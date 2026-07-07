/**
 * Client side of the "... with Claude Code" code actions: builds the prompt
 * and hands it to the Claude Code CLI in an integrated terminal.
 *
 * The Claude Code VS Code extension exposes no API to inject a prompt into
 * its panel input, so the CLI REPL is the integration point: the prompt is
 * typed into it with sendText(prompt, false) so the user can review/edit
 * and submit it themselves. The claudeCodeAutoSend setting submits
 * immediately instead.
 */
const TERMINAL_NAME = "Claude Code (Meteor Impact)";

let terminal;

const getConfig = () => {
    const { workspace } = require("vscode");
    const config =
        workspace
            .getConfiguration()
            .get("conf.settingsEditor.meteorImpact") || {};

    return {
        autoSend: !!config.claudeCodeAutoSend,
        cliPath: config.claudeCodeCliPath || "claude",
    };
};

const findLiveTerminal = () => {
    const { window } = require("vscode");

    if (terminal && terminal.exitStatus === undefined) return terminal;

    return window.terminals.find(
        ({ name, exitStatus }) =>
            name === TERMINAL_NAME && exitStatus === undefined
    );
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runClaudeCode = async (payload) => {
    const { window, workspace } = require("vscode");
    const { buildPrompt } = require("./claude-code-prompts");

    let prompt;
    try {
        prompt = buildPrompt(payload);
    } catch (e) {
        window.showErrorMessage(`Meteor Impact: ${e.message}`);
        return;
    }

    const { autoSend, cliPath } = getConfig();

    const existing = findLiveTerminal();
    // The CLI runs as the terminal process itself: no shell startup files
    // in between, and a missing binary surfaces as an immediate exit.
    terminal =
        existing ||
        window.createTerminal({
            name: TERMINAL_NAME,
            shellPath: cliPath,
            cwd: workspace.workspaceFolders?.[0]?.uri.fsPath,
        });
    terminal.show();

    // The REPL eats input typed while it boots; a fresh terminal needs a
    // moment before the prompt can be prefilled.
    await delay(existing ? 150 : 2500);

    if (terminal.exitStatus !== undefined) {
        window.showErrorMessage(
            `Meteor Impact: could not start the Claude Code CLI ("${cliPath}"). ` +
                "Install it or point the meteorImpact claudeCodeCliPath " +
                "setting at the executable."
        );
        return;
    }

    terminal.sendText(prompt, autoSend);
};

const registerClaudeCodeCommand = () => {
    const { commands, window } = require("vscode");

    const commandDisposable = commands.registerCommand(
        "_meteorImpact.claudeCode.run",
        runClaudeCode
    );
    const closeDisposable = window.onDidCloseTerminal((closed) => {
        if (closed === terminal) terminal = undefined;
    });

    return {
        dispose() {
            commandDisposable.dispose();
            closeDisposable.dispose();
        },
    };
};

module.exports = { registerClaudeCodeCommand };
