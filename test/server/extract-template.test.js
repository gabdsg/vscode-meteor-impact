const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    CodeActionsProvider,
} = require("../../server/src/code-actions-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Offset-based multi-line edit applier.
const applyEdits = (content, edits) => {
    const lines = content.split("\n");
    const toOffset = ({ line, character }) => {
        let offset = 0;
        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset + character;
    };

    return [...edits]
        .sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
        .reduce(
            (acc, { range, newText }) =>
                acc.slice(0, toOffset(range.start)) +
                newText +
                acc.slice(toOffset(range.end)),
            content
        );
};

describe("CodeActionsProvider - extract template refactor", () => {
    let indexer;
    let provider;
    let rootPath;

    const requestActions = (uri, range) =>
        provider.onCodeActionRequest({
            textDocument: { uri },
            range,
            context: { diagnostics: [] },
        });

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer("basic-project"));
        provider = new CodeActionsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
    });

    it("extracts the selection into a new template", () => {
        // The two <span> lines of foo.html (lines 2-3, full lines).
        const action = requestActions(
            fixtureUri("basic-project", "client/foo.html"),
            {
                start: { line: 2, character: 8 },
                end: { line: 3, character: 39 },
            }
        ).find(({ kind }) => kind === "refactor.extract");

        assert.ok(action, "Expected an extract action");
        assert.ok(action.title.includes('"extractedTemplate"'));

        const [uri] = Object.keys(action.edit.changes);
        assert.ok(uri.endsWith("foo.html"));

        const updated = applyEdits(
            fs.readFileSync(path.join(rootPath, "client/foo.html"), "utf-8"),
            action.edit.changes[uri]
        );

        // Selection replaced by the partial...
        assert.ok(updated.includes("{{> extractedTemplate}}"));
        // ...and moved into a new template, dedented to one level.
        assert.ok(updated.includes('<template name="extractedTemplate">'));
        assert.ok(
            updated.includes(
                "    <span>{{formattedName person}}</span>\n    <span>{{peopleCount}}</span>"
            )
        );
        // The original content appears only once.
        assert.strictEqual(
            updated.split("{{formattedName person}}").length - 1,
            1
        );
    });

    it("generates a unique template name", () => {
        indexer.blazeIndexer.templateIndexMap["extractedTemplate"] = {};

        try {
            const action = requestActions(
                fixtureUri("basic-project", "client/foo.html"),
                {
                    start: { line: 2, character: 8 },
                    end: { line: 3, character: 39 },
                }
            ).find(({ kind }) => kind === "refactor.extract");

            assert.ok(action.title.includes('"extractedTemplate2"'));
        } finally {
            delete indexer.blazeIndexer.templateIndexMap["extractedTemplate"];
        }
    });

    it("offers nothing for an empty selection", () => {
        const actions = requestActions(
            fixtureUri("basic-project", "client/foo.html"),
            {
                start: { line: 2, character: 8 },
                end: { line: 2, character: 8 },
            }
        );

        assert.ok(
            !actions.some(({ kind }) => kind === "refactor.extract")
        );
    });

    it("offers nothing when the selection crosses template boundaries", async () => {
        const { indexer: multiIndexer } = await loadFixtureIndexer(
            "multi-template-project"
        );
        const multiProvider = new CodeActionsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            multiIndexer
        );

        // From inside "first" through the closing tag into "second".
        const actions = multiProvider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("multi-template-project", "client/multi.html"),
            },
            range: {
                start: { line: 1, character: 4 },
                end: { line: 5, character: 10 },
            },
            context: { diagnostics: [] },
        });

        assert.ok(
            !actions.some(({ kind }) => kind === "refactor.extract")
        );
    });

    it("offers nothing for whitespace-only selections", () => {
        const actions = requestActions(
            fixtureUri("basic-project", "client/foo.html"),
            {
                start: { line: 2, character: 0 },
                end: { line: 2, character: 8 },
            }
        );

        assert.ok(
            !actions.some(({ kind }) => kind === "refactor.extract")
        );
    });

    it("respects context.only filtering", () => {
        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
            range: {
                start: { line: 2, character: 8 },
                end: { line: 3, character: 39 },
            },
            context: { diagnostics: [], only: ["quickfix"] },
        });

        assert.ok(
            !actions.some(({ kind }) => kind === "refactor.extract")
        );
    });
});
