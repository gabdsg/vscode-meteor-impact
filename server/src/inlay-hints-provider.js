const { ServerBase } = require("./helpers");

/**
 * Parameter name hints inside mustache helper calls:
 * {{formatAge person}} renders as {{formatAge person:person}}, using the
 * signatures captured at index time.
 */
class InlayHintsProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onInlayHintsRequest({ textDocument: { uri }, range }) {
        try {
            if (!this.isFileSpacebarsHTML(uri)) return [];

            const { AstWalker, NODE_TYPES } = require("./ast-helpers");

            const content = this.getFileContent(uri);
            let htmlWalker;
            try {
                htmlWalker = new AstWalker(
                    content,
                    require("@handlebars/parser").parse
                );
            } catch (e) {
                return [];
            }

            const {
                positionToOffset,
                getWrappingTemplateName,
            } = require("./text-utils");
            const { InlayHint, InlayHintKind } =
                require("vscode-languageserver");

            const { templateIndexMap, globalHelpersMap } =
                this.indexer.blazeIndexer;

            const hints = [];
            htmlWalker.walkUntil((node) => {
                if (
                    node?.type !== NODE_TYPES.MUSTACHE_STATEMENT ||
                    !node.params?.length ||
                    node.path?.type !== NODE_TYPES.PATH_EXPRESSION ||
                    node.path.parts?.length !== 1
                ) {
                    return;
                }

                const helperName = node.path.parts[0];
                const offset = positionToOffset(content, {
                    line: node.path.loc.start.line - 1,
                    character: node.path.loc.start.column,
                });
                const wrappingTemplateName = getWrappingTemplateName(
                    content,
                    offset
                );

                const helper =
                    (!!wrappingTemplateName &&
                        templateIndexMap[wrappingTemplateName]?.helpers?.[
                            helperName
                        ]) ||
                    globalHelpersMap[helperName];
                if (!helper?.signature?.params) return;

                node.params.forEach((param, index) => {
                    const paramText = helper.signature.params[index];
                    if (!paramText || !param.loc) return;

                    // "person?: Person" -> "person:"
                    const paramName = paramText
                        .split(":")[0]
                        .replace(/[?\s]+$/, "");
                    if (!paramName) return;

                    hints.push(
                        InlayHint.create(
                            {
                                line: param.loc.start.line - 1,
                                character: param.loc.start.column,
                            },
                            `${paramName}:`,
                            InlayHintKind.Parameter
                        )
                    );
                });
            });

            if (!range) return hints;
            return hints.filter(
                ({ position }) =>
                    position.line >= range.start.line &&
                    position.line <= range.end.line
            );
        } catch (e) {
            console.warn(`Inlay hints failed for ${uri}. ${e}`);
            return [];
        }
    }
}

module.exports = { InlayHintsProvider };
