const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const { HoverProvider } = require("../../server/src/hover-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// {{> card}} written across several lines (one hash argument per line).
// The AST node of the inclusion spans lines, which the symbol lookup used
// to reject, so cmd+click on the template name silently did nothing.
describe("Multi-line template inclusions", () => {
    let indexer;

    const createProvider = (ProviderClass) =>
        new ProviderClass(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    const callerUri = () =>
        fixtureUri("multiline-partial-project", "client/caller.html");

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("multiline-partial-project"));
    });

    it("go-to-definition on the template name resolves the template", () => {
        // Position on "card" in "{{> card".
        const definition = createProvider(DefinitionProvider).onDefinitionRequest(
            {
                position: { line: 1, character: 9 },
                textDocument: { uri: callerUri() },
            }
        );
        assert.ok(definition, "Expected a definition location");
        assert.ok(definition.uri.endsWith("card.js"));
    });

    it("hover on the template name shows the template info", () => {
        const hover = createProvider(HoverProvider).onHoverRequest({
            position: { line: 1, character: 9 },
            textDocument: { uri: callerUri() },
        });
        assert.ok(hover, "Expected a hover result");
        const { value } = hover.contents;
        assert.ok(value.includes("card"));
        assert.ok(value.includes("template"));
    });

    it("go-to-definition on a hash value still resolves the helper", () => {
        // Position on "ownerName" in "helper=ownerName".
        const definition = createProvider(DefinitionProvider).onDefinitionRequest(
            {
                position: { line: 3, character: 17 },
                textDocument: { uri: callerUri() },
            }
        );
        assert.ok(definition, "Expected a definition location");
        assert.ok(definition.uri.endsWith("caller.js"));
    });
});
