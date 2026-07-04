const assert = require("assert");

const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    getBlockVariablesAtOffset,
} = require("../../server/src/text-utils");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Block variable awareness", () => {
    let indexer;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("block-vars-project"));
    });

    it("extracts each-in and let bindings for an offset", () => {
        const content = [
            "{{#each person in people}}",
            "    {{#let total=count}}",
            "        x",
            "    {{/let}}",
            "    y",
            "{{/each}}",
            "z",
        ].join("\n");

        const atX = getBlockVariablesAtOffset(content, content.indexOf("x"));
        assert.deepStrictEqual(
            atX.map(({ name }) => name).sort(),
            ["person", "total"]
        );

        const atY = getBlockVariablesAtOffset(content, content.indexOf("y"));
        assert.deepStrictEqual(atY.map(({ name }) => name), ["person"]);

        const atZ = getBlockVariablesAtOffset(content, content.indexOf("z"));
        assert.deepStrictEqual(atZ, []);
    });

    it("keeps unclosed blocks in scope while typing", () => {
        const content = "{{#each item in items}}\n    {{i";

        const variables = getBlockVariablesAtOffset(content, content.length);
        assert.deepStrictEqual(
            variables.map(({ name }) => name),
            ["item"]
        );
    });

    it("offers block variables in mustache completion", () => {
        const provider = new CompletionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Inside {{person.name}} on line 2 (0-based) of list.html.
        const items = provider.onCompletionRequest({
            position: { line: 2, character: 16 },
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });

        const labels = items.map(({ label }) => label);
        assert.ok(labels.includes("person"), "Expected the each-in binding");
        assert.ok(labels.includes("people"), "Helpers still offered");

        const personItem = items.find(({ label }) => label === "person");
        assert.ok(personItem.detail.includes("#each"));
    });

    it("offers let bindings inside the let block only", () => {
        const provider = new CompletionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Inside {{total}} on line 6 (0-based) of list.html.
        const items = provider.onCompletionRequest({
            position: { line: 6, character: 16 },
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });

        const labels = items.map(({ label }) => label);
        assert.ok(labels.includes("total"));
        assert.ok(labels.includes("label"));
        assert.ok(!labels.includes("person"), "each binding out of scope");
    });

    it("does not flag block variables as unresolved helpers", () => {
        const diagnosticsByUri = new DiagnosticsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        ).computeDiagnostics();

        // {{person "x"}} is a call on a block variable: no warning. The
        // fixture has no other problems either.
        const htmlKey = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith("list.html")
        );
        assert.strictEqual(htmlKey, undefined, "Expected no diagnostics");
    });
});
