const assert = require("assert");

const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    loadFixtureIndexer,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

describe("DiagnosticsProvider", () => {
    let diagnosticsByUri;

    const diagnosticsFor = (fileName) => {
        const key = [...diagnosticsByUri.keys()].find((uri) =>
            uri.endsWith(fileName)
        );
        return (key && diagnosticsByUri.get(key)) || [];
    };

    before(async () => {
        const { indexer } = await loadFixtureIndexer("diagnostics-project");
        const provider = new DiagnosticsProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );
        diagnosticsByUri = provider.computeDiagnostics();
    });

    it("flags unresolved partial statements", () => {
        const diagnostics = diagnosticsFor("diag.html");
        const partialDiagnostic = diagnostics.find(({ message }) =>
            message.includes("missingTemplate")
        );

        assert.ok(partialDiagnostic, "Expected a missingTemplate diagnostic");
        assert.strictEqual(partialDiagnostic.range.start.line, 3);
    });

    it("flags mustaches with arguments that match no helper", () => {
        const diagnostics = diagnosticsFor("diag.html");
        const helperDiagnostic = diagnostics.find(({ message }) =>
            message.includes('"badHelper"')
        );

        assert.ok(helperDiagnostic, "Expected a badHelper diagnostic");
        assert.ok(helperDiagnostic.message.includes("diagT"));
        assert.strictEqual(helperDiagnostic.range.start.line, 2);
    });

    it("does not flag resolvable helpers", () => {
        const diagnostics = diagnosticsFor("diag.html");

        assert.ok(
            !diagnostics.some(({ message }) =>
                message.includes("usedHelper")
            ),
            "usedHelper is defined and should not be flagged"
        );
    });

    it("flags duplicate template names on every occurrence", () => {
        const duplicated = diagnosticsFor("diag.html").filter(({ message }) =>
            message.includes('"dup"')
        );

        assert.strictEqual(duplicated.length, 2);
        assert.deepStrictEqual(
            duplicated.map(({ range }) => range.start.line),
            [11, 15]
        );
    });

    it("does not flag helpers used only as call arguments", () => {
        const diagnostics = diagnosticsFor("diag.ts");

        for (const name of [
            "argOnlyHelper", // block-statement argument
            "anotherArgHelper",
            "subExprHelper", // sub-expression argument
            "hashArgHelper", // hash value
            "or", // the sub-expression helper itself
        ]) {
            assert.ok(
                !diagnostics.some(({ message }) =>
                    message.includes(`"${name}"`)
                ),
                `${name} is used in the template and should not be flagged`
            );
        }
    });

    it("flags unused helpers in the defining file", () => {
        const diagnostics = diagnosticsFor("diag.ts");

        assert.strictEqual(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.includes("unusedHelper"));
        assert.strictEqual(diagnostics[0].severity, 4); // Hint
        assert.deepStrictEqual(diagnostics[0].tags, [1]); // Unnecessary
    });

    it("publishes diagnostics and clears stale ones", async () => {
        const { indexer } = await loadFixtureIndexer("diagnostics-project");

        const sent = [];
        const provider = new DiagnosticsProvider(
            { sendDiagnostics: (params) => sent.push(params) },
            documentsInstanceMock,
            `file://${__dirname}`,
            indexer
        );

        provider.publish();
        const publishedUris = sent.map(({ uri }) => uri).sort();
        assert.strictEqual(publishedUris.length, 2);

        // Simulate all problems being fixed: next publish clears the files.
        sent.length = 0;
        provider.computeDiagnostics = () => new Map();
        provider.publish();

        assert.deepStrictEqual(
            sent.map(({ uri }) => uri).sort(),
            publishedUris
        );
        assert.ok(sent.every(({ diagnostics }) => !diagnostics.length));
    });
});
