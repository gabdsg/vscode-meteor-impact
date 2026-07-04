const { ServerBase } = require("./helpers");

class SymbolsProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    createRange({ start, end }) {
        const { Range } = require("vscode-languageserver");

        return Range.create(
            start.line - 1,
            start.column,
            end.line - 1,
            end.column
        );
    }

    unionRange(ranges) {
        const { Range } = require("vscode-languageserver");

        return ranges.reduce((acc, range) => {
            if (!acc) return range;

            const start =
                range.start.line < acc.start.line ? range.start : acc.start;
            const end = range.end.line > acc.end.line ? range.end : acc.end;
            return Range.create(start, end);
        }, undefined);
    }

    onDocumentSymbolRequest({ textDocument: { uri } }) {
        try {
            const fsPath = this.parseUri(uri).fsPath;

            if (this.isFileSpacebarsHTML(uri)) {
                return this.getHtmlDocumentSymbols(fsPath);
            }

            if (this.isFileJS(uri)) {
                return this.getJsDocumentSymbols(fsPath);
            }
        } catch (e) {
            console.warn(`Document symbols failed for ${uri}. ${e}`);
        }
    }

    getHtmlDocumentSymbols(fsPath) {
        const { DocumentSymbol, SymbolKind } = require("vscode-languageserver");
        const { templateIndexMap } = this.indexer.blazeIndexer;

        return Object.entries(templateIndexMap)
            .filter(
                ([, { node, uri }]) => !!node && uri?.fsPath === fsPath
            )
            .map(([templateName, { node }]) => {
                const range = this.createRange(node.loc);
                return DocumentSymbol.create(
                    templateName,
                    "template",
                    SymbolKind.Class,
                    range,
                    range
                );
            });
    }

    getJsDocumentSymbols(fsPath) {
        const { DocumentSymbol, SymbolKind } = require("vscode-languageserver");
        const { templateIndexMap, globalHelpersMap } =
            this.indexer.blazeIndexer;
        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;

        const symbols = [];

        // Template helpers and events defined in this file, grouped by
        // template.
        for (const [templateName, template] of Object.entries(
            templateIndexMap
        )) {
            const children = [
                ...Object.entries(template.helpers || {})
                    .filter(([, { uri }]) => uri?.fsPath === fsPath)
                    .map(([helperName, helper]) => {
                        const range = this.createRange(helper);
                        return DocumentSymbol.create(
                            helperName,
                            "helper",
                            SymbolKind.Function,
                            range,
                            range
                        );
                    }),
                ...Object.entries(template.events || {})
                    .filter(([, { uri }]) => uri?.fsPath === fsPath)
                    .map(([eventKey, event]) => {
                        const range = this.createRange(event);
                        return DocumentSymbol.create(
                            eventKey,
                            "event",
                            SymbolKind.Event,
                            range,
                            range
                        );
                    }),
            ];

            if (!children.length) continue;

            const range = this.unionRange(
                children.map(({ range: childRange }) => childRange)
            );
            symbols.push(
                DocumentSymbol.create(
                    templateName,
                    "template",
                    SymbolKind.Class,
                    range,
                    range,
                    children
                )
            );
        }

        // Global helpers defined in this file.
        for (const [helperName, helper] of Object.entries(globalHelpersMap)) {
            if (helper.uri?.fsPath !== fsPath) continue;

            const range = this.createRange(helper);
            symbols.push(
                DocumentSymbol.create(
                    helperName,
                    "global helper",
                    SymbolKind.Function,
                    range,
                    range
                )
            );
        }

        // Methods and publications defined in this file.
        for (const [maps, detail, kind] of [
            [methodsMap, "Meteor method", SymbolKind.Method],
            [publicationsMap, "Meteor publication", SymbolKind.Interface],
        ]) {
            for (const [name, { node, uri }] of Object.entries(maps)) {
                if (uri?.fsPath !== fsPath) continue;

                const range = this.createRange(node.loc);
                symbols.push(
                    DocumentSymbol.create(name, detail, kind, range, range)
                );
            }
        }

        return symbols;
    }

    onWorkspaceSymbolRequest({ query }) {
        try {
            const { SymbolInformation, SymbolKind } =
                require("vscode-languageserver");

            const { templateIndexMap, globalHelpersMap } =
                this.indexer.blazeIndexer;
            const { methodsMap, publicationsMap } =
                this.indexer.methodsAndPublicationsIndexer;

            const symbols = [];
            const add = (name, kind, entry, containerName) => {
                const location = entry.node?.loc || entry;
                if (!location?.start || !entry.uri) return;

                symbols.push(
                    SymbolInformation.create(
                        name,
                        kind,
                        this.createRange(location),
                        entry.uri.toString(),
                        containerName
                    )
                );
            };

            for (const [templateName, template] of Object.entries(
                templateIndexMap
            )) {
                if (template.node) {
                    add(templateName, SymbolKind.Class, template, "template");
                }

                for (const [helperName, helper] of Object.entries(
                    template.helpers || {}
                )) {
                    add(helperName, SymbolKind.Function, helper, templateName);
                }

                for (const [eventKey, event] of Object.entries(
                    template.events || {}
                )) {
                    add(eventKey, SymbolKind.Event, event, templateName);
                }
            }

            for (const [helperName, helper] of Object.entries(
                globalHelpersMap
            )) {
                add(helperName, SymbolKind.Function, helper, "global helpers");
            }

            for (const [name, entry] of Object.entries(methodsMap)) {
                add(name, SymbolKind.Method, entry, "Meteor methods");
            }

            for (const [name, entry] of Object.entries(publicationsMap)) {
                add(name, SymbolKind.Interface, entry, "Meteor publications");
            }

            const _query = (query || "").toLowerCase();
            if (!_query) return symbols;

            return symbols.filter(({ name }) =>
                name.toLowerCase().includes(_query)
            );
        } catch (e) {
            console.warn(`Workspace symbols failed. ${e}`);
        }
    }
}

module.exports = { SymbolsProvider };
