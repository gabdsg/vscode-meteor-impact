const assert = require("assert");

const { SymbolsProvider } = require("../../server/src/symbols-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new SymbolsProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("SymbolsProvider", () => {
    it("returns template symbols for HTML files", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const symbols = createProvider(indexer).onDocumentSymbolRequest({
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.strictEqual(symbols.length, 1);
        assert.strictEqual(symbols[0].name, "foo");
        assert.strictEqual(symbols[0].detail, "template");
    });

    it("returns helpers grouped by template for JS/TS files", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const symbols = createProvider(indexer).onDocumentSymbolRequest({
            textDocument: { uri: fixtureUri("basic-project", "client/foo.ts") },
        });

        const fooSymbol = symbols.find(({ name }) => name === "foo");
        assert.ok(fooSymbol, "Expected a symbol for template foo");

        const childNames = fooSymbol.children.map(({ name }) => name);
        assert.ok(childNames.includes("formattedName"));
        assert.ok(childNames.includes("peopleCount"));
    });

    it("returns event symbols for event maps", async () => {
        const { indexer } = await loadFixtureIndexer("events-project");

        const symbols = createProvider(indexer).onDocumentSymbolRequest({
            textDocument: {
                uri: fixtureUri("events-project", "client/widget.ts"),
            },
        });

        const widgetSymbol = symbols.find(({ name }) => name === "widget");
        assert.ok(widgetSymbol, "Expected a symbol for template widget");

        const childNames = widgetSymbol.children.map(({ name }) => name);
        assert.ok(childNames.includes("click .js-save"));
        assert.ok(childNames.includes("click .js-cancel"));
    });

    it("returns method and publication symbols", async () => {
        const { indexer } = await loadFixtureIndexer("methods-project");

        const symbols = createProvider(indexer).onDocumentSymbolRequest({
            textDocument: {
                uri: fixtureUri("methods-project", "server/methods.ts"),
            },
        });

        const names = symbols.map(({ name }) => name);
        assert.ok(names.includes("tasks.insert"));
        assert.ok(names.includes("tasks.remove"));
        assert.ok(names.includes("tasks.all"));
    });

    it("searches workspace symbols by substring", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const symbols = createProvider(indexer).onWorkspaceSymbolRequest({
            query: "formatted",
        });

        assert.strictEqual(symbols.length, 1);
        assert.strictEqual(symbols[0].name, "formattedName");
        assert.strictEqual(symbols[0].containerName, "foo");
        assert.ok(symbols[0].location.uri.endsWith("foo.ts"));
    });

    it("returns all symbols for an empty query", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const symbols = createProvider(indexer).onWorkspaceSymbolRequest({
            query: "",
        });

        const names = symbols.map(({ name }) => name);
        // Templates and helpers from both files.
        ["foo", "bar", "formattedName", "peopleCount", "barTitle"].forEach(
            (expected) => assert.ok(names.includes(expected), expected)
        );
    });
});
