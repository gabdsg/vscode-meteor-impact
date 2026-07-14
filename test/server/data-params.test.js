const assert = require("assert");

const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const { CompletionProvider } = require("../../server/src/completion-provider");
const { HoverProvider } = require("../../server/src/hover-provider");
const {
    DefinitionProvider,
} = require("../../server/src/definition-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// {{title}} inside "item" is not a helper: it is data passed at the
// inclusion sites ({{> item title="hello"}}). Those arguments are
// statically known, so the providers treat them like bound variables.
describe("Template data parameters from inclusion arguments", () => {
    let indexer;

    const createProvider = (Provider) =>
        new Provider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("data-params-project"));
    });

    it("indexes inclusion arguments per template", () => {
        const params = indexer.blazeIndexer.templateDataParams.item;
        assert.ok(params, "expected data params for template item");
        assert.deepStrictEqual(Object.keys(params).sort(), [
            "formatter",
            "subtitle",
            "title",
        ]);
        // Both callers of title are tracked.
        assert.strictEqual(params.title.length, 2);
        assert.ok(params.title[0].uri.fsPath.endsWith("parent.html"));
    });

    it("does not flag passed data as unresolved helpers", () => {
        const diagnosticsByUri = createProvider(
            DiagnosticsProvider
        ).computeDiagnostics();
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith("item.html")
        );
        const messages = ((key && diagnosticsByUri.get(key)) || []).map(
            ({ message }) => message
        );

        // {{formatter title}}: "formatter" is a function passed by the
        // caller, not an unresolved helper.
        assert.ok(!messages.some((m) => m.includes('"formatter"')));
        // Calls to names nobody passes or defines still warn.
        assert.ok(messages.some((m) => m.includes('"shout"')));
    });

    it("counts inclusion arguments as helper usage", () => {
        const { htmlUsageMap } = indexer.blazeIndexer;
        // {{> item itemContext}} and {{> item subtitle=computedSubtitle}}
        // both use helpers of "parent"; neither is unused.
        assert.ok(htmlUsageMap.itemContext, "positional partial arg indexed");
        assert.ok(htmlUsageMap.computedSubtitle, "hash partial arg indexed");

        const diagnosticsByUri = createProvider(
            DiagnosticsProvider
        ).computeDiagnostics();
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith("parent.js")
        );
        const messages = ((key && diagnosticsByUri.get(key)) || []).map(
            ({ message }) => message
        );
        assert.ok(!messages.some((m) => m.includes("never used")), messages);
    });

    it("offers data params in completion inside the template", () => {
        // Inside {{title}} of item.html (line 1, after "{{t").
        const items = createProvider(CompletionProvider).onCompletionRequest({
            position: { line: 1, character: 11 },
            textDocument: {
                uri: fixtureUri("data-params-project", "client/item.html"),
            },
        });

        const title = (items || []).find(({ label }) => label === "title");
        assert.ok(title, "expected 'title' in completions");
        assert.ok(title.detail.includes("item"));
    });

    it("shows a data-param hover with the inclusion site", () => {
        const hover = createProvider(HoverProvider).onHoverRequest({
            position: { line: 1, character: 11 },
            textDocument: {
                uri: fixtureUri("data-params-project", "client/item.html"),
            },
        });

        assert.ok(hover, "expected a hover");
        const { value } = hover.contents;
        assert.ok(value.includes("title"));
        assert.ok(value.includes("data passed to template"));
        assert.ok(value.includes("parent.html"));
    });

    it("jumps from the usage to the inclusion sites", () => {
        const locations = createProvider(
            DefinitionProvider
        ).onDefinitionRequest({
            position: { line: 1, character: 11 },
            textDocument: {
                uri: fixtureUri("data-params-project", "client/item.html"),
            },
        });

        const asArray = [].concat(locations || []);
        assert.strictEqual(asArray.length, 2, "one location per caller");
        assert.ok(asArray[0].uri.endsWith("parent.html"));
    });

    it("drops a file's inclusion arguments when it is removed", () => {
        const parentPath = indexer.parseUri(
            fixtureUri("data-params-project", "client/parent.html")
        ).fsPath;

        indexer.blazeIndexer.removeUri(parentPath);
        assert.ok(!indexer.blazeIndexer.templateDataParams.item);
    });
});
