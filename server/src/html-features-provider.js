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

            // Format edits are applied to the live buffer: computing them
            // from the disk fallback splices stale fragments into the
            // document whenever buffer and disk differ. No synced buffer,
            // no formatting.
            const document = this.documentsInstance.get(
                this.parseUri(uri).toString()
            );
            if (!document) return;

            const content = document.getText();

            // Blaze files that don't parse (a stray </template>, an
            // unclosed block) must not be silently re-indented: that
            // launders the damage into "formatted" output. Keep the parse
            // error visible instead. Full-page HTML without <template>
            // tags is not Blaze and still formats as plain HTML.
            try {
                const {
                    SpacebarsCompiler,
                } = require("@blastjs/spacebars-compiler");
                SpacebarsCompiler.parse(content);
            } catch (e) {
                if (/<template[\s>]/i.test(content)) {
                    console.warn(
                        `Formatting skipped for ${uri}: the file does not parse. ${e}`
                    );
                    return;
                }
            }

            return require("./html-language-service").getHtmlFormattingEdits(
                this.parseUri(uri),
                content,
                options,
                range
            );
        } catch (e) {
            console.warn(`Formatting failed for ${uri}. ${e}`);
        }
    }
}

module.exports = { HtmlFeaturesProvider };
