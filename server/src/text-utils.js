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
 * as { name, isClosing, start, end, nameStart } entries (offsets).
 * nameStart is the offset of the name attribute value.
 */
const getTemplateTags = (content) => {
    return [...content.matchAll(TEMPLATE_TAG_REGEX)].map((match) => ({
        name: match[1],
        isClosing: !match[1],
        start: match.index,
        end: match.index + match[0].length,
        nameStart: match[1]
            ? match.index + match[0].indexOf("name=") + "name=".length + 1
            : undefined,
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

const BLOCK_TAG_REGEX = /\{\{#([\w$]+)[^{}]*?\}\}|\{\{\/([\w$]+)\s*\}\}/g;
const EACH_IN_REGEX = /^\{\{#each\s+([\w$]+)\s+in\s/;
const LET_BINDING_REGEX = /([\w$]+)\s*=/g;

/**
 * Variables bound by the {{#each x in ...}} and {{#let a=... b=...}}
 * blocks wrapping the given offset. Text-based, so it works while typing;
 * a block that is still unclosed scopes until the end of the file.
 */
const getBlockVariablesAtOffset = (content, offset) => {
    const stack = [];
    const variables = [];

    const bindingsOf = (tagText, blockName) => {
        if (blockName === "each") {
            const eachInMatch = tagText.match(EACH_IN_REGEX);
            return eachInMatch ? [eachInMatch[1]] : [];
        }

        if (blockName === "let") {
            return [...tagText.matchAll(LET_BINDING_REGEX)].map(
                ([, name]) => name
            );
        }

        return [];
    };

    for (const match of content.matchAll(BLOCK_TAG_REGEX)) {
        if (match.index >= offset) break;

        const openName = match[1];
        if (openName) {
            stack.push({
                name: openName,
                bindings: bindingsOf(match[0], openName),
            });
            continue;
        }

        // Closing tag: pop up to (and including) the matching open.
        const closeName = match[2];
        const openIndex = stack.map(({ name }) => name).lastIndexOf(closeName);
        if (openIndex !== -1) stack.splice(openIndex);
    }

    for (const { name, bindings } of stack) {
        for (const binding of bindings) {
            variables.push({ name: binding, blockName: name });
        }
    }

    return variables;
};

module.exports = {
    positionToOffset,
    offsetToLoc,
    getTemplateTags,
    getWrappingTemplateName,
    getBlockVariablesAtOffset,
};
