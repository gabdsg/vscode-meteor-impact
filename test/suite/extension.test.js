const assert = require("assert");
const path = require("path");
const vscode = require("vscode");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const workspaceRoot = () => vscode.workspace.workspaceFolders[0].uri.fsPath;

suite("Meteor Impact integration", function () {
    this.timeout(120000);

    test("activates in a Meteor workspace", async () => {
        const extension = vscode.extensions.getExtension(
            "gabdsg.meteor-impact"
        );
        assert.ok(extension, "Extension not found");

        await extension.activate();
        assert.strictEqual(extension.isActive, true);
    });

    test("registers its commands", async () => {
        const commands = await vscode.commands.getCommands(true);

        [
            "meteorImpact.createTemplate",
            "meteorImpact.goToCounterpart",
            "meteorImpact.generateSettingsTypes",
            "meteorImpact.refreshExplorer",
        ].forEach((command) =>
            assert.ok(commands.includes(command), `Missing ${command}`)
        );
    });

    test("language server resolves a helper definition from HTML", async () => {
        const htmlUri = vscode.Uri.file(
            path.join(workspaceRoot(), "client", "hello.html")
        );
        const document = await vscode.workspace.openTextDocument(htmlUri);
        await vscode.window.showTextDocument(document);

        // Position on "greeting" inside {{greeting}}.
        const position = new vscode.Position(1, 13);

        // The language server indexes asynchronously: poll until it
        // answers or we give up.
        let definitions = [];
        for (let attempt = 0; attempt < 60; attempt++) {
            definitions = await vscode.commands.executeCommand(
                "vscode.executeDefinitionProvider",
                htmlUri,
                position
            );
            if (definitions?.length) break;
            await sleep(1000);
        }

        assert.ok(definitions?.length, "No definition resolved");
        const target = definitions[0].uri || definitions[0].targetUri;
        assert.ok(
            target.fsPath.endsWith("hello.ts"),
            `Expected hello.ts, got ${target.fsPath}`
        );
    });
});
