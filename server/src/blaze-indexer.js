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
    }

    addHelpersToMap({ templateName, helperName, value, uri, kind }) {
        this.templateIndexMap[templateName] =
            this.templateIndexMap[templateName] || {};

        // Set JS uri too - we need to do that to be able to infer the template from a given helper
        // and file uri. It's used in getHelperFromTemplate() from this class.
        this.templateIndexMap[templateName].jsUri =
            this.templateIndexMap[templateName].jsUri || uri;

        this.templateIndexMap[templateName][kind] =
            this.templateIndexMap[templateName][kind] || {};

        // Keep the uri around so that providers can point to the correct
        // file (.js or .ts) where the helper is defined.
        this.templateIndexMap[templateName][kind][helperName] = {
            start: value.start,
            end: value.end,
            uri,
        };
    }

    addUsage({ node, uri, key, map = this.htmlUsageMap }) {
        if (!node || !uri || !key) {
            throw new Error(
                `Expected to receive node, uri and key, but got: ${node}, ${uri} and ${key}.`
            );
        }

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

    indexGlobalHelpers({ node, uri }) {
        const { NODE_TYPES, NODE_NAMES } = require("./ast-helpers");
        const { TEMPLATE_CALLERS } = require("./constants");

        const callee = node.callee;
        if (
            callee.object?.type !== NODE_TYPES.IDENTIFIER ||
            callee.object.name !== NODE_NAMES.TEMPLATE ||
            callee.property.name !== TEMPLATE_CALLERS.REGISTER_HELPER
        )
            return;

        const [helperNameArgument] = node.arguments || [];
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
        };
    }

    indexHelpers({ node, uri }) {
        const { NODE_TYPES } = require("./ast-helpers");

        if (!node || node.type !== NODE_TYPES.CALL_EXPRESSION) {
            return;
        }

        const { TEMPLATE_CALLERS } = require("./constants");

        const callee = node.callee;
        if (!callee || callee.type !== NODE_TYPES.MEMBER_EXPRESSION) return;

        this.indexGlobalHelpers({ node, uri });

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
        if (type === NODE_TYPES.MUSTACHE_STATEMENT) {
            return this.addUsage({
                node: path,
                uri,
                key: path.head,
            });
        }

        // Index template tags usage {{> templateName}}
        if (type === NODE_TYPES.PARTIAL_STATEMENT && name) {
            return this.addUsage({ node: name, uri, key: name.original });
        }

        if (
            type === NODE_TYPES.BLOCK_STATEMENT &&
            Array.isArray(params) &&
            !!params.length
        ) {
            const firstParam = params[0];
            return this.addUsage({
                node: firstParam,
                uri,
                key: firstParam.original,
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
    }

    reset() {
        this.templateIndexMap = {};
        this.htmlUsageMap = {};
        this.globalHelpersMap = {};
        this.eventsMap = {};
    }
}

module.exports = { BlazeIndexer };
