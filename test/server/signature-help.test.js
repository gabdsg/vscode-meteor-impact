const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    SignatureHelpProvider,
} = require("../../server/src/signature-help-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new SignatureHelpProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("SignatureHelpProvider", () => {
    it("captures helper parameter text at index time", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const helper =
            indexer.blazeIndexer.templateIndexMap["foo"].helpers[
                "formattedName"
            ];
        assert.deepStrictEqual(helper.signature.params, ["person?: Person"]);
    });

    it("shows the helper signature inside a mustache call", async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");

        // Right after "formatAge " inside {{formatAge person}} on line 2 of
        // list.html (character 41 is on "person").
        const help = createProvider(indexer).onSignatureHelpRequest({
            position: { line: 2, character: 41 },
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });

        assert.ok(help, "Expected signature help");
        assert.strictEqual(
            help.signatures[0].label,
            "formatAge(person: Person)"
        );
        assert.strictEqual(help.activeParameter, 0);
    });

    it("shows the method signature in Meteor.callAsync arguments", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        const callerLines = fs
            .readFileSync(path.join(rootPath, "client/caller.ts"), "utf-8")
            .split("\n");

        const line = callerLines.findIndex((l) => l.includes("callAsync"));
        // Position inside the second argument ("new task").
        const character = callerLines[line].indexOf('"new task"') + 3;

        const help = createProvider(indexer).onSignatureHelpRequest({
            position: { line, character },
            textDocument: {
                uri: fixtureUri("methods-project", "client/caller.ts"),
            },
        });

        assert.ok(help, "Expected signature help");
        assert.strictEqual(
            help.signatures[0].label,
            "tasks.insert(text: string)"
        );
        assert.strictEqual(help.activeParameter, 0);
    });

    it("returns nothing outside calls", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // Plain HTML content position.
        const help = createProvider(indexer).onSignatureHelpRequest({
            position: { line: 1, character: 6 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.strictEqual(help, undefined);
    });

    it("returns nothing for parameterless handlers", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // {{barTitle}} has no parameters; position right after the name.
        const help = createProvider(indexer).onSignatureHelpRequest({
            position: { line: 1, character: 19 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/bar.html"),
            },
        });

        assert.strictEqual(help, undefined);
    });
});
