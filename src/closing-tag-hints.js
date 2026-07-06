/**
 * Pure hint computation for closing-tag decorations, vscode-free so it is
 * testable: at the closer of a long {{#block}} (and at its {{else}}) show
 * the opening condition; at the closing tag of a long HTML element show
 * its id/classes.
 */

const MIN_SPANNED_LINES = 4;

const countLines = (text, start, end) => {
    let count = 0;
    for (let i = start; i < end; i++) if (text[i] === "\n") count++;
    return count;
};

const lineHasTrailingContent = (text, offset) => {
    const lineEnd = text.indexOf("\n", offset);
    return /\S/.test(
        text.slice(offset, lineEnd === -1 ? undefined : lineEnd)
    );
};

/**
 * {{/block}} and {{else}} hints. Works on comment-blanked content, so
 * commented-out blocks don't produce hints.
 */
const blockHints = (blanked, minLines) => {
    const { getBlockRanges } = require("../server/src/text-utils");

    const eligible = getBlockRanges(blanked)
        .filter(
            ({ startOffset, endOffset }) =>
                countLines(blanked, startOffset, endOffset) >= minLines
        )
        .map((range) => {
            const opener = blanked
                .slice(range.startOffset)
                .match(/^\{\{\s*#\s*([\w$-]+)([^{}]*)\}\}/);
            return (
                opener && {
                    ...range,
                    condition: `${opener[1]}${opener[2]}`
                        .replace(/\s+/g, " ")
                        .trim(),
                }
            );
        })
        .filter(Boolean);

    const hints = eligible
        .filter(({ endOffset }) => !lineHasTrailingContent(blanked, endOffset))
        .map(({ endOffset, condition }) => ({
            offset: endOffset,
            text: condition,
        }));

    // {{else}} / {{else if ...}}: attributed to the innermost block.
    for (const match of blanked.matchAll(/\{\{\s*else\b[^{}]*\}\}/g)) {
        const end = match.index + match[0].length;
        const enclosing = eligible
            .filter(
                ({ startOffset, endOffset }) =>
                    startOffset < match.index && end <= endOffset
            )
            .sort((a, b) => b.startOffset - a.startOffset)[0];

        if (!enclosing || lineHasTrailingContent(blanked, end)) continue;
        hints.push({ offset: end, text: enclosing.condition });
    }

    return hints;
};

/** Closing-tag hints (#id.class) for elements spanning many lines. */
const elementHints = (content, minLines) => {
    const { getHtmlNodes } = require("../server/src/html-language-service");

    // Attribute values come quoted; mustaches only add conditional
    // classes, so they are dropped ({{#if x}}cls{{/if}} included).
    const clean = (value) =>
        (value || "")
            .replace(/^["']|["']$/g, "")
            .replace(/\{\{#[\s\S]*?\{\{\/[^{}]*\}\}/g, " ")
            .replace(/\{\{[^{}]*\}\}/g, " ");

    const hints = [];
    const visit = (node) => {
        (node.children || []).forEach(visit);

        if (node.endTagStart == null) return;
        if (countLines(content, node.start, node.end) < minLines) return;

        const id = clean(node.attributes?.id).trim().split(/\s+/)[0];
        const classes = clean(node.attributes?.class)
            .split(/\s+/)
            .filter(Boolean)
            .map((name) => `.${name}`)
            .join("");
        const text = `${id ? `#${id}` : ""}${classes}`;

        if (!text || lineHasTrailingContent(content, node.end)) return;
        hints.push({ offset: node.end, text });
    };

    getHtmlNodes("untitled:closing-tag-hints", content).forEach(visit);
    return hints;
};

const computeClosingTagHints = (
    content,
    { minLines = MIN_SPANNED_LINES, blocks = true, htmlElements = true } = {}
) => {
    const { blankHtmlComments } = require("../server/src/text-utils");

    return [
        ...(blocks ? blockHints(blankHtmlComments(content), minLines) : []),
        ...(htmlElements ? elementHints(content, minLines) : []),
    ].sort((a, b) => a.offset - b.offset);
};

module.exports = { computeClosingTagHints };
