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

        this.blazeIndexer = new BlazeIndexer();
        this.methodsAndPublicationsIndexer =
            new MethodsAndPublicationsIndexer();
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

    indexHtmlFile({ uri, astWalker }) {
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
    }

    indexJsFile({ uri, astWalker }) {
        if (!astWalker || !uri) {
            throw new Error(
                `Expected to receive uri and astWalker, but got: ${uri} and ${astWalker}`
            );
        }

        astWalker.walkUntil((node) => {
            this.methodsAndPublicationsIndexer.indexDefinitions({ uri, node });

            this.blazeIndexer.indexHelpers({ node, uri });
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
        const { uri, astWalker } = fileInfo;

        if (this.isFileSpacebarsHTML(uri)) {
            this.indexHtmlFile({ uri, astWalker });
        } else {
            this.indexJsFile({ uri, astWalker });
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
        try {
            fileInfo = this.parseFile({
                uri,
                fileContent: this.getFileContent(uri),
            });
        } catch (e) {
            console.warn(
                `Incremental reindex skipped for ${uri.fsPath}. ${e}`
            );
            return false;
        }

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

        const parsingErrors = [];
        const results = await Promise.all(
            uris.map(async (uri) => {
                try {
                    const fileInfo = this.parseFile({
                        uri,
                        fileContent: await this.getFileContentPromise(uri),
                    });

                    this.indexFileInfo(fileInfo);
                    return fileInfo;
                } catch (e) {
                    console.error(`Error parsing ${uri}. ${e}`);
                    parsingErrors.push({ uri, error: e });
                    return;
                }
            })
        );

        const validResults = results.filter(Boolean);

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
                    meteorToolbox: { ignoreDirsOnIndexing } = {},
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
        const { hasErrors, errors } = await this.loadSources();
        if (!hasErrors) {
            console.info("* Indexing completed.");
            return;
        }

        this.serverInstance.sendNotification(
            "errors/parsing",
            errors.map(({ uri }) => uri.fsPath).join(", \n")
        );
    }
}

module.exports = { Indexer };
