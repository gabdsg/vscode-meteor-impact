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
// Its documents instance serves fixture files as if they were open
// buffers, string-keyed like the real TextDocuments: formatting must
// only ever see synced buffer content, never the disk fallback.
const fs = require("fs");
const { URI } = require("../../server/node_modules/vscode-uri");
const provider = new HtmlFeaturesProvider(
    serverInstanceMock,
    {
        get: (key) => {
            if (typeof key !== "string") return undefined;
            const { fsPath } = URI.parse(key);
            return fs.existsSync(fsPath)
                ? { getText: () => fs.readFileSync(fsPath, "utf-8") }
                : undefined;
        },
    },
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

    it("computes edits from the synced buffer, never from disk", () => {
        // Regression: formatting a stale disk copy while the buffer had
        // unsaved edits spliced disk fragments into the document. The
        // space in the directory also pins the %20 key round-trip.
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fmt spc-"));
        const fsPath = path.join(dir, "buffered.html");
        fs.writeFileSync(
            fsPath,
            '<template name="stale"><div><span>disk</span></div></template>'
        );

        const uriString = URI.file(fsPath).toString();
        assert.ok(uriString.includes("%20"), "space must be URI-encoded");

        const bufferContent =
            '<template name="fresh">\n<div>\n{{#if x}}<span>buffer</span>{{/if}}\n</div>\n</template>';
        const synced = new HtmlFeaturesProvider(
            serverInstanceMock,
            {
                get: (key) =>
                    key === uriString
                        ? { getText: () => bufferContent }
                        : undefined,
            },
            `file://${__dirname}`,
            undefined
        );

        const edits = synced.onDocumentFormattingRequest({
            textDocument: { uri: uriString },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.ok(edits?.length, "expected edits from the synced buffer");
        assert.ok(edits[0].newText.includes("buffer"));
        assert.ok(!edits[0].newText.includes("disk"));
    });

    it("refuses to format a Blaze file that does not parse", () => {
        // Re-indenting a broken buffer (e.g. a stray </template> left by
        // an earlier corruption) launders the damage into "formatted"
        // output. Keep the parse error visible instead.
        const uriString = "file:///not-on-disk/broken.html";
        const brokenContent =
            '<template name="a">\n<div></div>\n</template></template>';
        const synced = new HtmlFeaturesProvider(
            serverInstanceMock,
            {
                get: (key) =>
                    key === uriString
                        ? { getText: () => brokenContent }
                        : undefined,
            },
            `file://${__dirname}`,
            undefined
        );

        const edits = synced.onDocumentFormattingRequest({
            textDocument: { uri: uriString },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.strictEqual(edits, undefined);
    });

    it("still formats non-Blaze HTML files (doctype pages)", () => {
        const uriString = "file:///not-on-disk/page.html";
        const pageContent =
            "<!DOCTYPE html>\n<html><body><div><span>x</span></div></body></html>";
        const synced = new HtmlFeaturesProvider(
            serverInstanceMock,
            {
                get: (key) =>
                    key === uriString
                        ? { getText: () => pageContent }
                        : undefined,
            },
            `file://${__dirname}`,
            undefined
        );

        const edits = synced.onDocumentFormattingRequest({
            textDocument: { uri: uriString },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.ok(edits?.length, "non-Blaze HTML should still format");
    });

    it("returns no edits when the document is not a synced buffer", () => {
        // Edits are applied to the live buffer: computing them from disk
        // content splices stale fragments into the document whenever the
        // two differ (real-world file corruption). Unsynced -> no edits.
        const detached = new HtmlFeaturesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            undefined
        );

        const edits = detached.onDocumentFormattingRequest({
            textDocument: {
                uri: fixtureUri("formatting-project", "client/messy.html"),
            },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.strictEqual(edits, undefined);
    });

    it("does not format JS files", () => {
        const edits = provider.onDocumentFormattingRequest({
            textDocument: { uri: fixtureUri("basic-project", "client/foo.ts") },
            options: { tabSize: 4, insertSpaces: true },
        });

        assert.strictEqual(edits, undefined);
    });
});
