const { ServerBase } = require("./helpers");

/**
 * App-wide summary of the index, consumed by the client's Meteor
 * Explorer and Template Hierarchy views: templates (with helpers,
 * events and the {{> }} inclusion graph), global helpers, methods and
 * publications, with usage flags.
 */
class OverviewProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onAppOverviewRequest() {
        const empty = {
            templates: [],
            globalHelpers: [],
            methods: [],
            publications: [],
        };

        try {
            if (!this.indexer?.loaded) return empty;

            const { blazeIndexer, methodsAndPublicationsIndexer } =
                this.indexer;
            const { templateIndexMap, htmlUsageMap, globalHelpersMap } =
                blazeIndexer;
            const { methodsMap, publicationsMap, usageMap } =
                methodsAndPublicationsIndexer;

            const { includes, includedBy } = this.buildInclusionGraph();

            const entryLocation = (entry) => ({
                file: entry.uri?.fsPath,
                line:
                    entry.keyLoc?.start.line ??
                    entry.start?.line ??
                    entry.node?.loc.start.line ??
                    1,
            });

            const templates = Object.entries(templateIndexMap)
                .map(([name, template]) => ({
                    name,
                    file: (template.uri || template.jsUri)?.fsPath,
                    line: template.node?.loc.start.line ?? 1,
                    helpers: Object.entries(template.helpers || {}).map(
                        ([helperName, helper]) => ({
                            name: helperName,
                            ...entryLocation(helper),
                            unused: !htmlUsageMap[helperName],
                        })
                    ),
                    events: Object.entries(template.events || {}).map(
                        ([eventKey, event]) => ({
                            name: eventKey,
                            ...entryLocation(event),
                        })
                    ),
                    includes: includes[name] || [],
                    includedBy: [...new Set(includedBy[name] || [])],
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const mapEntries = (map, unusedCheck) =>
                Object.entries(map)
                    .map(([name, entry]) => ({
                        name,
                        ...entryLocation(entry),
                        unused: unusedCheck(name),
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));

            return {
                templates,
                globalHelpers: mapEntries(
                    globalHelpersMap,
                    (name) => !htmlUsageMap[name]
                ),
                methods: mapEntries(methodsMap, (name) => !usageMap[name]),
                publications: mapEntries(
                    publicationsMap,
                    (name) => !usageMap[name]
                ),
            };
        } catch (e) {
            console.warn(`App overview failed. ${e}`);
            return empty;
        }
    }

    // Every {{> partial}} edge: which template includes which, and where.
    buildInclusionGraph() {
        const { NODE_TYPES } = require("./ast-helpers");
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const includes = {};
        const includedBy = {};

        const htmlSources = Object.values(this.indexer.getSources()).filter(
            ({ extension }) => extension === ".html"
        );

        for (const { astWalker, fileContent, uri } of htmlSources) {
            astWalker.walkUntil((node) => {
                if (
                    node?.type !== NODE_TYPES.PARTIAL_STATEMENT ||
                    !node.name?.loc
                ) {
                    return;
                }

                const target = node.name.original;
                const offset = positionToOffset(fileContent, {
                    line: node.name.loc.start.line - 1,
                    character: node.name.loc.start.column,
                });
                const wrappingTemplate = getWrappingTemplateName(
                    fileContent,
                    offset
                );
                if (!wrappingTemplate) return;

                includes[wrappingTemplate] = includes[wrappingTemplate] || [];
                includes[wrappingTemplate].push({
                    name: target,
                    file: uri.fsPath,
                    line: node.name.loc.start.line,
                });

                includedBy[target] = includedBy[target] || [];
                includedBy[target].push(wrappingTemplate);
            });
        }

        return { includes, includedBy };
    }
}

module.exports = { OverviewProvider };
