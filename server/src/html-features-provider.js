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

            const content = this.getFileContent(uri);

            const htmlRanges = require("./html-language-service")
                .getHtmlFoldingRanges(this.parseUri(uri), content);

            // {{#block}}...{{/block}} regions fold too; the closing tag
            // stays visible, like HTML tags.
            const { getBlockRanges, offsetToLoc } = require("./text-utils");
            const blockRanges = getBlockRanges(content)
                .map(({ startOffset, endOffset }) => ({
                    startLine: offsetToLoc(content, startOffset).line - 1,
                    endLine: offsetToLoc(content, endOffset).line - 2,
                }))
                .filter(({ startLine, endLine }) => endLine > startLine);

            return [...(htmlRanges || []), ...blockRanges];
        } catch (e) {
            console.warn(`Folding ranges failed for ${uri}. ${e}`);
        }
    }

    onLinkedEditingRangeRequest({ textDocument: { uri }, position }) {
        try {
            if (!this.isFileSpacebarsHTML(uri)) return null;

            const ranges = require("./html-language-service")
                .getHtmlLinkedEditingRanges(
                    this.parseUri(uri),
                    this.getFileContent(uri),
                    position
                );

            return ranges?.length ? { ranges } : null;
        } catch (e) {
            console.warn(`Linked editing ranges failed for ${uri}. ${e}`);
            return null;
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
