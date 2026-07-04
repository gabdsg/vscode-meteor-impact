const assert = require("assert");

const { ReferencesProvider } = require("../../server/src/references-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("BlazeIndexer - Template.X.events maps", () => {
    let indexer;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("events-project"));
    });

    it("indexes event handlers per template, like helpers", () => {
        const widgetTemplate = indexer.blazeIndexer.templateIndexMap["widget"];

        assert.ok(widgetTemplate, "Expected template widget to be indexed");
        assert.ok(widgetTemplate.events?.["click .js-save"]);
        assert.ok(widgetTemplate.events?.["click .js-cancel"]);
        assert.ok(
            widgetTemplate.events["click .js-cancel"].uri.fsPath.endsWith(
                "widget.ts"
            )
        );
    });

    it("indexes every definition of the same event key", () => {
        const locations =
            indexer.blazeIndexer.getEventLocations("click .js-save");

        assert.strictEqual(locations.length, 2);

        const paths = locations.map(({ uri }) => uri.fsPath).sort();
        assert.ok(paths[0].endsWith("widget-extra.ts"));
        assert.ok(paths[1].endsWith("widget.ts"));
    });

    it("finds references for an event handler key", () => {
        const referencesProvider = new ReferencesProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        // Position inside "click .js-save" on line 4 (0-based 3) of
        // widget.ts.
        const locations = referencesProvider.onReferenceRequest({
            position: { line: 3, character: 8 },
            textDocument: {
                uri: fixtureUri("events-project", "client/widget.ts"),
            },
        });

        assert.ok(Array.isArray(locations), "Expected reference locations");
        assert.strictEqual(locations.length, 2);
        assert.ok(
            locations.some(({ uri }) => uri.endsWith("widget-extra.ts"))
        );
    });
});
