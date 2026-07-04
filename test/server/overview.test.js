const assert = require("assert");

const { OverviewProvider } = require("../../server/src/overview-provider");
const {
    loadFixtureIndexer,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const createProvider = (indexer) =>
    new OverviewProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("OverviewProvider", () => {
    it("summarizes templates with helpers and the inclusion graph", async () => {
        const { indexer } = await loadFixtureIndexer("rename-folder-project");

        const overview = createProvider(indexer).onAppOverviewRequest();

        const names = overview.templates.map(({ name }) => name);
        assert.deepStrictEqual(names, ["home", "widgetA"]);

        const home = overview.templates.find(({ name }) => name === "home");
        assert.strictEqual(home.includedBy.length, 0);
        assert.strictEqual(home.includes.length, 1);
        assert.strictEqual(home.includes[0].name, "widgetA");
        assert.ok(home.includes[0].file.endsWith("home.html"));

        const widgetA = overview.templates.find(
            ({ name }) => name === "widgetA"
        );
        assert.deepStrictEqual(widgetA.includedBy, ["home"]);
        assert.strictEqual(widgetA.helpers.length, 1);
        assert.strictEqual(widgetA.helpers[0].name, "title");
        assert.ok(widgetA.helpers[0].file.endsWith("widgetA.ts"));
        assert.strictEqual(widgetA.helpers[0].unused, false);
    });

    it("summarizes methods and publications with usage flags", async () => {
        const { indexer } = await loadFixtureIndexer(
            "method-diagnostics-project"
        );

        const overview = createProvider(indexer).onAppOverviewRequest();

        const insert = overview.methods.find(
            ({ name }) => name === "tasks.insert"
        );
        assert.ok(insert);
        assert.strictEqual(insert.unused, false);
        assert.ok(insert.file.endsWith("defs.ts"));

        const unused = overview.methods.find(
            ({ name }) => name === "tasks.unused"
        );
        assert.strictEqual(unused.unused, true);

        assert.strictEqual(overview.publications.length, 1);
        assert.strictEqual(overview.publications[0].name, "tasks.all");
    });

    it("lists events under their template", async () => {
        const { indexer } = await loadFixtureIndexer("events-project");

        const overview = createProvider(indexer).onAppOverviewRequest();
        const widget = overview.templates.find(
            ({ name }) => name === "widget"
        );

        const eventNames = widget.events.map(({ name }) => name).sort();
        assert.deepStrictEqual(eventNames, [
            "click .js-cancel",
            "click .js-save",
        ]);
    });
});
