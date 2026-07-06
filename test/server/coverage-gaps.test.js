const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const { HoverProvider } = require("../../server/src/hover-provider");
const { ServerBase } = require("../../server/src/helpers");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createDefinitionProvider = (indexer) =>
    new DefinitionProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

const createHoverProvider = (indexer) =>
    new HoverProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("Definition provider - JS and partial paths", () => {
    it("jumps from a Meteor.call literal to the method definition", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        const callerLines = fs
            .readFileSync(path.join(rootPath, "client/caller.ts"), "utf-8")
            .split("\n");
        const line = callerLines.findIndex((l) => l.includes("callAsync"));
        const character = callerLines[line].indexOf("tasks.insert") + 3;

        const location = createDefinitionProvider(indexer).onDefinitionRequest(
            {
                position: { line, character },
                textDocument: {
                    uri: fixtureUri("methods-project", "client/caller.ts"),
                },
            }
        );

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("methods.ts"));
        assert.strictEqual(location.range.start.line, 3);
    });

    it("resolves a cross-file partial to the template's code-behind", async () => {
        const { indexer } = await loadFixtureIndexer("rename-folder-project");

        // {{> widgetA}} inside home.html; widgetA lives in its own folder.
        const location = createDefinitionProvider(indexer).onDefinitionRequest(
            {
                position: { line: 1, character: 9 },
                textDocument: {
                    uri: fixtureUri("rename-folder-project", "client/home.html"),
                },
            }
        );

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("widgetA.ts"));
    });

    it("resolves a same-file partial through the shared code-behind", async () => {
        const { indexer } = await loadFixtureIndexer("block-vars-project");

        // {{> row}} in list.html; the row template is defined in the same
        // file and Template.row appears in list.ts.
        const location = createDefinitionProvider(indexer).onDefinitionRequest(
            {
                position: { line: 8, character: 9 },
                textDocument: {
                    uri: fixtureUri("block-vars-project", "client/list.html"),
                },
            }
        );

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("list.ts"));
    });
});

describe("Definition provider - fallback paths", () => {
    it("resolves a same-file partial to the HTML tag when the code-behind doesn't define it", async () => {
        const { indexer } = await loadFixtureIndexer("stateless-project");

        // {{> banner}} in page.html; page.ts exists but has no
        // Template.banner, so the definition is the HTML tag itself.
        const location = createDefinitionProvider(indexer).onDefinitionRequest(
            {
                position: { line: 1, character: 9 },
                textDocument: {
                    uri: fixtureUri("stateless-project", "client/page.html"),
                },
            }
        );

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("page.html"));
    });

    it("returns the current node when only references exist for it", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "basic-project"
        );
        const barJsLines = fs
            .readFileSync(path.join(rootPath, "client/bar.js"), "utf-8")
            .split("\n");
        const line = barJsLines.findIndex((l) =>
            l.includes("Template.bar.helpers")
        );

        // On the "bar" template property: not a helper/method, but it has
        // HTML usages, so the provider anchors references at the cursor.
        const location = createDefinitionProvider(indexer).onDefinitionRequest(
            {
                position: { line, character: 10 },
                textDocument: {
                    uri: fixtureUri("basic-project", "client/bar.js"),
                },
            }
        );

        assert.ok(location, "Expected the anchor location");
        assert.ok(location.uri.endsWith("bar.js"));
    });
});

describe("Hover provider - JS paths", () => {
    it("hovers a template helper from its definition file", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");

        // On "formattedName" (the helper key) in foo.ts, line 16.
        const hover = createHoverProvider(indexer).onHoverRequest({
            position: { line: 15, character: 6 },
            textDocument: { uri: fixtureUri("basic-project", "client/foo.ts") },
        });

        assert.ok(hover, "Expected a hover");
        assert.ok(hover.contents.value.includes("template helper"));
    });

    it("hovers a global helper from its registerHelper call", async () => {
        const { indexer } = await loadFixtureIndexer("global-helpers-project");

        const hover = createHoverProvider(indexer).onHoverRequest({
            position: { line: 2, character: 27 },
            textDocument: {
                uri: fixtureUri(
                    "global-helpers-project",
                    "client/global-helpers.ts"
                ),
            },
        });

        assert.ok(hover, "Expected a hover");
        assert.ok(hover.contents.value.includes("global helper"));
    });

    it("hovers an event key with its definition count", async () => {
        const { indexer } = await loadFixtureIndexer("events-project");

        const hover = createHoverProvider(indexer).onHoverRequest({
            position: { line: 3, character: 8 },
            textDocument: {
                uri: fixtureUri("events-project", "client/widget.ts"),
            },
        });

        assert.ok(hover, "Expected a hover");
        assert.ok(hover.contents.value.includes("event handler (2 definitions)"));
    });

    it("hovers a publication name", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "methods-project"
        );
        const lines = fs
            .readFileSync(path.join(rootPath, "server/methods.ts"), "utf-8")
            .split("\n");
        const line = lines.findIndex((l) => l.includes("Meteor.publish"));

        const hover = createHoverProvider(indexer).onHoverRequest({
            position: { line, character: lines[line].indexOf("tasks.all") + 2 },
            textDocument: {
                uri: fixtureUri("methods-project", "server/methods.ts"),
            },
        });

        assert.ok(hover, "Expected a hover");
        assert.ok(hover.contents.value.includes("Meteor publication"));
    });
});

