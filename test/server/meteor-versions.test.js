const assert = require("assert");

const {
    parseVersionsFile,
    parsePackagesFile,
} = require("../../src/meteor-versions");

describe("Meteor packages file parsing", () => {
    it("parses .meteor/versions into a name -> version map", () => {
        const versions = parseVersionsFile(
            [
                "accounts-base@2.2.8",
                "blaze-html-templates@2.0.0",
                "zodern:types@1.0.13",
                "",
                "not a version line",
            ].join("\n")
        );

        assert.deepStrictEqual(versions, {
            "accounts-base": "2.2.8",
            "blaze-html-templates": "2.0.0",
            "zodern:types": "1.0.13",
        });
    });

    it("parses .meteor/packages entries stripping comments and pins", () => {
        const packages = parsePackagesFile(
            [
                "# Meteor packages used by this project.",
                "",
                "meteor-base@1.5.1   # Packages every Meteor app needs",
                "blaze-html-templates",
                "  zodern:types  ",
                "#unused-package",
            ].join("\n")
        );

        assert.deepStrictEqual(packages, [
            "meteor-base",
            "blaze-html-templates",
            "zodern:types",
        ]);
    });

    it("tolerates empty content", () => {
        assert.deepStrictEqual(parseVersionsFile(""), {});
        assert.deepStrictEqual(parsePackagesFile(undefined), []);
    });
});
