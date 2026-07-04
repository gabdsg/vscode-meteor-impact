const assert = require("assert");

const { resolveBlockAutoClose } = require("../../src/blaze-block-close");
const { counterpartCandidates } = require("../../src/counterpart-files");

describe("Blaze block auto-close decisions", () => {
    it("closes inline when the final brace is typed", () => {
        const content = "<div>{{#if visible}}";
        const decision = resolveBlockAutoClose(content, 19, "}");

        assert.deepStrictEqual(decision, { blockName: "if", mode: "inline" });
    });

    it("closes on the next line when Enter follows the open tag", () => {
        const content = "    {{#each item in items}}\n    ";
        const decision = resolveBlockAutoClose(
            content,
            content.indexOf("\n"),
            "\n    "
        );

        assert.deepStrictEqual(decision, {
            blockName: "each",
            mode: "newline",
            indent: "    ",
        });
    });

    it("does nothing when the block is already balanced", () => {
        const content = "{{#if a}}{{/if}}{{#if b}}";
        // Typing the final brace of a SECOND {{#if}} while one close
        // exists: still unbalanced, so it closes...
        assert.ok(resolveBlockAutoClose(content, 24, "}"));

        // ...but a fully balanced document does nothing.
        const balanced = "{{#if a}}x{{/if}}";
        assert.strictEqual(resolveBlockAutoClose(balanced, 8, "}"), undefined);
    });

    it("ignores plain mustaches and unrelated typing", () => {
        assert.strictEqual(
            resolveBlockAutoClose("{{title}}", 8, "}"),
            undefined
        );
        assert.strictEqual(
            resolveBlockAutoClose("{{#if a}}", 8, "x"),
            undefined
        );
        // Large pastes are not treated as typing.
        assert.strictEqual(
            resolveBlockAutoClose("{{#if a}}", 0, "{{#if a}}"),
            undefined
        );
    });

    it("supports custom block helpers", () => {
        const decision = resolveBlockAutoClose("{{#myBlock arg}}", 15, "}");
        assert.strictEqual(decision.blockName, "myBlock");
    });
});

describe("Counterpart file cycle", () => {
    it("cycles html -> code -> style", () => {
        assert.deepStrictEqual(counterpartCandidates("/app/foo.html"), [
            "/app/foo.ts",
            "/app/foo.js",
            "/app/foo.less",
            "/app/foo.css",
        ]);
    });

    it("cycles code -> style -> html", () => {
        assert.deepStrictEqual(counterpartCandidates("/app/foo.ts"), [
            "/app/foo.less",
            "/app/foo.css",
            "/app/foo.html",
        ]);
    });

    it("cycles style -> html -> code", () => {
        assert.deepStrictEqual(counterpartCandidates("/app/foo.less"), [
            "/app/foo.html",
            "/app/foo.ts",
            "/app/foo.js",
        ]);
    });

    it("returns nothing for unrelated files", () => {
        assert.deepStrictEqual(counterpartCandidates("/app/readme.md"), []);
    });
});
