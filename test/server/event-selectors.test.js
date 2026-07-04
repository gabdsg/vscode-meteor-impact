const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const { ReferencesProvider } = require("../../server/src/references-provider");
const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Event selector intelligence", () => {
    let indexer;

    const createProvider = (Provider) =>
        new Provider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("events-project"));
    });

    it("indexes class tokens as selectors per template", () => {
        const selectors =
            indexer.blazeIndexer.templateSelectorsMap["widget"];

        assert.ok(selectors, "Expected selectors for widget");
        assert.ok(selectors[".js-save"]);
        assert.ok(selectors[".js-cancel"]);
        assert.ok(selectors[".js-save"][0].uri.fsPath.endsWith("widget.html"));
    });

    it("jumps from an event key to the targeted elements", () => {
        // Position on "click .js-save" in widget.ts.
        const locations = createProvider(DefinitionProvider)
            .onDefinitionRequest({
                position: { line: 3, character: 8 },
                textDocument: {
                    uri: fixtureUri("events-project", "client/widget.ts"),
                },
            });

        assert.ok(Array.isArray(locations), "Expected selector locations");
        assert.strictEqual(locations.length, 1);
        assert.ok(locations[0].uri.endsWith("widget.html"));
        // The js-save class token is on line 2 (0-based 1).
        assert.strictEqual(locations[0].range.start.line, 1);
    });

    it("finds event handlers from a class token in HTML", () => {
        // Position inside "js-save" of class="js-save" in widget.html.
        const locations = createProvider(ReferencesProvider)
            .onReferenceRequest({
                position: { line: 1, character: 21 },
                textDocument: {
                    uri: fixtureUri("events-project", "client/widget.html"),
                },
                context: { includeDeclaration: true },
            });

        assert.ok(Array.isArray(locations), "Expected handler locations");
        // "click .js-save" is defined in widget.ts and widget-extra.ts.
        assert.strictEqual(locations.length, 2);
        assert.ok(locations.some(({ uri }) => uri.endsWith("widget.ts")));
        assert.ok(
            locations.some(({ uri }) => uri.endsWith("widget-extra.ts"))
        );
    });

    it("completes selectors while typing an event key", () => {
        // Right after the "." in "click .js-cancel" of widget.ts.
        const items = createProvider(CompletionProvider).onCompletionRequest({
            position: { line: 6, character: 12 },
            textDocument: {
                uri: fixtureUri("events-project", "client/widget.ts"),
            },
        });

        assert.ok(Array.isArray(items), "Expected completions");
        const labels = items.map(({ label }) => label);
        assert.ok(labels.includes("js-save"));
        assert.ok(labels.includes("js-cancel"));

        const item = items.find(({ label }) => label === "js-save");
        assert.ok(item.detail.includes('template "widget"'));
    });

    it("does not offer selector completions outside event maps", () => {
        // Inside the Meteor.callAsync string of the methods fixture.
        const run = async () => {
            const { indexer: methodsIndexer } = await loadFixtureIndexer(
                "methods-project"
            );
            const provider = new CompletionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${__dirname}`,
                methodsIndexer
            );

            return provider.onCompletionRequest({
                position: { line: 3, character: 34 },
                textDocument: {
                    uri: fixtureUri("methods-project", "client/caller.ts"),
                },
            });
        };

        return run().then((items) => {
            const labels = (items || []).map(({ label }) => label);
            assert.ok(!labels.includes("js-save"));
        });
    });
});
