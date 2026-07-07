const assert = require("assert");

const {
    loadFixtureIndexer,
    fixtureUri,
    overrideContent,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Real-world file shapes reported from a large Meteor app: mustaches
// without names ({{this}}), Spacebars-valid-but-mustache-invalid files,
// full-page HTML (email templates, generated reports) and nested
// node_modules. None of them may break indexing or spam errors.
describe("Indexer resilience on real-world projects", () => {
    let indexer;
    let result;

    before(async () => {
        ({ indexer, result } = await loadFixtureIndexer("resilient-project"));
    });

    it("survives {{this}}, {{.}} and literal mustaches", () => {
        // The load completed (previously addUsage threw and killed the
        // server initialize) and the template indexed normally.
        assert.ok(indexer.loaded);
        assert.ok(indexer.blazeIndexer.templateIndexMap["dynamic"]);
        assert.ok(indexer.blazeIndexer.htmlUsageMap["items"]);

        // No junk keys leaked into the usage map.
        assert.ok(!("undefined" in indexer.blazeIndexer.htmlUsageMap));
        assert.ok(!("true" in indexer.blazeIndexer.htmlUsageMap));
        assert.ok(!("this" in indexer.blazeIndexer.htmlUsageMap));
    });

    it("skips full-page HTML files quietly", () => {
        // Email templates and generated reports are not Blaze files:
        // no parse error is recorded for them...
        assert.strictEqual(result.hasErrors, false);
        assert.strictEqual(indexer.parsingErrors.size, 0);

        // ...and they are not in the sources map.
        const sourcePaths = Object.keys(indexer.getSources());
        assert.ok(
            !sourcePaths.some((p) => p.endsWith("school-invitation.html"))
        );
        assert.ok(!sourcePaths.some((p) => p.endsWith("report.html")));
    });

    it("degrades to Spacebars-only indexing when the mustache parser rejects a file Meteor accepts", () => {
        // loose.html has a stray brace after {{cardId}} - Spacebars (and
        // the Meteor build) accept it, so it must not be flagged as a
        // parse error and the file stays available to providers.
        assert.ok(
            ![...indexer.parsingErrors.keys()].some((p) =>
                p.endsWith("loose.html")
            )
        );
        const looseSource = Object.entries(indexer.getSources()).find(
            ([fsPath]) => fsPath.endsWith("loose.html")
        );
        assert.ok(looseSource, "loose.html should stay in the sources");
        assert.ok(looseSource[1].htmlJs, "htmlJs indexing is preserved");
    });

    it("ignores mustaches inside HTML comments, like Meteor does", () => {
        // The commented-out {{/if}} did not fail the parse: the template
        // and its helper usages indexed fully.
        assert.ok(indexer.blazeIndexer.templateIndexMap["commented"]);
        assert.ok(indexer.blazeIndexer.htmlUsageMap["rows"]);

        // A <template> tag inside a comment is not a real template.
        assert.ok(!indexer.blazeIndexer.templateIndexMap["ghost"]);
    });

    it("survives Object.prototype method calls on Template", () => {
        // Template.hasOwnProperty(t) looked like a template reference and
        // the inherited function made `map[name] || []` skip its guard,
        // crashing indexing. It must neither error nor be recorded.
        assert.ok(
            ![...indexer.parsingErrors.keys()].some((p) =>
                p.endsWith("template-utils.js")
            )
        );
        assert.ok(
            !Object.prototype.hasOwnProperty.call(
                indexer.blazeIndexer.templateJsReferences,
                "hasOwnProperty"
            )
        );
    });

    it("never indexes nested node_modules", () => {
        assert.ok(
            !indexer.projectUris.some(({ fsPath }) =>
                fsPath.includes("node_modules")
            )
        );
    });

    const createProvider = (ProviderClass) =>
        new ProviderClass(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    it("definition request degrades quietly on a file the mustache parser rejects", () => {
        // loose.html indexes (htmlJs-only) but has no mustache AST: the
        // request returns nothing instead of failing with a parse error.
        const { DefinitionProvider } = require("../../server/src/definition-provider");
        const definition = createProvider(DefinitionProvider).onDefinitionRequest({
            position: { line: 1, character: 31 },
            textDocument: {
                uri: fixtureUri("resilient-project", "client/loose.html"),
            },
        });
        assert.strictEqual(definition, undefined);
    });

    it("hover falls back to HTML tag docs on a file the mustache parser rejects", () => {
        const { HoverProvider } = require("../../server/src/hover-provider");

        // Position on the <div> tag of loose.html.
        const hover = createProvider(HoverProvider).onHoverRequest({
            position: { line: 1, character: 6 },
            textDocument: {
                uri: fixtureUri("resilient-project", "client/loose.html"),
            },
        });
        assert.ok(hover, "Expected the embedded HTML hover fallback");
        assert.ok(JSON.stringify(hover.contents).includes("div"));
    });

    it("resolves a partial inside a file whose htmlJs is a single node", () => {
        // solo.html has exactly one top-level tag and no trailing newline:
        // SpacebarsCompiler.parse returns a single node, not an array.
        const { DefinitionProvider } = require("../../server/src/definition-provider");

        // Position on "dynamic" in {{> dynamic}}.
        const definition = createProvider(DefinitionProvider).onDefinitionRequest({
            position: { line: 0, character: 33 },
            textDocument: {
                uri: fixtureUri("resilient-project", "client/solo.html"),
            },
        });
        assert.ok(definition, "Expected a definition location");
        assert.ok(definition.uri.endsWith("dynamic.js"));
    });

    it("treats a file turning non-Blaze as a removal on reindex", () => {
        const uri = fixtureUri("resilient-project", "client/dynamic.html");
        const overrides = new Map();
        overrideContent(indexer, overrides);

        const fsPath = indexer.parseUri(uri).fsPath;
        overrides.set(fsPath, "<!DOCTYPE html>\n<html><body>x</body></html>");

        assert.strictEqual(indexer.reindexFile(uri), false);
        // No error squiggle; the HTML-side definition is gone (the entry
        // itself survives because dynamic.js still defines its helpers).
        assert.ok(!indexer.parsingErrors.has(fsPath));
        assert.ok(!indexer.blazeIndexer.templateIndexMap["dynamic"]?.node);
        assert.ok(!indexer.blazeIndexer.htmlUsageMap["items"]);

        // Restore: everything comes back.
        overrides.delete(fsPath);
        assert.strictEqual(indexer.reindexFile(uri), true);
        assert.ok(indexer.blazeIndexer.templateIndexMap["dynamic"].node);
        assert.ok(indexer.blazeIndexer.htmlUsageMap["items"]);
    });
});
