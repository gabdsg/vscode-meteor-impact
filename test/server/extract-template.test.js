const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    CodeActionsProvider,
} = require("../../server/src/code-actions-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

// Offset-based multi-line edit applier.
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

const count = (str, sub) => str.split(sub).length - 1;

const createProvider = (indexer, serverMock = serverInstanceMock) =>
    new CodeActionsProvider(
        serverMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    );

describe("CodeActionsProvider - extract template refactor", () => {
    describe("code action", () => {
        let provider;

        before(async () => {
            const { indexer } = await loadFixtureIndexer("basic-project");
            provider = createProvider(indexer);
        });

        const requestActions = (range) =>
            provider.onCodeActionRequest({
                textDocument: {
                    uri: fixtureUri("basic-project", "client/foo.html"),
                },
                range,
                context: { diagnostics: [] },
            });

        it("offers a command carrying the range and a suggested name", () => {
            const action = requestActions({
                start: { line: 2, character: 8 },
                end: { line: 3, character: 39 },
            }).find(({ kind }) => kind === "refactor.extract");

            assert.ok(action, "Expected an extract action");
            assert.strictEqual(
                action.command.command,
                "meteorImpact.extractTemplate"
            );

            const [args] = action.command.arguments;
            assert.ok(args.uri.endsWith("foo.html"));
            assert.strictEqual(args.suggestedName, "extractedTemplate");
            assert.deepStrictEqual(args.range.start, {
                line: 2,
                character: 8,
            });
        });

        it("offers nothing for empty or whitespace selections", () => {
            [
                {
                    start: { line: 2, character: 8 },
                    end: { line: 2, character: 8 },
                },
                {
                    start: { line: 2, character: 0 },
                    end: { line: 2, character: 8 },
                },
            ].forEach((range) => {
                assert.ok(
                    !requestActions(range).some(
                        ({ kind }) => kind === "refactor.extract"
                    )
                );
            });
        });

        it("offers nothing when the selection crosses template boundaries", async () => {
            const { indexer } = await loadFixtureIndexer(
                "multi-template-project"
            );

            const actions = createProvider(indexer).onCodeActionRequest({
                textDocument: {
                    uri: fixtureUri(
                        "multi-template-project",
                        "client/multi.html"
                    ),
                },
                range: {
                    start: { line: 1, character: 4 },
                    end: { line: 5, character: 10 },
                },
                context: { diagnostics: [] },
            });

            assert.ok(
                !actions.some(({ kind }) => kind === "refactor.extract")
            );
        });
    });

    describe("edit building", () => {
        let indexer;
        let provider;
        let rootPath;
        let changes;

        const editsFor = (fileName) => {
            const key = Object.keys(changes).find((uri) =>
                uri.endsWith(fileName)
            );
            assert.ok(key, `Expected edits for ${fileName}`);
            return changes[key];
        };

        const applyTo = (relativePath) =>
            applyEdits(
                fs.readFileSync(path.join(rootPath, relativePath), "utf-8"),
                editsFor(relativePath.split("/").pop())
            );

        before(async () => {
            ({ indexer, rootPath } = await loadFixtureIndexer(
                "extract-project"
            ));
            provider = createProvider(indexer);

            // The <div class="js-box">...</div> block (lines 2-6).
            changes = provider.buildExtractTemplateEdit({
                uri: fixtureUri("extract-project", "client/panel.html"),
                range: {
                    start: { line: 2, character: 4 },
                    end: { line: 6, character: 10 },
                },
                templateName: "detailsPanel",
            });
        });

        it("replaces the selection and appends the named template", () => {
            const updated = applyTo("client/panel.html");

            assert.ok(updated.includes("{{> detailsPanel}}"));
            assert.ok(updated.includes('<template name="detailsPanel">'));
            // Dedented one level inside the new template.
            assert.ok(updated.includes('    <div class="js-box">'));
            // Moved, not duplicated: the div lives only in the new template.
            assert.strictEqual(count(updated, "js-box"), 1);
            assert.ok(
                updated.indexOf("js-box") >
                    updated.indexOf('<template name="detailsPanel">')
            );
        });

        it("moves helpers used only by the selection", () => {
            const updated = applyTo("client/panel.ts");

            // boxLabel now lives only on the new template.
            assert.strictEqual(count(updated, "boxLabel"), 1);
            assert.ok(
                updated.includes("Template.detailsPanel.helpers({"),
                "Expected a helpers block for the new template"
            );
            assert.ok(
                updated.indexOf("boxLabel") >
                    updated.indexOf("Template.detailsPanel.helpers")
            );
        });

        it("copies helpers still used by the parent template", () => {
            const updated = applyTo("client/panel.ts");

            // summary is used in the selection AND in the footer.
            assert.strictEqual(count(updated, "summary"), 2);
            // title is untouched.
            assert.strictEqual(count(updated, "title"), 1);
        });

        it("moves events whose targets are only in the selection", () => {
            const updated = applyTo("client/panel.ts");

            assert.strictEqual(count(updated, '"click .js-save"'), 1);
            assert.ok(updated.includes("Template.detailsPanel.events({"));
            assert.ok(
                updated.indexOf('"click .js-save"') >
                    updated.indexOf("Template.detailsPanel.events")
            );
        });

        it("passes outer block variables as partial arguments", async () => {
            const { indexer: blockVarsIndexer, rootPath: blockVarsRoot } =
                await loadFixtureIndexer("block-vars-project");
            const blockVarsProvider = createProvider(blockVarsIndexer);

            const listLines = fs
                .readFileSync(
                    path.join(blockVarsRoot, "client/list.html"),
                    "utf-8"
                )
                .split("\n");

            const blockVarsChanges =
                blockVarsProvider.buildExtractTemplateEdit({
                    uri: fixtureUri("block-vars-project", "client/list.html"),
                    range: {
                        start: { line: 2, character: 8 },
                        end: { line: 2, character: listLines[2].length },
                    },
                    templateName: "personRow",
                });

            const key = Object.keys(blockVarsChanges).find((uri) =>
                uri.endsWith("list.html")
            );
            const updated = applyEdits(
                listLines.join("\n"),
                blockVarsChanges[key]
            );

            assert.ok(
                updated.includes("{{> personRow person=person}}"),
                "Expected the each-in binding to travel via data context"
            );
        });
    });

    describe("execution", () => {
        it("applies the edit through the connection", async () => {
            const { indexer } = await loadFixtureIndexer("extract-project");

            const applied = [];
            const provider = createProvider(indexer, {
                workspace: { applyEdit: async (params) => applied.push(params) },
                window: { showErrorMessage: () => {} },
            });

            const result = await provider.executeExtractTemplate({
                uri: fixtureUri("extract-project", "client/panel.html"),
                range: {
                    start: { line: 2, character: 4 },
                    end: { line: 6, character: 10 },
                },
                templateName: "detailsPanel",
            });

            assert.strictEqual(result.applied, true);
            assert.strictEqual(applied.length, 1);
            assert.ok(Object.keys(applied[0].changes).length >= 2);
        });

        it("rejects names that already exist", async () => {
            const { indexer } = await loadFixtureIndexer("extract-project");

            const errors = [];
            const provider = createProvider(indexer, {
                workspace: { applyEdit: async () => {} },
                window: { showErrorMessage: (m) => errors.push(m) },
            });

            const result = await provider.executeExtractTemplate({
                uri: fixtureUri("extract-project", "client/panel.html"),
                range: {
                    start: { line: 2, character: 4 },
                    end: { line: 6, character: 10 },
                },
                templateName: "panel",
            });

            assert.strictEqual(result.applied, false);
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0].includes("already exists"));
        });
    });
});
