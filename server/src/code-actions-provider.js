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

    onCodeActionRequest({ textDocument: { uri }, context }) {
        try {
            return (context?.diagnostics || [])
                .filter(
                    ({ source, data }) =>
                        source === "meteor-toolbox" && !!data?.kind
                )
                .map((diagnostic) => this.createAction({ uri, diagnostic }))
                .filter(Boolean);
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
