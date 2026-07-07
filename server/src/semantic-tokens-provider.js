const { ServerBase } = require("./helpers");

// Legend indexes must match the pushes below.
const TOKEN_TYPES = ["function", "class", "keyword", "variable"];
const TOKEN_TYPE_INDEX = {
    helper: 0,
    template: 1,
    keyword: 2,
    variable: 3,
};

const BUILTIN_BLOCKS = ["each", "if", "unless", "with", "let"];

/**
 * Semantic tokens for Spacebars files. Only symbols that RESOLVE get a
 * token (helpers, global helpers, templates, block keywords and block
 * variables) - unresolved/data-context paths keep the plain grammar
 * color, which makes resolution visible at a glance.
 */
class SemanticTokensProvider extends ServerBase {
    static legend = { tokenTypes: TOKEN_TYPES, tokenModifiers: [] };

    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onSemanticTokensRequest({ textDocument: { uri } }) {
        const empty = { data: [] };

        try {
            if (!this.isFileSpacebarsHTML(uri)) return empty;

            const content = this.getFileContent(uri);
            const htmlWalker = this.createHtmlWalker(content);
            // Broken while typing: keep the previous tokens' colors.
            if (!htmlWalker) return empty;

            const tokens = this.collectTokens({ content, htmlWalker });

            const { SemanticTokensBuilder } = require("vscode-languageserver");
            const builder = new SemanticTokensBuilder();
            tokens
                .sort((a, b) => a.line - b.line || a.char - b.char)
                .forEach(({ line, char, length, typeIndex }) =>
                    builder.push(line, char, length, typeIndex, 0)
                );

            return builder.build();
        } catch (e) {
            console.warn(`Semantic tokens failed for ${uri}. ${e}`);
            return empty;
        }
    }

    collectTokens({ content, htmlWalker }) {
        const { NODE_TYPES } = require("./ast-helpers");
        const {
            positionToOffset,
            getWrappingTemplateName,
            getBlockVariablesAtOffset,
        } = require("./text-utils");

        const { templateIndexMap, globalHelpersMap } =
            this.indexer.blazeIndexer;

        const tokens = [];
        const handled = new Set();
        const keyOf = ({ start }) => `${start.line}:${start.column}`;

        const pushToken = (loc, length, typeIndex) =>
            tokens.push({
                line: loc.start.line - 1,
                char: loc.start.column,
                length,
                typeIndex,
            });

        const classifyPath = (path) => {
            if (!path?.loc || handled.has(keyOf(path.loc))) return;
            handled.add(keyOf(path.loc));

            const head = path.parts?.[0];
            if (!head || path.original.startsWith("@") || head === "this") {
                return;
            }

            const offset = positionToOffset(content, {
                line: path.loc.start.line - 1,
                character: path.loc.start.column,
            });

            if (
                getBlockVariablesAtOffset(content, offset).some(
                    ({ name }) => name === head
                )
            ) {
                return pushToken(
                    path.loc,
                    head.length,
                    TOKEN_TYPE_INDEX.variable
                );
            }

            const wrappingTemplateName = getWrappingTemplateName(
                content,
                offset
            );
            const isHelper =
                (!!wrappingTemplateName &&
                    !!templateIndexMap[wrappingTemplateName]?.helpers?.[
                        head
                    ]) ||
                !!globalHelpersMap[head];
            if (isHelper) {
                return pushToken(
                    path.loc,
                    head.length,
                    TOKEN_TYPE_INDEX.helper
                );
            }

            // Data passed at inclusion sites colors like a bound variable.
            if (
                !!wrappingTemplateName &&
                this.indexer.blazeIndexer.getDataParams(
                    wrappingTemplateName,
                    head
                )
            ) {
                pushToken(path.loc, head.length, TOKEN_TYPE_INDEX.variable);
            }
        };

        htmlWalker.walkUntil((node) => {
            if (!node) return;

            // {{> template}}
            if (
                node.type === NODE_TYPES.PARTIAL_STATEMENT &&
                node.name?.loc
            ) {
                handled.add(keyOf(node.name.loc));
                if (templateIndexMap[node.name.original]) {
                    pushToken(
                        node.name.loc,
                        node.name.original.length,
                        TOKEN_TYPE_INDEX.template
                    );
                }
                return;
            }

            // {{#each x in items}} / {{#if ...}} / custom block helpers.
            if (node.type === NODE_TYPES.BLOCK_STATEMENT && node.path?.loc) {
                const blockName = node.path.original;
                if (!BUILTIN_BLOCKS.includes(blockName)) return;

                handled.add(keyOf(node.path.loc));
                pushToken(
                    node.path.loc,
                    blockName.length,
                    TOKEN_TYPE_INDEX.keyword
                );

                const isEachIn =
                    blockName === "each" &&
                    node.params?.length === 3 &&
                    node.params[1]?.original === "in";
                if (isEachIn) {
                    handled.add(keyOf(node.params[0].loc));
                    pushToken(
                        node.params[0].loc,
                        node.params[0].original.length,
                        TOKEN_TYPE_INDEX.variable
                    );
                    handled.add(keyOf(node.params[1].loc));
                    pushToken(node.params[1].loc, 2, TOKEN_TYPE_INDEX.keyword);
                }
                return;
            }

            if (node.type === NODE_TYPES.PATH_EXPRESSION) classifyPath(node);
        });

        return tokens;
    }
}

module.exports = { SemanticTokensProvider };
