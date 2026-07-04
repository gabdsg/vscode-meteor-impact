const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loadFixtureIndexer, fixtureUri } = require("./test-utils");

const overrideContent = (indexer, overrides) => {
    indexer.documentsInstance = {
        get: (uri) =>
            overrides.has(uri.fsPath)
                ? { getText: () => overrides.get(uri.fsPath) }
                : undefined,
    };
};

describe("Incremental reindexing - removal of derived entries", () => {
    it("updates event maps when an event key is renamed", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "events-project"
        );
        const overrides = new Map();
        overrideContent(indexer, overrides);

        const widgetTsPath = path.join(rootPath, "client/widget.ts");
        overrides.set(
            widgetTsPath,
            fs
                .readFileSync(widgetTsPath, "utf-8")
                .replace(/click \.js-save/g, "click .js-store")
        );

        assert.ok(indexer.reindexFile(`file://${widgetTsPath}`));

        const { eventsMap, templateIndexMap } = indexer.blazeIndexer;
        // The old key keeps only the widget-extra.ts definition.
        assert.strictEqual(eventsMap["click .js-save"].length, 1);
        assert.ok(
            eventsMap["click .js-save"][0].uri.fsPath.endsWith(
                "widget-extra.ts"
            )
        );
        assert.strictEqual(eventsMap["click .js-store"].length, 1);
        assert.ok(templateIndexMap["widget"].events["click .js-store"]);
    });

    it("updates template selectors when the HTML changes", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "events-project"
        );
        const overrides = new Map();
        overrideContent(indexer, overrides);

        const widgetHtmlPath = path.join(rootPath, "client/widget.html");
        overrides.set(
            widgetHtmlPath,
            fs
                .readFileSync(widgetHtmlPath, "utf-8")
                .replace('<button class="js-save">Save</button>', "")
        );

        assert.ok(indexer.reindexFile(`file://${widgetHtmlPath}`));

        const selectors = indexer.blazeIndexer.templateSelectorsMap["widget"];
        assert.ok(!selectors[".js-save"], "Removed selector is dropped");
        assert.ok(selectors[".js-cancel"], "Remaining selector is kept");
    });

    it("removes global helpers and Template.X references with their file", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "global-helpers-project"
        );
        const overrides = new Map();
        overrideContent(indexer, overrides);

        const globalsPath = path.join(rootPath, "client/global-helpers.ts");
        overrides.set(globalsPath, 'import { Template } from "meteor/templating";\n');

        assert.ok(
            indexer.reindexFile(
                fixtureUri("global-helpers-project", "client/global-helpers.ts")
            )
        );
        assert.ok(!indexer.blazeIndexer.globalHelpersMap["formatCurrency"]);

        const mainTsPath = path.join(rootPath, "client/main.ts");
        overrides.set(mainTsPath, 'import { Template } from "meteor/templating";\n');
        assert.ok(indexer.reindexFile(`file://${mainTsPath}`));
        assert.ok(!indexer.blazeIndexer.templateJsReferences["home"]);
    });
});
