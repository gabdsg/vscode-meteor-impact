const assert = require("assert");

const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    CodeActionsProvider,
} = require("../../server/src/code-actions-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Diagnostics - methods and publications", () => {
    let indexer;
    let diagnosticsByUri;

    const diagnosticsFor = (fileName) => {
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith(fileName)
        );
        return (key && diagnosticsByUri.get(key)) || [];
    };

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("method-diagnostics-project"));
        diagnosticsByUri = new DiagnosticsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        ).computeDiagnostics();
    });

    it("flags calls to unknown methods", () => {
        const diagnostic = diagnosticsFor("calls.ts").find(({ message }) =>
            message.includes('"tasks.oops"')
        );

        assert.ok(diagnostic, "Expected a tasks.oops diagnostic");
        assert.ok(diagnostic.message.startsWith("Method"));
        assert.deepStrictEqual(diagnostic.data, {
            kind: "create-method",
            name: "tasks.oops",
        });
    });

    it("flags subscriptions to unknown publications", () => {
        const diagnostic = diagnosticsFor("calls.ts").find(({ message }) =>
            message.includes('"missing.pub"')
        );

        assert.ok(diagnostic, "Expected a missing.pub diagnostic");
        assert.ok(diagnostic.message.startsWith("Publication"));
        assert.strictEqual(diagnostic.data.kind, "create-publication");
    });

    it("does not flag known names or foreign subscribe calls", () => {
        const messages = diagnosticsFor("calls.ts").map(
            ({ message }) => message
        );

        assert.ok(!messages.some((m) => m.includes('"tasks.insert"')));
        assert.ok(!messages.some((m) => m.includes('"tasks.all"')));
        // emitter.subscribe is not a Meteor subscription.
        assert.ok(!messages.some((m) => m.includes("not.a.publication")));
    });

    it("hints unused methods at their definition", () => {
        const diagnostics = diagnosticsFor("defs.ts");

        const unused = diagnostics.find(({ message }) =>
            message.includes('"tasks.unused"')
        );
        assert.ok(unused, "Expected an unused-method hint");
        assert.strictEqual(unused.severity, 4); // Hint
        assert.deepStrictEqual(unused.tags, [1]); // Unnecessary

        assert.ok(
            !diagnostics.some(({ message }) =>
                message.includes('"tasks.insert" is never')
            )
        );
    });

    it("offers to create the missing method and publication", () => {
        const provider = new CodeActionsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        const actions = provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("method-diagnostics-project", "client/calls.ts"),
            },
            context: { diagnostics: diagnosticsFor("calls.ts") },
        });

        const createMethod = actions.find(({ title }) =>
            title.includes('Create method "tasks.oops"')
        );
        assert.ok(createMethod, "Expected a create-method action");

        const [methodUri] = Object.keys(createMethod.edit.changes);
        assert.ok(methodUri.endsWith("defs.ts"), "Stub goes near existing methods");
        const methodEdit = createMethod.edit.changes[methodUri][0];
        assert.ok(methodEdit.newText.includes('"tasks.oops"() {'));

        const createPublication = actions.find(({ title }) =>
            title.includes('Create publication "missing.pub"')
        );
        assert.ok(createPublication, "Expected a create-publication action");
        const [pubUri] = Object.keys(createPublication.edit.changes);
        assert.ok(pubUri.endsWith("defs.ts"));
        assert.ok(
            createPublication.edit.changes[pubUri][0].newText.includes(
                'Meteor.publish("missing.pub", function () {'
            )
        );
    });
});
