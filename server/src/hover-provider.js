const { ServerBase } = require("./helpers");

class HoverProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onHoverRequest({ position, textDocument: { uri } }) {
        try {
            if (this.isFileSpacebarsHTML(uri)) {
                return this.handleHtmlHover({ uri, position });
            }

            if (this.isFileJS(uri)) {
                return this.handleJsHover({ uri, position });
            }
        } catch (e) {
            console.warn(`Hover request failed for ${uri}. ${e}`);
        }
    }

    createHover({ name, subtitle, defUri, defLine, doc }) {
        const contentLines = [`**${name}**${subtitle ? ` — ${subtitle}` : ""}`];

        if (doc) contentLines.push(doc);

        if (defUri && defLine) {
            const snippet = this.getDefinitionSnippet(defUri, defLine);
            if (snippet) {
                const language = defUri.fsPath.endsWith(".ts")
                    ? "typescript"
                    : defUri.fsPath.endsWith(".js")
                    ? "javascript"
                    : "html";
                contentLines.push(
                    `\`\`\`${language}\n${snippet}\n\`\`\``
                );
            }

            const relativePath = require("path").relative(
                this.rootUri.fsPath,
                defUri.fsPath
            );
            contentLines.push(`*${relativePath}:${defLine}*`);
        }

        return {
            contents: {
                kind: "markdown",
                value: contentLines.join("\n\n"),
            },
        };
    }

    getDefinitionSnippet(defUri, line) {
        try {
            return this.getFileContent(defUri)
                .split("\n")
                [line - 1]?.trim();
        } catch (e) {
            return;
        }
    }

    handleHtmlHover({ uri, position }) {
        const content = this.getFileContent(uri);
        const htmlWalker = this.createHtmlWalker(content);

        // Outside Blaze symbols, fall back to the embedded HTML language
        // service (tag/attribute documentation).
        const htmlHoverFallback = () =>
            require("./html-language-service").getHtmlHover(
                this.parseUri(uri),
                content,
                position
            );

        if (!htmlWalker) return htmlHoverFallback();

        const symbol = htmlWalker.getSymbolAtPosition(position);
        if (!symbol) return htmlHoverFallback();

        const { blazeIndexer } = this.indexer;

        // {{> templateName}}
        if (htmlWalker.isPartialStatement(symbol)) {
            const { node, uri: templateUri } =
                blazeIndexer.getTemplateInfo(symbol);
            if (!node || !templateUri) {
                const packageTemplate =
                    this.indexer.packagesIndexer?.templates[
                        symbol.name?.original
                    ];
                if (!packageTemplate) return;

                return this.createHover({
                    name: symbol.name?.original,
                    subtitle: `template from package \`${packageTemplate.packageName}\``,
                });
            }

            return this.createHover({
                name: symbol.name?.original,
                subtitle: "template",
                defUri: templateUri,
                defLine: node.loc.start.line,
            });
        }

        if (
            !htmlWalker.isPathExpression(symbol) &&
            !htmlWalker.isMustacheStatement(symbol)
        ) {
            return htmlHoverFallback();
        }

        const helperName = blazeIndexer.getHelperName(symbol);

        const { positionToOffset, getWrappingTemplateName } =
            require("./text-utils");
        const templateName = getWrappingTemplateName(
            content,
            positionToOffset(content, position)
        );

        const scopedHelper =
            !!templateName &&
            blazeIndexer.templateIndexMap[templateName]?.helpers?.[helperName];
        if (scopedHelper) {
            return this.createHover({
                name: helperName,
                subtitle: `helper of template \`${templateName}\``,
                defUri: scopedHelper.uri,
                defLine: scopedHelper.start.line,
                doc: scopedHelper.jsdoc,
            });
        }

        const globalHelper = blazeIndexer.getGlobalHelper(helperName);
        if (globalHelper) {
            return this.createHover({
                name: helperName,
                subtitle: "global helper",
                defUri: globalHelper.uri,
                defLine: globalHelper.start.line,
                doc: globalHelper.jsdoc,
            });
        }

        // Not a helper: data passed at the inclusion sites
        // ({{> template helperName=...}}).
        const dataParams =
            !!templateName &&
            blazeIndexer.getDataParams(templateName, helperName);
        if (dataParams?.length) {
            return this.createHover({
                name: helperName,
                subtitle: `data passed to template \`${templateName}\` (${
                    dataParams.length
                } caller${dataParams.length > 1 ? "s" : ""})`,
                defUri: dataParams[0].uri,
                defLine: dataParams[0].loc.start.line,
            });
        }

        return;
    }

    handleJsHover({ uri, position }) {
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

        const nodeKey = nodeAtPosition.value || nodeAtPosition.name;
        if (!nodeKey || typeof nodeKey !== "string") return;

        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;
        const { blazeIndexer } = this.indexer;

        const methodInfo = methodsMap[nodeKey];
        const publicationInfo = publicationsMap[nodeKey];
        if (methodInfo || publicationInfo) {
            const { node, uri: defUri } = methodInfo || publicationInfo;

            return this.createHover({
                name: nodeKey,
                subtitle: methodInfo ? "Meteor method" : "Meteor publication",
                defUri,
                defLine: node.loc.start.line,
            });
        }

        const scopedHelper = blazeIndexer.getHelperFromTemplate({
            templateUri: this.parseUri(uri),
            helper: nodeKey,
        });
        if (scopedHelper) {
            return this.createHover({
                name: nodeKey,
                subtitle: "template helper",
                defUri: scopedHelper.uri,
                defLine: scopedHelper.start.line,
                doc: scopedHelper.jsdoc,
            });
        }

        const globalHelper = blazeIndexer.getGlobalHelper(nodeKey);
        if (globalHelper) {
            return this.createHover({
                name: nodeKey,
                subtitle: "global helper",
                defUri: globalHelper.uri,
                defLine: globalHelper.start.line,
                doc: globalHelper.jsdoc,
            });
        }

        const eventLocations = blazeIndexer.getEventLocations(nodeKey);
        if (eventLocations?.length) {
            return this.createHover({
                name: nodeKey,
                subtitle: `event handler (${eventLocations.length} definition${
                    eventLocations.length > 1 ? "s" : ""
                })`,
                defUri: eventLocations[0].uri,
                defLine: eventLocations[0].node.loc.start.line,
            });
        }

        return;
    }
}

module.exports = { HoverProvider };
