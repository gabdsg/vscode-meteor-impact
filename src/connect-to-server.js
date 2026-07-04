let client;
let extractTemplateCommandDisposable;
let renameTemplateCommandDisposable;

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
    setupNotifications();
    registerExtractTemplateCommand();

    const { commands } = require("vscode");
    const { renameTemplate } = require("./rename-template");
    renameTemplateCommandDisposable?.dispose?.();
    renameTemplateCommandDisposable = commands.registerCommand(
        "meteorImpact.renameTemplate",
        (clickedUri) => renameTemplate(clickedUri, client)
    );

    return client;
};

const setupNotifications = () => {
    if (!client) {
        throw new Error(
            "Too soon to setup notifications, wait for the server connection."
        );
    }

    client.onNotification("errors/parsing", (filesPath) => {
        if (!filesPath) {
            return;
        }

        const { window } = require("vscode");
        window.showErrorMessage(
            `Meteor Impact was unable to parse the following files: ${filesPath}.
             If parsing errors are expected for such files, remember to add them to the excluded files list on the extension settings.`
        );
    });
};

const stopServer = () => {
    extractTemplateCommandDisposable?.dispose?.();
    extractTemplateCommandDisposable = undefined;
    renameTemplateCommandDisposable?.dispose?.();
    renameTemplateCommandDisposable = undefined;

    if (!client) return;
    client.stop();
};

module.exports = { connectToLanguageServer, stopServer };
