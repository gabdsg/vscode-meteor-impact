/**
 * Thin wrapper around vscode-html-languageservice, so Spacebars files keep
 * the full HTML editing experience (completion, hover, folding, formatting)
 * that is lost by claiming .html files as the "spacebars" language.
 * Positions inside mustaches are handled by the Blaze providers; everything
 * else is delegated here.
 */

let languageService;
const getService = () => {
    if (!languageService) {
        languageService =
            require("vscode-html-languageservice").getLanguageService();
    }

    return languageService;
};

const createDocument = (uri, content) => {
    const { TextDocument } = require("vscode-html-languageservice");

    return TextDocument.create(
        uri.toString?.() || `${uri}`,
        "html",
        0,
        content
    );
};

const getHtmlCompletions = (uri, content, position) => {
    const service = getService();
    const document = createDocument(uri, content);

    return service.doComplete(
        document,
        position,
        service.parseHTMLDocument(document)
    );
};

const getHtmlHover = (uri, content, position) => {
    const service = getService();
    const document = createDocument(uri, content);

    return (
        service.doHover(
            document,
            position,
            service.parseHTMLDocument(document)
        ) || undefined
    );
};

const getHtmlFoldingRanges = (uri, content) =>
    getService().getFoldingRanges(createDocument(uri, content));

const getHtmlLinkedEditingRanges = (uri, content, position) => {
    const service = getService();
    const document = createDocument(uri, content);

    return service.findLinkedEditingRanges(
        document,
        position,
        service.parseHTMLDocument(document)
    );
};

const getHtmlFormattingEdits = (uri, content, options, range) =>
    getService().format(createDocument(uri, content), range, {
        tabSize: options?.tabSize ?? 4,
        insertSpaces: options?.insertSpaces ?? true,
        // Indent {{#block}}...{{/block}} contents.
        indentHandlebars: true,
        preserveNewLines: true,
        maxPreserveNewLines: 2,
    });

module.exports = {
    getHtmlCompletions,
    getHtmlHover,
    getHtmlFoldingRanges,
    getHtmlLinkedEditingRanges,
    getHtmlFormattingEdits,
};
