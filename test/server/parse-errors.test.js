const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    loadFixtureIndexer,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const computeDiagnostics = (indexer) =>
    new DiagnosticsProvider(
        serverInstanceMock,
        documentsInstanceMock,
        `file://${__dirname}`,
        indexer
    ).computeDiagnostics();

describe("Parse errors as diagnostics", () => {
    it("reports unparseable files as error diagnostics, not notifications", async () => {
        const { indexer, result } = await loadFixtureIndexer(
            "parse-error-project"
        );

        // The load still reports the error internally...
        assert.strictEqual(result.hasErrors, true);
        assert.ok(indexer.parsingErrors.size >= 1);

        // ...and it surfaces as a positioned Error diagnostic.
        const diagnosticsByUri = computeDiagnostics(indexer);
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith("bad.html")
        );
        assert.ok(key, "Expected diagnostics for bad.html");

        const [diagnostic] = diagnosticsByUri.get(key);
        assert.strictEqual(diagnostic.severity, 1); // Error
        assert.ok(diagnostic.message.startsWith("Parse error:"));
        assert.ok(diagnostic.range.start.line >= 0);

        // The healthy file indexed normally.
        assert.ok(indexer.blazeIndexer.templateIndexMap["fine"]);
    });

    it("sets and clears the error across incremental reindexes", async () => {
        const { indexer, rootPath } = await loadFixtureIndexer(
            "basic-project"
        );

        const fooHtmlPath = path.join(rootPath, "client/foo.html");
        const originalContent = fs.readFileSync(fooHtmlPath, "utf-8");
        const overrides = new Map();
        indexer.documentsInstance = {
            get: (uri) =>
                overrides.has(uri.fsPath)
                    ? { getText: () => overrides.get(uri.fsPath) }
                    : undefined,
        };

        // Break the file: parse fails, error recorded.
        overrides.set(
            fooHtmlPath,
            '<template name="foo">{{#each broken}}</template>'
        );
        assert.strictEqual(
            indexer.reindexFile(`file://${fooHtmlPath}`),
            false
        );
        assert.ok(indexer.parsingErrors.has(fooHtmlPath));

        const diagnosticsByUri = computeDiagnostics(indexer);
        assert.ok(
            [...diagnosticsByUri.keys()].some((uri) =>
                uri.endsWith("foo.html")
            )
        );

        // Fix it: the error clears.
        overrides.set(fooHtmlPath, originalContent);
        assert.strictEqual(indexer.reindexFile(`file://${fooHtmlPath}`), true);
        assert.ok(!indexer.parsingErrors.has(fooHtmlPath));
    });
});
