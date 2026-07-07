const { ServerBase } = require("./helpers");

// Partials that are provided by core/packages and never appear in the index.
const KNOWN_EXTERNAL_PARTIALS = ["yield", "Template.dynamic", "UI.dynamic"];

/**
 * Computes and publishes project diagnostics after each reindex:
 * - Unresolved {{> partials}} (warning).
 * - Mustaches called with arguments (so they must be helpers) that don't
 *   match a template-scoped or global helper (warning).
 * - Duplicate template names (warning).
 * - Helpers that are never used in any template (hint, marked unnecessary).
 */
class DiagnosticsProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);

        this.lastPublishedUris = new Set();
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

    addDiagnostic(diagnosticsByUri, uri, diagnostic) {
        const key = uri.toString();
        if (!diagnosticsByUri.has(key)) diagnosticsByUri.set(key, []);

        diagnosticsByUri.get(key).push({
            source: "meteor-impact",
            ...diagnostic,
        });
    }

    computeDiagnostics() {
        const diagnosticsByUri = new Map();

        const htmlSources = Object.values(this.indexer.getSources()).filter(
            ({ extension }) => extension === ".html"
        );

        const templateTagsByFile = htmlSources.map((source) => ({
            source,
            tags: require("./text-utils")
                .getTemplateTags(source.fileContent)
                .filter(({ isClosing }) => !isClosing),
        }));

        this.checkParseErrors(diagnosticsByUri);
        this.checkUnresolvedSymbols(diagnosticsByUri, htmlSources);
        this.checkDuplicateTemplates(diagnosticsByUri, templateTagsByFile);
        this.checkUnusedHelpers(diagnosticsByUri);
        this.checkMethodAndPublicationCalls(diagnosticsByUri);
        this.checkUnusedMethodsAndPublications(diagnosticsByUri);
        this.checkSessionKeys(diagnosticsByUri);
        this.checkCollectionFieldNames(diagnosticsByUri);

        return diagnosticsByUri;
    }

    /**
     * Field names in query selectors / update modifiers / projections /
     * insert docs that the collection's MongoDB schema doesn't declare.
     * Warning when the schema explicitly closes the wrapping object
     * (additionalProperties: false), Hint otherwise - open subtrees hold
     * legitimate dynamic fields. Anything not confidently classified is
     * skipped: false negatives over false positives.
     */
    checkCollectionFieldNames(diagnosticsByUri) {
        const { mongoSchemaIndexer } = this.indexer;
        if (!Object.keys(mongoSchemaIndexer.schemasMap).length) return;

        const { NODE_TYPES } = require("./ast-helpers");
        const { DiagnosticSeverity } = require("vscode-languageserver");

        const SELECTOR_METHODS = ["find", "findOne", "count", "remove"];
        const UPDATE_METHODS = ["update", "upsert"];
        const INSERT_METHODS = ["insert"];

        const jsSources = Object.values(this.indexer.getSources()).filter(
            ({ extension }) => extension !== ".html"
        );

        for (const { astWalker, uri } of jsSources) {
            astWalker.walkUntil((node) => {
                if (node?.type !== NODE_TYPES.CALL_EXPRESSION) return;

                const callee = node.callee;
                if (
                    callee?.type !== NODE_TYPES.MEMBER_EXPRESSION ||
                    callee.object?.type !== NODE_TYPES.IDENTIFIER
                ) {
                    return;
                }

                const baseMethod = `${callee.property?.name || ""}`.replace(
                    /Async$/,
                    ""
                );
                const schema = mongoSchemaIndexer.resolveCollection(
                    callee.object.name
                );
                if (!schema) return;

                const collectionName =
                    mongoSchemaIndexer.collectionVarsMap[callee.object.name]
                        ?.collectionName;
                const [firstArg, secondArg] = node.arguments || [];
                const report = ({ keyNode, dottedPath }) => {
                    const field = mongoSchemaIndexer.lookupField(
                        schema,
                        dottedPath
                    );
                    if (field) return;
                    if (!mongoSchemaIndexer.isPathFlaggable(schema, dottedPath))
                        return;

                    this.addDiagnostic(diagnosticsByUri, uri, {
                        severity: mongoSchemaIndexer.isUnderClosedObject(
                            schema,
                            dottedPath
                        )
                            ? DiagnosticSeverity.Warning
                            : DiagnosticSeverity.Hint,
                        range: this.createRange(keyNode.loc),
                        message: `Field "${dottedPath}" is not defined in the MongoDB schema for collection "${collectionName}".`,
                        data: {
                            kind: "unknown-collection-field",
                            collectionName,
                            fieldPath: dottedPath,
                        },
                    });
                };

                if (
                    [...SELECTOR_METHODS, ...UPDATE_METHODS].includes(
                        baseMethod
                    )
                ) {
                    this.validateFieldObject({
                        objectNode: firstArg,
                        prefix: "",
                        mode: "selector",
                        report,
                    });
                }
                if (INSERT_METHODS.includes(baseMethod)) {
                    this.validateFieldObject({
                        objectNode: firstArg,
                        prefix: "",
                        mode: "doc",
                        report,
                    });
                }
                if (UPDATE_METHODS.includes(baseMethod)) {
                    this.validateUpdateModifier({ node: secondArg, report });
                }
                if (["find", "findOne"].includes(baseMethod)) {
                    this.validateProjection({ node: secondArg, report });
                }
            });
        }
    }

    // Selector / insert-doc walker. Static keys only; computed keys,
    // spreads and template literals are invisible on purpose.
    validateFieldObject({ objectNode, prefix, mode, report }) {
        const { NODE_TYPES } = require("./ast-helpers");
        if (objectNode?.type !== NODE_TYPES.OBJECT_EXPRESSION) return;

        for (const property of objectNode.properties || []) {
            if (property.type !== NODE_TYPES.PROPERTY || property.computed) {
                continue;
            }

            const keyNode = property.key;
            const key =
                keyNode?.type === NODE_TYPES.IDENTIFIER
                    ? keyNode.name
                    : keyNode?.type === NODE_TYPES.LITERAL &&
                      typeof keyNode.value === "string"
                    ? keyNode.value
                    : undefined;
            if (!key) continue;

            if (key.startsWith("$")) {
                // $or/$and/$nor: arrays of selectors at the same prefix.
                if (
                    ["$or", "$and", "$nor"].includes(key) &&
                    property.value?.type === "ArrayExpression"
                ) {
                    for (const element of property.value.elements || []) {
                        this.validateFieldObject({
                            objectNode: element,
                            prefix,
                            mode,
                            report,
                        });
                    }
                }
                // $elemMatch: selector scoped to the wrapping field.
                if (key === "$elemMatch") {
                    this.validateFieldObject({
                        objectNode: property.value,
                        prefix,
                        mode,
                        report,
                    });
                }
                // Other operators ($in, $gt, $exists...): values, not
                // field names.
                continue;
            }

            const dottedPath = prefix ? `${prefix}.${key}` : key;
            report({ keyNode, dottedPath });

            if (property.value?.type !== NODE_TYPES.OBJECT_EXPRESSION) {
                continue;
            }
            // Insert documents nest plain objects; selectors nest operator
            // objects ({ contacts: { $elemMatch: {...} } }). Both extend
            // the dotted prefix.
            this.validateFieldObject({
                objectNode: property.value,
                prefix: dottedPath,
                mode,
                report,
            });
        }
    }

    validateUpdateModifier({ node, report }) {
        const { NODE_TYPES } = require("./ast-helpers");
        const {
            FIELD_MODIFIER_OPERATORS,
        } = require("./mongo-field-context");

        if (node?.type !== NODE_TYPES.OBJECT_EXPRESSION) return;

        for (const property of node.properties || []) {
            if (property.type !== NODE_TYPES.PROPERTY || property.computed) {
                continue;
            }

            const operator =
                property.key?.name ??
                (typeof property.key?.value === "string"
                    ? property.key.value
                    : undefined);
            if (!FIELD_MODIFIER_OPERATORS.includes(operator)) continue;

            // Keys under $set-style operators are full dotted paths.
            this.validateFieldObject({
                objectNode: property.value,
                prefix: "",
                mode: "doc",
                report,
            });
        }
    }

    validateProjection({ node, report }) {
        const { NODE_TYPES } = require("./ast-helpers");
        if (node?.type !== NODE_TYPES.OBJECT_EXPRESSION) return;

        for (const property of node.properties || []) {
            const key =
                property.key?.name ??
                (typeof property.key?.value === "string"
                    ? property.key.value
                    : undefined);
            if (!["fields", "projection"].includes(key)) continue;

            this.validateFieldObject({
                objectNode: property.value,
                prefix: "",
                mode: "doc",
                report,
            });
        }
    }

    /**
     * Session/ReactiveDict keys that are read but never set (likely a
     * typo) or set but never read (dead state). Hints, not warnings: keys
     * can be written by packages or through dynamic (non-literal) keys the
     * indexer can't see.
     */
    checkSessionKeys(diagnosticsByUri) {
        const {
            DiagnosticSeverity,
            DiagnosticTag,
        } = require("vscode-languageserver");

        for (const [key, { sets, gets }] of Object.entries(
            this.indexer.sessionKeysIndexer.keysMap
        )) {
            if (gets.length && !sets.length) {
                for (const { node, uri } of gets) {
                    this.addDiagnostic(diagnosticsByUri, uri, {
                        severity: DiagnosticSeverity.Hint,
                        range: this.createRange(node.loc),
                        message: `Session key "${key}" is read but never set in this project.`,
                    });
                }
            }

            if (sets.length && !gets.length) {
                for (const { node, uri } of sets) {
                    this.addDiagnostic(diagnosticsByUri, uri, {
                        severity: DiagnosticSeverity.Hint,
                        tags: [DiagnosticTag.Unnecessary],
                        range: this.createRange(node.loc),
                        message: `Session key "${key}" is set but never read in this project.`,
                    });
                }
            }
        }
    }

    // Files the indexer couldn't parse: a real error squiggle at the spot,
    // instead of the old "errors/parsing" popup.
    checkParseErrors(diagnosticsByUri) {
        const { DiagnosticSeverity, Range } = require("vscode-languageserver");

        for (const entry of this.indexer.parsingErrors?.values() || []) {
            const { startLine, startColumn, endLine, endColumn } = entry.range;

            this.addDiagnostic(diagnosticsByUri, entry.uri, {
                severity: DiagnosticSeverity.Error,
                range: Range.create(
                    startLine - 1,
                    startColumn,
                    endLine - 1,
                    endColumn
                ),
                message: `Parse error: ${entry.message}`,
            });
        }
    }

    /**
     * Meteor.call/callAsync/apply/applyAsync and .subscribe calls whose
     * name literal matches no indexed method/publication. Package-provided
     * names can't be seen, so these are warnings, never errors.
     */
    checkMethodAndPublicationCalls(diagnosticsByUri) {
        const { NODE_TYPES } = require("./ast-helpers");
        const { DiagnosticSeverity } = require("vscode-languageserver");

        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;

        const METHOD_CALLERS = ["call", "callAsync", "apply", "applyAsync"];
        // Limit .subscribe receivers to the Meteor-looking ones, so event
        // emitter/observable subscribe calls aren't flagged.
        const isSubscribeReceiver = (object) =>
            object?.type === "ThisExpression" ||
            (object?.type === NODE_TYPES.IDENTIFIER &&
                (object.name === "Meteor" ||
                    /instance|template/i.test(object.name)));

        const jsSources = Object.values(this.indexer.getSources()).filter(
            ({ extension }) => extension !== ".html"
        );

        for (const { astWalker, uri } of jsSources) {
            astWalker.walkUntil((node) => {
                if (node?.type !== NODE_TYPES.CALL_EXPRESSION) return;

                const callee = node.callee;
                if (callee?.type !== NODE_TYPES.MEMBER_EXPRESSION) return;

                const propertyName = callee.property?.name;
                const isMethodCall =
                    METHOD_CALLERS.includes(propertyName) &&
                    callee.object?.type === NODE_TYPES.IDENTIFIER &&
                    callee.object.name === "Meteor";
                const isSubscription =
                    propertyName === "subscribe" &&
                    isSubscribeReceiver(callee.object);
                if (!isMethodCall && !isSubscription) return;

                const [nameArgument] = node.arguments || [];
                if (
                    nameArgument?.type !== NODE_TYPES.LITERAL ||
                    typeof nameArgument.value !== "string"
                ) {
                    return;
                }

                const map = isMethodCall ? methodsMap : publicationsMap;
                if (map[nameArgument.value]) return;

                this.addDiagnostic(diagnosticsByUri, uri, {
                    severity: DiagnosticSeverity.Warning,
                    range: this.createRange(nameArgument.loc),
                    message: `${
                        isMethodCall ? "Method" : "Publication"
                    } "${nameArgument.value}" is not defined in this project (it may be provided by a package).`,
                    data: {
                        kind: isMethodCall
                            ? "create-method"
                            : "create-publication",
                        name: nameArgument.value,
                    },
                });
            });
        }
    }

    checkUnusedMethodsAndPublications(diagnosticsByUri) {
        const {
            DiagnosticSeverity,
            DiagnosticTag,
        } = require("vscode-languageserver");

        const { methodsMap, publicationsMap, usageMap } =
            this.indexer.methodsAndPublicationsIndexer;

        for (const [map, label, usage] of [
            [methodsMap, "Method", "called"],
            [publicationsMap, "Publication", "subscribed to"],
        ]) {
            for (const [name, { node, uri }] of Object.entries(map)) {
                if (usageMap[name] || !uri) continue;

                this.addDiagnostic(diagnosticsByUri, uri, {
                    severity: DiagnosticSeverity.Hint,
                    tags: [DiagnosticTag.Unnecessary],
                    range: this.createRange(node.loc),
                    message: `${label} "${name}" is never ${usage} in this project.`,
                });
            }
        }
    }

    checkUnresolvedSymbols(diagnosticsByUri, htmlSources) {
        const { NODE_TYPES } = require("./ast-helpers");
        const { DiagnosticSeverity } = require("vscode-languageserver");
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const { templateIndexMap, globalHelpersMap } =
            this.indexer.blazeIndexer;

        for (const { astWalker, uri, fileContent } of htmlSources) {
            astWalker.walkUntil((node) => {
                if (!node) return;

                // {{> partialName}} pointing to an unknown template.
                if (node.type === NODE_TYPES.PARTIAL_STATEMENT) {
                    const partialName = node.name?.original;
                    if (
                        !partialName ||
                        node.name?.parts?.length > 1 ||
                        KNOWN_EXTERNAL_PARTIALS.includes(partialName) ||
                        templateIndexMap[partialName] ||
                        this.indexer.packagesIndexer?.templates[partialName]
                    ) {
                        return;
                    }

                    return this.addDiagnostic(diagnosticsByUri, uri, {
                        severity: DiagnosticSeverity.Warning,
                        range: this.createRange(node.name.loc),
                        message: `Template "${partialName}" is not defined in this project (it may be provided by a package).`,
                        data: {
                            kind: "create-template",
                            templateName: partialName,
                        },
                    });
                }

                // A mustache with arguments must be a helper call: it can't
                // be resolved from the data context, so we can check it.
                if (
                    node.type !== NODE_TYPES.MUSTACHE_STATEMENT ||
                    !node.params?.length
                ) {
                    return;
                }

                const path = node.path;
                if (
                    path?.type !== NODE_TYPES.PATH_EXPRESSION ||
                    path.parts?.length !== 1
                ) {
                    return;
                }

                const helperName = path.parts[0];
                if (!helperName || path.original.startsWith("@")) return;

                const pathOffset = positionToOffset(fileContent, {
                    line: path.loc.start.line - 1,
                    character: path.loc.start.column,
                });

                const wrappingTemplateName = getWrappingTemplateName(
                    fileContent,
                    pathOffset
                );

                const { getBlockVariablesAtOffset } = require("./text-utils");
                const isBlockVariable = getBlockVariablesAtOffset(
                    fileContent,
                    pathOffset
                ).some(({ name }) => name === helperName);

                const isResolvable =
                    isBlockVariable ||
                    (!!wrappingTemplateName &&
                        (!!templateIndexMap[wrappingTemplateName]?.helpers?.[
                            helperName
                        ] ||
                            // Data passed at inclusion sites:
                            // {{> template helperName=...}}.
                            !!this.indexer.blazeIndexer.getDataParams(
                                wrappingTemplateName,
                                helperName
                            ))) ||
                    !!globalHelpersMap[helperName] ||
                    !!this.indexer.packagesIndexer?.globalHelpers[helperName];
                if (isResolvable) return;

                this.addDiagnostic(diagnosticsByUri, uri, {
                    severity: DiagnosticSeverity.Warning,
                    range: this.createRange(path.loc),
                    message: wrappingTemplateName
                        ? `Helper "${helperName}" is not defined on template "${wrappingTemplateName}" or globally.`
                        : `Helper "${helperName}" is not defined globally.`,
                    data: wrappingTemplateName
                        ? {
                              kind: "create-helper",
                              helperName,
                              templateName: wrappingTemplateName,
                          }
                        : undefined,
                });
            });
        }
    }

    checkDuplicateTemplates(diagnosticsByUri, templateTagsByFile) {
        const { DiagnosticSeverity } = require("vscode-languageserver");
        const { offsetToLoc } = require("./text-utils");

        const occurrences = {};
        for (const { source, tags } of templateTagsByFile) {
            for (const tag of tags) {
                occurrences[tag.name] = occurrences[tag.name] || [];
                occurrences[tag.name].push({ source, tag });
            }
        }

        for (const [templateName, definitions] of Object.entries(
            occurrences
        )) {
            if (definitions.length < 2) continue;

            for (const { source, tag } of definitions) {
                this.addDiagnostic(diagnosticsByUri, source.uri, {
                    severity: DiagnosticSeverity.Warning,
                    range: this.createRange({
                        start: offsetToLoc(source.fileContent, tag.start),
                        end: offsetToLoc(source.fileContent, tag.end),
                    }),
                    message: `Template "${templateName}" is defined ${definitions.length} times.`,
                });
            }
        }
    }

    checkUnusedHelpers(diagnosticsByUri) {
        const {
            DiagnosticSeverity,
            DiagnosticTag,
        } = require("vscode-languageserver");

        const { templateIndexMap, globalHelpersMap, htmlUsageMap } =
            this.indexer.blazeIndexer;

        const unusedHelperDiagnostic = (helper, message, data) => ({
            severity: DiagnosticSeverity.Hint,
            tags: [DiagnosticTag.Unnecessary],
            range: this.createRange(helper),
            message,
            data,
        });

        for (const [templateName, template] of Object.entries(
            templateIndexMap
        )) {
            for (const [helperName, helper] of Object.entries(
                template.helpers || {}
            )) {
                if (htmlUsageMap[helperName] || !helper.uri) continue;

                this.addDiagnostic(
                    diagnosticsByUri,
                    helper.uri,
                    unusedHelperDiagnostic(
                        helper,
                        `Helper "${helperName}" of template "${templateName}" is never used in any template.`,
                        { kind: "remove-helper", helperName, templateName }
                    )
                );
            }
        }

        for (const [helperName, helper] of Object.entries(globalHelpersMap)) {
            if (htmlUsageMap[helperName] || !helper.uri) continue;

            this.addDiagnostic(
                diagnosticsByUri,
                helper.uri,
                unusedHelperDiagnostic(
                    helper,
                    `Global helper "${helperName}" is never used in any template.`
                )
            );
        }
    }

    publish() {
        try {
            const diagnosticsByUri = this.computeDiagnostics();

            // Clear diagnostics of files that no longer have any.
            for (const uri of this.lastPublishedUris) {
                if (diagnosticsByUri.has(uri)) continue;

                this.serverInstance.sendDiagnostics({ uri, diagnostics: [] });
            }

            for (const [uri, diagnostics] of diagnosticsByUri.entries()) {
                this.serverInstance.sendDiagnostics({ uri, diagnostics });
            }

            this.lastPublishedUris = new Set(diagnosticsByUri.keys());
        } catch (e) {
            console.error(`Failed to publish diagnostics. ${e}`);
        }
    }
}

module.exports = { DiagnosticsProvider };
