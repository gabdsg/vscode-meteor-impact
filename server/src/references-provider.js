const { ServerBase } = require("./helpers");

class ReferencesProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onReferenceRequest({ position, textDocument: { uri }, context }) {
        if (this.isFileSpacebarsHTML(uri)) {
            return this.handleHtmlReferences({ position, uri, context });
        }

        if (!this.isFileJS(uri)) {
            return;
        }

        const { astWalker } = this.indexer.getFileInfo(uri);
        const nodeAtPosition = astWalker.getSymbolAtPosition(position);
        if (!nodeAtPosition) {
            console.warn(
                `Nothing found for the specified position: ${JSON.stringify(
                    position,
                    undefined,
                    2
                )}`
            );
            return;
        }

        const { NODE_TYPES } = require("./ast-helpers");
        const { Location, Range } = require("vscode-languageserver");

        if (
            ![NODE_TYPES.LITERAL, NODE_TYPES.IDENTIFIER].includes(
                nodeAtPosition.type
            )
        ) {
            return;
        }

        // Find references for helpers, templateNames, and methods/publications.
        const nodeKey = nodeAtPosition.value || nodeAtPosition.name;
        const usageInfoArray =
            this.indexer.methodsAndPublicationsIndexer.getUsageInfo(nodeKey) ||
            this.indexer.blazeIndexer.htmlUsageMap[nodeKey] ||
            this.indexer.blazeIndexer.getEventLocations(nodeKey) ||
            this.indexer.blazeIndexer.getTemplateInfo(nodeKey);

        if (!Array.isArray(usageInfoArray) || !usageInfoArray.length) {
            console.warn(`No references found for ${nodeKey}`);
            return;
        }

        return this.createLocations(usageInfoArray);
    }

    // Entries can carry their location as node.loc (usage entries) or as
    // start/end (helper index entries).
    createLocations(entries) {
        const { Location, Range } = require("vscode-languageserver");

        return entries.map(({ node, uri, start, end }) => {
            const _start = start || node.loc.start;
            const _end = end || node.loc.end;

            return Location.create(
                uri.path,
                Range.create(
                    _start.line - 1,
                    _start.column,
                    _end.line - 1,
                    _end.column
                )
            );
        });
    }

    handleHtmlReferences({ position, uri, context }) {
        const { AstWalker, NODE_TYPES } = require("./ast-helpers");

        let htmlWalker;
        try {
            htmlWalker = new AstWalker(
                this.getFileContent(uri),
                require("@handlebars/parser").parse
            );
        } catch (e) {
            console.warn(`Not able to parse ${uri} for references. ${e}`);
            return;
        }

        const symbol = htmlWalker.getSymbolAtPosition(position);
        if (!symbol) return;

        const isPartial = htmlWalker.isPartialStatement(symbol);
        if (
            !isPartial &&
            ![
                NODE_TYPES.PATH_EXPRESSION,
                NODE_TYPES.MUSTACHE_STATEMENT,
            ].includes(symbol.type)
        ) {
            return;
        }

        const { blazeIndexer } = this.indexer;
        const key = isPartial
            ? symbol.name?.original
            : blazeIndexer.getHelperName(symbol);
        if (!key || typeof key !== "string") return;

        const usages = blazeIndexer.htmlUsageMap[key] || [];

        // Also point to the definitions (helpers in JS/TS files, template
        // tags in HTML files), unless the client asked not to.
        const definitions =
            context?.includeDeclaration === false
                ? []
                : [
                      ...Object.values(blazeIndexer.templateIndexMap).flatMap(
                          (template) =>
                              template.helpers?.[key]
                                  ? [template.helpers[key]]
                                  : []
                      ),
                      ...(blazeIndexer.getGlobalHelper(key)
                          ? [blazeIndexer.getGlobalHelper(key)]
                          : []),
                      ...(blazeIndexer.templateIndexMap[key]
                          ? [blazeIndexer.templateIndexMap[key]]
                          : []),
                  ].filter(({ node, start }) => node || start);

        const allEntries = [...usages, ...definitions];
        if (!allEntries.length) {
            console.warn(`No references found for ${key}`);
            return;
        }

        return this.createLocations(allEntries);
    }
}

module.exports = {
    ReferencesProvider,
};
