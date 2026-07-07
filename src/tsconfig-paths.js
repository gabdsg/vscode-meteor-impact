/**
 * Merge Meteor package path mappings into an existing tsconfig.json
 * WITHOUT destroying it: tsconfig is a user-owned build config that can
 * contain comments and hand-picked options, so edits go through
 * jsonc-parser (comment- and formatting-preserving), and only
 * compilerOptions.paths keys starting with "meteor/" are ever touched.
 *
 * Pure module (no vscode import) so it can be unit-tested.
 */

const METEOR_PATH_PREFIX = "meteor/";

const detectIndentation = (content) =>
    /\n\t/.test(content)
        ? { insertSpaces: false, tabSize: 4 }
        : {
              insertSpaces: true,
              tabSize: /\n {2}[^ ]/.test(content) ? 2 : 4,
          };

/**
 * Returns the updated file content, or the original content when there is
 * nothing to change. Only "meteor/*" keys are written (they are
 * extension-generated); user keys like "@models/*" are never modified.
 */
const mergePathsIntoTsConfigContent = (content, paths) => {
    const { modify, applyEdits, parse } = require("jsonc-parser");

    const meteorEntries = Object.entries(paths || {}).filter(([key]) =>
        key.startsWith(METEOR_PATH_PREFIX)
    );
    if (!meteorEntries.length) return content;

    const existing = parse(content, [], { allowTrailingComma: true }) || {};
    const existingPaths = existing.compilerOptions?.paths || {};

    const formattingOptions = detectIndentation(content);

    let result = content;
    for (const [key, value] of meteorEntries) {
        if (
            JSON.stringify(existingPaths[key]) === JSON.stringify(value)
        ) {
            continue;
        }

        const edits = modify(
            result,
            ["compilerOptions", "paths", key],
            value,
            { formattingOptions }
        );
        result = applyEdits(result, edits);
    }

    return result;
};

module.exports = { mergePathsIntoTsConfigContent };
