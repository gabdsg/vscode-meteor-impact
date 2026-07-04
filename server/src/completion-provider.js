const { ServerBase } = require("./helpers");

class CompletionProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    // TODO -> Should we trigger only with triggerCharacter?
    onCompletionRequest({ textDocument: { uri }, position }) {
        if (this.isFileJS(uri)) {
            return this.handleJsCompletion({ uri, position });
        }

        if (this.isFileSpacebarsHTML(uri)) {
            return this.handleHtmlCompletion({ uri, position });
        }

        return;
    }

    // Regexes matching an open string literal that is the first argument of
    // a method call / subscription, e.g `Meteor.callAsync("tasks.`.
    static METHOD_CALL_REGEX =
        /Meteor\s*\.\s*(?:callAsync|call|applyAsync|apply)\s*\(\s*["'`][^"'`]*$/;
    static SUBSCRIBE_REGEX = /\.\s*subscribe\s*\(\s*["'`][^"'`]*$/;

    getMethodOrPublicationCompletions({ uri, position }) {
        const content = this.getFileContent(uri);
        const linePrefix = (content.split("\n")[position.line] || "").slice(
            0,
            position.character
        );

        const isMethodCall =
            CompletionProvider.METHOD_CALL_REGEX.test(linePrefix);
        const isSubscription =
            !isMethodCall && CompletionProvider.SUBSCRIBE_REGEX.test(linePrefix);

        if (!isMethodCall && !isSubscription) return;

        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;

        return Object.keys(isMethodCall ? methodsMap : publicationsMap).map(
            (name) => ({
                ...CompletionItem.create(name),
                kind: CompletionItemKind.Method,
                detail: isMethodCall ? "Meteor method" : "Meteor publication",
            })
        );
    }

    // An open string whose last token starts a CSS-like selector, e.g
    // `"click .js-`.
    static EVENT_SELECTOR_REGEX = /["'`][^"'`]*([.#])[\w-]*$/;
    static EVENTS_CALL_REGEX =
        /Template(?:\.(\w+)|\[["']([^"']+)["']\])\s*\.events\s*\(/g;

    getEventSelectorCompletions({ uri, position }) {
        const content = this.getFileContent(uri);
        const linePrefix = (content.split("\n")[position.line] || "").slice(
            0,
            position.character
        );

        const selectorMatch = linePrefix.match(
            CompletionProvider.EVENT_SELECTOR_REGEX
        );
        if (!selectorMatch) return;

        // Find the enclosing Template.X.events( call.
        const { positionToOffset } = require("./text-utils");
        const textBefore = content.slice(
            0,
            positionToOffset(content, position)
        );

        let templateName;
        let callEnd = -1;
        for (const match of textBefore.matchAll(
            CompletionProvider.EVENTS_CALL_REGEX
        )) {
            templateName = match[1] || match[2];
            callEnd = match.index + match[0].length;
        }
        if (!templateName || textBefore.slice(callEnd).includes("});")) return;

        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        const prefixChar = selectorMatch[1];
        const selectors =
            this.indexer.blazeIndexer.templateSelectorsMap[templateName] || {};

        return Object.keys(selectors)
            .filter((selector) => selector.startsWith(prefixChar))
            .map((selector) => ({
                ...CompletionItem.create(selector.slice(1)),
                kind: CompletionItemKind.Value,
                detail: `${
                    prefixChar === "." ? "class" : "id"
                } in template "${templateName}"`,
            }));
    }

    handleJsCompletion({ uri, position }) {
        // Completing a selector inside an event map key?
        const selectorItems = this.getEventSelectorCompletions({
            uri,
            position,
        });
        if (selectorItems) return selectorItems;

        // Completing a method/publication name string?
        const methodOrPublicationItems = this.getMethodOrPublicationCompletions(
            { uri, position }
        );
        if (methodOrPublicationItems) return methodOrPublicationItems;

        // Parse the file, since the index may be outdated already.
        const {
            AstWalker,
            parseJsSource,
            NODE_NAMES,
            NODE_TYPES,
        } = require("./ast-helpers");

        // Parse with errorRecovery because the input can be syntatically wrong.
        let astWalker;
        try {
            astWalker = new AstWalker(this.getFileContent(uri), parseJsSource, {
                extension: this.getFileExtension(uri),
                errorRecovery: true,
            });
        } catch (e) {
            // The content can be broken beyond recovery while typing.
            console.warn(`Not able to parse ${uri} for completion. ${e}`);
            return;
        }

        const { line, character } = position;
        const nodeAtPosition = astWalker.getSymbolAtPosition({
            line,
            character: character - 1,
        });
        if (!nodeAtPosition) return;

        if (
            nodeAtPosition.type !== NODE_TYPES.IDENTIFIER ||
            nodeAtPosition.name !== NODE_NAMES.TEMPLATE
        ) {
            return;
        }

        const {
            CompletionItemKind,
            CompletionItem,
        } = require("vscode-languageserver");

        return Object.keys(this.indexer.blazeIndexer.templateIndexMap).map(
            (templateName) => ({
                ...CompletionItem.create(templateName),
                textEdit: templateName,
                kind: CompletionItemKind.Class,
                detail: NODE_NAMES.TEMPLATE,
            })
        );
    }

    createTemplateNameCompletions() {
        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");
        const { NODE_NAMES } = require("./ast-helpers");

        const { templateIndexMap } = this.indexer.blazeIndexer;
        const packageTemplates =
            this.indexer.packagesIndexer?.templates || {};

        return [
            ...Object.keys(templateIndexMap).map((templateName) => ({
                ...CompletionItem.create(templateName),
                kind: CompletionItemKind.Class,
                detail: NODE_NAMES.TEMPLATE,
            })),
            ...Object.entries(packageTemplates)
                .filter(([templateName]) => !templateIndexMap[templateName])
                .map(([templateName, { packageName }]) => ({
                    ...CompletionItem.create(templateName),
                    kind: CompletionItemKind.Class,
                    detail: `Template (package ${packageName})`,
                })),
        ];
    }

    handleHtmlCompletion({ uri, position }) {
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const content = this.getFileContent(uri);
        const offset = positionToOffset(content, position);
        const textBefore = content.slice(0, offset);

        // Outside a mustache, delegate to the embedded HTML language
        // service so the regular HTML experience keeps working.
        const delegateToHtml = () =>
            require("./html-language-service").getHtmlCompletions(
                this.parseUri(uri),
                content,
                position
            );

        const mustacheStart = textBefore.lastIndexOf("{{");
        if (mustacheStart === -1) return delegateToHtml();

        const mustacheText = textBefore.slice(mustacheStart + 2);
        if (mustacheText.includes("}}")) return delegateToHtml();

        // Closing a block ({{/each}}): nothing useful to offer.
        if (mustacheText.startsWith("/")) return;

        // {{> partial: offer template names.
        if (mustacheText.startsWith(">")) {
            return this.createTemplateNameCompletions();
        }

        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        // Inside {{...}} or {{#block ...}}: offer the helpers of the
        // wrapping template, the global helpers and the variables bound by
        // wrapping {{#each x in ...}} / {{#let}} blocks.
        const templateName = getWrappingTemplateName(content, offset);
        const scopedHelpers =
            (!!templateName &&
                this.indexer.blazeIndexer.templateIndexMap[templateName]
                    ?.helpers) ||
            {};

        const { getBlockVariablesAtOffset } = require("./text-utils");

        return [
            ...getBlockVariablesAtOffset(content, offset).map(
                ({ name, blockName }) => ({
                    ...CompletionItem.create(name),
                    kind: CompletionItemKind.Variable,
                    detail: `Bound by wrapping {{#${blockName}}}`,
                })
            ),
            ...Object.keys(scopedHelpers).map((helperName) => ({
                ...CompletionItem.create(helperName),
                kind: CompletionItemKind.Function,
                detail: `Helper of template "${templateName}"`,
            })),
            ...Object.keys(this.indexer.blazeIndexer.globalHelpersMap).map(
                (helperName) => ({
                    ...CompletionItem.create(helperName),
                    kind: CompletionItemKind.Function,
                    detail: "Global helper",
                })
            ),
        ];
    }
}

module.exports = { CompletionProvider };
