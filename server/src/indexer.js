const { ServerBase } = require("./helpers");
const {
    MethodsAndPublicationsIndexer,
} = require("./methods-and-publications-indexer");
const { BlazeIndexer } = require("./blaze-indexer");

class Indexer extends ServerBase {
    constructor({ rootUri, serverInstance, documentsInstance }) {
        if (!rootUri) {
            throw new Error("Expected rootUri");
        }

        super(serverInstance, documentsInstance, rootUri);

        this.loaded = false;
        this.sources = {};
        this.ignoreDirs = [];
        // fsPath -> { uri, message, range } for files that fail to parse.
        this.parsingErrors = new Map();

        this.blazeIndexer = new BlazeIndexer();
        this.methodsAndPublicationsIndexer =
            new MethodsAndPublicationsIndexer();

        const { PackagesIndexer } = require("./packages-indexer");
        this.packagesIndexer = new PackagesIndexer();
    }

    async findUris(patterns) {
        const glob = require("glob");
        const { promisify } = require("util");

        const directoriesToBeIgnored = this.ignoreDirs.map(({ fsPath }) => {
            const finishesWithSlash = fsPath[fsPath.length - 1] === "/";
            const startsWithSlash = fsPath[0] === "/";

            let finalGlob = `${fsPath}${finishesWithSlash ? "" : "/"}**`;
            // If starts with "/", we remove it so that the Glob works correctly for the cwd specified.
            if (startsWithSlash) {
                finalGlob = finalGlob.slice(1);
            }

            return finalGlob;
        });

        const globPromise = promisify(glob);
        const uriArrays = await Promise.all(
            patterns.map((_p) =>
                globPromise(_p, {
                    cwd: this.rootUri.fsPath,
                    ignore: [
                        "tests/**",
                        "**/**.tests.js",
                        "**/**.tests.ts",
                        "node_modules/**",
                        // Build output and package metadata are not app
                        // sources (packages are indexed separately).
                        ".meteor/**",
                        ...directoriesToBeIgnored,
                    ],
                    absolute: true,
                })
            )
        );

        // Flatten them all
        const uris = uriArrays.flatMap((paths) => paths);
        return [...new Set(uris).values()].sort().map(this.parseUri);
    }

    indexHtmlFile({ uri, astWalker, fileContent }) {
        if (!astWalker || !uri) {
            throw new Error(
                `Expected to receive uri and astWalker, but got: ${uri} and ${astWalker}`
            );
        }

        astWalker.walkUntil((node) => {
            this.blazeIndexer.indexHelpersUsageAndTemplates({
                uri,
                node,
            });
        });

        if (fileContent) {
            this.blazeIndexer.indexTemplateSelectors({ uri, fileContent });
        }
    }

    indexJsFile({ uri, astWalker, fileContent }) {
        if (!astWalker || !uri) {
            throw new Error(
                `Expected to receive uri and astWalker, but got: ${uri} and ${astWalker}`
            );
        }

        astWalker.walkUntil((node) => {
            this.methodsAndPublicationsIndexer.indexDefinitions({
                uri,
                node,
                fileContent,
            });

            this.blazeIndexer.indexHelpers({ node, uri, fileContent });
            this.blazeIndexer.indexTemplateJsReferences({ node, uri });
        });
    }

    /**
     * Usages can only be matched against known definitions, so this pass
     * must run after every file had its definitions indexed - otherwise
     * usages in files that sort before their definition are lost.
     */
    indexJsFileUsages({ uri, astWalker }) {
        let previousNode;
        astWalker.walkUntil((node) => {
            this.methodsAndPublicationsIndexer.indexUsage({
                uri,
                node,
                previousNode,
            });
            previousNode = node;
        });
    }

    /**
     * Normalize a parser exception into a positioned entry so it can be
     * shown as an in-file diagnostic instead of a notification.
     */
    recordParsingError(uri, error, fileContent) {
        // babel: error.loc; handlebars: error.lineNumber/column; fallback:
        // "line N" in the message.
        const line =
            error?.loc?.line ??
            error?.lineNumber ??
            Number(`${error?.message}`.match(/line (\d+)/i)?.[1]) ??
            1;
        const safeLine = Number.isFinite(line) && line > 0 ? line : 1;
        const column = error?.loc?.column ?? 0;

        const lineText = fileContent?.split("\n")[safeLine - 1] ?? "";
        const message = `${error?.message || error}`.split("\n")[0];

        this.parsingErrors.set(uri.fsPath, {
            uri,
            message,
            range: {
                startLine: safeLine,
                startColumn: column,
                endLine: safeLine,
                endColumn: Math.max(lineText.length, column + 1),
            },
        });
    }

    parseFile({ uri, fileContent }) {
        const { AstWalker, parseJsSource } = require("./ast-helpers");
        const { SpacebarsCompiler } = require("@blastjs/spacebars-compiler");
        const { parse: handlebarsParser } = require("@handlebars/parser");

        const extension = this.getFileExtension(uri);
        const isFileHtml = this.isFileSpacebarsHTML(uri);

        const astWalker = new AstWalker(
            fileContent,
            isFileHtml ? handlebarsParser : parseJsSource,
            isFileHtml ? {} : { extension }
        );

        // Also index the htmlJs representation.
        const htmlJs = isFileHtml && SpacebarsCompiler.parse(fileContent);

        return {
            extension,
            astWalker,
            uri,
            htmlJs,
            fileContent,
        };
    }

