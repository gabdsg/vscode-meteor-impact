const { window, workspace, SnippetString } = require("vscode");

const BLOCK_OPEN_AT_END_REGEX = /\{\{#([\w-]+)(?:\s+[^{}]*)?\}\}\s*$/;

const isBlockBalanced = (content, blockName) => {
    const opens = (
        content.match(new RegExp(`\\{\\{#${blockName}\\b`, "g")) || []
    ).length;
    const closes = (
        content.match(new RegExp(`\\{\\{\\/${blockName}\\}\\}`, "g")) || []
    ).length;

    return closes >= opens;
};

/**
 * Auto-insert the {{/block}} for a just-completed {{#block ...}}. Two
 * triggers, covering both typing styles:
 * - typing the final "}" of the open tag,
 * - pressing Enter right after the open tag (the flow when auto-closing
 *   pairs already placed the braces).
 */
const registerBlazeBlockAutoClose = () =>
    workspace.onDidChangeTextDocument((event) => {
        const editor = window.activeTextEditor;
        if (
            !editor ||
            event.document !== editor.document ||
            event.document.languageId !== "spacebars" ||
            event.contentChanges.length !== 1
        ) {
            return;
        }

        const change = event.contentChanges[0];
        const typedBrace =
            change.text.length <= 2 && change.text.endsWith("}");
        const pressedEnter = /^\r?\n[ \t]*$/.test(change.text);
        if (!typedBrace && !pressedEnter) return;

        const content = event.document.getText();
        // For Enter, look at the text before the newline; for "}", at the
        // text through the typed brace.
        const anchorOffset = typedBrace
            ? change.rangeOffset + change.text.length
            : change.rangeOffset;

        const match = content
            .slice(0, anchorOffset)
            .match(BLOCK_OPEN_AT_END_REGEX);
        if (!match) return;

        const blockName = match[1];
        if (isBlockBalanced(content, blockName)) return;

        const cursorOffset = change.rangeOffset + change.text.length;
        const position = event.document.positionAt(cursorOffset);

        if (typedBrace) {
            // {{#if x}}| -> {{#if x}}|{{/if}}
            editor.insertSnippet(
                new SnippetString(`$0{{/${blockName}}}`),
                position
            );
        } else {
            // Enter after the open tag: close on the line below, aligned
            // with the opening line's indentation.
            const openLine = event.document.lineAt(
                event.document.positionAt(change.rangeOffset).line
            );
            const indent = openLine.text.match(/^[ \t]*/)[0];
            editor.insertSnippet(
                new SnippetString(`$0\n${indent}{{/${blockName}}}`),
                position
            );
        }
    });

module.exports = { registerBlazeBlockAutoClose };
