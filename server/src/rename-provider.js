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

    // With the cursor on the name attribute of a <template> tag: the
    // definition side of a template rename.
    resolveTemplateTagTarget({ content, position }) {
        const { Range } = require("vscode-languageserver");
        const {
            positionToOffset,
            offsetToLoc,
            getTemplateTags,
        } = require("./text-utils");

        const offset = positionToOffset(content, position);

        for (const tag of getTemplateTags(content)) {
            if (tag.isClosing) continue;

            const nameEnd = tag.nameStart + tag.name.length;
            if (offset < tag.nameStart || offset > nameEnd) continue;

            const start = offsetToLoc(content, tag.nameStart);
            const end = offsetToLoc(content, nameEnd);
            return {
                kind: "template",
                name: tag.name,
                originRange: Range.create(
                    start.line - 1,
                    start.column,
                    end.line - 1,
                    end.column
                ),
            };
        }

        return;
    }

    resolveHtmlTarget({ uri, position }) {
        const { AstWalker, NODE_TYPES } = require("./ast-helpers");

        const content = this.getFileContent(uri);

        const tagTarget = this.resolveTemplateTagTarget({ content, position });
        if (tagTarget) return tagTarget;

        const htmlWalker = new AstWalker(
            content,
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
        const { templateIndexMap, globalHelpersMap } = this.indexer.blazeIndexer;

        // Resolve the usage to its actual helper: the wrapping template's
        // scoped helper shadows a global with the same name.
        const { positionToOffset, getWrappingTemplateName } =
            require("./text-utils");
        const wrappingTemplateName = getWrappingTemplateName(
            content,
            positionToOffset(content, position)
        );

        if (
            !!wrappingTemplateName &&
            templateIndexMap[wrappingTemplateName]?.helpers?.[name]
        ) {
            return {
                kind: "helper",
                name,
                originRange,
                scope: { templateName: wrappingTemplateName },
            };
        }

        if (globalHelpersMap[name]) {
            return {
                kind: "helper",
                name,
                originRange,
                scope: { global: true },
            };
        }

        // Block/each parameters can reference templates too.
        if (templateIndexMap[name]) {
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

        // Helper renames are anchored to the definition key the cursor is
        // on, so that only the right scope is renamed.
        const helperScope = this.findHelperScopeAtNode({
            uri,
            name,
            loc: nodeAtPosition.loc,
        });
        if (helperScope) {
            return { kind: "helper", name, originRange, scope: helperScope };
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

    // Which helper definition (if any) is the given JS node? Matched by
    // exact position against the indexed definition keys.
    findHelperScopeAtNode({ uri, name, loc }) {
        const { templateIndexMap, globalHelpersMap } = this.indexer.blazeIndexer;

        const fsPath = this.parseUri(uri).fsPath;
        const samePosition = (otherLoc) =>
            !!otherLoc &&
            otherLoc.start.line === loc.start.line &&
            otherLoc.start.column === loc.start.column;

        for (const [templateName, template] of Object.entries(
            templateIndexMap
        )) {
            const helper = template.helpers?.[name];
            if (
                helper?.uri?.fsPath === fsPath &&
                samePosition(helper.keyLoc)
            ) {
                return { templateName };
            }
        }

        const globalHelper = globalHelpersMap[name];
        if (
            globalHelper?.uri?.fsPath === fsPath &&
            samePosition(globalHelper.node?.loc)
        ) {
            return { global: true };
        }

        return;
    }

    // Wrapping template of an indexed HTML usage, resolved from the file
    // content kept on the sources map.
    getUsageWrappingTemplate({ node, uri }) {
        const source = this.indexer.getSources()[uri.fsPath];
        if (!source?.fileContent) return;

        const { positionToOffset, getWrappingTemplateName } =
            require("./text-utils");

        return getWrappingTemplateName(
            source.fileContent,
            positionToOffset(source.fileContent, {
                line: node.loc.start.line - 1,
                character: node.loc.start.column,
            })
        );
    }

    buildEdits({ kind, name, scope }, newName) {
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

        if (kind === "template") {
            for (const { node, uri } of blazeIndexer.htmlUsageMap[name] || []) {
                addEdit(uri, this.createRange(node.loc));
            }
        }

        if (kind === "helper") {
            this.addScopedHelperEdits({ name, scope, addEdit });
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

    /**
     * Scope-aware helper edits: only the definition of the resolved scope
     * and the usages that actually resolve to it are renamed. A usage
     * resolves to the wrapping template's scoped helper if one exists, and
     * to the global helper otherwise.
     */
    addScopedHelperEdits({ name, scope, addEdit }) {
        const { templateIndexMap, globalHelpersMap } =
            this.indexer.blazeIndexer;

        if (scope?.templateName) {
            const helper = templateIndexMap[scope.templateName]?.helpers?.[
                name
            ];
            if (helper?.keyLoc) {
                // Edit the property key only, keeping literal quotes.
                addEdit(
                    helper.uri,
                    helper.keyIsLiteral
                        ? this.createInnerRange(helper.keyLoc)
                        : this.createRange(helper.keyLoc)
                );
            }
        } else if (scope?.global && globalHelpersMap[name]?.node) {
            addEdit(
                globalHelpersMap[name].uri,
                this.createInnerRange(globalHelpersMap[name].node.loc)
            );
        }

        for (const usage of this.indexer.blazeIndexer.htmlUsageMap[name] ||
            []) {
            const wrappingTemplateName = this.getUsageWrappingTemplate(usage);
            const resolvesToScopedHelper =
                !!wrappingTemplateName &&
                !!templateIndexMap[wrappingTemplateName]?.helpers?.[name];

            const belongsToScope = scope?.templateName
                ? wrappingTemplateName === scope.templateName
                : !resolvesToScopedHelper;
            if (!belongsToScope) continue;

            addEdit(usage.uri, this.createRange(usage.node.loc));
        }
    }

    /**
     * Symbol + import-specifier edits for a template folder rename, applied
     * through workspace/applyEdit. The client renames the files/folder
     * afterwards, so the import edits point at the NEW basenames.
     */
    async executeTemplateFolderRename({ folderUri, oldName, newName }) {
        const fail = (message) => {
            this.serverInstance.window?.showErrorMessage?.(message);
            return { applied: false, reason: message };
        };

        try {
            if (!newName || !/^[\w-]+$/.test(newName)) {
                return fail(`"${newName}" is not a valid template name.`);
            }

            if (this.indexer.blazeIndexer.templateIndexMap[newName]) {
                return fail(
                    `A template named "${newName}" already exists.`
                );
            }

            // Template.oldName property references can't survive a rename
            // to a non-identifier name.
            const jsReferences =
                this.indexer.blazeIndexer.templateJsReferences[oldName] || [];
            if (
                jsReferences.some(({ isLiteral }) => !isLiteral) &&
                !/^[A-Za-z_$][\w$]*$/.test(newName)
            ) {
                return fail(
                    `"${newName}" is not a valid identifier, but Template.${oldName} property references exist. Pick an identifier-safe name.`
                );
            }

            const changes = this.buildEdits(
                { kind: "template", name: oldName },
                newName
            );

            this.addImportSpecifierEdits({
                folderUri,
                oldName,
                newName,
                changes,
            });

            if (!Object.keys(changes).length) {
                return fail(`Nothing to rename for template "${oldName}".`);
            }

            await this.serverInstance.workspace.applyEdit({ changes });
            return { applied: true };
        } catch (e) {
            console.error(`Template folder rename failed. ${e}`);
            return fail(`Template rename failed: ${e.message}`);
        }
    }

    // Rewrite import "./old.html|less|css" specifiers inside the folder's
    // code-behind files to the new basename.
    addImportSpecifierEdits({ folderUri, oldName, newName, changes }) {
        const { TextEdit, Range } = require("vscode-languageserver");
        const { offsetToLoc } = require("./text-utils");

        const folderFsPath = this.parseUri(folderUri).fsPath;
        const specifierRegex = new RegExp(
            `(["'])\\./${oldName}(\\.(?:html|less|css))\\1`,
            "g"
        );

        for (const extension of [".ts", ".js"]) {
            const scriptFsPath = require("path").join(
                folderFsPath,
                `${oldName}${extension}`
            );
            const source = this.indexer.getSources()[scriptFsPath];
            if (!source?.fileContent) continue;

            const uriString = source.uri.toString();
            for (const match of source.fileContent.matchAll(specifierRegex)) {
                const start = offsetToLoc(source.fileContent, match.index);
                const end = offsetToLoc(
                    source.fileContent,
                    match.index + match[0].length
                );

                changes[uriString] = changes[uriString] || [];
                changes[uriString].push(
                    TextEdit.replace(
                        Range.create(
                            start.line - 1,
                            start.column,
                            end.line - 1,
                            end.column
                        ),
                        `${match[1]}./${newName}${match[2]}${match[1]}`
                    )
                );
            }
        }
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
