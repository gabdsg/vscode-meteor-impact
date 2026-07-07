const assert = require("assert");

const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    loadFixtureIndexer,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Session key diagnostics", () => {
    let diagnostics;

    before(async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "session-keys-project"
        );
        const byUri = new DiagnosticsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${rootPath}`,
            indexer
        ).computeDiagnostics();

        diagnostics = [...byUri.values()].flat();
    });

    const messagesAbout = (key) =>
        diagnostics.filter(({ message }) => message.includes(`"${key}"`));

    it("hints on keys read but never set", () => {
        const [diagnostic] = messagesAbout("neverSet");
        assert.ok(diagnostic);
        assert.ok(diagnostic.message.includes("read but never set"));
        // Hint severity = 4
        assert.strictEqual(diagnostic.severity, 4);
    });

    it("hints on keys set but never read, tagged unnecessary", () => {
        const [diagnostic] = messagesAbout("neverRead");
        assert.ok(diagnostic);
        assert.ok(diagnostic.message.includes("set but never read"));
        assert.deepStrictEqual(diagnostic.tags, [1]);
    });

    it("stays quiet for keys with both sets and gets", () => {
        for (const key of ["counter", "filters.text", "dictKey"]) {
            assert.deepStrictEqual(messagesAbout(key), [], key);
        }
    });
});
