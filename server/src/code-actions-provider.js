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
                              source === "meteor-toolbox" && !!data?.kind
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
     * {{> partial}} and append a new <template> containing it. The
     * generated name is a placeholder - a single rename (F2) on it updates
     * the partial and the tag together.
     */
    createExtractTemplateAction({ uri, range }) {
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
        if (!this.isInsideOneTemplateBody(content, startOffset, endOffset)) {
            return;
        }

        const templateName = this.generateExtractedTemplateName();

        const { TextEdit } = require("vscode-languageserver");
        const stub = `${
            content.endsWith("\n") ? "" : "\n"
        }\n<template name="${templateName}">\n${this.reindentExtractedBody(
            selectedText
        )}\n</template>\n`;

        return {
            title: `Extract selection to template "${templateName}"`,
            kind: "refactor.extract",
            edit: {
                changes: {
                    [parsedUri.toString()]: [
                        TextEdit.replace(range, `{{> ${templateName}}}`),
                        TextEdit.insert(
                            this.endOfFilePosition(content),
                            stub
                        ),
                    ],
                },
            },
        };
    }

    isInsideOneTemplateBody(content, startOffset, endOffset) {
        const { getTemplateTags } = require("./text-utils");

        const tags = getTemplateTags(content);
        for (let i = 0; i < tags.length; i++) {
            if (tags[i].isClosing) continue;

            const closing = tags
                .slice(i + 1)
                .find(({ isClosing }) => isClosing);
            if (!closing) continue;

            if (startOffset >= tags[i].end && endOffset <= closing.start) {
                return true;
            }
        }

        return false;
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
