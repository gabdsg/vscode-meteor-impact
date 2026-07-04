const { ServerBase } = require("./helpers");

/**
 * Rename for the symbols we index. Renames are by name, project-wide:
 * - Helpers: JS/TS definitions (template-scoped on every template defining
 *   the name, and global) + every HTML usage.
 * - Templates: <template name="..."> tags, {{> partial}} / block usages and
 *   Template.X JS references.
 * - Methods/publications: definition + every call site string.
 * - Event keys: every event map defining the key.
 */
class RenameProvider extends ServerBase {
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

    // Range of a string literal without its quotes.
    createInnerRange(loc) {
        const { Range } = require("vscode-languageserver");

        return Range.create(
            loc.start.line - 1,
            loc.start.column + 1,
            loc.end.line - 1,
            loc.end.column - 1
        );
    }

    onPrepareRenameRequest({ position, textDocument: { uri } }) {
        try {
            const target = this.resolveTarget({ uri, position });
            if (!target) return;

            return { range: target.originRange, placeholder: target.name };
        } catch (e) {
            console.warn(`Prepare rename failed for ${uri}. ${e}`);
        }
    }

    onRenameRequest({ position, textDocument: { uri }, newName }) {
        try {
            if (!newName || /["'`{}]/.test(newName)) return;

            const target = this.resolveTarget({ uri, position });
            if (!target) return;

            const changes = this.buildEdits(target, newName);
            if (!Object.keys(changes).length) return;

            return { changes };
        } catch (e) {
            console.warn(`Rename failed for ${uri}. ${e}`);
        }
    }

    resolveTarget({ uri, position }) {
        if (this.isFileSpacebarsHTML(uri)) {
            return this.resolveHtmlTarget({ uri, position });
        }

        if (this.isFileJS(uri)) {
            return this.resolveJsTarget({ uri, position });
        }
    }

    resolveHtmlTarget({ uri, position }) {
        const { AstWalker, NODE_TYPES } = require("./ast-helpers");

        const htmlWalker = new AstWalker(
            this.getFileContent(uri),
            require("@handlebars/parser").parse
        );

        const symbol = htmlWalker.getSymbolAtPosition(position);
        if (!symbol) return;

        if (htmlWalker.isPartialStatement(symbol)) {
            const name = symbol.name?.original;
            if (!name || symbol.name?.parts?.length > 1) return;

            return {
                kind: "template",
                name,
                originRange: this.createRange(symbol.name.loc),
            };
        }

        if (symbol.type !== NODE_TYPES.PATH_EXPRESSION) return;
        if (symbol.parts?.length !== 1 || symbol.original.startsWith("@")) {
            return;
        }

        const name = symbol.parts[0];
        const originRange = this.createRange(symbol.loc);
        const { blazeIndexer } = this.indexer;

        if (this.findHelperDefinitions(name).length) {
            return { kind: "helper", name, originRange };
        }

        // Block/each parameters can reference templates too.
        if (blazeIndexer.templateIndexMap[name]) {
            return { kind: "template", name, originRange };
        }

        return;
    }

    resolveJsTarget({ uri, position }) {
        const { AstWalker, parseJsSource, NODE_TYPES } =
            require("./ast-helpers");

        const astWalker = new AstWalker(
            this.getFileContent(uri),
            parseJsSource,
            { extension: this.getFileExtension(uri), errorRecovery: true }
        );

        const nodeAtPosition = astWalker.getSymbolAtPosition(position);
        if (
            !nodeAtPosition ||
            ![NODE_TYPES.LITERAL, NODE_TYPES.IDENTIFIER].includes(
                nodeAtPosition.type
            )
        ) {
            return;
        }

        const name = nodeAtPosition.value || nodeAtPosition.name;
        if (!name || typeof name !== "string") return;

        const originRange =
            nodeAtPosition.type === NODE_TYPES.LITERAL
                ? this.createInnerRange(nodeAtPosition.loc)
                : this.createRange(nodeAtPosition.loc);

        const { blazeIndexer, methodsAndPublicationsIndexer } = this.indexer;

        if (methodsAndPublicationsIndexer.methodsMap[name]) {
            return { kind: "method", name, originRange };
        }

        if (methodsAndPublicationsIndexer.publicationsMap[name]) {
            return { kind: "publication", name, originRange };
        }

        if (this.findHelperDefinitions(name).length) {
            return { kind: "helper", name, originRange };
        }

        if (blazeIndexer.eventsMap[name]) {
            return { kind: "event", name, originRange };
        }

        if (
            blazeIndexer.templateIndexMap[name] ||
            blazeIndexer.templateJsReferences[name]
        ) {
            return { kind: "template", name, originRange };
        }

        return;
    }

    findHelperDefinitions(name) {
        const { templateIndexMap, globalHelpersMap } = this.indexer.blazeIndexer;

        return [
            ...Object.values(templateIndexMap).flatMap((template) =>
                template.helpers?.[name] ? [template.helpers[name]] : []
            ),
            ...(globalHelpersMap[name] ? [globalHelpersMap[name]] : []),
        ];
    }

    buildEdits({ kind, name }, newName) {
        const { TextEdit } = require("vscode-languageserver");

        const changes = {};
        const seen = new Set();
        const addEdit = (uri, range) => {
            const key = `${uri.fsPath}:${range.start.line}:${range.start.character}:${range.end.character}`;
            if (seen.has(key)) return;
            seen.add(key);

            const uriString = uri.toString();
            changes[uriString] = changes[uriString] || [];
            changes[uriString].push(TextEdit.replace(range, newName));
        };

        const { blazeIndexer, methodsAndPublicationsIndexer } = this.indexer;

        // HTML usages apply to helpers and templates alike.
        if (["helper", "template"].includes(kind)) {
            for (const { node, uri } of blazeIndexer.htmlUsageMap[name] || []) {
                addEdit(uri, this.createRange(node.loc));
            }
        }

        if (kind === "helper") {
            for (const helper of this.findHelperDefinitions(name)) {
                if (helper.keyLoc) {
                    // Template-scoped helper: edit the property key only.
                    addEdit(
                        helper.uri,
                        helper.keyIsLiteral
                            ? this.createInnerRange(helper.keyLoc)
                            : this.createRange(helper.keyLoc)
                    );
                } else if (helper.node) {
                    // Global helper: the registerHelper name argument.
                    addEdit(helper.uri, this.createInnerRange(helper.node.loc));
                }
            }
        }

        if (kind === "template") {
            this.addTemplateTagEdits(name, addEdit);

            for (const reference of blazeIndexer.templateJsReferences[name] ||
                []) {
                addEdit(
                    reference.uri,
                    reference.isLiteral
                        ? this.createInnerRange(reference.loc)
                        : this.createRange(reference.loc)
                );
            }
        }

        if (["method", "publication"].includes(kind)) {
            const { NODE_TYPES } = require("./ast-helpers");
            const definition =
                methodsAndPublicationsIndexer.methodsMap[name] ||
                methodsAndPublicationsIndexer.publicationsMap[name];

            if (definition) {
                addEdit(
                    definition.uri,
                    definition.node.type === NODE_TYPES.LITERAL
                        ? this.createInnerRange(definition.node.loc)
                        : this.createRange(definition.node.loc)
                );
            }

            for (const { node, uri } of methodsAndPublicationsIndexer.usageMap[
                name
            ] || []) {
                addEdit(uri, this.createInnerRange(node.loc));
            }
        }

        if (kind === "event") {
            const { NODE_TYPES } = require("./ast-helpers");

            for (const { node, uri } of blazeIndexer.eventsMap[name] || []) {
                addEdit(
                    uri,
                    node.type === NODE_TYPES.LITERAL
                        ? this.createInnerRange(node.loc)
                        : this.createRange(node.loc)
                );
            }
        }

        return changes;
    }

    // Edit the name="..." attribute of every <template> tag with this name.
    addTemplateTagEdits(name, addEdit) {
        const { Range } = require("vscode-languageserver");
        const { getTemplateTags, offsetToLoc } = require("./text-utils");

        const htmlSources = Object.values(this.indexer.getSources()).filter(
            ({ extension }) => extension === ".html"
        );

        for (const { uri, fileContent } of htmlSources) {
            for (const tag of getTemplateTags(fileContent)) {
                if (tag.isClosing || tag.name !== name) continue;

                const start = offsetToLoc(fileContent, tag.nameStart);
                const end = offsetToLoc(
                    fileContent,
                    tag.nameStart + name.length
                );
                addEdit(
                    uri,
                    Range.create(
                        start.line - 1,
                        start.column,
                        end.line - 1,
                        end.column
                    )
                );
            }
        }
    }
}

module.exports = { RenameProvider };
