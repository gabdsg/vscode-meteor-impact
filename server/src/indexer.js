const { ServerBase } = require("./helpers");
const {
    MethodsAndPublicationsIndexer,
} = require("./methods-and-publications-indexer");
const { BlazeIndexer } = require("./blaze-indexer");

class Indexer extends ServerBase {
    constructor({
        rootUri,
        serverInstance,
        documentsInstance,
        enableIndexCache = false,
        mongoSchemaPath = undefined,
    }) {
        if (!rootUri) {
            throw new Error("Expected rootUri");
        }

        super(serverInstance, documentsInstance, rootUri);

        this.loaded = false;
        this.sources = {};
        this.ignoreDirs = [];
        this.enableIndexCache = enableIndexCache;
        // fsPath -> { uri, message, range } for files that fail to parse.
        this.parsingErrors = new Map();

        this.blazeIndexer = new BlazeIndexer();
        this.methodsAndPublicationsIndexer =
            new MethodsAndPublicationsIndexer();

        const { SessionKeysIndexer } = require("./session-keys-indexer");
        this.sessionKeysIndexer = new SessionKeysIndexer();

        const { ClassMethodsIndexer } = require("./class-methods-indexer");
        this.classMethodsIndexer = new ClassMethodsIndexer();

        const { MongoSchemaIndexer } = require("./mongo-schema-indexer");
        this.mongoSchemaIndexer = new MongoSchemaIndexer();
        this.mongoSchemaPath = mongoSchemaPath;

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
                        // Anywhere in the tree, not just the root: apps can
                        // have nested installs (e.g. playwright/node_modules).
                        "**/node_modules/**",
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

            this.sessionKeysIndexer.indexCall({ node, uri });
            this.classMethodsIndexer.indexClass({ node, uri });
            this.mongoSchemaIndexer.indexCollectionDeclarations({ node, uri });

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

    /**
     * Parse a file into the index representation. Returns null for HTML
     * files that are not Blaze templates at all (full pages like email
     * templates or build reports) - those are skipped, not errors.
     */
    parseFile({ uri, fileContent }) {
        const { AstWalker, parseJsSource } = require("./ast-helpers");
        const { SpacebarsCompiler } = require("@blastjs/spacebars-compiler");
        const { parse: handlebarsParser } = require("@handlebars/parser");
        const { blankHtmlComments, blankStrayBraces } =
            require("./text-utils");

        const extension = this.getFileExtension(uri);
        const isFileHtml = this.isFileSpacebarsHTML(uri);

        if (!isFileHtml) {
            return {
                extension,
                astWalker: new AstWalker(fileContent, parseJsSource, {
                    extension,
                }),
                uri,
                htmlJs: false,
                fileContent,
            };
        }

        let htmlJs;
        try {
            htmlJs = SpacebarsCompiler.parse(fileContent);
        } catch (e) {
            // A file without a single <template> tag is not a Blaze file
            // (doctype pages, generated reports): skip it quietly. Real
            // template files with syntax errors still surface as errors.
            if (!/<template[\s>]/i.test(fileContent)) return null;
            throw e;
        }

        // Spacebars is more lenient than the mustache parser (it ignores
        // mustaches inside HTML comments - blanked below - and tolerates
        // things like stray braces after a mustache). When only the
        // mustache parse fails, Meteor still builds the file, so degrade
        // to htmlJs-only indexing instead of reporting an error.
        let astWalker;
        try {
            astWalker = new AstWalker(
                blankStrayBraces(blankHtmlComments(fileContent)),
                handlebarsParser,
                {}
            );
        } catch (e) {
            astWalker = new AstWalker();
        }

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

        // Not a Blaze file (parseFile skipped it): drop any previous index
        // entries for it and stop.
        if (!fileInfo) {
            [
                this.blazeIndexer,
                this.methodsAndPublicationsIndexer,
                this.sessionKeysIndexer,
                this.classMethodsIndexer,
                this.mongoSchemaIndexer,
            ].forEach((i) => i?.removeUri?.(uri.fsPath));
            delete this.sources[uri.fsPath];
            return false;
        }

        [
            this.blazeIndexer,
            this.methodsAndPublicationsIndexer,
            this.sessionKeysIndexer,
            this.classMethodsIndexer,
        ].forEach((i) => i?.removeUri?.(uri.fsPath));

        try {
            this.indexFileInfo(fileInfo);
            if (!this.isFileSpacebarsHTML(uri)) {
                this.indexJsFileUsages(fileInfo);
            }
        } catch (e) {
            console.warn(`Incremental index failed for ${uri.fsPath}. ${e}`);
            this.recordParsingError(uri, e, fileContent);
            return false;
        }

        this.sources[uri.fsPath] = fileInfo;
        this.cachedFiles?.add(uri.fsPath);
        if (
            this.projectUris &&
            !this.projectUris.some(({ fsPath }) => fsPath === uri.fsPath)
        ) {
            this.projectUris.push(uri);
        }
        this.scheduleCacheSave();

        return true;
    }

    async loadSources(globs = ["**/**{.js,.ts,.html}"]) {
        const uris = await this.findUris(globs);
        this.projectUris = uris;

        // Read-only symbols provided by installed packages.
        await this.packagesIndexer.load(this.rootUri);

        // External MongoDB schemas for collection field IntelliSense.
        await this.mongoSchemaIndexer.loadSchemas(
            this.resolveMongoSchemaPath()
        );

        // Warm start: restore the maps when nothing changed on disk. HTML
        // sources hydrate eagerly (diagnostics/overview walk them); JS/TS
        // hydrate lazily on first provider access.
        if (this.enableIndexCache) {
            const { loadIndexCache } = require("./index-cache");
            this.restoredFromCache = await loadIndexCache(this, uris);

            if (this.restoredFromCache) {
                this.sources = {};
                this.cachedFiles = new Set(uris.map(({ fsPath }) => fsPath));
                this.loaded = true;

                uris.filter((uri) => this.isFileSpacebarsHTML(uri)).forEach(
                    (uri) => this.hydrateFile(uri)
                );

                console.info("* Index restored from cache.");
                return { hasErrors: false, errors: [] };
            }
        }

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

        // One broken file must never take the whole server down: indexing
        // failures are recorded per file and everything else proceeds.
        const indexSafely = (fileInfo, work) => {
            try {
                work(fileInfo);
            } catch (e) {
                console.error(`Error indexing ${fileInfo.uri}. ${e}`);
                this.recordParsingError(
                    fileInfo.uri,
                    e,
                    fileInfo.fileContent
                );
                parsingErrors.push({ uri: fileInfo.uri, error: e });
            }
        };

        // ...but index sequentially in sorted-uri order, so that
        // last-write-wins entries don't depend on I/O completion order.
        validResults.forEach((fileInfo) =>
            indexSafely(fileInfo, (info) => this.indexFileInfo(info))
        );

        // Second pass, once every definition is known.
        validResults.forEach((fileInfo) => {
            if (fileInfo.extension === ".html") return;

            indexSafely(fileInfo, (info) => this.indexJsFileUsages(info));
        });

        this.sources = validResults.reduce(
            (acc, fileInfo) => ({
                ...acc,
                [fileInfo.uri.fsPath]: fileInfo,
            }),
            {}
        );
        this.cachedFiles = new Set(Object.keys(this.sources));
        this.loaded = true;

        if (this.enableIndexCache) {
            const { saveIndexCache } = require("./index-cache");
            await saveIndexCache(this, uris);
        }

        return {
            hasErrors: Array.isArray(parsingErrors) && !!parsingErrors.length,
            errors: parsingErrors,
        };
    }

    /**
     * Parse a file on demand (used after a cache restore, where sources
     * are lazy). Files unknown to the cache also get indexed.
     */
    hydrateFile(uriLike) {
        const uri = this.parseUri(uriLike);

        try {
            const fileContent = require("fs").readFileSync(uri.fsPath, {
                encoding: "utf-8",
            });
            const fileInfo = this.parseFile({ uri, fileContent });
            if (!fileInfo) return undefined;

            if (!this.cachedFiles?.has(uri.fsPath)) {
                this.indexFileInfo(fileInfo);
                if (!this.isFileSpacebarsHTML(uri)) {
                    this.indexJsFileUsages(fileInfo);
                }
                this.cachedFiles?.add(uri.fsPath);
            }

            this.sources[uri.fsPath] = fileInfo;
            return fileInfo;
        } catch (e) {
            console.warn(`Hydration failed for ${uri.fsPath}. ${e}`);
            return undefined;
        }
    }

    // Debounced cache refresh after incremental changes.
    scheduleCacheSave() {
        if (!this.enableIndexCache || !this.projectUris) return;

        clearTimeout(this.cacheSaveTimeout);
        this.cacheSaveTimeout = setTimeout(() => {
            const { saveIndexCache } = require("./index-cache");
            saveIndexCache(this, this.projectUris);
        }, 5000);
        this.cacheSaveTimeout.unref?.();
    }

    getSources() {
        if (!this.loaded) {
            throw new Error("Indexer was not loaded");
        }

        return this.sources;
    }

    getFileInfo(uri) {
        const parsed = this.parseUri(uri);
        return this.getSources()[parsed.fsPath] || this.hydrateFile(parsed);
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

    // The configured MongoSchema repo path, resolved against the workspace
    // root (absolute paths pass through). Undefined when not configured.
    resolveMongoSchemaPath() {
        if (!this.mongoSchemaPath) return undefined;

        const path = require("path");
        return path.isAbsolute(this.mongoSchemaPath)
            ? this.mongoSchemaPath
            : path.join(this.rootUri.fsPath, this.mongoSchemaPath);
    }

    async onDidChangeConfiguration({
        settings: {
            conf: {
                settingsEditor: {
                    meteorImpact: { ignoreDirsOnIndexing, mongoSchemaPath } = {},
                } = {},
            } = {},
        } = {},
    }) {
        this.mongoSchemaPath = mongoSchemaPath || undefined;
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
        this.serverInstance?.sendNotification?.("meteorImpact/indexing", {
            busy: true,
        });

        try {
            [
                this.blazeIndexer,
                this.methodsAndPublicationsIndexer,
                this.sessionKeysIndexer,
                this.classMethodsIndexer,
                this.mongoSchemaIndexer,
            ].forEach((i) => i?.reset?.());
            // Parse errors surface as in-file diagnostics after the reindex.
            await this.loadSources();
            console.info("* Indexing completed.");
        } finally {
            this.serverInstance?.sendNotification?.("meteorImpact/indexing", {
                busy: false,
                templates: Object.keys(this.blazeIndexer.templateIndexMap)
                    .length,
                methods: Object.keys(
                    this.methodsAndPublicationsIndexer.methodsMap
                ).length,
                publications: Object.keys(
                    this.methodsAndPublicationsIndexer.publicationsMap
                ).length,
            });
        }
    }
}

module.exports = { Indexer };
