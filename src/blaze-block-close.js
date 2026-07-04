/**
 * Decision logic for Blaze block auto-closing, kept vscode-free so it is
 * testable: given a document change, should a {{/block}} be inserted,
 * and how?
 */

const BLOCK_OPEN_AT_END_REGEX = /\{\{#([\w-]+)(?:\s+[^{}]*)?\}\}\s*$/;

const isBlockBalanced = (content, blockName) => {
    const opens = (
        content.match(new RegExp(`\\{\\{#${blockName}\\b`, "g")) || []
    ).length;
    const closes = (
        content.match(new RegExp(`\\{\\{\\/${blockName}\\}\\}`, "g")) || []
    ).length;

    return closes >= opens;
};

/**
 * Returns undefined when nothing should happen, or:
 *   { blockName, mode: "inline" }  - insert {{/block}} at the cursor
 *   { blockName, mode: "newline", indent } - insert it on the next line
 */
const resolveBlockAutoClose = (content, rangeOffset, changeText) => {
    const typedBrace =
        changeText.length <= 2 && changeText.endsWith("}");
    const pressedEnter = /^\r?\n[ \t]*$/.test(changeText);
    if (!typedBrace && !pressedEnter) return;

    // For Enter, look at the text before the newline; for "}", at the
    // text through the typed brace.
    const anchorOffset = typedBrace
        ? rangeOffset + changeText.length
        : rangeOffset;

    const match = content
        .slice(0, anchorOffset)
        .match(BLOCK_OPEN_AT_END_REGEX);
    if (!match) return;

    const blockName = match[1];
    if (isBlockBalanced(content, blockName)) return;

    if (typedBrace) return { blockName, mode: "inline" };

    const lineStart = content.lastIndexOf("\n", rangeOffset - 1) + 1;
    const indent = content
        .slice(lineStart, rangeOffset)
        .match(/^[ \t]*/)[0];

    return { blockName, mode: "newline", indent };
};

module.exports = { resolveBlockAutoClose };
