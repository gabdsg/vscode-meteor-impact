const assert = require("assert");

const {
    CodeActionsProvider,
} = require("../../server/src/code-actions-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("CodeActionsProvider - Claude Code actions", () => {
    let indexer;
    let provider;

    const requestActions = (relativePath, position, context = {}) =>
        provider.onCodeActionRequest({
            textDocument: {
                uri: fixtureUri("claude-code-project", relativePath),
            },
            range: { start: position, end: position },
            context,
        }) || [];

    const claudeActionsAt = (relativePath, position, context) =>
        requestActions(relativePath, position, context).filter(
            ({ kind }) => kind === "refactor.claudeCode"
        );

    before(async () => {
        let rootPath;
        ({ indexer, rootPath } = await loadFixtureIndexer(
            "claude-code-project"
        ));
        provider = new CodeActionsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${rootPath}`,
            indexer
        );
    });

    it("offers all four actions inside a Meteor method body", () => {
        const actions = claudeActionsAt("server/methods.js", {
            line: 5,
            character: 10,
        });

        assert.deepStrictEqual(
            actions.map(({ title }) => title),
            [
                "Create tests with Claude Code",
                "Add JSDoc with Claude Code",
                "Explain this function with Claude Code",
                "Security-review this method with Claude Code",
            ]
        );

        const [payload] = actions[0].command.arguments;
        assert.strictEqual(payload.action, "createTests");
        assert.strictEqual(payload.filePath, "server/methods.js");
        assert.strictEqual(payload.functionName, "tasks.insert");
        assert.strictEqual(payload.enclosingKind, "method");
        assert.strictEqual(payload.enclosingName, "tasks.insert");
        assert.strictEqual(payload.startLine, 5);
        assert.strictEqual(payload.endLine, 8);
        assert.strictEqual(
            actions[0].command.command,
            "_meteorImpact.claudeCode.run"
        );
    });

    it("labels publications in the security review title", () => {
        const actions = claudeActionsAt("server/methods.js", {
            line: 11,
            character: 6,
        });

        const securityAction = actions.find(({ title }) =>
            title.startsWith("Security-review")
        );
        assert.ok(securityAction);
        assert.strictEqual(
            securityAction.title,
            "Security-review this publication with Claude Code"
        );

        const [payload] = securityAction.command.arguments;
        assert.strictEqual(payload.enclosingKind, "publication");
        assert.strictEqual(payload.enclosingName, "tasks.mine");
        assert.strictEqual(payload.functionName, "(anonymous)");
    });

    it("resolves ValidatedMethod names from the name property", () => {
        const actions = claudeActionsAt("server/methods.js", {
            line: 21,
            character: 10,
        });

        const [payload] = actions[0].command.arguments;
        assert.strictEqual(payload.functionName, "run");
        assert.strictEqual(payload.enclosingKind, "method");
        assert.strictEqual(payload.enclosingName, "tasks.remove");
    });

    it("offers three actions on a plain server function", () => {
        const actions = claudeActionsAt("server/methods.js", {
            line: 15,
            character: 6,
        });

        assert.strictEqual(actions.length, 3);
        assert.ok(
            !actions.some(({ title }) => title.startsWith("Security-review"))
        );

        const [payload] = actions[0].command.arguments;
        assert.strictEqual(payload.functionName, "plainServerFunction");
        assert.strictEqual(payload.enclosingKind, undefined);
    });

    it("offers actions with the cursor on the function name itself", () => {
        // Line 1 is `export function typedHelper(...)`: cursor on the name,
        // before the parameter paren.
        const onPlainName = claudeActionsAt("imports/server/helper.ts", {
            line: 1,
            character: 20,
        });
        assert.strictEqual(onPlainName.length, 3);
        assert.strictEqual(
            onPlainName[0].command.arguments[0].functionName,
            "typedHelper"
        );

        // Cursor on a static async class method's name (line 5 0-based:
        // `    static async getSchoolsForInstitution(params: {`).
        const onMethodName = claudeActionsAt("imports/server/helper.ts", {
            line: 5,
            character: 25,
        });
        assert.strictEqual(onMethodName.length, 3);
        const [payload] = onMethodName[0].command.arguments;
        assert.strictEqual(payload.functionName, "getSchoolsForInstitution");
        assert.strictEqual(payload.startLine, 6);
    });

    it("offers actions with the cursor on a Meteor method's name key", () => {
        // Line 4 0-based is `    "tasks.insert"(text) {`: cursor on the key.
        const actions = claudeActionsAt("server/methods.js", {
            line: 4,
            character: 8,
        });

        assert.strictEqual(actions.length, 4);
        const [payload] = actions[0].command.arguments;
        assert.strictEqual(payload.functionName, "tasks.insert");
        assert.strictEqual(payload.enclosingName, "tasks.insert");
    });

    it("works in TypeScript files under imports/server", () => {
        const actions = claudeActionsAt("imports/server/helper.ts", {
            line: 1,
            character: 6,
        });

        assert.strictEqual(actions.length, 3);
        const [payload] = actions[0].command.arguments;
        assert.strictEqual(payload.functionName, "typedHelper");
    });

    it("offers actions in shared files guarded by Meteor.isServer", () => {
        const actions = claudeActionsAt("shared/shared.js", {
            line: 3,
            character: 8,
        });

        assert.ok(actions.length >= 3);
    });

    it("offers no actions in client files", () => {
        const actions = claudeActionsAt("client/ui.js", {
            line: 1,
            character: 6,
        });

        assert.deepStrictEqual(actions, []);
    });

    it("offers no actions outside any function", () => {
        const actions = claudeActionsAt("server/methods.js", {
            line: 2,
            character: 0,
        });

        assert.deepStrictEqual(actions, []);
    });

    it("honors the context.only filter", () => {
        const filtered = claudeActionsAt(
            "server/methods.js",
            { line: 5, character: 10 },
            { only: ["quickfix"] }
        );
        assert.deepStrictEqual(filtered, []);

        const requested = claudeActionsAt(
            "server/methods.js",
            { line: 5, character: 10 },
            { only: ["refactor"] }
        );
        assert.strictEqual(requested.length, 4);
    });
});
