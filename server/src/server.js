const {
    createConnection,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments,
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const { DefinitionProvider } = require("./definition-provider");
const { CompletionProvider } = require("./completion-provider");
const { ReferencesProvider } = require("./references-provider");
const { HoverProvider } = require("./hover-provider");
const { SymbolsProvider } = require("./symbols-provider");
const { DiagnosticsProvider } = require("./diagnostics-provider");
const { HtmlFeaturesProvider } = require("./html-features-provider");
const { RenameProvider } = require("./rename-provider");
const { CodeActionsProvider } = require("./code-actions-provider");
const { SemanticTokensProvider } = require("./semantic-tokens-provider");
const { SignatureHelpProvider } = require("./signature-help-provider");
const { OverviewProvider } = require("./overview-provider");
const { InlayHintsProvider } = require("./inlay-hints-provider");
const { Indexer } = require("./indexer");

class ServerInstance {
    constructor() {
        // Create a connection for the server, using Node's IPC as a transport.
        // Also include all preview / proposed LSP features.
        this.connection = createConnection(ProposedFeatures.all);
        this.documents = new TextDocuments(TextDocument);

        this.connection.onInitialize(async (params) => {
            // Stale-build confusion is real: say who we are first.
            console.info(
                `* Meteor Impact language server ${
                    require("../../package.json").version
                }`
            );

            this.rootUri =
                params.rootUri ||
                (params.rootPath && `file://${params.rootPath}`);

            if (!this.rootUri) {
                console.error("Not able to found rootUri");
                return;
            }

            this.indexer = new Indexer({
                rootUri: this.rootUri,
                serverInstance: this.connection,
                documentsInstance: this.documents,
                enableIndexCache: true,
            });

            this.diagnosticsProvider = new DiagnosticsProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );

            // Create the "index"
            await this.indexer.reindex();
            this.diagnosticsProvider.publish();

            this.definitionProvider = new DefinitionProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.completionProvider = new CompletionProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.referencesProvider = new ReferencesProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.hoverProvider = new HoverProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.symbolsProvider = new SymbolsProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.htmlFeaturesProvider = new HtmlFeaturesProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.renameProvider = new RenameProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.codeActionsProvider = new CodeActionsProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.semanticTokensProvider = new SemanticTokensProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.signatureHelpProvider = new SignatureHelpProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.overviewProvider = new OverviewProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );
            this.inlayHintsProvider = new InlayHintsProvider(
                this.connection,
                this.documents,
                this.rootUri,
                this.indexer
            );

            return {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Incremental,
                    definitionProvider: true,
                    referencesProvider: true,
                    hoverProvider: true,
                    documentSymbolProvider: true,
                    workspaceSymbolProvider: true,
                    foldingRangeProvider: true,
                    linkedEditingRangeProvider: true,
                    renameProvider: { prepareProvider: true },
                    codeActionProvider: {
                        codeActionKinds: ["quickfix", "refactor.extract"],
                    },
                    semanticTokensProvider: {
                        legend: SemanticTokensProvider.legend,
                        full: true,
                        range: false,
                    },
                    documentFormattingProvider: true,
                    documentRangeFormattingProvider: true,
                    completionProvider: {
                        resolveProvider: "true",
                        triggerCharacters: ["."],
                    },
                    signatureHelpProvider: {
                        triggerCharacters: [" ", "(", ","],
                    },
                    inlayHintProvider: true,
                },
            };
        });

        // Created/deleted/renamed files change the project shape: full
        // reindex. Content edits only reindex the changed file.
        this.connection.onDidChangeWatchedFiles(() =>
            this.scheduleReindexing()
        );
        this.documents.onDidChangeContent(({ document }) =>
            this.scheduleFileReindexing(document.uri)
        );

        this.connection.onDefinition((...params) =>
            this.definitionProvider.onDefinitionRequest(...params)
        );
        this.connection.onCompletion((...params) =>
            this.completionProvider.onCompletionRequest(...params)
        );
        this.connection.onReferences((...params) =>
            this.referencesProvider.onReferenceRequest(...params)
        );
        this.connection.onHover((...params) =>
            this.hoverProvider.onHoverRequest(...params)
        );
        this.connection.onDocumentSymbol((...params) =>
            this.symbolsProvider.onDocumentSymbolRequest(...params)
        );
        this.connection.onWorkspaceSymbol((...params) =>
            this.symbolsProvider.onWorkspaceSymbolRequest(...params)
        );
        this.connection.onFoldingRanges((...params) =>
            this.htmlFeaturesProvider.onFoldingRangesRequest(...params)
        );
        this.connection.languages.onLinkedEditingRange((...params) =>
            this.htmlFeaturesProvider.onLinkedEditingRangeRequest(...params)
        );
        this.connection.onCodeAction((...params) =>
            this.codeActionsProvider.onCodeActionRequest(...params)
        );
        // Custom request from the client's extract-template command, sent
        // after the user picked a name.
        this.connection.onRequest("meteorImpact/extractTemplate", (params) =>
            this.codeActionsProvider.executeExtractTemplate(params)
        );
        // Symbol/import edits for the client's template folder rename.
        this.connection.onRequest(
            "meteorImpact/renameTemplateFiles",
            (params) =>
                this.renameProvider.executeTemplateFolderRename(params)
        );
        // Index summary for the Meteor Explorer views.
        this.connection.onRequest("meteorImpact/appOverview", () =>
            this.overviewProvider.onAppOverviewRequest()
        );
        this.connection.languages.inlayHint.on((...params) =>
            this.inlayHintsProvider.onInlayHintsRequest(...params)
        );
        this.connection.languages.semanticTokens.on((...params) =>
            this.semanticTokensProvider.onSemanticTokensRequest(...params)
        );
        this.connection.onSignatureHelp((...params) =>
            this.signatureHelpProvider.onSignatureHelpRequest(...params)
        );
        this.connection.onPrepareRename((...params) =>
            this.renameProvider.onPrepareRenameRequest(...params)
        );
        this.connection.onDocumentFormatting((...params) =>
            this.htmlFeaturesProvider.onDocumentFormattingRequest(...params)
        );
        this.connection.onDocumentRangeFormatting((...params) =>
            this.htmlFeaturesProvider.onDocumentFormattingRequest(...params)
        );
        this.connection.onRenameRequest((...params) =>
            this.renameProvider.onRenameRequest(...params)
        );
        this.connection.onDidChangeConfiguration((...params) =>
            this.indexer.onDidChangeConfiguration(...params)
        );
        // TODO -> implement completion resolver?.
        this.connection.onCompletionResolve(() => {});

        this.documents.listen(this.connection);

        this.connection.listen();
    }

    scheduleFileReindexing(uri) {
        // Before the initial index there is nothing to update incrementally.
        if (!this.indexer?.loaded) return;

        this.fileReindexingTimeouts = this.fileReindexingTimeouts || new Map();

        const existingTimeout = this.fileReindexingTimeouts.get(uri);
        if (existingTimeout) clearTimeout(existingTimeout);

        const timeoutMs = 300;
        this.fileReindexingTimeouts.set(
            uri,
            setTimeout(() => {
                this.fileReindexingTimeouts.delete(uri);

                try {
                    this.indexer.reindexFile(uri);
                    // Publish either way: a failed parse just produced a
                    // parse-error diagnostic.
                    this.diagnosticsProvider?.publish();
                } catch (err) {
                    console.error(
                        `Failed to reindex ${uri}: ${err.message}. Falling back to full reindex.`
                    );
                    this.scheduleReindexing();
                }
            }, timeoutMs)
        );
    }

    scheduleReindexing() {
        if (this.reindexingTimeout) {
            clearTimeout(this.reindexingTimeout);
        }

        const timeoutMs = 3000;
        this.connection.console.info(
            `Scheduling reindexing in ${timeoutMs} ms`
        );

        this.reindexingTimeout = setTimeout(() => {
            this.indexer
                .reindex()
                .then(() => this.diagnosticsProvider?.publish())
                .catch((err) =>
                    console.error(`Failed to reindex: ${err.message}`)
                );
        }, timeoutMs);
    }
}

new ServerInstance();
