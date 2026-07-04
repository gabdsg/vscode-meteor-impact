const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loadFixtureIndexer, fixtureUri } = require("./test-utils");

// Simulates open editor buffers: reindexFile reads through the documents
// instance, so overriding it mimics unsaved edits.
const overrideContent = (indexer, overrides) => {
    indexer.documentsInstance = {
        get: (uri) =>
            overrides.has(uri.fsPath)
                ? { getText: () => overrides.get(uri.fsPath) }
                : undefined,
    };
};

describe("Indexer - incremental reindexing", () => {
    let indexer;
    let rootPath;
    let overrides;

    beforeEach(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer("basic-project"));
        overrides = new Map();
        overrideContent(indexer, overrides);
    });

    it("updates helpers when a JS/TS file changes", () => {
        const fooTsPath = path.join(rootPath, "client/foo.ts");
        const originalContent = fs.readFileSync(fooTsPath, "utf-8");

        overrides.set(
            fooTsPath,
            originalContent.replace(/formattedName/g, "renamedHelper")
        );

        const reindexed = indexer.reindexFile(
            fixtureUri("basic-project", "client/foo.ts")
        );
        assert.strictEqual(reindexed, true);

        const { helpers } = indexer.blazeIndexer.templateIndexMap["foo"];
        assert.ok(helpers["renamedHelper"], "Expected the renamed helper");
        assert.ok(!helpers["formattedName"], "Old helper should be dropped");
        // Other helpers of the same file are re-added.
        assert.ok(helpers["peopleCount"]);
        // Other files are untouched.
        assert.ok(
            indexer.blazeIndexer.templateIndexMap["bar"].helpers["barTitle"]
        );
    });

    it("updates usages when an HTML file changes", () => {
        const fooHtmlPath = path.join(rootPath, "client/foo.html");
        const originalContent = fs.readFileSync(fooHtmlPath, "utf-8");

        overrides.set(
            fooHtmlPath,
            originalContent.replace("<span>{{peopleCount}}</span>", "")
        );

        const reindexed = indexer.reindexFile(
            fixtureUri("basic-project", "client/foo.html")
        );
        assert.strictEqual(reindexed, true);

        const { htmlUsageMap, templateIndexMap } = indexer.blazeIndexer;
        assert.ok(!htmlUsageMap["peopleCount"], "Removed usage is dropped");
        assert.ok(htmlUsageMap["formattedName"], "Remaining usage is kept");
        // The template tag is re-indexed and its helpers (from foo.ts)
        // survive.
        assert.ok(templateIndexMap["foo"].node);
        assert.ok(templateIndexMap["foo"].helpers["formattedName"]);
    });

    it("keeps the previous index when the file is unparseable", () => {
        const fooHtmlPath = path.join(rootPath, "client/foo.html");

        // Unclosed block: the handlebars parser throws.
        overrides.set(fooHtmlPath, "{{#if broken}}");

        const reindexed = indexer.reindexFile(
            fixtureUri("basic-project", "client/foo.html")
        );

        assert.strictEqual(reindexed, false);
        assert.ok(indexer.blazeIndexer.templateIndexMap["foo"].node);
        assert.ok(indexer.blazeIndexer.htmlUsageMap["formattedName"]);
    });

    it("indexes brand new files", () => {
        const newPath = path.join(rootPath, "client/fresh.ts");
        overrides.set(
            newPath,
            'import { Template } from "meteor/templating";\n' +
                "Template.fresh.helpers({\n" +
                "    freshHelper(): string {\n" +
                '        return "fresh";\n' +
                "    },\n" +
                "});\n"
        );

        const reindexed = indexer.reindexFile(`file://${newPath}`);

        assert.strictEqual(reindexed, true);
        assert.ok(
            indexer.blazeIndexer.templateIndexMap["fresh"].helpers[
                "freshHelper"
            ]
        );
        assert.ok(indexer.getFileInfo(`file://${newPath}`));
    });

    it("ignores non-source files", () => {
        assert.strictEqual(
            indexer.reindexFile(`file://${rootPath}/client/styles.css`),
            false
        );
    });
});
