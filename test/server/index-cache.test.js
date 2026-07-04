const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { cacheFilePath } = require("../../server/src/index-cache");
const { DefinitionProvider } = require("../../server/src/definition-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const clearCacheFor = (indexer) => {
    try {
        fs.rmSync(cacheFilePath(indexer.rootUri), { force: true });
    } catch (e) {
        /* no cache yet */
    }
};

describe("Index cache (warm start)", () => {
    // Start from a clean slate: caches survive across test runs.
    before(() => {
        clearCacheFor({
            rootUri: {
                fsPath: path.join(__dirname, "fixtures", "basic-project"),
            },
        });
    });

    it("restores the maps without re-parsing when nothing changed", async () => {
        const { indexer: first } = await loadFixtureIndexer("basic-project", {
            enableIndexCache: true,
        });
        assert.strictEqual(first.restoredFromCache, false);

        try {
            const { indexer: second, result } = await loadFixtureIndexer(
                "basic-project",
                { enableIndexCache: true }
            );

            assert.strictEqual(second.restoredFromCache, true);
            assert.strictEqual(result.hasErrors, false);

            // Maps survived with URIs revived.
            const helper =
                second.blazeIndexer.templateIndexMap["foo"].helpers[
                    "formattedName"
                ];
            assert.ok(helper.uri.fsPath.endsWith("foo.ts"));
            assert.ok(second.blazeIndexer.htmlUsageMap["barTitle"]);
            assert.ok(
                second.methodsAndPublicationsIndexer instanceof Object
            );

            // Only HTML sources hydrated eagerly.
            const hydrated = Object.keys(second.getSources());
            assert.ok(hydrated.every((p) => p.endsWith(".html")));

            // Providers hydrate JS lazily and still work end-to-end.
            const location = new DefinitionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${__dirname}`,
                second
            ).onDefinitionRequest({
                position: { line: 2, character: 17 },
                textDocument: {
                    uri: fixtureUri("basic-project", "client/foo.html"),
                },
            });
            assert.ok(location.uri.endsWith("foo.ts"));
        } finally {
            clearCacheFor(first);
        }
    });

    it("falls back to a full parse when a file changed", async () => {
        const { indexer: first, rootPath } = await loadFixtureIndexer(
            "basic-project",
            { enableIndexCache: true }
        );

        try {
            const fooTs = path.join(rootPath, "client/foo.ts");
            const now = new Date();
            fs.utimesSync(fooTs, now, now);

            const { indexer: second } = await loadFixtureIndexer(
                "basic-project",
                { enableIndexCache: true }
            );

            assert.strictEqual(second.restoredFromCache, false);
            // Full parse: every source present.
            assert.strictEqual(Object.keys(second.getSources()).length, 4);
        } finally {
            clearCacheFor(first);
        }
    });

    it("stays disabled by default", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        assert.strictEqual(indexer.restoredFromCache, undefined);
        assert.strictEqual(Object.keys(indexer.getSources()).length, 4);
    });
});
