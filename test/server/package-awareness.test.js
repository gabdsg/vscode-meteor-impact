const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const { CompletionProvider } = require("../../server/src/completion-provider");
const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("Package awareness", () => {
    let indexer;

    const createProvider = (Provider) =>
        new Provider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("package-aware-project"));
    });

    it("indexes templates and global helpers from built packages", () => {
        const { templates, globalHelpers } = indexer.packagesIndexer;

        assert.ok(templates["loginButtons"]);
        assert.strictEqual(templates["loginButtons"].packageName, "accounts-ui");
        // Underscored bundle names map back to scoped package names.
        assert.strictEqual(
            templates["bootstrapAlert"].packageName,
            "mizzao:bootstrap"
        );
        assert.ok(globalHelpers["currentUserFormatted"]);
    });

    it("does not index the build output as app sources", () => {
        const sourcePaths = Object.keys(indexer.getSources());
        assert.ok(
            sourcePaths.every((p) => !p.includes(".meteor")),
            "Expected .meteor build files to be excluded from app sources"
        );
    });

    it("does not flag package templates or global helpers", () => {
        const diagnosticsByUri = createProvider(
            DiagnosticsProvider
        ).computeDiagnostics();
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith("app.html")
        );
        const messages = (key ? diagnosticsByUri.get(key) : []).map(
            ({ message }) => message
        );

        assert.ok(!messages.some((m) => m.includes("loginButtons")));
        assert.ok(!messages.some((m) => m.includes("currentUserFormatted")));
        // Genuinely unknown partials are still flagged.
        assert.ok(messages.some((m) => m.includes("stillMissing")));
    });

    it("resolves definition of a package template into the bundle", () => {
        // Position on "loginButtons" inside {{> loginButtons}}.
        const location = createProvider(DefinitionProvider).onDefinitionRequest(
            {
                position: { line: 1, character: 15 },
                textDocument: {
                    uri: fixtureUri("package-aware-project", "client/app.html"),
                },
            }
        );

        assert.ok(location, "Expected a definition location");
        assert.ok(location.uri.endsWith("accounts-ui.js"));
    });

    it("offers package templates in partial completion", () => {
        // After {{> on the stillMissing line.
        const items = createProvider(CompletionProvider).onCompletionRequest({
            position: { line: 3, character: 8 },
            textDocument: {
                uri: fixtureUri("package-aware-project", "client/app.html"),
            },
        });

        const loginItem = (items.items || items).find(
            ({ label }) => label === "loginButtons"
        );
        assert.ok(loginItem, "Expected the package template");
        assert.ok(loginItem.detail.includes("accounts-ui"));
    });
});
