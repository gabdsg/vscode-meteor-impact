const assert = require("assert");

const {
    mergePathsIntoTsConfigContent,
} = require("../../src/tsconfig-paths");

// Tab-indented, commented tsconfig with user-owned paths - the shape the
// merge must survive without clobbering anything.
const TSCONFIG = `{
	"compilerOptions": {
		"target": "ES2021",
		// TODO: module resolution = "Node" will be deprecated in TS 7.0
		"moduleResolution": "Node",
		"strict": true,
		"paths": {
			"@models/*": ["./lib/models/*"],
			"@lib/*": ["./lib/*"]
		},
		"types": ["node", "meteor", "jest"]
	},
	"include": ["client/**/*.ts", "server/**/*.ts"]
}
`;

const METEOR_PATHS = {
    "meteor/meteor": ["/home/u/.meteor/packages/meteor/1.0.0/meteor.js"],
    "meteor/quave:testing": ["packages/quave-testing/testing.js"],
};

describe("tsconfig-paths merge", () => {
    it("adds meteor/* paths while preserving comments, tabs and user paths", () => {
        const result = mergePathsIntoTsConfigContent(TSCONFIG, METEOR_PATHS);

        // Comments and user content survive untouched.
        assert.ok(result.includes("// TODO: module resolution"));
        assert.ok(result.includes('"@models/*": ["./lib/models/*"]'));
        assert.ok(result.includes('"types": ["node", "meteor", "jest"]'));
        // Tab indentation preserved (no 4-space runs introduced).
        assert.ok(!/\n {4}"meteor/.test(result));
        assert.ok(/\n\t\t\t"meteor\/meteor"/.test(result));

        // Meteor paths landed inside compilerOptions.paths.
        const parsed = require("jsonc-parser").parse(result);
        assert.deepStrictEqual(
            parsed.compilerOptions.paths["meteor/meteor"],
            METEOR_PATHS["meteor/meteor"]
        );
        assert.deepStrictEqual(
            parsed.compilerOptions.paths["meteor/quave:testing"],
            METEOR_PATHS["meteor/quave:testing"]
        );
        assert.deepStrictEqual(parsed.compilerOptions.paths["@lib/*"], [
            "./lib/*",
        ]);
    });

    it("is idempotent: a second merge changes nothing", () => {
        const once = mergePathsIntoTsConfigContent(TSCONFIG, METEOR_PATHS);
        const twice = mergePathsIntoTsConfigContent(once, METEOR_PATHS);

        assert.strictEqual(twice, once);
    });

    it("updates a stale meteor path but never user keys", () => {
        const once = mergePathsIntoTsConfigContent(TSCONFIG, METEOR_PATHS);
        const updated = mergePathsIntoTsConfigContent(once, {
            "meteor/meteor": ["/home/u/.meteor/packages/meteor/2.0.0/meteor.js"],
            "@models/*": ["./somewhere/else/*"],
        });

        const parsed = require("jsonc-parser").parse(updated);
        assert.deepStrictEqual(parsed.compilerOptions.paths["meteor/meteor"], [
            "/home/u/.meteor/packages/meteor/2.0.0/meteor.js",
        ]);
        // Non-meteor keys are ignored even when passed in.
        assert.deepStrictEqual(parsed.compilerOptions.paths["@models/*"], [
            "./lib/models/*",
        ]);
    });

    it("creates the paths object when compilerOptions has none", () => {
        const minimal = `{\n\t"compilerOptions": {\n\t\t"strict": true\n\t}\n}\n`;
        const result = mergePathsIntoTsConfigContent(minimal, METEOR_PATHS);

        const parsed = require("jsonc-parser").parse(result);
        assert.deepStrictEqual(
            parsed.compilerOptions.paths["meteor/meteor"],
            METEOR_PATHS["meteor/meteor"]
        );
        assert.strictEqual(parsed.compilerOptions.strict, true);
    });

    it("returns the content unchanged when there are no meteor paths", () => {
        assert.strictEqual(
            mergePathsIntoTsConfigContent(TSCONFIG, { "@x/*": ["./x/*"] }),
            TSCONFIG
        );
        assert.strictEqual(
            mergePathsIntoTsConfigContent(TSCONFIG, {}),
            TSCONFIG
        );
    });
});
