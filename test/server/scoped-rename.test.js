const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { RenameProvider } = require("../../server/src/rename-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const applyEdits = (content, edits) => {
    const lines = content.split("\n");
    const sorted = [...edits].sort(
        (a, b) =>
            b.range.start.line - a.range.start.line ||
            b.range.start.character - a.range.start.character
    );

    for (const { range, newText } of sorted) {
        const line = lines[range.start.line];
        lines[range.start.line] =
            line.slice(0, range.start.character) +
            newText +
            line.slice(range.end.character);
    }

    return lines.join("\n");
};

const count = (str, sub) => str.split(sub).length - 1;

describe("RenameProvider - helper scoping", () => {
    let indexer;
    let rootPath;
    let provider;

    const uriOf = (relativePath) =>
        fixtureUri("scoped-helpers-project", relativePath);

    const changedFiles = (changes) =>
        Object.keys(changes)
            .map((uri) => uri.split("/").pop())
            .sort();

    const applyToHtml = (changes) => {
        const key = Object.keys(changes).find((uri) =>
            uri.endsWith("tpls.html")
        );
        assert.ok(key, "Expected edits in tpls.html");
        return applyEdits(
            fs.readFileSync(path.join(rootPath, "client/tpls.html"), "utf-8"),
            changes[key]
        ).split("\n");
    };

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer(
            "scoped-helpers-project"
        ));
        provider = new RenameProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
    });

    it("renaming from a usage only touches the wrapping template's scope", () => {
        // {{shared}} inside the "alpha" template.
        const result = provider.onRenameRequest({
            position: { line: 1, character: 12 },
            textDocument: { uri: uriOf("client/tpls.html") },
            newName: "renamed",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.deepStrictEqual(changedFiles(result.changes), [
            "alpha.ts",
            "tpls.html",
        ]);

        const htmlLines = applyToHtml(result.changes);
        assert.ok(htmlLines[1].includes("{{renamed}}"), "alpha usage renamed");
        assert.strictEqual(count(htmlLines.join("\n"), "{{shared}}"), 2);
    });

    it("renaming from a definition key only touches that template's scope", () => {
        // The "shared" key inside Template.beta.helpers.
        const result = provider.onRenameRequest({
            position: { line: 3, character: 5 },
            textDocument: { uri: uriOf("client/beta.ts") },
            newName: "renamed",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.deepStrictEqual(changedFiles(result.changes), [
            "beta.ts",
            "tpls.html",
        ]);

        const htmlLines = applyToHtml(result.changes);
        assert.ok(htmlLines[5].includes("{{renamed}}"), "beta usage renamed");
        assert.strictEqual(count(htmlLines.join("\n"), "{{shared}}"), 2);
    });

    it("renaming a global helper skips usages shadowed by scoped helpers", () => {
        // {{shared}} inside "gamma", which has no scoped helper: it
        // resolves to the global.
        const result = provider.onRenameRequest({
            position: { line: 9, character: 12 },
            textDocument: { uri: uriOf("client/tpls.html") },
            newName: "renamed",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.deepStrictEqual(changedFiles(result.changes), [
            "globals.ts",
            "tpls.html",
        ]);

        const htmlLines = applyToHtml(result.changes);
        assert.ok(htmlLines[9].includes("{{renamed}}"), "gamma usage renamed");
        // alpha and beta usages resolve to their scoped helpers: untouched.
        assert.strictEqual(count(htmlLines.join("\n"), "{{shared}}"), 2);
    });

    it("renaming from the registerHelper argument renames the global scope", () => {
        const result = provider.onRenameRequest({
            position: { line: 2, character: 27 },
            textDocument: { uri: uriOf("client/globals.ts") },
            newName: "renamed",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.deepStrictEqual(changedFiles(result.changes), [
            "globals.ts",
            "tpls.html",
        ]);

        const globalsKey = Object.keys(result.changes).find((uri) =>
            uri.endsWith("globals.ts")
        );
        const newGlobals = applyEdits(
            fs.readFileSync(path.join(rootPath, "client/globals.ts"), "utf-8"),
            result.changes[globalsKey]
        );
        assert.ok(newGlobals.includes('Template.registerHelper("renamed"'));
    });
});
