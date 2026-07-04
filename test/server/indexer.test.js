const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Indexer - TypeScript and JavaScript sources", () => {
    let indexer;
    let result;

    before(async () => {
        ({ indexer, result } = await loadFixtureIndexer("basic-project"));
    });

    it("indexes all fixture files without parsing errors", () => {
        assert.strictEqual(
            result.hasErrors,
            false,
            `Expected no parsing errors, got: ${JSON.stringify(
                result.errors?.map(({ uri, error }) => ({
                    uri: uri.fsPath,
                    error: `${error}`,
                }))
            )}`
        );

        const sourcePaths = Object.keys(indexer.getSources());
        assert.strictEqual(sourcePaths.length, 4);
        assert.ok(sourcePaths.some((p) => p.endsWith("foo.ts")));
        assert.ok(sourcePaths.some((p) => p.endsWith("bar.js")));
    });

    it("indexes helpers defined in .ts files", () => {
        const fooTemplate = indexer.blazeIndexer.templateIndexMap["foo"];
        assert.ok(fooTemplate, "Expected template foo to be indexed");

        const { helpers } = fooTemplate;
        assert.ok(helpers["formattedName"]);
        assert.ok(helpers["peopleCount"]);

        // Helper locations should point into the .ts file.
        assert.ok(helpers["formattedName"].uri.fsPath.endsWith("foo.ts"));
        assert.strictEqual(helpers["formattedName"].start.line, 16);
        assert.strictEqual(helpers["peopleCount"].start.line, 20);
    });

    it("still indexes helpers defined in .js files", () => {
        const barTemplate = indexer.blazeIndexer.templateIndexMap["bar"];
        assert.ok(barTemplate, "Expected template bar to be indexed");

        const { helpers } = barTemplate;
        assert.ok(helpers["barTitle"]);
        assert.ok(helpers["barTitle"].uri.fsPath.endsWith("bar.js"));
    });

    it("indexes helpers and template usage from HTML files", () => {
        const { htmlUsageMap } = indexer.blazeIndexer;

        assert.ok(htmlUsageMap["formattedName"]);
        assert.ok(htmlUsageMap["peopleCount"]);
        assert.ok(htmlUsageMap["barTitle"]);
        // {{> bar}} partial usage.
        assert.ok(htmlUsageMap["bar"]);
    });

    it("resolves definition of a mustache to the helper in the .ts file", () => {
        const definitionProvider = new DefinitionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Position of "formattedName" inside {{formattedName person}} on
        // line 3 (0-based line 2) of foo.html.
        const location = definitionProvider.onDefinitionRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("foo.ts"));
        // formattedName is defined on line 16 (0-based 15) of foo.ts.
        assert.strictEqual(location.range.start.line, 15);
    });
});
