const assert = require("assert");

const { CompletionProvider } = require("../../server/src/completion-provider");
const { DefinitionProvider } = require("../../server/src/definition-provider");
const { HoverProvider } = require("../../server/src/hover-provider");
const {
    DiagnosticsProvider,
} = require("../../server/src/diagnostics-provider");
const {
    getMongoFieldContext,
} = require("../../server/src/mongo-field-context");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
    overrideContent,
} = require("./test-utils");

const QUERIES_FILE = "imports/queries.js";

describe("MongoSchema field IntelliSense", () => {
    let indexer;
    let rootPath;

    const queriesContent = () =>
        Object.values(indexer.getSources()).find(({ uri }) =>
            uri.fsPath.endsWith("queries.js")
        ).fileContent;

    const positionOf = (fileContent, text, offsetInText = 1) => {
        const offset = fileContent.indexOf(text);
        assert.ok(offset !== -1, `"${text}" not found in fixture`);

        const before = fileContent.slice(0, offset);
        return {
            line: before.split("\n").length - 1,
            character:
                offset - (before.lastIndexOf("\n") + 1) + offsetInText,
        };
    };

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer("mongo-schema-app", {
            mongoSchemaPath: "mongo-schema",
        }));
    });

    describe("indexer", () => {
        it("flattens schemas into dotted field paths", () => {
            const schema = indexer.mongoSchemaIndexer.schemasMap["students"];
            assert.ok(schema);

            assert.deepStrictEqual(schema.fieldsMap["firstName"].bsonTypes, [
                "string",
                "null",
            ]);
            assert.strictEqual(schema.fieldsMap["firstName"].required, true);
            assert.ok(schema.fieldsMap["firstName"].line > 1);
            assert.ok(schema.fieldsMap["contacts.relationship"]);
            assert.strictEqual(schema.fieldsMap["meta"].openObject, true);
            assert.ok(schema.fieldsMap["_id"]);
            assert.ok(
                schema.additionalPropertiesFalseAt.includes("contacts")
            );
        });

        it("maps collection variables through the name string", () => {
            const { collectionVarsMap } = indexer.mongoSchemaIndexer;

            assert.strictEqual(
                collectionVarsMap["Students"].collectionName,
                "students"
            );
            assert.strictEqual(
                collectionVarsMap["Aliased"].collectionName,
                "messageStyles"
            );
            assert.strictEqual(collectionVarsMap["ClientOnly"], undefined);
        });

        it("normalizes positional and numeric path segments", () => {
            const { MongoSchemaIndexer } = require("../../server/src/mongo-schema-indexer");

            for (const raw of [
                "contacts.0.number",
                "contacts.$.number",
                "contacts.$[].number",
                "contacts.$[elem].number",
            ]) {
                assert.strictEqual(
                    MongoSchemaIndexer.normalizePath(raw),
                    "contacts.number",
                    raw
                );
            }
        });
    });

    describe("field context scanner", () => {
        it("classifies selectors, modifiers and projections", () => {
            const selector = "Students.find({ firstName: 1, nested: { ";
            assert.deepStrictEqual(
                getMongoFieldContext(selector, selector.length),
                {
                    collectionVarName: "Students",
                    method: "find",
                    openString: undefined,
                    argContext: "selector",
                    pathPrefix: "nested",
                }
            );

            const modifier =
                'Students.updateAsync({ _id: id }, { $set: { "contacts.';
            const modifierContext = getMongoFieldContext(
                modifier,
                modifier.length
            );
            assert.strictEqual(modifierContext.argContext, "modifier");
            assert.strictEqual(modifierContext.modifierOperator, "$set");
            assert.ok(modifierContext.openString);

            const projection = "Students.find({}, { fields: { ";
            assert.strictEqual(
                getMongoFieldContext(projection, projection.length)
                    .argContext,
                "projection"
            );

            const closed = "Students.find({ a: 1 }); other(";
            assert.strictEqual(
                getMongoFieldContext(closed, closed.length),
                undefined
            );
        });
    });

    describe("completion", () => {
        const completionsAt = (suffix) => {
            const provider = new CompletionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const content = `${queriesContent()}\n${suffix}`;
            const lines = content.split("\n");
            const queriesFsPath = Object.keys(indexer.getSources()).find(
                (fsPath) => fsPath.endsWith("queries.js")
            );
            overrideContent(indexer, new Map([[queriesFsPath, content]]));
            provider.documentsInstance = indexer.documentsInstance;

            const items = provider.onCompletionRequest({
                textDocument: {
                    uri: fixtureUri("mongo-schema-app", QUERIES_FILE),
                },
                position: {
                    line: lines.length - 1,
                    character: lines[lines.length - 1].length,
                },
            });

            overrideContent(indexer, new Map());
            return items;
        };

        it("offers schema fields in a selector", () => {
            const items = completionsAt("Students.find({ ");
            assert.ok(Array.isArray(items));

            const labels = items.map(({ label }) => label);
            assert.ok(labels.includes("firstName"));
            assert.ok(labels.includes("contacts"));
            // Bare keys don't get dotted paths.
            assert.ok(!labels.includes("contacts.relationship"));

            const firstName = items.find(
                ({ label }) => label === "firstName"
            );
            assert.ok(firstName.detail.includes("string | null"));
            assert.ok(firstName.detail.includes("students"));
        });

        it("offers dotted paths inside quoted keys", () => {
            const items = completionsAt('Students.find({ "');
            const labels = items.map(({ label }) => label);
            assert.ok(labels.includes("contacts.relationship"));
        });

        it("offers child segments under a nested prefix", () => {
            const items = completionsAt(
                "Students.find({ contacts: { $elemMatch: { "
            );
            const labels = items.map(({ label }) => label);
            assert.ok(labels.includes("relationship"));
            assert.ok(labels.includes("number"));
            assert.ok(!labels.includes("firstName"));
        });

        it("offers nothing for unresolvable collections", () => {
            const items = completionsAt("Unknown.find({ ");
            assert.ok(!items || !items.length);
        });
    });

    describe("hover", () => {
        it("shows type and schema location for a field key", () => {
            const provider = new HoverProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const hover = provider.onHoverRequest({
                textDocument: {
                    uri: fixtureUri("mongo-schema-app", QUERIES_FILE),
                },
                position: positionOf(
                    queriesContent(),
                    '"contacts.relationship"',
                    2
                ),
            });

            assert.ok(hover);
            const markdown = hover.contents.value;
            assert.ok(markdown.includes("contacts.relationship"));
            assert.ok(markdown.includes("students"));
            assert.ok(markdown.includes("type: string"));
            assert.ok(markdown.includes("students.schema.json"));
        });
    });

    describe("definition", () => {
        it("jumps from a field key to the schema file", () => {
            const provider = new DefinitionProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            );

            const location = provider.onDefinitionRequest({
                textDocument: {
                    uri: fixtureUri("mongo-schema-app", QUERIES_FILE),
                },
                position: positionOf(queriesContent(), "firstName: \"Ana\""),
            });

            assert.ok(location);
            assert.ok(location.uri.endsWith("students.schema.json"));
            const schemaContent = require("fs").readFileSync(
                `${rootPath}/mongo-schema/schemas/students/students.schema.json`,
                "utf-8"
            );
            const expectedLine = schemaContent
                .split("\n")
                .findIndex((line) => line.includes('"firstName": {'));
            assert.strictEqual(location.range.start.line, expectedLine);
        });
    });

    describe("diagnostics", () => {
        let diagnostics;

        before(() => {
            const byUri = new DiagnosticsProvider(
                serverInstanceMock,
                documentsInstanceMock,
                `file://${rootPath}`,
                indexer
            ).computeDiagnostics();
            diagnostics = [...byUri.values()]
                .flat()
                .filter(({ data }) => data?.kind === "unknown-collection-field");
        });

        const about = (fieldPath) =>
            diagnostics.find(({ data }) => data.fieldPath === fieldPath);

        it("flags unknown root fields as hints", () => {
            const diagnostic = about("typoField");
            assert.ok(diagnostic);
            // Hint severity = 4 (root object is open).
            assert.strictEqual(diagnostic.severity, 4);
            assert.ok(diagnostic.message.includes('"students"'));
        });

        it("flags unknown projection fields", () => {
            assert.ok(about("projTypo"));
        });

        it("flags typos under closed objects as warnings", () => {
            const diagnostic = about("contacts.0.relationshp");
            assert.ok(diagnostic);
            // Warning severity = 2 (contacts items are closed).
            assert.strictEqual(diagnostic.severity, 2);
        });

        it("stays quiet for known, positional, open and dynamic fields", () => {
            assert.strictEqual(diagnostics.length, 3, JSON.stringify(
                diagnostics.map(({ data }) => data.fieldPath)
            ));
        });
    });
});