    indexFileInfo(fileInfo) {
        const { uri, astWalker, fileContent } = fileInfo;

        if (this.isFileSpacebarsHTML(uri)) {
            this.indexHtmlFile({ uri, astWalker, fileContent });
        } else {
            this.indexJsFile({ uri, astWalker, fileContent });
        }
    }

    /**
     * Reindex a single file without re-globbing/re-parsing the rest of the
     * project. Uses the open buffer content when available, so the index
     * follows unsaved edits. Returns false when the file can't be parsed,
     * in which case the previous index for it is kept.
     */
    reindexFile(uriLike) {
        const uri = this.parseUri(uriLike);
        const extension = this.getFileExtension(uri);
        if (![".js", ".ts", ".html"].includes(extension)) return false;

        // Parse before dropping anything, so a file that is broken beyond
        // error recovery keeps its previous (stale but usable) index.
        let fileInfo;
        let fileContent;
        try {
            fileContent = this.getFileContent(uri);
            fileInfo = this.parseFile({ uri, fileContent });
        } catch (e) {
            console.warn(
                `Incremental reindex skipped for ${uri.fsPath}. ${e}`
            );
            this.recordParsingError(uri, e, fileContent);
            return false;
        }

        this.parsingErrors.delete(uri.fsPath);

        [this.blazeIndexer, this.methodsAndPublicationsIndexer].forEach((i) =>
            i?.removeUri?.(uri.fsPath)
        );

        this.indexFileInfo(fileInfo);
        if (!this.isFileSpacebarsHTML(uri)) {
            this.indexJsFileUsages(fileInfo);
        }

        this.sources[uri.fsPath] = fileInfo;

        return true;
    }

    async loadSources(globs = ["**/**{.js,.ts,.html}"]) {
        const uris = await this.findUris(globs);

        // Read-only symbols provided by installed packages.
        await this.packagesIndexer.load(this.rootUri);

        const parsingErrors = [];
        this.parsingErrors = new Map();
        // Read and parse concurrently...
        const results = await Promise.all(
            uris.map(async (uri) => {
                let fileContent;
                try {
                    fileContent = await this.getFileContentPromise(uri);
                    return this.parseFile({ uri, fileContent });
                } catch (e) {
                    console.error(`Error parsing ${uri}. ${e}`);
                    this.recordParsingError(uri, e, fileContent);
                    parsingErrors.push({ uri, error: e });
                    return;
                }
            })
        );

        const validResults = results.filter(Boolean);

        // ...but index sequentially in sorted-uri order, so that
        // last-write-wins entries don't depend on I/O completion order.
        validResults.forEach((fileInfo) => this.indexFileInfo(fileInfo));

        // Second pass, once every definition is known.
        validResults.forEach((fileInfo) => {
            if (fileInfo.extension === ".html") return;

            this.indexJsFileUsages(fileInfo);
        });

        this.sources = validResults.reduce(
            (acc, fileInfo) => ({
                ...acc,
                [fileInfo.uri.fsPath]: fileInfo,
            }),
            {}
        );
        this.loaded = true;

        return {
            hasErrors: Array.isArray(parsingErrors) && !!parsingErrors.length,
            errors: parsingErrors,
        };
    }

    getSources() {
        if (!this.loaded) {
            throw new Error("Indexer was not loaded");
        }

        return this.sources;
    }

    getFileInfo(uri) {
        return this.getSources()[this.parseUri(uri).fsPath];
    }

    getSourcesOfType(fileExtension) {
        if (![".html", ".js", ".ts"].includes(fileExtension)) {
            throw new Error(
                `Invalid extension requested. Received: ${fileExtension}`
            );
        }

        return Object.values(this.getSources()).filter(
            ({ extension }) => extension === fileExtension
        );
    }

    async onDidChangeConfiguration({
        settings: {
            conf: {
                settingsEditor: {
                    meteorImpact: { ignoreDirsOnIndexing } = {},
                } = {},
            } = {},
        } = {},
    }) {
        if (!ignoreDirsOnIndexing) {
            console.warn("No directories set to be ignored, nothing to do...");
            this.ignoreDirs = [];
        } else {
            const parsedDirs = ignoreDirsOnIndexing.split(",");
            if (!parsedDirs.length) {
                throw new Error(
                    "Error parsing directories to ignore on indexing."
                );
            }

            this.ignoreDirs = parsedDirs.map(this.parseUri);
        }

        await this.reindex();
    }

    async reindex() {
        console.info(`* Indexing project: ${this.rootUri}`);
        [this.blazeIndexer, this.methodsAndPublicationsIndexer].forEach((i) =>
            i?.reset?.()
        );
        // Parse errors surface as in-file diagnostics after the reindex.
        await this.loadSources();
        console.info("* Indexing completed.");
    }
}

module.exports = { Indexer };
