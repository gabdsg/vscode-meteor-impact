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

describe("Closing tag hints", () => {
    const { computeClosingTagHints } = require("../../src/closing-tag-hints");

    const hintTexts = (content, options) =>
        computeClosingTagHints(content, options).map(({ text }) => text);

    it("hints the condition at the closer of a long block", () => {
        const content = [
            "{{#if isSavingState}}",
            "<span>a</span>",
            "<span>b</span>",
            "<span>c</span>",
            "<span>d</span>",
            "{{/if}}",
        ].join("\n");

        const hints = computeClosingTagHints(content);
        assert.deepStrictEqual(hints, [
            { offset: content.length, text: "if isSavingState" },
        ]);
    });

    it("keeps the full block arguments in the hint", () => {
        const content = [
            "{{#each product in shareableProducts}}",
            "<i>1</i>",
            "<i>2</i>",
            "<i>3</i>",
            "<i>4</i>",
            "{{/each}}",
        ].join("\n");

        assert.deepStrictEqual(hintTexts(content), [
            "each product in shareableProducts",
        ]);
    });

    it("hints {{else}} with the enclosing condition", () => {
        const content = [
            "{{#if ready}}",
            "<b>1</b>",
            "<b>2</b>",
            "{{else}}",
            "<b>3</b>",
            "<b>4</b>",
            "{{/if}}",
        ].join("\n");

        assert.deepStrictEqual(hintTexts(content), [
            "if ready",
            "if ready",
        ]);
    });

    it("skips short blocks, trailing content and commented blocks", () => {
        // Inline/short: no hints.
        assert.deepStrictEqual(
            hintTexts("{{#if x}}Hide{{else}}Show{{/if}}"),
            []
        );

        // Something after the closer on the same line: no hint there.
        const trailing = [
            "{{#if x}}",
            "<b>1</b>",
            "<b>2</b>",
            "<b>3</b>",
            "<b>4</b>",
            "{{/if}} <span>tail</span>",
        ].join("\n");
        assert.deepStrictEqual(hintTexts(trailing), []);

        // Commented-out blocks are not real blocks.
        const commented = [
            "<!-- {{#if x}}",
            "<b>1</b>",
            "<b>2</b>",
            "<b>3</b>",
            "<b>4</b>",
            "{{/if}} -->",
        ].join("\n");
        assert.deepStrictEqual(hintTexts(commented), []);
    });

    it("hints long HTML elements with their class and id", () => {
        const content = [
            '<div id="main" class="toolbar wide">',
            "<span>1</span>",
            "<span>2</span>",
            "<span>3</span>",
            "<span>4</span>",
            "</div>",
        ].join("\n");

        assert.deepStrictEqual(hintTexts(content), ["#main.toolbar.wide"]);
    });

    it("skips short elements and elements without class or id", () => {
        assert.deepStrictEqual(
            hintTexts('<div class="toolbar"><span>x</span></div>'),
            []
        );

        const anonymous = [
            "<div>",
            "<span>1</span>",
            "<span>2</span>",
            "<span>3</span>",
            "<span>4</span>",
            "</div>",
        ].join("\n");
        assert.deepStrictEqual(hintTexts(anonymous), []);
    });

    it("filters block and element hints independently via options", () => {
        const content = [
            '<div class="toolbar">',
            "{{#if ready}}",
            "<b>1</b>",
            "<b>2</b>",
            "<b>3</b>",
            "<b>4</b>",
            "{{/if}}",
            "</div>",
        ].join("\n");

        assert.deepStrictEqual(hintTexts(content), ["if ready", ".toolbar"]);
        assert.deepStrictEqual(hintTexts(content, { htmlElements: false }), [
            "if ready",
        ]);
        assert.deepStrictEqual(hintTexts(content, { blocks: false }), [
            ".toolbar",
        ]);
    });

    it("strips mustaches from hinted class values", () => {
        const content = [
            '<div class="panes {{#if showPreview}}with-preview{{/if}}">',
            "<span>1</span>",
            "<span>2</span>",
            "<span>3</span>",
            "<span>4</span>",
            "</div>",
        ].join("\n");

        assert.deepStrictEqual(hintTexts(content), [".panes"]);
    });
});
