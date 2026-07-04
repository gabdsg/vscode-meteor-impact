const assert = require("assert");

const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new CompletionProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

const labelsOf = (items) => (items || []).map(({ label }) => label);

describe("CompletionProvider - context aware HTML completion", () => {
    let globalHelpersProvider;
    let basicProvider;

    before(async () => {
        const { indexer: globalHelpersIndexer } = await loadFixtureIndexer(
            "global-helpers-project"
        );
        const { indexer: basicIndexer } = await loadFixtureIndexer(
            "basic-project"
        );

        globalHelpersProvider = createProvider(globalHelpersIndexer);
        basicProvider = createProvider(basicIndexer);
    });

    it("offers scoped and global helpers inside a mustache", () => {
        // Inside {{formatCurrency price}} of the "home" template.
        const items = globalHelpersProvider.onCompletionRequest({
            position: { line: 1, character: 13 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        const labels = labelsOf(items);
        assert.ok(labels.includes("price"), "Expected scoped helper");
        assert.ok(labels.includes("formatCurrency"), "Expected global helper");

        const priceItem = items.find(({ label }) => label === "price");
        assert.ok(priceItem.detail.includes("home"));
    });

    it("scopes helpers to the wrapping template", () => {
        // Inside {{formatCurrency 10}} of the "about" template, which has
        // no scoped helpers: only globals should be offered.
        const items = globalHelpersProvider.onCompletionRequest({
            position: { line: 5, character: 13 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        const labels = labelsOf(items);
        assert.ok(!labels.includes("price"), "price is scoped to home");
        assert.ok(labels.includes("formatCurrency"));
    });

    it("offers template names after {{>", () => {
        // Inside {{> bar}} of foo.html.
        const items = basicProvider.onCompletionRequest({
            position: { line: 4, character: 13 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        const labels = labelsOf(items);
        assert.ok(labels.includes("foo"));
        assert.ok(labels.includes("bar"));
        // Templates only, no helpers.
        assert.ok(!labels.includes("formattedName"));
    });

    it("offers no Blaze items outside mustaches", () => {
        // Inside <div> of foo.html, before any mustache: the HTML language
        // service answers instead.
        const result = basicProvider.onCompletionRequest({
            position: { line: 1, character: 8 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        const labels = labelsOf(result?.items || result);
        assert.ok(!labels.includes("formattedName"));
        assert.ok(!labels.includes("foo"));
    });

    it("offers no Blaze items after a closed mustache", () => {
        // Right after {{peopleCount}} on line 4 (0-based 3) of foo.html.
        const result = basicProvider.onCompletionRequest({
            position: { line: 3, character: 29 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        const labels = labelsOf(result?.items || result);
        assert.ok(!labels.includes("formattedName"));
        assert.ok(!labels.includes("peopleCount"));
    });
});
