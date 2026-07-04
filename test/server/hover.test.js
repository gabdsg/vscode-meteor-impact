const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { HoverProvider } = require("../../server/src/hover-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new HoverProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("HoverProvider", () => {
    it("shows helper info when hovering a mustache in HTML", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // Position on "formattedName" inside foo.html.
        const hover = createProvider(indexer).onHoverRequest({
            position: { line: 2, character: 17 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(hover, "Expected hover result");
        const { value } = hover.contents;
        assert.ok(value.includes("formattedName"));
        assert.ok(value.includes("foo.ts"));
        assert.ok(value.includes("helper of template"));
    });

    it("shows template info when hovering a partial", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // Position on "bar" inside {{> bar}} of foo.html.
        const hover = createProvider(indexer).onHoverRequest({
            position: { line: 4, character: 13 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(hover, "Expected hover result");
        const { value } = hover.contents;
        assert.ok(value.includes("bar"));
        assert.ok(value.includes("template"));
        assert.ok(value.includes("bar.html"));
    });

    it("shows global helper info when no scoped helper matches", async () => {
        const { indexer } = await loadFixtureIndexer("global-helpers-project");

        // Position on "formatCurrency" in the "about" template.
        const hover = createProvider(indexer).onHoverRequest({
            position: { line: 5, character: 13 },
            textDocument: {
                uri: fixtureUri("global-helpers-project", "client/main.html"),
            },
        });

        assert.ok(hover, "Expected hover result");
        const { value } = hover.contents;
        assert.ok(value.includes("formatCurrency"));
        assert.ok(value.includes("global helper"));
        assert.ok(value.includes("global-helpers.ts"));
    });

    it("shows method info when hovering a Meteor.call string in JS", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        const callerLines = fs
            .readFileSync(path.join(rootPath, "client/caller.ts"), "utf-8")
            .split("\n");

        const line = callerLines.findIndex((l) => l.includes("callAsync"));
        const character = callerLines[line].indexOf("tasks.insert") + 3;

        const hover = createProvider(indexer).onHoverRequest({
            position: { line, character },
            textDocument: {
                uri: fixtureUri("methods-project", "client/caller.ts"),
            },
        });

        assert.ok(hover, "Expected hover result");
        const { value } = hover.contents;
        assert.ok(value.includes("tasks.insert"));
        assert.ok(value.includes("Meteor method"));
        assert.ok(value.includes("methods.ts"));
    });

    it("falls back to HTML hover for plain HTML content", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // Position on the <div> tag of foo.html.
        const hover = createProvider(indexer).onHoverRequest({
            position: { line: 1, character: 6 },
            textDocument: {
                uri: fixtureUri("basic-project", "client/foo.html"),
            },
        });

        assert.ok(hover, "Expected the HTML language service hover");
        const value = hover.contents.value || `${hover.contents}`;
        assert.ok(value.toLowerCase().includes("div"));
    });
});
