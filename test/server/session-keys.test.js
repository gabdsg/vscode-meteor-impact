const assert = require("assert");

const { CompletionProvider } = require("../../server/src/completion-provider");
const { DefinitionProvider } = require("../../server/src/definition-provider");
const { ReferencesProvider } = require("../../server/src/references-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
    overrideContent,
} = require("./test-utils");

const STATE_FILE = "client/state.js";

describe("Session/ReactiveDict key intelligence", () => {
    let indexer;
    let rootPath;

    // 0-based LSP position of the nth occurrence of `text` in the file.
    const positionOf = (fileContent, text, occurrence = 0) => {
        let offset = -1;
        for (let i = 0; i <= occurrence; i++) {
            offset = fileContent.indexOf(text, offset + 1);
        }
        assert.ok(offset !== -1, `"${text}" not found in fixture`);

        const before = fileContent.slice(0, offset);
        const line = before.split("\n").length - 1;
        const character = offset - (before.lastIndexOf("\n") + 1);
        // Inside the string literal, not at the opening quote.
        return { line, character: character + 1 };
    };

    const stateContent = () =>
        Object.values(indexer.getSources()).find(({ uri }) =>
            uri.fsPath.endsWith("state.js")
        ).fileContent;

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer(
            "session-keys-project"
        ));
    });

    describe("indexer", () => {
        it("indexes sets and gets per key", () => {
            const { keysMap } = indexer.sessionKeysIndexer;

            assert.strictEqual(keysMap["counter"].sets.length, 1);
            assert.strictEqual(keysMap["counter"].gets.length, 1);
            // set + equals-read in state.js, get in other.js
            assert.strictEqual(keysMap["filters.text"].sets.length, 1);
            assert.strictEqual(keysMap["filters.text"].gets.length, 2);
            assert.strictEqual(keysMap["neverSet"].sets.length, 0);
            assert.strictEqual(keysMap["neverRead"].gets.length, 0);
        });

        it("indexes ReactiveDict variables and their keys", () => {
            const { keysMap, reactiveDictVars } = indexer.sessionKeysIndexer;

            assert.ok(
                Object.values(reactiveDictVars).some((vars) =>
                    vars.includes("state")
                )
            );
            assert.strictEqual(keysMap["dictKey"].sets.length, 1);
            assert.strictEqual(keysMap["dictKey"].gets.length, 1);
        });

        it("ignores dynamic keys and non-reactive receivers", () => {
            const { keysMap } = indexer.sessionKeysIndexer;

            assert.strictEqual(keysMap["mapKey"], undefined);
        });

        it("removes a file's entries incrementally", () => {
            const { SessionKeysIndexer } = require("../../server/src/session-keys-indexer");
            const clone = new SessionKeysIndexer();
            Object.assign(
                clone,
                JSON.parse(JSON.stringify(indexer.sessionKeysIndexer))
            );

            const stateFsPath = Object.keys(indexer.getSources()).find(
                (fsPath) => fsPath.endsWith("state.js")
            );
            clone.removeUri(stateFsPath);

            assert.strictEqual(clone.keysMap["counter"], undefined);
            // filters.text still has the get from other.js
            assert.strictEqual(clone.keysMap["filters.text"].gets.length, 1);
            assert.strictEqual(clone.keysMap["filters.text"].sets.length, 0);
        });
    });

    describe("completion", () => {
        it("offers known keys inside Session.get('...')", () => {
            const provider = new CompletionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const content = `${stateContent()}\nSession.get("`;
            const lines = content.split("\n");
            const stateFsPath = Object.keys(indexer.getSources()).find(
                (fsPath) => fsPath.endsWith("state.js")
            );
            overrideContent(indexer, new Map([[stateFsPath, content]]));
            provider.documentsInstance = indexer.documentsInstance;

            const items = provider.onCompletionRequest({
                textDocument: {
                    uri: fixtureUri("session-keys-project", STATE_FILE),
                },
                position: {
                    line: lines.length - 1,
                    character: lines[lines.length - 1].length,
                },
            });

            overrideContent(indexer, new Map());
            provider.documentsInstance = documentsInstanceMock;

            assert.ok(Array.isArray(items));
            const labels = items.map(({ label }) => label);
            for (const expected of ["counter", "filters.text", "dictKey"]) {
                assert.ok(labels.includes(expected), expected);
            }
            assert.strictEqual(
                items[0].detail,
                "Session/ReactiveDict key"
            );
        });
    });

    describe("definition", () => {
        it("jumps from a get to the first set", () => {
            const provider = new DefinitionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const location = provider.onDefinitionRequest({
                textDocument: {
                    uri: fixtureUri("session-keys-project", STATE_FILE),
                },
                position: positionOf(stateContent(), '"counter"', 1),
            });

            assert.ok(location);
            // First set is the setDefault on line 3 (0-based).
            assert.strictEqual(location.range.start.line, 3);
        });
    });

    describe("references", () => {
        it("returns every set and get of a key", () => {
            const provider = new ReferencesProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const locations = provider.onReferenceRequest({
                textDocument: {
                    uri: fixtureUri("session-keys-project", STATE_FILE),
                },
                position: positionOf(stateContent(), '"filters.text"', 0),
            });

            assert.ok(Array.isArray(locations));
            assert.strictEqual(locations.length, 3);
            assert.ok(
                locations.some(({ uri }) => uri.endsWith("other.js")),
                "cross-file reference expected"
            );
        });
    });
});
