const assert = require("assert");

const { loadFixtureIndexer } = require("./test-utils");

describe("BlazeIndexer - Template[\"kebab-name\"] member access", () => {
    let indexer;

    before(async () => {
        ({ indexer } = await loadFixtureIndexer("kebab-project"));
    });

    it("indexes helpers of templates accessed with a computed string literal", () => {
        const kebabTemplate =
            indexer.blazeIndexer.templateIndexMap["kebab-template"];

        assert.ok(kebabTemplate, "Expected kebab-template to be indexed");
        assert.ok(kebabTemplate.helpers?.["kebabHelper"]);
        assert.ok(
            kebabTemplate.helpers["kebabHelper"].uri.fsPath.endsWith(
                "kebab.ts"
            )
        );
    });

    it("indexes helpers declared with string literal keys", () => {
        const kebabTemplate =
            indexer.blazeIndexer.templateIndexMap["kebab-template"];

        assert.ok(kebabTemplate.helpers?.["quoted-helper"]);
    });
});
