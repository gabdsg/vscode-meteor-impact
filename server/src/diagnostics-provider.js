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

        return diagnosticsByUri;
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
                        !!templateIndexMap[wrappingTemplateName]?.helpers?.[
                            helperName
                        ]) ||
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
