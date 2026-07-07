const assert = require("assert");

const { buildPrompt } = require("../../src/claude-code-prompts");

describe("claude-code-prompts", () => {
    const methodPayload = {
        action: "createTests",
        filePath: "server/methods.js",
        functionName: "tasks.insert",
        startLine: 5,
        endLine: 8,
        enclosingKind: "method",
        enclosingName: "tasks.insert",
    };

    const plainPayload = {
        action: "createTests",
        filePath: "imports/server/helper.ts",
        functionName: "typedHelper",
        startLine: 1,
        endLine: 3,
    };

    const actions = ["createTests", "securityReview", "addJsdoc", "explain"];

    it("builds single-line prompts for every action", () => {
        for (const action of actions) {
            const prompt = buildPrompt({ ...methodPayload, action });

            assert.ok(prompt.length > 50, `${action} prompt is too short`);
            assert.ok(
                !prompt.includes("\n"),
                `${action} prompt must be single-line (sendText submits on newline)`
            );
        }
    });

    it("locates the function with path, name and line range", () => {
        for (const action of actions) {
            const prompt = buildPrompt({ ...methodPayload, action });

            assert.ok(prompt.includes("server/methods.js"), action);
            assert.ok(prompt.includes("`tasks.insert`"), action);
            assert.ok(prompt.includes("lines 5-8"), action);
        }
    });

    it("mentions the enclosing Meteor method when there is one", () => {
        const prompt = buildPrompt(methodPayload);
        assert.ok(prompt.includes('the Meteor method "tasks.insert"'));
        assert.ok(prompt.includes("this.userId"));
    });

    it("omits Meteor wording for plain functions", () => {
        const prompt = buildPrompt(plainPayload);
        assert.ok(!prompt.includes("the Meteor method"));
    });

    it("labels publications in the security review", () => {
        const prompt = buildPrompt({
            ...methodPayload,
            action: "securityReview",
            enclosingKind: "publication",
            enclosingName: "tasks.mine",
        });
        assert.ok(prompt.includes('the Meteor publication "tasks.mine"'));
        assert.ok(prompt.includes("do not change any code yet"));
    });

    it("throws on unknown actions", () => {
        assert.throws(() => buildPrompt({ action: "nope" }));
        assert.throws(() => buildPrompt(undefined));
    });
});
