const { ServerBase } = require("./helpers");

/**
 * Whole-file HTML features for Spacebars files, delegated to the embedded
 * HTML language service: folding ranges and formatting.
 */
class HtmlFeaturesProvider extends ServerBase {
    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onFoldingRangesRequest({ textDocument: { uri } }) {
        try {
            if (!this.isFileSpacebarsHTML(uri)) return;

            return require("./html-language-service").getHtmlFoldingRanges(
                this.parseUri(uri),
                this.getFileContent(uri)
            );
        } catch (e) {
            console.warn(`Folding ranges failed for ${uri}. ${e}`);
        }
    }

    onDocumentFormattingRequest({ textDocument: { uri }, options, range }) {
        try {
            if (!this.isFileSpacebarsHTML(uri)) return;

            return require("./html-language-service").getHtmlFormattingEdits(
                this.parseUri(uri),
                this.getFileContent(uri),
                options,
                range
            );
        } catch (e) {
            console.warn(`Formatting failed for ${uri}. ${e}`);
        }
    }
}

module.exports = { HtmlFeaturesProvider };
