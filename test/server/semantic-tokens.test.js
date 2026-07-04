const assert = require("assert");

const {
    SemanticTokensProvider,
} = require("../../server/src/semantic-tokens-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Decode the LSP delta-encoded quintuples into absolute tokens.
const decodeTokens = (data, tokenTypes) => {
    const tokens = [];
    let line = 0;
    let char = 0;

    for (let i = 0; i < data.length; i += 5) {
        line += data[i];
        char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
        tokens.push({
            line,
            char,
            length: data[i + 2],
            type: tokenTypes[data[i + 3]],
        });
    }

    return tokens;
};

describe("SemanticTokensProvider", () => {
    let tokens;

    const tokenAt = (line, char) =>
        tokens.find((t) => t.line === line && t.char === char);

    before(async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");
        const provider = new SemanticTokensProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        const result = provider.onSemanticTokensRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.html"),
            },
        });

        tokens = decodeTokens(
            result.data,
            SemanticTokensProvider.legend.tokenTypes
        );
    });

    it("marks builtin blocks and each-in bindings", () => {
        // Line 1: {{#each person in people}}
        assert.strictEqual(tokenAt(1, 7)?.type, "keyword", "each");
        assert.strictEqual(tokenAt(1, 12)?.type, "variable", "person");
        assert.strictEqual(tokenAt(1, 19)?.type, "keyword", "in");
        assert.strictEqual(tokenAt(1, 22)?.type, "function", "people");
    });

    it("marks block variables and helpers in mustaches", () => {
        // Line 2: <div>{{person.name}} {{formatAge person}}</div>
        assert.strictEqual(tokenAt(2, 15)?.type, "variable", "person");
        assert.strictEqual(tokenAt(2, 31)?.type, "function", "formatAge");
        assert.strictEqual(tokenAt(2, 41)?.type, "variable", "person arg");
    });

    it("marks let bindings as variables where used", () => {
        // Line 6: <span>{{total}} {{label}}</span>
        assert.strictEqual(tokenAt(6, 16)?.type, "variable", "total");
        assert.strictEqual(tokenAt(6, 26)?.type, "variable", "label");
    });

    it("marks known partials as templates", () => {
        // Line 8: {{> row}}
        const partialToken = tokens.find(
            ({ line, type }) => line === 8 && type === "class"
        );
        assert.ok(partialToken, "Expected a class token for {{> row}}");
    });

    it("emits no token for unresolved paths", () => {
        // person.name's "name" part and unresolved things get no token:
        // every emitted token must be one of the known positions.
        const unresolved = tokens.filter(
            ({ type }) =>
                !["function", "class", "keyword", "variable"].includes(type)
        );
        assert.deepStrictEqual(unresolved, []);
    });

    it("returns empty tokens for JS files", () => {
        const provider = new SemanticTokensProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            null
        );

        const result = provider.onSemanticTokensRequest({
            textDocument: {
                uri: fixtureUri("block-vars-project", "client/list.ts"),
            },
        });

        assert.deepStrictEqual(result.data, []);
    });
});