describe("ValidatedMethod and publishComposite indexing", () => {
    it("indexes both declaration styles", async () => {
        const { indexer } = await loadFixtureIndexer(
            "validated-methods-project"
        );
        const { methodsMap, publicationsMap } =
            indexer.methodsAndPublicationsIndexer;

        assert.ok(methodsMap["tasks.update"], "Expected the ValidatedMethod");
        assert.ok(
            methodsMap["tasks.update"].uri.fsPath.endsWith("api.ts")
        );
        assert.ok(
            publicationsMap["tasks.composite"],
            "Expected the publishComposite publication"
        );
    });
});

describe("Indexer configuration", () => {
    it("reindexes with configured ignored directories", async () => {
        const { indexer } = await loadFixtureIndexer("basic-project");
        assert.ok(Object.keys(indexer.getSources()).length > 0);

        await indexer.onDidChangeConfiguration({
            settings: {
                conf: {
                    settingsEditor: {
                        meteorImpact: { ignoreDirsOnIndexing: "client" },
                    },
                },
            },
        });

        assert.strictEqual(Object.keys(indexer.getSources()).length, 0);

        // Clearing the setting restores full indexing.
        await indexer.onDidChangeConfiguration({ settings: {} });
        assert.ok(Object.keys(indexer.getSources()).length > 0);
    });
});

describe("Indexing notifications", () => {
    it("emits busy/done with index stats around a reindex", async () => {
        const { Indexer } = require("../../server/src/indexer");
        const notifications = [];

        const indexer = new Indexer({
            rootUri: fixtureUri("basic-project", ""),
            serverInstance: {
                sendNotification: (method, params) =>
                    notifications.push({ method, params }),
            },
            documentsInstance: documentsInstanceMock,
        });

        await indexer.reindex();

        const indexing = notifications.filter(
            ({ method }) => method === "meteorImpact/indexing"
        );
        assert.strictEqual(indexing.length, 2);
        assert.strictEqual(indexing[0].params.busy, true);
        assert.strictEqual(indexing[1].params.busy, false);
        assert.strictEqual(indexing[1].params.templates, 2);
    });
});

describe("ServerBase utilities", () => {
    it("reads open buffers through the documents instance", () => {
        const base = new ServerBase(
            serverInstanceMock,
            { get: () => ({ getText: () => "buffer content" }) },
            `file://${__dirname}`
        );

        assert.strictEqual(
            base.getFileContent("file:///whatever.ts"),
            "buffer content"
        );
    });

    it("looks up open buffers by string URI, like TextDocuments does", () => {
        // vscode-languageserver's TextDocuments is a Map keyed by the
        // client's URI string: a URI object always misses, silently
        // reading stale disk content instead of the open buffer.
        const uriString = "file:///not-on-disk/open-buffer.html";
        const synced = new Map([
            [uriString, { getText: () => "buffer content" }],
        ]);
        const base = new ServerBase(
            serverInstanceMock,
            { get: (key) => synced.get(key) },
            `file://${__dirname}`
        );

        assert.strictEqual(base.getFileContent(uriString), "buffer content");
    });

    it("resolves the sibling code-behind, preferring existing files", async () => {
        const { rootPath } = await loadFixtureIndexer("basic-project");
        const base = new ServerBase(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`
        );

        // foo has a .ts code-behind, bar a .js one.
        assert.ok(
            base
                .getSiblingJsUri(`file://${rootPath}/client/foo.html`)
                .fsPath.endsWith("foo.ts")
        );
        assert.ok(
            base
                .getSiblingJsUri(`file://${rootPath}/client/bar.html`)
                .fsPath.endsWith("bar.js")
        );
        // Neither exists: defaults to the .js path.
        assert.ok(
            base
                .getSiblingJsUri(`file://${rootPath}/client/nothing.html`)
                .fsPath.endsWith("nothing.js")
        );
    });
});
