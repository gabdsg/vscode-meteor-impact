/**
 * Indexer focused on Blaze elements: helpers, events and template
 * definitions.
 */
class BlazeIndexer {
    constructor() {
        this.templateIndexMap = {};
        this.htmlUsageMap = {};
        // Global helpers registered with Template.registerHelper("name", fn).
        this.globalHelpersMap = {};
        // Event key -> every location where a handler is defined for it.
        this.eventsMap = {};
        // Template name -> every Template.X / Template["x"] JS reference.
        this.templateJsReferences = {};
        // Template name -> selector (".class" / "#id") -> locations of the
        // class/id tokens in the template HTML.
        this.templateSelectorsMap = {};
        // Template name -> argument name -> the inclusion sites passing it
        // ({{> item title="hello"}}): inside "item", {{title}} is data.
        this.templateDataParams = {};
    }

    /**
     * Index the class/id attribute tokens of every template in an HTML
     * file, keyed as CSS-like selectors, to connect event maps with the
     * elements they target.
     */
    indexTemplateSelectors({ uri, fileContent }) {
        const {
            offsetToLoc,
            getWrappingTemplateName,
        } = require("./text-utils");

        const ATTRIBUTE_REGEX = /\b(class|id)=["']([^"']*)["']/g;

        for (const match of fileContent.matchAll(ATTRIBUTE_REGEX)) {
            const templateName = getWrappingTemplateName(
                fileContent,
                match.index
            );
            if (!templateName) continue;

            const prefix = match[1] === "class" ? "." : "#";
            const valueStart = match.index + match[1].length + 2;

            for (const token of match[2].matchAll(/[\w-]+/g)) {
                const selector = `${prefix}${token[0]}`;
                const startOffset = valueStart + token.index;
                const endOffset = startOffset + token[0].length;
                const entryKey = `${uri.fsPath}${startOffset}`;

                this.templateSelectorsMap[templateName] =
                    this.templateSelectorsMap[templateName] || {};
                const entries = (this.templateSelectorsMap[templateName][
                    selector
                ] = this.templateSelectorsMap[templateName][selector] || []);

                if (entries.some(({ entryKey: e }) => e === entryKey)) {
                    continue;
                }

                entries.push({
                    start: offsetToLoc(fileContent, startOffset),
                    end: offsetToLoc(fileContent, endOffset),
                    uri,
                    entryKey,
                });
            }
        }
    }

    addHelpersToMap({
        templateName,
        helperName,
        value,
        uri,
        kind,
        key,
        signature,
        jsdoc,
    }) {
        this.templateIndexMap[templateName] =
            this.templateIndexMap[templateName] || {};

        // Set JS uri too - we need to do that to be able to infer the template from a given helper
        // and file uri. It's used in getHelperFromTemplate() from this class.
        this.templateIndexMap[templateName].jsUri =
            this.templateIndexMap[templateName].jsUri || uri;

        this.templateIndexMap[templateName][kind] =
            this.templateIndexMap[templateName][kind] || {};

        const { NODE_TYPES } = require("./ast-helpers");

        // Keep the uri around so that providers can point to the correct
        // file (.js or .ts) where the helper is defined. The key location
        // (property name only, as opposed to the whole property) is used by
        // rename.
        this.templateIndexMap[templateName][kind][helperName] = {
            start: value.start,
            end: value.end,
            uri,
            keyLoc: key?.loc,
            keyIsLiteral: key?.type === NODE_TYPES.LITERAL,
            signature,
            jsdoc,
        };
    }

    addUsage({ node, uri, key, map = this.htmlUsageMap }) {
        // Not every mustache has a resolvable name: {{this}}, {{.}},
        // literals ({{true}}) and sub-expression params ({{#if (eq a b)}})
        // all come through with no head/original. Those are valid Spacebars
        // with nothing to index - skip them instead of failing the file.
        if (!node?.loc?.start || !node.loc.end || !uri) return;
        if (typeof key !== "string" || !key.length) return;

        const {
            loc: {
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn },
            },
        } = node;
        const entryKey = `${uri.fsPath}${startLine}${startColumn}${endLine}${endColumn}`;

        if (!Array.isArray(map[key])) {
            map[key] = [{ node, uri, entryKey }];
            return;
        }

        // Entry already exists, no need to add again.
        if (
            map[key].some(
                ({ entryKey: existingEntryKey }) =>
                    existingEntryKey === entryKey
            )
        ) {
            return;
        }

