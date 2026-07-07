let client;
let extractTemplateCommandDisposable;
let claudeCodeCommandDisposable;
let renameTemplateCommandDisposable;
let explorerDisposables = [];
let statusBarItem;

// A small activity-bar presence: spinner while the project (re)indexes,
// a rocket with index stats afterwards.
const setupIndexingStatusBar = () => {
    const { window, StatusBarAlignment } = require("vscode");

    statusBarItem =
        statusBarItem ||
        window.createStatusBarItem(StatusBarAlignment.Left, 0);

    client.onNotification(
        "meteorImpact/indexing",
        ({ busy, templates, methods, publications } = {}) => {
            if (busy) {
                statusBarItem.text = "$(sync~spin) Meteor: indexing...";
                statusBarItem.tooltip = "Meteor Impact is indexing the project";
            } else {
                statusBarItem.text = "$(rocket) Meteor";
                statusBarItem.tooltip = `Meteor Impact — ${templates} templates, ${methods} methods, ${publications} publications indexed`;
            }
            statusBarItem.show();
        }
    );
};

/**
 * The "Extract selection to template..." code action carries this command:
 * ask for the template name (LSP has no input box), then let the server
 * build and apply the workspace edit.
 */
const registerExtractTemplateCommand = () => {
    const { commands, window } = require("vscode");

    extractTemplateCommandDisposable?.dispose?.();
    extractTemplateCommandDisposable = commands.registerCommand(
        "meteorImpact.extractTemplate",
        async (args) => {
            const templateName = await window.showInputBox({
                prompt: "Name for the extracted template",
                value: args?.suggestedName,
                validateInput: (value) =>
                    /^[\w-]+$/.test(value)
                        ? undefined
                        : "Template names can only contain letters, numbers, _ and -.",
            });

            if (!templateName) return;

            await client.sendRequest("meteorImpact/extractTemplate", {
                ...args,
                templateName,
            });
        }
    );
};

const connectToLanguageServer = async (asAbsolutePath) => {
    const {
        TransportKind,
        LanguageClient,
    } = require("vscode-languageclient/node");
    const path = require("path");

    const serverModule = asAbsolutePath(
        path.join("server", "src", "server.js")
    );

    const defaultServerOptions = {
        module: serverModule,
        transport: TransportKind.ipc,
    };
    const serverOptions = {
        run: defaultServerOptions,
        debug: {
            ...defaultServerOptions,
            options: { execArgv: ["--nolazy", "--inspect=6009"] },
        },
    };

    const clientOptions = {
        documentSelector: [
            { scheme: "file", language: "html" },
            { scheme: "file", language: "javascript" },
            { scheme: "file", language: "typescript" },
            { scheme: "file", language: "spacebars" },
        ],
        synchronize: {
            configurationSection: "conf.settingsEditor.meteorImpact",
        },
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        "meteor-impact-language-server",
        "Meteor Impact Language Server",
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    await client.start();
    registerExtractTemplateCommand();

    const { registerClaudeCodeCommand } = require("./claude-code");
    claudeCodeCommandDisposable?.dispose?.();
    claudeCodeCommandDisposable = registerClaudeCodeCommand();

    setupIndexingStatusBar();

    const { commands } = require("vscode");
    const { renameTemplate } = require("./rename-template");
    renameTemplateCommandDisposable?.dispose?.();
    renameTemplateCommandDisposable = commands.registerCommand(
        "meteorImpact.renameTemplate",
        (clickedUri) => renameTemplate(clickedUri, client)
    );

    const { registerMeteorExplorer } = require("./meteor-explorer");
    explorerDisposables.forEach((disposable) => disposable?.dispose?.());
    explorerDisposables = registerMeteorExplorer(client);

    return client;
};

const stopServer = () => {
    extractTemplateCommandDisposable?.dispose?.();
    extractTemplateCommandDisposable = undefined;
    claudeCodeCommandDisposable?.dispose?.();
    claudeCodeCommandDisposable = undefined;
    renameTemplateCommandDisposable?.dispose?.();
    renameTemplateCommandDisposable = undefined;
    explorerDisposables.forEach((disposable) => disposable?.dispose?.());
    explorerDisposables = [];
    statusBarItem?.dispose?.();
    statusBarItem = undefined;

    if (!client) return;
    client.stop();
};

module.exports = { connectToLanguageServer, stopServer };
