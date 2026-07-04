const assert = require("assert");

const { loadFixtureIndexer } = require("./test-utils");

describe("BlazeIndexer - multiple templates per content chunk", () => {
    let indexer;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("multi-template-project"));
    });

    it("indexes every template of the same content chunk", () => {
        const { templateIndexMap } = indexer.blazeIndexer;

        // "first", "second" and the opening tag of "third" live in the same
        // ContentStatement (no mustache in between).
        assert.ok(templateIndexMap["first"]);
        assert.ok(templateIndexMap["second"]);
        assert.ok(templateIndexMap["third"]);
    });

    it("points each template to the precise tag location", () => {
        const { templateIndexMap } = indexer.blazeIndexer;

        assert.deepStrictEqual(templateIndexMap["first"].node.loc.start, {
            line: 1,
            column: 1,
        });
        assert.deepStrictEqual(templateIndexMap["second"].node.loc.start, {
            line: 5,
            column: 1,
        });
        assert.deepStrictEqual(templateIndexMap["third"].node.loc.start, {
            line: 9,
            column: 1,
        });
    });

    it("does not clobber helpers indexed before the HTML file", () => {
        // aaa-helpers.ts sorts before multi.html, so its helpers are indexed
        // first and must survive the template tag indexing.
        const secondTemplate = indexer.blazeIndexer.templateIndexMap["second"];

        assert.ok(secondTemplate.helpers?.["secondHelper"]);
        assert.ok(
            secondTemplate.helpers["secondHelper"].uri.fsPath.endsWith(
                "aaa-helpers.ts"
            )
        );
        // And the template tag location/uri should still be the HTML file.
        assert.ok(secondTemplate.uri.fsPath.endsWith("multi.html"));
    });
});
