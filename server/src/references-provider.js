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
            // Before getTemplateInfo: that returns a (truthy) empty object
            // for unknown names and would short-circuit the chain.
            this.indexer.sessionKeysIndexer.getReferences(nodeKey) ||
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
        const { NODE_TYPES } = require("./ast-helpers");

        const content = this.getFileContent(uri);

        const htmlWalker = this.createHtmlWalker(content);
        if (!htmlWalker) {
            console.warn(`Not able to parse ${uri} for references.`);
            return;
        }

        const symbol = htmlWalker.getSymbolAtPosition(position);
        const isPartial = !!symbol && htmlWalker.isPartialStatement(symbol);
        if (
            !symbol ||
            (!isPartial &&
                ![
                    NODE_TYPES.PATH_EXPRESSION,
                    NODE_TYPES.MUSTACHE_STATEMENT,
                ].includes(symbol.type))
        ) {
            // Not a Blaze symbol: maybe a class/id token targeted by an
            // event map.
            return this.findEventHandlersForSelector({
                content,
                position,
            });
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

    /**
     * With the cursor on a class/id token inside a class="..."/id="..."
     * attribute, return every event map key targeting that selector on the
     * wrapping template.
     */
    findEventHandlersForSelector({ content, position }) {
        const ATTRIBUTE_REGEX = /\b(class|id)=["']([^"']*)["']/g;

        const line = content.split("\n")[position.line] || "";
        for (const match of line.matchAll(ATTRIBUTE_REGEX)) {
            const valueStart = match.index + match[1].length + 2;

            for (const token of match[2].matchAll(/[\w-]+/g)) {
                const tokenStart = valueStart + token.index;
                const tokenEnd = tokenStart + token[0].length;
                if (
                    position.character < tokenStart ||
                    position.character > tokenEnd
                ) {
                    continue;
                }

                const selector = `${match[1] === "class" ? "." : "#"}${
                    token[0]
                }`;
                return this.getHandlerLocationsForSelector({
                    content,
                    position,
                    selector,
                });
            }
        }

        return;
    }

    getHandlerLocationsForSelector({ content, position, selector }) {
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const templateName = getWrappingTemplateName(
            content,
            positionToOffset(content, position)
        );
        if (!templateName) return;

        const { templateIndexMap, eventsMap } = this.indexer.blazeIndexer;

        const matchingEventKeys = Object.keys(
            templateIndexMap[templateName]?.events || {}
        ).filter((eventKey) =>
            (eventKey.match(/[.#][\w-]+/g) || []).includes(selector)
        );
        if (!matchingEventKeys.length) return;

        // eventsMap holds every definition of the key (event maps can be
        // split across files).
        const entries = matchingEventKeys.flatMap(
            (eventKey) => eventsMap[eventKey] || []
        );
        if (!entries.length) return;

        return this.createLocations(entries);
    }
}

module.exports = {
    ReferencesProvider,
};
