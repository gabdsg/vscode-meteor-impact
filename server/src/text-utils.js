/**
 * Text-based utilities for Spacebars HTML files. They work on the raw file
 * content, so they behave correctly even while the file is being typed and
 * is not parseable.
 */

const TEMPLATE_TAG_REGEX = /<template\s+name=["']([^"']+)["'][^>]*>|<\/template>/g;

// LSP position (0-based line/character) -> offset in content.
const positionToOffset = (content, { line, character }) => {
    const lines = content.split("\n");

    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }

    return offset + character;
};

// Offset in content -> AST-style location (1-based line, 0-based column).
const offsetToLoc = (content, offset) => {
    const consumedLines = content.slice(0, offset).split("\n");

    return {
        line: consumedLines.length,
        column: consumedLines[consumedLines.length - 1].length,
    };
};

/**
 * All the <template name="..."> and </template> tags of the file, in order,
 * as { name, isClosing, start, end } entries (offsets).
 */
const getTemplateTags = (content) => {
    return [...content.matchAll(TEMPLATE_TAG_REGEX)].map((match) => ({
        name: match[1],
        isClosing: !match[1],
        start: match.index,
        end: match.index + match[0].length,
    }));
};

/**
 * Name of the <template> tag wrapping the given offset, if any. Blaze
 * templates can't be nested, so the last unclosed opening tag wins.
 */
const getWrappingTemplateName = (content, offset) => {
    let current;
    for (const tag of getTemplateTags(content)) {
        if (tag.start >= offset) break;

        current = tag.isClosing ? undefined : tag.name;
    }

    return current;
};

module.exports = {
    positionToOffset,
    offsetToLoc,
    getTemplateTags,
    getWrappingTemplateName,
};
