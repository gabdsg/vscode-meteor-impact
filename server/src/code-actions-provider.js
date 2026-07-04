const { ServerBase } = require("./helpers");

const IDENTIFIER_REGEX = /^[A-Za-z_$][\w$]*$/;

/**
 * Quick fixes for the diagnostics we publish, driven by the structured
 * `data` payload each actionable diagnostic carries:
 * - create-template: append a <template> stub to the HTML file.
 * - create-helper: append a Template.X.helpers stub to the code-behind.
 * - remove-helper: delete an unused helper property.
 */
class CodeActionsProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onCodeActionRequest({ textDocument: { uri }, range, context }) {
        try {
            const matchesOnly = (kind) =>
                !context?.only?.length ||
                context.only.some((requested) => kind.startsWith(requested));

            const quickFixes = matchesOnly("quickfix")
                ? (context?.diagnostics || [])
                      .filter(
                          ({ source, data }) =>
                              source === "meteor-impact" && !!data?.kind
                      )
                      .map((diagnostic) =>
                          this.createAction({ uri, diagnostic })
                      )
                      .filter(Boolean)
                : [];

            const extractAction =
                matchesOnly("refactor.extract") &&
                this.createExtractTemplateAction({ uri, range });

            return [...quickFixes, ...(extractAction ? [extractAction] : [])];
        } catch (e) {
            console.warn(`Code actions failed for ${uri}. ${e}`);
        }
    }

    createAction({ uri, diagnostic }) {
        const handlers = {
            "create-template": () =>
                this.createTemplateAction({ uri, diagnostic }),
            "create-helper": () => this.createHelperAction({ uri, diagnostic }),
            "remove-helper": () => this.removeHelperAction({ diagnostic }),
            "create-method": () =>
                this.createMethodOrPublicationAction({
                    diagnostic,
                    isMethod: true,
                }),
            "create-publication": () =>
                this.createMethodOrPublicationAction({
                    diagnostic,
                    isMethod: false,
                }),
        };

        return handlers[diagnostic.data.kind]?.();
    }

    quickFix({ title, diagnostic, editUri, edits }) {
        return {
            title,
            kind: "quickfix",
            diagnostics: [diagnostic],
            edit: { changes: { [editUri.toString()]: edits } },
        };
    }

    // Insert position at the very end of the content.
    endOfFilePosition(content) {
        const { Position } = require("vscode-languageserver");

        const lines = content.split("\n");
        return Position.create(
            lines.length - 1,
            lines[lines.length - 1].length
        );
    }

    createTemplateAction({ uri, diagnostic }) {
        const { TextEdit } = require("vscode-languageserver");
        const { templateName } = diagnostic.data;

        const parsedUri = this.parseUri(uri);
        const content = this.getFileContent(parsedUri);

        const stub = `${content.endsWith("\n") ? "" : "\n"}\n<template name="${templateName}">\n    \n</template>\n`;

        return this.quickFix({
            title: `Create template "${templateName}" in this file`,
            diagnostic,
            editUri: parsedUri,
            edits: [TextEdit.insert(this.endOfFilePosition(content), stub)],
        });
    }

    createHelperAction({ uri, diagnostic }) {
        const { TextEdit } = require("vscode-languageserver");
        const { helperName, templateName } = diagnostic.data;

        // Prefer the file already defining helpers for this template,
        // otherwise the HTML file's code-behind sibling.
        const { existsSync } = require("fs");
        const targetUri =
            this.indexer.blazeIndexer.templateIndexMap[templateName]?.jsUri ||
            (existsSync(this.getSiblingJsUri(uri).fsPath) &&
                this.getSiblingJsUri(uri));
        if (!targetUri) return;

        const content = this.getFileContent(targetUri);

        const templateAccess = IDENTIFIER_REGEX.test(templateName)
            ? `Template.${templateName}`
            : `Template["${templateName}"]`;
        const helperKey = IDENTIFIER_REGEX.test(helperName)
            ? helperName
            : `"${helperName}"`;

        const stub = `${content.endsWith("\n") ? "" : "\n"}\n${templateAccess}.helpers({\n    ${helperKey}() {\n        return "";\n    },\n});\n`;

        return this.quickFix({
            title: `Create helper "${helperName}" on template "${templateName}"`,
            diagnostic,
            editUri: targetUri,
            edits: [TextEdit.insert(this.endOfFilePosition(content), stub)],
        });
    }

    /**
     * "Extract to template": replace the selected HTML with a
     * {{> partial}} and move it into a new <template>, together with the
     * helpers/events it uses. The action carries a command: the client
     * asks for the template name and then requests the actual edit via
     * meteorImpact/extractTemplate (see executeExtractTemplate).
     */
    createExtractTemplateAction({ uri, range }) {
        const context = this.getExtractTemplateContext({ uri, range });
        if (!context) return;

        const title = "Extract selection to template...";

        return {
            title,
            kind: "refactor.extract",
            command: {
                title,
                command: "meteorImpact.extractTemplate",
                arguments: [
                    {
                        uri: context.parsedUri.toString(),
                        range,
                        suggestedName: this.generateExtractedTemplateName(),
                    },
                ],
            },
        };
    }

    // Validate the selection and gather what every extract step needs.
    getExtractTemplateContext({ uri, range }) {
        if (!range || !this.isFileSpacebarsHTML(uri)) return;

        const { positionToOffset } = require("./text-utils");

        const parsedUri = this.parseUri(uri);
        const content = this.getFileContent(parsedUri);

        const startOffset = positionToOffset(content, range.start);
        const endOffset = positionToOffset(content, range.end);
        if (endOffset <= startOffset) return;

        const selectedText = content.slice(startOffset, endOffset);
        if (!selectedText.trim()) return;
        // Template tags can't be nested.
        if (/<\/?template\b/i.test(selectedText)) return;

        // The whole selection must live inside a single template body.
        const region = this.findWrappingTemplateRegion(
            content,
            startOffset,
            endOffset
        );
        if (!region) return;

        return {
            parsedUri,
            content,
            range,
            startOffset,
            endOffset,
            selectedText,
            region,
        };
    }

    findWrappingTemplateRegion(content, startOffset, endOffset) {
        const { getTemplateTags } = require("./text-utils");

        const tags = getTemplateTags(content);
        for (let i = 0; i < tags.length; i++) {
            if (tags[i].isClosing) continue;

            const closing = tags
                .slice(i + 1)
                .find(({ isClosing }) => isClosing);
            if (!closing) continue;

            if (startOffset >= tags[i].end && endOffset <= closing.start) {
                return {
                    templateName: tags[i].name,
                    bodyStart: tags[i].end,
                    bodyEnd: closing.start,
                };
            }
        }

        return;
    }

    async executeExtractTemplate({ uri, range, templateName }) {
        const fail = (message) => {
            this.serverInstance.window?.showErrorMessage?.(message);
            return { applied: false, reason: message };
        };

        try {
            if (!templateName || !/^[\w-]+$/.test(templateName)) {
                return fail(
                    `"${templateName}" is not a valid template name.`
                );
            }

            if (this.indexer.blazeIndexer.templateIndexMap[templateName]) {
                return fail(
                    `A template named "${templateName}" already exists.`
                );
            }

            const changes = this.buildExtractTemplateEdit({
                uri,
                range,
                templateName,
            });
            if (!changes) {
                return fail("The selection can't be extracted.");
            }

            await this.serverInstance.workspace.applyEdit({ changes });
            return { applied: true };
        } catch (e) {
            console.error(`Extract template failed. ${e}`);
            return fail(`Extract template failed: ${e.message}`);
        }
    }

    buildExtractTemplateEdit({ uri, range, templateName }) {
        const context = this.getExtractTemplateContext({ uri, range });
        if (!context) return;

        const { TextEdit } = require("vscode-languageserver");
        const { parsedUri, content, selectedText } = context;

        const changes = {};
        const addEdit = (uriString, edit) => {
            changes[uriString] = changes[uriString] || [];
            changes[uriString].push(edit);
        };

        // Blaze partials inherit the parent data context but not block
        // bindings: pass the outer block variables the selection uses as
        // keyword arguments, so they arrive through the data context.
        const partialArguments = this.getFreeBlockVariables(context)
            .map((name) => ` ${name}=${name}`)
            .join("");

        const stub = `${
            content.endsWith("\n") ? "" : "\n"
        }\n<template name="${templateName}">\n${this.reindentExtractedBody(
            selectedText
        )}\n</template>\n`;

        addEdit(
            parsedUri.toString(),
            TextEdit.replace(range, `{{> ${templateName}${partialArguments}}}`)
        );
        addEdit(
            parsedUri.toString(),
            TextEdit.insert(this.endOfFilePosition(content), stub)
        );

        this.addCodeBehindExtractEdits({ context, templateName, addEdit });

        return changes;
    }

    getFreeBlockVariables({ content, startOffset, selectedText }) {
        const { getBlockVariablesAtOffset } = require("./text-utils");

        return getBlockVariablesAtOffset(content, startOffset)
            .map(({ name }) => name)
            .filter((name, index, names) => names.indexOf(name) === index)
            .filter((name) =>
                new RegExp(`\\{\\{[^{}]*\\b${name}\\b`).test(selectedText)
            );
    }

    /**
     * Move the helpers and events the selection uses to the new template's
     * code-behind. Entries still used by the rest of the parent template
     * are copied instead of moved; moves whose property doesn't cleanly
     * own its lines are downgraded to copies.
     */
    addCodeBehindExtractEdits({ context, templateName, addEdit }) {
        const { positionToOffset } = require("./text-utils");
        const { parsedUri, content, startOffset, endOffset, region } = context;

        const { blazeIndexer } = this.indexer;
        const parent = blazeIndexer.templateIndexMap[region.templateName];
        if (!parent) return;

        const offsetOf = ({ line, column }) =>
            positionToOffset(content, { line: line - 1, character: column });
        const isSelected = (offset) =>
            offset >= startOffset && offset < endOffset;

        // Helpers: decide by where their usages live.
        const helpersToExtract = [];
        for (const [name, entry] of Object.entries(parent.helpers || {})) {
            if (!entry.uri) continue;

            const usageOffsets = (blazeIndexer.htmlUsageMap[name] || [])
                .filter(({ uri }) => uri.fsPath === parsedUri.fsPath)
                .map(({ node }) => offsetOf(node.loc.start))
                .filter(
                    (offset) =>
                        offset >= region.bodyStart && offset < region.bodyEnd
                );

            const selectedUsages = usageOffsets.filter(isSelected);
            if (!selectedUsages.length) continue;

            helpersToExtract.push({
                entry,
                move: selectedUsages.length === usageOffsets.length,
            });
        }

        // Events: decide by where the elements their selectors target live.
        const eventsToExtract = [];
        for (const [eventKey, entry] of Object.entries(parent.events || {})) {
            if (!entry.uri) continue;

            const selectors = eventKey.match(/[.#][\w-]+/g) || [];
            const elementOffsets = selectors
                .flatMap(
                    (selector) =>
                        blazeIndexer.templateSelectorsMap[
                            region.templateName
                        ]?.[selector] || []
                )
                .filter(({ uri }) => uri.fsPath === parsedUri.fsPath)
                .map(({ start }) => offsetOf(start));

            const selectedElements = elementOffsets.filter(isSelected);
            if (!selectedElements.length) continue;

            eventsToExtract.push({
                entry,
                move: selectedElements.length === elementOffsets.length,
            });
        }

        if (!helpersToExtract.length && !eventsToExtract.length) return;

        // Group by defining file: helpers/events can be split across files.
        const byFile = new Map();
        const addToGroup = (kind, item) => {
            const fsPath = item.entry.uri.fsPath;
            if (!byFile.has(fsPath)) {
                byFile.set(fsPath, {
                    uri: item.entry.uri,
                    helpers: [],
                    events: [],
                });
            }
            byFile.get(fsPath)[kind].push(item);
        };
        helpersToExtract.forEach((item) => addToGroup("helpers", item));
        eventsToExtract.forEach((item) => addToGroup("events", item));

        const { TextEdit, Range } = require("vscode-languageserver");
        const templateAccess = IDENTIFIER_REGEX.test(templateName)
            ? `Template.${templateName}`
            : `Template["${templateName}"]`;

        for (const [fsPath, group] of byFile) {
            const jsContent = this.indexer.getSources()[fsPath]?.fileContent;
            if (!jsContent) continue;

            const uriString = group.uri.toString();
            const jsLines = jsContent.split("\n");

            const sliceProperty = ({ start, end }) =>
                jsContent.slice(
                    positionToOffset(jsContent, {
                        line: start.line - 1,
                        character: start.column,
                    }),
                    positionToOffset(jsContent, {
                        line: end.line - 1,
                        character: end.column,
                    })
                );

            const deletePropertyLines = ({ start, end }) => {
                const firstLine = jsLines[start.line - 1] || "";
                const lastLine = jsLines[end.line - 1] || "";
                const isSafe =
                    !firstLine.slice(0, start.column).trim() &&
                    /^,?\s*$/.test(lastLine.slice(end.column));
                if (!isSafe) return false;

                addEdit(
                    uriString,
                    TextEdit.del(
                        Range.create(start.line - 1, 0, end.line, 0)
                    )
                );
                return true;
            };

            for (const item of [...group.helpers, ...group.events]) {
                if (item.move) deletePropertyLines(item.entry);
            }

            const buildBlock = (kind, items) =>
                items.length
                    ? `\n${templateAccess}.${kind}({\n${items
                          .map(({ entry }) => `    ${sliceProperty(entry)},`)
                          .join("\n")}\n});\n`
                    : "";

            addEdit(
                uriString,
                TextEdit.insert(
                    this.endOfFilePosition(jsContent),
                    `${jsContent.endsWith("\n") ? "" : "\n"}${buildBlock(
                        "helpers",
                        group.helpers
                    )}${buildBlock("events", group.events)}`
                )
            );
        }
    }

    generateExtractedTemplateName() {
        const { templateIndexMap } = this.indexer.blazeIndexer;

        const base = "extractedTemplate";
        if (!templateIndexMap[base]) return base;

        let counter = 2;
        while (templateIndexMap[`${base}${counter}`]) counter++;
        return `${base}${counter}`;
    }

    // Dedent the selection and re-indent it one level inside the new
    // template.
    reindentExtractedBody(selectedText) {
        const lines = selectedText.split("\n");

        const indents = lines
            .filter((line, index) => index > 0 && line.trim())
            .map((line) => line.match(/^\s*/)[0].length);
        const commonIndent = indents.length ? Math.min(...indents) : 0;

        return lines
            .map((line, index) => {
                if (!line.trim()) return "";

                const dedented =
                    index === 0
                        ? line.trimStart()
                        : line.slice(Math.min(commonIndent, line.length));
                return `    ${dedented}`;
            })
            .join("\n")
            .replace(/^\n+|\n+$/g, "");
    }

    // Stub goes to a file already defining methods/publications, so the
    // fix is only offered when such a file exists.
    createMethodOrPublicationAction({ diagnostic, isMethod }) {
        const { TextEdit } = require("vscode-languageserver");
        const { name } = diagnostic.data;

        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;
        const existingDefinition = Object.values(
            isMethod ? methodsMap : publicationsMap
        ).find(({ uri }) => !!uri);
        if (!existingDefinition) return;

        const targetUri = existingDefinition.uri;
        const content = this.getFileContent(targetUri);

        const methodKey = IDENTIFIER_REGEX.test(name) ? name : `"${name}"`;
        const stub = isMethod
            ? `${
                  content.endsWith("\n") ? "" : "\n"
              }\nMeteor.methods({\n    ${methodKey}() {\n\n    },\n});\n`
            : `${
                  content.endsWith("\n") ? "" : "\n"
              }\nMeteor.publish("${name}", function () {\n    return [];\n});\n`;

        return this.quickFix({
            title: `Create ${
                isMethod ? "method" : "publication"
            } "${name}"`,
            diagnostic,
            editUri: targetUri,
            edits: [TextEdit.insert(this.endOfFilePosition(content), stub)],
        });
    }

    removeHelperAction({ diagnostic }) {
        const { TextEdit, Range } = require("vscode-languageserver");
        const { helperName, templateName } = diagnostic.data;

        const helper =
            this.indexer.blazeIndexer.templateIndexMap[templateName]?.helpers?.[
                helperName
            ];
        if (!helper?.uri) return;

        const content =
            this.indexer.getSources()[helper.uri.fsPath]?.fileContent;
        if (!content) return;

        // Only offer whole-line removal when the property owns its lines:
        // nothing but whitespace before it, nothing but a trailing comma
        // after it.
        const lines = content.split("\n");
        const firstLine = lines[helper.start.line - 1] || "";
        const lastLine = lines[helper.end.line - 1] || "";
        const isSafe =
            !firstLine.slice(0, helper.start.column).trim() &&
            /^,?\s*$/.test(lastLine.slice(helper.end.column));
        if (!isSafe) return;

        return this.quickFix({
            title: `Remove unused helper "${helperName}"`,
            diagnostic,
            editUri: helper.uri,
            edits: [
                TextEdit.del(
                    Range.create(helper.start.line - 1, 0, helper.end.line, 0)
                ),
            ],
        });
    }
}

module.exports = { CodeActionsProvider };
