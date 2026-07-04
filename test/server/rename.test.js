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

const createProvider = (indexer) =>
    new RenameProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

// Apply single-line text edits to a file content.
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

const editsFor = (changes, fileName) => {
    const key = Object.keys(changes).find((uri) => uri.endsWith(fileName));
    assert.ok(key, `Expected edits for ${fileName}`);
    return changes[key];
};

const applyTo = (rootPath, changes, relativePath) =>
    applyEdits(
        fs.readFileSync(path.join(rootPath, relativePath), "utf-8"),
        editsFor(changes, relativePath.split("/").pop())
    );

describe("RenameProvider", () => {
    it("renames a helper from an HTML usage", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "basic-project"
        );

        const result = createProvider(indexer).onRenameRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
            newName: "prettyName",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.strictEqual(Object.keys(result.changes).length, 2);

        const newTs = applyTo(rootPath, result.changes, "client/foo.ts");
        assert.ok(newTs.includes("prettyName(person?: Person): string"));
        assert.ok(!newTs.includes("formattedName"));

        const newHtml = applyTo(rootPath, result.changes, "client/foo.html");
        assert.ok(newHtml.includes("{{prettyName person}}"));
    });

    it("renames a template from a partial usage", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "basic-project"
        );

        const result = createProvider(indexer).onRenameRequest({
            position: { line: 4, character: 13 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
            newName: "sidebar",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.strictEqual(Object.keys(result.changes).length, 3);

        assert.ok(
            applyTo(rootPath, result.changes, "client/foo.html").includes(
                "{{> sidebar}}"
            )
        );
        assert.ok(
            applyTo(rootPath, result.changes, "client/bar.html").includes(
                '<template name="sidebar">'
            )
        );
        assert.ok(
            applyTo(rootPath, result.changes, "client/bar.js").includes(
                "Template.sidebar.helpers({"
            )
        );
    });

    it("renames a method definition and its call sites", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        const methodsLines = fs
            .readFileSync(path.join(rootPath, "server/methods.ts"), "utf-8")
            .split("\n");

        const line = methodsLines.findIndex((l) =>
            l.includes('"tasks.insert"')
        );
        const character = methodsLines[line].indexOf("tasks.insert") + 3;

        const result = createProvider(indexer).onRenameRequest({
            position: { line, character },
            textDocument: {
                uri: fixtureUri("methods-project", "server/methods.ts"),
            },
            newName: "tasks.create",
        });

        assert.ok(result?.changes, "Expected a workspace edit");

        const newMethods = applyTo(
            rootPath,
            result.changes,
            "server/methods.ts"
        );
        assert.ok(newMethods.includes('"tasks.create"(text: string)'));

        const newCaller = applyTo(rootPath, result.changes, "client/caller.ts");
        assert.ok(newCaller.includes('Meteor.callAsync("tasks.create"'));
    });

    it("renames quoted helper keys keeping the quotes", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "kebab-project"
        );
        const kebabLines = fs
            .readFileSync(path.join(rootPath, "client/kebab.ts"), "utf-8")
            .split("\n");

        const line = kebabLines.findIndex((l) => l.includes("quoted-helper"));

        const result = createProvider(indexer).onRenameRequest({
            position: { line, character: 8 },
            textDocument: {
                uri: fixtureUri("kebab-project", "client/kebab.ts"),
            },
            newName: "renamed-helper",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.ok(
            applyTo(rootPath, result.changes, "client/kebab.ts").includes(
                '"renamed-helper": (): string => "quoted"'
            )
        );
    });

    it("renames event keys across every event map", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "events-project"
        );

        const result = createProvider(indexer).onRenameRequest({
            position: { line: 3, character: 8 },
            textDocument: {
                uri: fixtureUri("events-project", "client/widget.ts"),
            },
            newName: "click .js-store",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.strictEqual(Object.keys(result.changes).length, 2);
        assert.ok(
            applyTo(rootPath, result.changes, "client/widget.ts").includes(
                '"click .js-store"(event: Event)'
            )
        );
        assert.ok(
            applyTo(
                rootPath,
                result.changes,
                "client/widget-extra.ts"
            ).includes('"click .js-store"(): void')
        );
    });

    it("renames a template from its own tag attribute", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "basic-project"
        );

        // Cursor on "bar" inside <template name="bar"> in bar.html.
        const result = createProvider(indexer).onRenameRequest({
            position: { line: 0, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/bar.html"),
            },
            newName: "sidebar",
        });

        assert.ok(result?.changes, "Expected a workspace edit");
        assert.strictEqual(Object.keys(result.changes).length, 3);
        assert.ok(
            applyTo(rootPath, result.changes, "client/bar.html").includes(
                '<template name="sidebar">'
            )
        );
        assert.ok(
            applyTo(rootPath, result.changes, "client/foo.html").includes(
                "{{> sidebar}}"
            )
        );
        assert.ok(
            applyTo(rootPath, result.changes, "client/bar.js").includes(
                "Template.sidebar.helpers({"
            )
        );
    });

    it("prepares rename from the template tag with the attribute range", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const prepared = createProvider(indexer).onPrepareRenameRequest({
            position: { line: 0, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/bar.html"),
            },
        });

        assert.ok(prepared, "Expected a prepare rename result");
        assert.strictEqual(prepared.placeholder, "bar");
        assert.strictEqual(prepared.range.start.character, 16);
        assert.strictEqual(prepared.range.end.character, 19);
    });

    it("prepares rename with the symbol range and placeholder", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const prepared = createProvider(indexer).onPrepareRenameRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(prepared, "Expected a prepare rename result");
        assert.strictEqual(prepared.placeholder, "formattedName");
        assert.strictEqual(prepared.range.start.line, 2);
    });

    it("refuses to rename plain HTML content", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        const prepared = createProvider(indexer).onPrepareRenameRequest({
            position: { line: 1, character: 6 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.strictEqual(prepared, undefined);
    });
});