        return map[key].push({ node, uri, entryKey });
    }

    /**
     * Arguments of a mustache/block/sub-expression call are references
     * too: {{#unless or isPersonalMessage}} passes the isPersonalMessage
     * helper to "or". Index every PathExpression param and hash value as
     * a usage so argument-only helpers resolve and are not reported as
     * unused. @data variables ({{helper @index}}) are never helpers.
     */
    indexCallArguments({ node, uri }) {
        const { NODE_TYPES } = require("./ast-helpers");

        const args = [
            ...(Array.isArray(node.params) ? node.params : []),
            ...(node.hash?.pairs || []).map(({ value }) => value),
        ];

        for (const arg of args) {
            if (arg?.type !== NODE_TYPES.PATH_EXPRESSION || arg.data) {
                continue;
            }

            this.addUsage({ node: arg, uri, key: arg.head });
        }
    }

    indexGlobalHelpers({ node, uri, fileContent }) {
        const {
            NODE_TYPES,
            NODE_NAMES,
            extractFunctionSignature,
            extractJsDoc,
        } = require("./ast-helpers");
        const { TEMPLATE_CALLERS } = require("./constants");

        const callee = node.callee;
        if (
            callee.object?.type !== NODE_TYPES.IDENTIFIER ||
            callee.object.name !== NODE_NAMES.TEMPLATE ||
            callee.property.name !== TEMPLATE_CALLERS.REGISTER_HELPER
        )
            return;

        const [helperNameArgument, helperFunction] = node.arguments || [];
        if (
            helperNameArgument?.type !== NODE_TYPES.LITERAL ||
            typeof helperNameArgument.value !== "string"
        )
            return;

        const { start, end } = helperNameArgument.loc;
        this.globalHelpersMap[helperNameArgument.value] = {
            node: helperNameArgument,
            start,
            end,
            uri,
            signature: extractFunctionSignature(helperFunction, fileContent),
            jsdoc: extractJsDoc(fileContent, node.start),
        };
    }

    /**
     * Record the arguments passed at an inclusion site: after
     * {{> item title="hello"}}, {{title}} inside "item" resolves from the
     * caller's data context, not from a helper.
     */
    indexDataParams({ node, uri }) {
        const templateName = node.name?.original;
        const pairs = node.hash?.pairs;
        if (
            typeof templateName !== "string" ||
            !templateName ||
            templateName in Object.prototype ||
            !Array.isArray(pairs)
        ) {
            return;
        }

        const params = (this.templateDataParams[templateName] =
            this.templateDataParams[templateName] || {});

        for (const pair of pairs) {
            const key = pair?.key;
            if (
                typeof key !== "string" ||
                !key ||
                key in Object.prototype ||
                !pair.loc
            ) {
                continue;
            }

            const { start } = pair.loc;
            const entryKey = `${uri.fsPath}${start.line}${start.column}`;
            const entries = (params[key] = params[key] || []);
            if (entries.some(({ entryKey: e }) => e === entryKey)) continue;

            entries.push({ loc: pair.loc, uri, entryKey });
        }
    }

    /**
     * Track every Template.X / Template["x-y"] member access in JS/TS, so
     * that renaming a template can update its JS references too.
     */
    indexTemplateJsReferences({ node, uri }) {
        const { NODE_TYPES, NODE_NAMES } = require("./ast-helpers");

        if (
            !node ||
            node.type !== NODE_TYPES.MEMBER_EXPRESSION ||
            node.object?.type !== NODE_TYPES.IDENTIFIER ||
            node.object.name !== NODE_NAMES.TEMPLATE
        ) {
            return;
        }

        const templateName = this.getTemplateNameFromProperty(node.property);
        if (!templateName) return;

        // Template.hasOwnProperty(t) and friends are method calls, not
        // template references: the inherited function is truthy, so the
        // `|| []` guard below kept it and `.some` crashed indexing.
        // ponytail: a template literally named "toString" loses JS-rename
        // support; switch the map to Object.create(null) if that ever matters.
        if (templateName in Object.prototype) return;

        const { loc } = node.property;
        const entryKey = `${uri.fsPath}${loc.start.line}${loc.start.column}`;

        this.templateJsReferences[templateName] =
            this.templateJsReferences[templateName] || [];
        if (
            this.templateJsReferences[templateName].some(
                ({ entryKey: existing }) => existing === entryKey
            )
        ) {
            return;
        }

        this.templateJsReferences[templateName].push({
            loc,
            isLiteral: node.property.type === NODE_TYPES.LITERAL,
            uri,
            entryKey,
        });
    }

    indexHelpers({ node, uri, fileContent }) {
        const { NODE_TYPES, extractFunctionSignature, extractJsDoc } =
            require("./ast-helpers");

        if (!node || node.type !== NODE_TYPES.CALL_EXPRESSION) {
            return;
        }

        const { TEMPLATE_CALLERS } = require("./constants");

        const callee = node.callee;
        if (!callee || callee.type !== NODE_TYPES.MEMBER_EXPRESSION) return;

        this.indexGlobalHelpers({ node, uri, fileContent });

        // Helpers and events maps have the same shape and are indexed alike.
        const caller = callee.property.name;
        if (
            ![TEMPLATE_CALLERS.HELPERS, TEMPLATE_CALLERS.EVENTS].includes(
                caller
            )
        )
            return;

        const templateName = this.getTemplateNameFromProperty(
            callee.object.property
        );
        if (!templateName) return;

        const { arguments: nodeArguments } = node;
        if (!Array.isArray(nodeArguments) || !nodeArguments.length) return;

        for (const arg of nodeArguments) {
            const { properties } = arg;
            if (!properties || !properties.length) return;

            for (const prop of properties) {
                if (prop.type !== NODE_TYPES.PROPERTY) return;

                const { key, loc } = prop;
                // Keys can be identifiers ({ helper() {} }) or string
                // literals ({ "my-helper": () => {} }, { "click .btn": fn }).
                const helperName = key.name || key.value;
                if (!helperName) continue;

                this.addHelpersToMap({
                    templateName,
                    helperName,
                    value: loc,
                    uri,
                    kind: caller,
                    key,
                    signature: extractFunctionSignature(
                        prop.value,
                        fileContent
                    ),
                    jsdoc: extractJsDoc(fileContent, prop.start),
                });

                if (caller === TEMPLATE_CALLERS.EVENTS) {
                    // Track every location defining a handler for this event
                    // key, so that find-references works across event maps.
                    this.addUsage({
                        node: key,
                        uri,
                        key: helperName,
                        map: this.eventsMap,
                    });
                }
            }
        }
    }

    indexHelpersUsageAndTemplates({ uri, node }) {
        if (!node || !uri) return;

        const { NODE_TYPES } = require("./ast-helpers");

        const { type, params, original, path, name } = node;
        if (
            type === NODE_TYPES.MUSTACHE_STATEMENT ||
            type === NODE_TYPES.SUB_EXPRESSION
        ) {
            this.indexCallArguments({ node, uri });
            return this.addUsage({
                node: path,
                uri,
                key: path.head,
            });
        }

        // Index template tags usage {{> templateName}}
        if (type === NODE_TYPES.PARTIAL_STATEMENT && name) {
            this.indexDataParams({ node, uri });
            return this.addUsage({ node: name, uri, key: name.original });
        }

        if (type === NODE_TYPES.BLOCK_STATEMENT) {
            this.indexCallArguments({ node, uri });

            if (!Array.isArray(params) || !params.length) return;
            return this.addUsage({
                node: params[0],
                uri,
                key: params[0].original,
            });
        }

        // Index <template name="templateName"> tags.
        if (
            type !== NODE_TYPES.CONTENT_STATEMENT ||
            typeof original !== "string"
        ) {
            return;
        }

        const regex = /template\s+name=["']([^"']+)["']/g;

        // A single content chunk can contain multiple <template> tags, so
        // walk all the matches and compute the precise location of each tag
        // instead of pointing at the whole chunk.
        for (const match of original.matchAll(regex)) {
            const templateName = match[1];
            const loc = {
                start: this.getPositionInContent(node, match.index),
                end: this.getPositionInContent(
                    node,
                    match.index + match[0].length
                ),
            };

            // Merge with any existing entry so that helpers already indexed
            // from the code-behind file are not clobbered.
            this.templateIndexMap[templateName] = {
                ...this.templateIndexMap[templateName],
                node: { ...node, loc },
                uri,
            };
        }
    }

    /**
     * Translate an offset inside a ContentStatement raw string into an
     * absolute line/column position, based on the node location.
     */
    getPositionInContent({ original, loc }, offset) {
        const consumedLines = original.slice(0, offset).split("\n");
        const lineOffset = consumedLines.length - 1;

        return {
            line: loc.start.line + lineOffset,
            column:
                lineOffset === 0
                    ? loc.start.column + offset
                    : consumedLines[lineOffset].length,
        };
    }

    /**
     * Extract the template name from the property of a Template.X or
     * Template["x-y"] (computed string literal) member expression.
     */
    getTemplateNameFromProperty(property) {
        const { NODE_TYPES } = require("./ast-helpers");

        if (!property) return;

        if (property.type === NODE_TYPES.IDENTIFIER) return property.name;

        if (
            property.type === NODE_TYPES.LITERAL &&
            typeof property.value === "string"
        ) {
            return property.value;
        }
    }

    getHelperName(helper) {
        const _name =
            (typeof helper === "string" && helper) ||
            helper.parts?.[0] ||
            helper.path?.parts?.[0] ||
            helper.path?.original ||
            helper.original;

        if (!_name) {
            throw new Error(
                `Expected to receive helperName, but got ${helper}`
            );
        }

        return _name;
    }

    getGlobalHelper(helper) {
        return this.globalHelpersMap[this.getHelperName(helper)];
    }

    /**
     * Inclusion-site entries passing `name` as data to `templateName`
     * ({{> templateName name=...}}), or undefined. Array.isArray keeps
     * Object.prototype names from resolving.
     */
    getDataParams(templateName, name) {
        const entries =
            this.templateDataParams[templateName]?.[this.getHelperName(name)];
        return Array.isArray(entries) ? entries : undefined;
    }

    getEventLocations(eventKey) {
        return this.eventsMap[eventKey];
    }

    getHelperFromTemplate({ templateName, helper, templateUri }) {
        const _name = this.getHelperName(helper);

        let indexMap = this.templateIndexMap[templateName];
        if (!indexMap && !!templateUri) {
            const fromTemplate = Object.keys(this.templateIndexMap).find(
                (k) => {
                    if (!Object.hasOwnProperty.call(this.templateIndexMap, k)) {
                        return;
                    }

                    const jsUri = this.templateIndexMap[k].jsUri;

                    return jsUri && jsUri.path === templateUri.path;
                }
            );

            indexMap = !!fromTemplate && this.templateIndexMap[fromTemplate];
        }

        // Templates without a code-behind file have no helpers indexed.
        if (!indexMap || !Object.keys(indexMap.helpers || {}).length) return;

        return indexMap.helpers[_name];
    }

    getTemplateInfo(templateName) {
        const _name =
            (typeof templateName === "string" && templateName) ||
            templateName.parts?.[0] ||
            templateName.name?.original ||
            templateName.object?.property?.name ||
            templateName.name;

        if (!_name) {
            throw new Error(
                `Expected to received templateName, but got: ${_name}`
            );
        }

        return this.templateIndexMap[_name] || {};
    }

    /**
     * Drop every entry that was indexed from the given file, so the file
     * can be reindexed incrementally.
     */
    removeUri(fsPath) {
        const matches = (uri) => uri?.fsPath === fsPath;

        for (const [templateName, template] of Object.entries(
            this.templateIndexMap
        )) {
            if (matches(template.uri)) {
                delete template.node;
                delete template.uri;
            }

            for (const kind of ["helpers", "events"]) {
                for (const [name, entry] of Object.entries(
                    template[kind] || {}
                )) {
                    if (matches(entry.uri)) delete template[kind][name];
                }

                if (template[kind] && !Object.keys(template[kind]).length) {
                    delete template[kind];
                }
            }

            if (matches(template.jsUri)) {
                delete template.jsUri;

                // Keep the inference working when helpers of this template
                // remain indexed from another file.
                const remainingHelper = Object.values(
                    template.helpers || {}
                )[0];
                if (remainingHelper) template.jsUri = remainingHelper.uri;
            }

            if (!Object.keys(template).length) {
                delete this.templateIndexMap[templateName];
            }
        }

        for (const map of [this.htmlUsageMap, this.eventsMap]) {
            for (const [key, entries] of Object.entries(map)) {
                const remaining = entries.filter(({ uri }) => !matches(uri));

                if (!remaining.length) {
                    delete map[key];
                } else if (remaining.length !== entries.length) {
                    map[key] = remaining;
                }
            }
        }

        for (const [name, helper] of Object.entries(this.globalHelpersMap)) {
            if (matches(helper.uri)) delete this.globalHelpersMap[name];
        }

        for (const [name, entries] of Object.entries(
            this.templateJsReferences
        )) {
            const remaining = entries.filter(({ uri }) => !matches(uri));

            if (!remaining.length) {
                delete this.templateJsReferences[name];
            } else if (remaining.length !== entries.length) {
                this.templateJsReferences[name] = remaining;
            }
        }

        for (const [templateName, selectors] of Object.entries(
            this.templateSelectorsMap
        )) {
            for (const [selector, entries] of Object.entries(selectors)) {
                const remaining = entries.filter(({ uri }) => !matches(uri));

                if (!remaining.length) {
                    delete selectors[selector];
                } else if (remaining.length !== entries.length) {
                    selectors[selector] = remaining;
                }
            }

            if (!Object.keys(selectors).length) {
                delete this.templateSelectorsMap[templateName];
            }
        }

        for (const [templateName, params] of Object.entries(
            this.templateDataParams
        )) {
            for (const [param, entries] of Object.entries(params)) {
                const remaining = entries.filter(({ uri }) => !matches(uri));

                if (!remaining.length) {
                    delete params[param];
                } else if (remaining.length !== entries.length) {
                    params[param] = remaining;
                }
            }

            if (!Object.keys(params).length) {
                delete this.templateDataParams[templateName];
            }
        }
    }

    reset() {
        this.templateIndexMap = {};
        this.htmlUsageMap = {};
        this.globalHelpersMap = {};
        this.eventsMap = {};
        this.templateJsReferences = {};
        this.templateSelectorsMap = {};
        this.templateDataParams = {};
    }
}

module.exports = { BlazeIndexer };
