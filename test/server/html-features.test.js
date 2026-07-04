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

    it("returns linked editing ranges for paired tags", () => {
        const provider = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Inside the "div" tag name on line 1 of foo.html; the closing
        // </div> is on line 5.
        const result = provider.onLinkedEditingRangeRequest({
            position: { line: 1, character: 6 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(result?.ranges, "Expected linked editing ranges");
        assert.strictEqual(result.ranges.length, 2);
        assert.strictEqual(result.ranges[0].start.line, 1);
        assert.strictEqual(result.ranges[1].start.line, 5);
    });

    it("returns null linked editing ranges outside tag names", () => {
        const provider = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // On the mustache content of line 2.
        const result = provider.onLinkedEditingRangeRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.strictEqual(result, null);
    });

    it("folds {{#block}} regions keeping the closing tag visible", async () => {
        const { indexer: blockVarsIndexer } = await loadFixtureIndexer(
            "block-vars-project"
        );
        const provider = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            blockVarsIndexer
        );

        const ranges = provider.onFoldingRangesRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });

        // {{#each}} opens on line 1 (0-based), closes on line 4.
        assert.ok(
            ranges.some(
                ({ startLine, endLine }) => startLine === 1 && endLine === 3
            ),
            "Expected the each block fold"
        );
        // {{#let}} opens on line 5, closes on line 7.
        assert.ok(
            ranges.some(
                ({ startLine, endLine }) => startLine === 5 && endLine === 6
            ),
            "Expected the let block fold"
        );
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
