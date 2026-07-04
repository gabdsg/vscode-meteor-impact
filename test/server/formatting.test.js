const assert = require("assert");

const {
    HtmlFeaturesProvider,
} = require("../../server/src/html-features-provider");
const {
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Formatting doesn't need the index: instantiate the provider directly.
const provider = new HtmlFeaturesProvider(
    serverInstanceMock,
    documentsInstanceMock,
    `file://${__dirname}`,
    undefined
);

describe("HtmlFeaturesProvider - Spacebars formatting", () => {
    it("formats HTML and indents mustache blocks", () => {
        const edits = provider.onDocumentFormattingRequest({
            textDocument: {
                uri: fixtureUri("formatting-project", "client/messy.html"),
            },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.ok(Array.isArray(edits) && edits.length, "Expected edits");

        const formatted = edits[0].newText;
        assert.ok(formatted.includes("    <div>"));
        assert.ok(formatted.includes("        {{#if visible}}"));
        assert.ok(formatted.includes("            <span>{{title}}</span>"));
        assert.ok(formatted.includes("        {{/if}}"));
    });

    it("respects the indentation options", () => {
        const edits = provider.onDocumentFormattingRequest({
            textDocument: {
                uri: fixtureUri("formatting-project", "client/messy.html"),
            },
            options: { tabSize: 2, insertSpaces: true },
        });

        const formatted = edits[0].newText;
        assert.ok(formatted.includes("  <div>"));
        assert.ok(formatted.includes("    {{#if visible}}"));
    });

    it("does not format JS files", () => {
        const edits = provider.onDocumentFormattingRequest({
            textDocument: { uri: fixtureUri("basic-project", "client/foo.ts") },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.strictEqual(edits, undefined);
    });
});
