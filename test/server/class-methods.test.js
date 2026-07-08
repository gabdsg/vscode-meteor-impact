const assert = require("assert");

const { DefinitionProvider } = require("../../server/src/definition-provider");
const {
    loadFixtureIndexer,
    fixtureUri,
    serverInstanceMock,
    documentsInstanceMock,
} = require("./test-utils");

const FIXTURE = "class-methods-project";
const COMPOSE_FILE = "client/compose.js";

describe("Class method go-to-definition fallback", () => {
    let indexer;
    let rootPath;
    let provider;

    // 0-based LSP position of the nth occurrence of `text` in the file.
    const positionOf = (fileContent, text, occurrence = 0) => {
        let offset = -1;
        for (let i = 0; i <= occurrence; i++) {
            offset = fileContent.indexOf(text, offset + 1);
        }
        assert.ok(offset !== -1, `"${text}" not found in fixture`);

        const before = fileContent.slice(0, offset);
        const line = before.split("\n").length - 1;
        const character = offset - (before.lastIndexOf("\n") + 1);
        return { line, character: character + 1 };
    };

    const composeContent = () =>
        Object.values(indexer.getSources()).find(({ uri }) =>
            uri.fsPath.endsWith("compose.js")
        ).fileContent;

    const definitionAt = (text, occurrence = 0) =>
        provider.onDefinitionRequest({
            textDocument: { uri: fixtureUri(FIXTURE, COMPOSE_FILE) },
            position: positionOf(composeContent(), text, occurrence),
        });

    before(async () => {
        ({ indexer, rootPath } = await loadFixtureIndexer(FIXTURE));
        provider = new DefinitionProvider(
            serverInstanceMock,
            documentsInstanceMock,
            `file://${rootPath}`,
            indexer
        );
    });

    it("indexes class methods, function fields and getters by name", () => {
        const { methodsMap } = indexer.classMethodsIndexer;

        assert.strictEqual(methodsMap["canSendEmail"].length, 1);
        assert.strictEqual(
            methodsMap["canSendEmail"][0].className,
            "ComposeController"
        );
        assert.strictEqual(methodsMap["hasSelectedUsers"].length, 1);
        assert.strictEqual(methodsMap["selectedCount"].length, 1);
        assert.ok(
            !Object.prototype.hasOwnProperty.call(methodsMap, "constructor")
        );
    });

    it("resolves Template.instance().controller.canSendEmail()", () => {
        const locations = definitionAt("canSendEmail()");

        assert.ok(locations?.length, "expected a definition location");
        assert.ok(
            locations[0].uri.endsWith("lib/controllers/composeController.js")
        );
        // Points at the method name inside the class body.
        assert.strictEqual(locations[0].range.start.line, 5);
    });

    it("resolves function-valued class fields", () => {
        const locations = definitionAt("hasSelectedUsers()");

        assert.ok(locations?.length, "expected a definition location");
        assert.ok(
            locations[0].uri.endsWith("lib/controllers/composeController.js")
        );
        assert.strictEqual(locations[0].range.start.line, 9);
    });

    it("does not fire for plain identifiers that are not member accesses", () => {
        // `const canSendEmail = false;` - same name, but not obj.name.
        const location = definitionAt("canSendEmail", 2);

        assert.strictEqual(location, undefined);
    });
});
