const assert = require("assert");

const { ReferencesProvider } = require("../../server/src/references-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new ReferencesProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("ReferencesProvider - references from HTML files", () => {
    it("finds usages and definition of a helper from a mustache", async () => {
        const { indexer } = await loadFixtureIndexer("global-helpers-project");

        // Position on "formatCurrency" inside the "home" template.
        const locations = createProvider(indexer).onReferenceRequest({
            position: { line: 1, character: 13 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
            context: { includeDeclaration: true },
        });

        assert.ok(Array.isArray(locations), "Expected locations");
        // Two usages (home + about templates) and one definition.
        assert.strictEqual(locations.length, 3);
        assert.ok(
            locations.some(({ uri }) => uri.endsWith("global-helpers.ts")),
            "Expected the definition in global-helpers.ts"
        );
    });

    it("omits definitions when includeDeclaration is false", async () => {
        const { indexer } = await loadFixtureIndexer("global-helpers-project");

        const locations = createProvider(indexer).onReferenceRequest({
            position: { line: 1, character: 13 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
            context: { includeDeclaration: false },
        });

        assert.strictEqual(locations.length, 2);
        assert.ok(
            locations.every(({ uri }) => uri.endsWith("main.html")),
            "Expected only HTML usages"
        );
    });

    it("finds references of a template from a partial statement", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // Position on "bar" inside {{> bar}} of foo.html.
        const locations = createProvider(indexer).onReferenceRequest({
            position: { line: 4, character: 13 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
            context: { includeDeclaration: true },
        });

        assert.ok(Array.isArray(locations), "Expected locations");
        assert.ok(
            locations.some(({ uri }) => uri.endsWith("foo.html")),
            "Expected the {{> bar}} usage"
        );
        assert.ok(
            locations.some(({ uri }) => uri.endsWith("bar.html")),
            "Expected the template definition"
        );
    });
});
