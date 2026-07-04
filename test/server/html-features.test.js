const assert = require("assert");

const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    HtmlFeaturesProvider,
} = require("../../server/src/html-features-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Embedded HTML language service", () => {
    let indexer;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("basic-project"));
    });

    it("delegates completion to the HTML service outside mustaches", () => {
        const provider = new CompletionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Inside the "div" tag name of foo.html (line 1: `    <div>`).
        const result = provider.onCompletionRequest({
            position: { line: 1, character: 8 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(result, "Expected HTML completions");
        const labels = (result.items || result).map(({ label }) => label);
        assert.ok(labels.includes("div"), "Expected HTML tag completions");
        // Blaze items must not leak into HTML context.
        assert.ok(!labels.includes("formattedName"));
    });

    it("still handles mustache completions itself", () => {
        const provider = new CompletionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        const result = provider.onCompletionRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        const labels = (result.items || result).map(({ label }) => label);
        assert.ok(labels.includes("formattedName"));
        assert.ok(!labels.includes("div"));
    });

    it("returns folding ranges for templates and tags", () => {
        const provider = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        const ranges = provider.onFoldingRangesRequest({
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(Array.isArray(ranges));
        assert.ok(ranges.length >= 2, "Expected template and div folds");
        // The <template> block folds from line 0.
        assert.ok(ranges.some(({ startLine }) => startLine === 0));
    });

    it("returns no folding ranges for JS files", () => {
        const provider = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        const ranges = provider.onFoldingRangesRequest({
            textDocument: { uri: fixtureUri("basic-project", "client/foo.ts") },
        });

        assert.strictEqual(ranges, undefined);
    });
});
