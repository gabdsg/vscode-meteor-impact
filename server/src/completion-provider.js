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

    /**
     * Field-name completions inside query selectors, update modifiers and
     * projections of a resolvable collection, powered by the MongoSchema
     * repo (mongoSchemaPath setting).
     */
    getCollectionFieldCompletions({ uri, position }) {
        const { mongoSchemaIndexer } = this.indexer;
        if (!Object.keys(mongoSchemaIndexer.schemasMap).length) return;

        const { positionToOffset } = require("./text-utils");
        const { getMongoFieldContext } = require("./mongo-field-context");

        const content = this.getFileContent(uri);
        const context = getMongoFieldContext(
            content,
            positionToOffset(content, position)
        );
        if (!context) return;

        // Only complete at a key position: right after {, comma or inside
        // an open string that isn't a value.
        const linePrefix = (content.split("\n")[position.line] || "").slice(
            0,
            position.character
        );
        const atKeyPosition = /[{,(]\s*["'`]?[\w.$]*$/.test(linePrefix);
        if (!atKeyPosition) return;

        const schema = mongoSchemaIndexer.resolveCollection(
            context.collectionVarName
        );
        if (!schema) return;

        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        const { pathPrefix } = context;
        const collectionName =
            mongoSchemaIndexer.collectionVarsMap[context.collectionVarName]
                ?.collectionName || "users";
        // Inside quotes, dotted paths are valid keys; bare keys only get
        // the immediate child segment.
        const insideQuotes = !!context.openString;

        const items = [];
        for (const [dottedPath, field] of Object.entries(schema.fieldsMap)) {
            let label;
            if (!pathPrefix) {
                label = dottedPath;
            } else if (dottedPath.startsWith(`${pathPrefix}.`)) {
                label = dottedPath.slice(pathPrefix.length + 1);
            } else {
                continue;
            }
            if (!insideQuotes && label.includes(".")) continue;

            items.push({
                ...CompletionItem.create(label),
                kind: CompletionItemKind.Field,
                detail: `${
                    field.bsonTypes.join(" | ") || "field"
                } — ${collectionName}${field.required ? " (required)" : ""}`,
                sortText: `${field.required ? "0" : "1"}${label}`,
            });
        }

        return items.length ? items : undefined;
    }

    // An open string literal that is the key argument of a Session call,
    // e.g `Session.get("selected`.
    static SESSION_KEY_REGEX =
        /\bSession\s*\.\s*(?:get|set|setDefault|equals)\s*\(\s*["'`][^"'`]*$/;

    getSessionKeyCompletions({ uri, position }) {
        const content = this.getFileContent(uri);
        const linePrefix = (content.split("\n")[position.line] || "").slice(
            0,
            position.character
        );

        if (!CompletionProvider.SESSION_KEY_REGEX.test(linePrefix)) return;

        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        return Object.keys(this.indexer.sessionKeysIndexer.keysMap).map(
            (key) => ({
                ...CompletionItem.create(key),
                kind: CompletionItemKind.Value,
                detail: "Session/ReactiveDict key",
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
        // Completing a collection field name inside a Mongo query?
        const fieldItems = this.getCollectionFieldCompletions({
            uri,
            position,
        });
        if (fieldItems) return fieldItems;

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

        // Completing a Session key string?
        const sessionKeyItems = this.getSessionKeyCompletions({
            uri,
            position,
        });
        if (sessionKeyItems) return sessionKeyItems;

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

    /**
     * Class/id completions from same-directory style files when the
     * cursor sits inside an unclosed class="..." or id="..." value.
     */
    createStyleSelectorCompletions({ uri, textBefore }) {
        const attribute = textBefore.match(
            /\b(class|id)\s*=\s*(["'])(?:(?!\2).)*$/
        );
        if (!attribute) return;

        const fs = require("fs");
        const path = require("path");
        const { extractStyleSelectors } = require("./text-utils");
        const {
            CompletionItem,
            CompletionItemKind,
        } = require("vscode-languageserver");

        const directory = path.dirname(this.parseUri(uri).fsPath);
        const wantedKind = attribute[1] === "class" ? "classes" : "ids";

        const items = new Map();
        let styleFiles;
        try {
            styleFiles = fs
                .readdirSync(directory)
                .filter((name) => /\.(css|less|scss)$/i.test(name));
        } catch (e) {
            return;
        }

        for (const fileName of styleFiles) {
            let selectors;
            try {
                selectors = extractStyleSelectors(
                    this.getFileContent(
                        `file://${path.join(directory, fileName)}`
                    )
                );
            } catch (e) {
                continue;
            }

            for (const name of selectors[wantedKind]) {
                if (items.has(name)) continue;
                items.set(name, {
                    ...CompletionItem.create(name),
                    kind: CompletionItemKind.Value,
                    detail: `CSS ${
                        attribute[1] === "class" ? "class" : "id"
                    } in ${fileName}`,
                });
            }
        }

        return items.size ? [...items.values()] : undefined;
    }

    handleHtmlCompletion({ uri, position }) {
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const content = this.getFileContent(uri);
        const offset = positionToOffset(content, position);
        const textBefore = content.slice(0, offset);

        // Outside a mustache, offer style-file selectors inside class/id
        // attributes, otherwise delegate to the embedded HTML language
        // service so the regular HTML experience keeps working.
        const delegateToHtml = () =>
            this.createStyleSelectorCompletions({ uri, textBefore }) ||
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
            ...Object.keys(
                (!!templateName &&
                    this.indexer.blazeIndexer.templateDataParams[
                        templateName
                    ]) ||
                    {}
            ).map((paramName) => ({
                ...CompletionItem.create(paramName),
                kind: CompletionItemKind.Field,
                detail: `Data passed to "${templateName}" by its callers`,
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
