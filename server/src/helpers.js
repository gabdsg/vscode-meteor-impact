class ServerBase {
    static SPACEBARS_FILES_EXTENSION = {
        HTML_TEMPLATE: ".html",
        JS_TEMPLATE: ".js",
        TS_TEMPLATE: ".ts",
    };

    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        this.serverInstance = serverInstance;
        this.documentsInstance = documentsInstance;
        this.rootUri = this.parseUri(rootUri);
        this.indexer = indexer;
    }

    parseUri(uri) {
        if (!uri) {
            throw new Error("Missing URI parameter");
        }

        const { URI } = require("vscode-uri");

        return uri instanceof URI ? uri : URI.parse(uri);
    }

    getFileExtension(uri) {
        if (!uri) {
            throw new Error(`Wrong parameter URI. Received: ${uri}`);
        }

        const { Utils } = require("vscode-uri");

        return Utils.extname(this.parseUri(uri));
    }

    isFileSpacebarsHTML(uri) {
        return (
            this.getFileExtension(uri) ===
            ServerBase.SPACEBARS_FILES_EXTENSION.HTML_TEMPLATE
        );
    }

    isFileJS = (uri) => {
        return [
            ServerBase.SPACEBARS_FILES_EXTENSION.JS_TEMPLATE,
            ServerBase.SPACEBARS_FILES_EXTENSION.TS_TEMPLATE,
        ].includes(this.getFileExtension(uri));
    };

    /**
     * Given an HTML file uri, return the uri of the sibling .js or .ts file
     * (i.e the template's code-behind file), preferring the one that exists
     * on disk. Defaults to the .js path when neither exists.
     */
    getSiblingJsUri(uri) {
        const { existsSync } = require("fs");

        const htmlPath = this.parseUri(uri).fsPath;
        const candidates = [
            ServerBase.SPACEBARS_FILES_EXTENSION.JS_TEMPLATE,
            ServerBase.SPACEBARS_FILES_EXTENSION.TS_TEMPLATE,
        ].map((ext) => htmlPath.replace(/\.html$/, ext));

        return this.parseUri(
            candidates.find((path) => existsSync(path)) || candidates[0]
        );
    }

    /**
     * Fresh mustache AST for provider requests. Spacebars accepts content
     * the mustache parser rejects (stray braces after a mustache) and
     * Meteor ignores mustaches inside HTML comments, so comments are
     * blanked (offsets preserved) and parse failures return null for the
     * caller to degrade gracefully instead of failing the whole request.
     */
    createHtmlWalker(content) {
        const { AstWalker } = require("./ast-helpers");
        const { blankHtmlComments } = require("./text-utils");

        try {
            return new AstWalker(
                blankHtmlComments(content),
                require("@handlebars/parser").parse
            );
        } catch (e) {
            return null;
        }
    }

    getFileContent(_uri, range) {
        if (!this.serverInstance) {
            throw new Error("Server instance is required to get file content");
        }

        if (!this.documentsInstance) {
            throw new Error(
                "Documents instance is required to get file content"
            );
        }

        const uri = this.parseUri(_uri);

        // TextDocuments is keyed by the client's URI string; a URI object
        // always misses and we'd silently read stale disk content.
        const fromDocumentInstance = this.documentsInstance.get(
            uri.toString()
        );
        if (!!fromDocumentInstance) {
            return fromDocumentInstance.getText(range);
        }

        return require("fs").readFileSync(uri.fsPath, { encoding: "utf-8" });
    }

    getFileContentPromise(_uri) {
        if (!_uri) {
            throw new Error("_uri is required");
        }

        // Parse to get the correct fsPath that works on all OS's.
        const uri = this.parseUri(_uri);

        return require("fs/promises").readFile(uri.fsPath, {
            encoding: "utf-8",
        });
    }
}

module.exports = {
    ServerBase,
};
