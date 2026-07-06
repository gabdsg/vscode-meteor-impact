const vscode = require("vscode");
const { computeClosingTagHints } = require("./closing-tag-hints");

/**
 * Ghost-text hints after the closers of long constructs: the opening
 * condition at {{/if}}/{{else}}, the id/classes at </div>. Purely
 * decorative - computed from the buffer, themed like CodeLens text.
 */

const decorationType = () =>
    vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            margin: "0 0 0 1.5em",
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

const hintsEnabled = () =>
    vscode.workspace
        .getConfiguration()
        .get("conf.settingsEditor.meteorImpact.closingTagHints") !== false;

const registerClosingTagHints = () => {
    const decoration = decorationType();
    let timer;

    const refresh = (editor) => {
        if (!editor || editor.document.languageId !== "spacebars") return;

        if (!hintsEnabled()) {
            editor.setDecorations(decoration, []);
            return;
        }

        const document = editor.document;
        let hints;
        try {
            hints = computeClosingTagHints(document.getText());
        } catch (e) {
            return;
        }

        editor.setDecorations(
            decoration,
            hints.map(({ offset, text }) => {
                const position = document.positionAt(offset);
                return {
                    range: new vscode.Range(position, position),
                    renderOptions: {
                        after: { contentText: `« ${text}` },
                    },
                };
            })
        );
    };

    const refreshSoon = (editor) => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(editor), 250);
    };

    refresh(vscode.window.activeTextEditor);

    const subscriptions = [
        vscode.window.onDidChangeActiveTextEditor((editor) =>
            refresh(editor)
        ),
        vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                refreshSoon(editor);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("conf.settingsEditor.meteorImpact")) {
                refresh(vscode.window.activeTextEditor);
            }
        }),
    ];

    return {
        dispose: () => {
            clearTimeout(timer);
            decoration.dispose();
            subscriptions.forEach((s) => s.dispose());
        },
    };
};

module.exports = { registerClosingTagHints };
