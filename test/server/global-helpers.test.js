const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("BlazeIndexer - Template.registerHelper", () => {
    let indexer;
    let definitionProvider;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("global-helpers-project"));
        definitionProvider = new DefinitionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
    });

    it("indexes global helpers", () => {
        const globalHelper = indexer.blazeIndexer.globalHelpersMap[
            "formatCurrency"
        ];

        assert.ok(globalHelper, "Expected formatCurrency to be indexed");
        assert.ok(globalHelper.uri.fsPath.endsWith("global-helpers.ts"));
        assert.strictEqual(globalHelper.start.line, 3);
    });

    it("falls back to global helpers on definition requests from HTML", () => {
        // Position of "formatCurrency" inside {{formatCurrency price}}.
        const location = definitionProvider.onDefinitionRequest({
            position: { line: 1, character: 12 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("global-helpers.ts"));
        assert.strictEqual(location.range.start.line, 2);
    });

    it("resolves global helpers inside templates that have no scoped helpers", () => {
        // Position of "formatCurrency" inside the "about" template, which
        // has no code-behind helpers at all.
        const location = definitionProvider.onDefinitionRequest({
            position: { line: 5, character: 12 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("global-helpers.ts"));
    });

    it("still resolves template-scoped helpers first", () => {
        // Position of "price" inside {{formatCurrency price}}.
        const location = definitionProvider.onDefinitionRequest({
            position: { line: 1, character: 27 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("main.ts"));
        assert.strictEqual(location.range.start.line, 3);
    });
});
