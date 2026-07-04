const assert = require("assert");

const {
    InlayHintsProvider,
} = require("../../server/src/inlay-hints-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new InlayHintsProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("InlayHintsProvider", () => {
    let hints;

    before(async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");
        hints = createProvider(indexer).onInlayHintsRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });
    });

    it("labels helper call arguments with the parameter name", () => {
        // {{formatAge person}} -> "person:" before the argument.
        const hint = hints.find(({ label }) => label === "person:");

        assert.ok(hint, "Expected a parameter hint");
        assert.strictEqual(hint.kind, 2); // Parameter
        assert.strictEqual(hint.position.line, 2);
        // The argument "person" starts at column 41 on that line.
        assert.strictEqual(hint.position.character, 41);
    });

    it("emits no hints for unresolvable calls or plain mustaches", () => {
        // {{person "x"}} calls a block variable: no signature, no hint on
        // line 3; {{person.name}} has no params at all.
        assert.ok(hints.every(({ position }) => position.line !== 3));
    });

    it("respects the requested range", async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");

        const rangedHints = createProvider(indexer).onInlayHintsRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
            range: {
                start: { line: 5, character: 0 },
                end: { line: 10, character: 0 },
            },
        });

        assert.deepStrictEqual(rangedHints, []);
    });

    it("returns nothing for JS files", async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");

        const jsHints = createProvider(indexer).onInlayHintsRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.ts"),
            },
        });

        assert.deepStrictEqual(jsHints, []);
    });
});
