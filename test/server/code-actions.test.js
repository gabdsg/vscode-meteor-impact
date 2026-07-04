const assert = require("assert");

const {
    CodeActionsProvider,
} = require("../../server/src/code-actions-provider");
const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Generic multi-line edit applier working on offsets.
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

describe("CodeActionsProvider - quick fixes", () => {
    let indexer;
    let provider;
    let diagnosticsByUri;

    const diagnosticsFor = (fileName) => {
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith(fileName)
        );
        return (key && diagnosticsByUri.get(key)) || [];
    };

    const contentOf = (fileName) => {
        const source = Object.values(indexer.getSources()).find(({ uri }) =>
            uri.fsPath.endsWith(fileName)
        );
        return source.fileContent;
    };

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("diagnostics-project"));
        provider = new CodeActionsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
        diagnosticsByUri = new DiagnosticsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        ).computeDiagnostics();
    });

    it("offers to create a missing template", () => {
        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("diagnostics-project", "client/diag.html"),
            },
            context: { diagnostics: diagnosticsFor("diag.html") },
        });

        const action = actions.find(({ title }) =>
            title.includes('Create template "missingTemplate"')
        );
        assert.ok(action, "Expected a create-template action");

        const [uri] = Object.keys(action.edit.changes);
        assert.ok(uri.endsWith("diag.html"));

        const updated = applyEdits(
            contentOf("diag.html"),
            action.edit.changes[uri]
        );
        assert.ok(updated.includes('<template name="missingTemplate">'));
    });

    it("offers to create a missing helper in the code-behind", () => {
        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("diagnostics-project", "client/diag.html"),
            },
            context: { diagnostics: diagnosticsFor("diag.html") },
        });

        const action = actions.find(({ title }) =>
            title.includes('Create helper "badHelper"')
        );
        assert.ok(action, "Expected a create-helper action");

        const [uri] = Object.keys(action.edit.changes);
        assert.ok(uri.endsWith("diag.ts"), "Stub goes to the code-behind");

        const updated = applyEdits(
            contentOf("diag.ts"),
            action.edit.changes[uri]
        );
        assert.ok(updated.includes("Template.diagT.helpers({"));
        assert.ok(updated.includes("badHelper() {"));
    });

    it("offers to remove an unused helper by whole lines", () => {
        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("diagnostics-project", "client/diag.ts"),
            },
            context: { diagnostics: diagnosticsFor("diag.ts") },
        });

        const action = actions.find(({ title }) =>
            title.includes('Remove unused helper "unusedHelper"')
        );
        assert.ok(action, "Expected a remove-helper action");

        const [uri] = Object.keys(action.edit.changes);
        const updated = applyEdits(
            contentOf("diag.ts"),
            action.edit.changes[uri]
        );

        assert.ok(!updated.includes("unusedHelper"));
        assert.ok(updated.includes("usedHelper"));
        // The helpers object is still syntactically intact.
        assert.ok(updated.includes("});"));
        assert.ok(!/\n\s*\n\s*\},\n\}\)/.test(updated));
    });

    it("returns no actions for foreign diagnostics", () => {
        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("diagnostics-project", "client/diag.ts"),
            },
            context: {
                diagnostics: [
                    {
                        source: "eslint",
                        message: "something",
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 1 },
                        },
                    },
                ],
            },
        });

        assert.deepStrictEqual(actions, []);
    });
});
