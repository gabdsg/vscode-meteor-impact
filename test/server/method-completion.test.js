const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("CompletionProvider - Meteor.call/subscribe names", () => {
    let provider;
    let callerLines;

    const callerUri = fixtureUri("methods-project", "client/caller.ts");

    before(async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        provider = new CompletionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
        callerLines = fs
            .readFileSync(path.join(rootPath, "client/caller.ts"), "utf-8")
            .split("\n");
    });

    it("completes method names in Meteor.callAsync string argument", () => {
        const line = callerLines.findIndex((l) => l.includes("callAsync"));
        // Cursor right after `Meteor.callAsync("tasks.`
        const character =
            callerLines[line].indexOf('callAsync("') + 'callAsync("'.length + 6;

        const items = provider.onCompletionRequest({
            position: { line, character },
            textDocument: { uri: callerUri },
        });

        const labels = (items || []).map(({ label }) => label);
        assert.ok(labels.includes("tasks.insert"));
        assert.ok(labels.includes("tasks.remove"));
        assert.ok(!labels.includes("tasks.all"), "Publications not offered");
    });

    it("completes publication names in Meteor.subscribe string argument", () => {
        const line = callerLines.findIndex((l) => l.includes("subscribe"));
        // Cursor right after `Meteor.subscribe("`
        const character =
            callerLines[line].indexOf('subscribe("') + 'subscribe("'.length;

        const items = provider.onCompletionRequest({
            position: { line, character },
            textDocument: { uri: callerUri },
        });

        const labels = (items || []).map(({ label }) => label);
        assert.deepStrictEqual(labels, ["tasks.all"]);
    });

    it("does not trigger outside call arguments", () => {
        // Cursor at the start of the callAsync line, before any string.
        const line = callerLines.findIndex((l) => l.includes("callAsync"));

        const items = provider.onCompletionRequest({
            position: { line, character: 4 },
            textDocument: { uri: callerUri },
        });

        assert.ok(
            !(items || []).some(({ label }) => label === "tasks.insert")
        );
    });
});
