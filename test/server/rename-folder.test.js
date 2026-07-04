const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { RenameProvider } = require("../../server/src/rename-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    documentsInstanceMock,
} = require("./test-utils");

const applyEdits = (content, edits) => {
    const lines = content.split("\n");
    const toOffset = ({ line, character }) => {
        let offset = 0;
        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset + character;
    };

    return [...edits]
        .sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
        .reduce(
            (acc, { range, newText }) =>
                acc.slice(0, toOffset(range.start)) +
                newText +
                acc.slice(toOffset(range.end)),
            content
        );
};

describe("RenameProvider - template folder rename", () => {
    let indexer;
    let rootPath;

    const createProvider = (serverMock) =>
        new RenameProvider(
            serverMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer(
            "rename-folder-project"
        ));
    });

    it("applies symbol and import edits for the folder rename", async () => {
        const applied = [];
        const provider = createProvider({
            workspace: { applyEdit: async (params) => applied.push(params) },
            window: { showErrorMessage: () => {} },
        });

        const result = await provider.executeTemplateFolderRename({
            folderUri: fixtureUri("rename-folder-project", "client/widgetA"),
            oldName: "widgetA",
            newName: "widgetB",
        });

        assert.strictEqual(result.applied, true);
        const { changes } = applied[0];

        const editsFor = (fileName) => {
            const key = Object.keys(changes).find((uri) =>
                uri.endsWith(fileName)
            );
            assert.ok(key, `Expected edits for ${fileName}`);
            return changes[key];
        };

        // Partial usage in home.html.
        const newHome = applyEdits(
            fs.readFileSync(
                path.join(rootPath, "client/home.html"),
                "utf-8"
            ),
            editsFor("home.html")
        );
        assert.ok(newHome.includes("{{> widgetB}}"));

        // Template tag attribute.
        const newHtml = applyEdits(
            fs.readFileSync(
                path.join(rootPath, "client/widgetA/widgetA.html"),
                "utf-8"
            ),
            editsFor("widgetA.html")
        );
        assert.ok(newHtml.includes('<template name="widgetB">'));

        // Template.X reference AND import specifiers in the code-behind.
        const newTs = applyEdits(
            fs.readFileSync(
                path.join(rootPath, "client/widgetA/widgetA.ts"),
                "utf-8"
            ),
            editsFor("widgetA.ts")
        );
        assert.ok(newTs.includes("Template.widgetB.helpers({"));
        assert.ok(newTs.includes('import "./widgetB.html";'));
        assert.ok(newTs.includes('import "./widgetB.less";'));
        assert.ok(!newTs.includes("widgetA"));
    });

    it("rejects non-identifier names when Template.X references exist", async () => {
        const errors = [];
        const provider = createProvider({
            workspace: { applyEdit: async () => {} },
            window: { showErrorMessage: (message) => errors.push(message) },
        });

        const result = await provider.executeTemplateFolderRename({
            folderUri: fixtureUri("rename-folder-project", "client/widgetA"),
            oldName: "widgetA",
            newName: "widget-b",
        });

        assert.strictEqual(result.applied, false);
        assert.ok(errors[0].includes("identifier"));
    });

    it("rejects names that already exist", async () => {
        const errors = [];
        const provider = createProvider({
            workspace: { applyEdit: async () => {} },
            window: { showErrorMessage: (message) => errors.push(message) },
        });

        const result = await provider.executeTemplateFolderRename({
            folderUri: fixtureUri("rename-folder-project", "client/widgetA"),
            oldName: "widgetA",
            newName: "home",
        });

        assert.strictEqual(result.applied, false);
        assert.ok(errors[0].includes("already exists"));
    });
});
