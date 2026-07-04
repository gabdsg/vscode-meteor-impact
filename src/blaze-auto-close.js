const { window, workspace, SnippetString } = require("vscode");
const { resolveBlockAutoClose } = require("./blaze-block-close");

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
        const decision = resolveBlockAutoClose(
            event.document.getText(),
            change.rangeOffset,
            change.text
        );
        if (!decision) return;

        const position = event.document.positionAt(
            change.rangeOffset + change.text.length
        );
        const snippet =
            decision.mode === "inline"
                ? `$0{{/${decision.blockName}}}`
                : `$0\n${decision.indent}{{/${decision.blockName}}}`;

        editor.insertSnippet(new SnippetString(snippet), position);
    });

module.exports = { registerBlazeBlockAutoClose };
