const path = require("path");

const { Indexer } = require("../../server/src/indexer");

const FIXTURES_PATH = path.join(__dirname, "fixtures");

// Minimal stand-ins for the language server/documents instances: enough for
// the indexer and providers to fall back to reading files from disk.
const serverInstanceMock = { sendNotification: () => {} };
const documentsInstanceMock = { get: () => undefined };

const loadFixtureIndexer = async (fixtureName, indexerOptions = {}) => {
    const rootPath = path.join(FIXTURES_PATH, fixtureName);
    const indexer = new Indexer({
        rootUri: `file://${rootPath}`,
        serverInstance: serverInstanceMock,
        documentsInstance: documentsInstanceMock,
        ...indexerOptions,
    });

    const result = await indexer.loadSources();
    return { indexer, result, rootPath };
};

const fixtureUri = (fixtureName, relativePath) =>
    `file://${path.join(FIXTURES_PATH, fixtureName, relativePath)}`;

// Simulates open editor buffers: getFileContent reads through the
// documents instance, keyed - like the real TextDocuments - by the URI
// string. Overrides are a Map keyed by fsPath for test convenience.
const overrideContent = (indexer, overrides) => {
    indexer.documentsInstance = {
        get: (key) => {
            const { fsPath } = indexer.parseUri(key);
            return overrides.has(fsPath)
                ? { getText: () => overrides.get(fsPath) }
                : undefined;
        },
    };
};

module.exports = {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
    overrideContent,
};
