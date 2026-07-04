const { ServerBase } = require("./helpers");

/**
 * Signature help for helper calls in mustaches ({{helper arg1 ...}}) and
 * for Meteor.call/callAsync/subscribe argument lists, using the parameter
 * lists captured at index time.
 */
class SignatureHelpProvider extends ServerBase {
    static METHOD_CALL_REGEX =
        /Meteor\s*\.\s*(?:callAsync|call|applyAsync|apply)\s*\(\s*["'`]([^"'`]+)["'`]\s*,(.*)$/;
    static SUBSCRIBE_REGEX =
        /\.\s*subscribe\s*\(\s*["'`]([^"'`]+)["'`]\s*,(.*)$/;

    constructor(serverInstance, documentsInstance, rootUri, indexer) {
        super(serverInstance, documentsInstance, rootUri, indexer);
    }

    onSignatureHelpRequest({ textDocument: { uri }, position }) {
        try {
            if (this.isFileSpacebarsHTML(uri)) {
                return this.handleHtmlSignature({ uri, position });
            }

            if (this.isFileJS(uri)) {
                return this.handleJsSignature({ uri, position });
            }
        } catch (e) {
            console.warn(`Signature help failed for ${uri}. ${e}`);
        }
    }

    createSignatureHelp({ name, signature, activeParameter }) {
        if (!signature?.params?.length) return;

        return {
            signatures: [
                {
                    label: `${name}(${signature.params.join(", ")})`,
                    parameters: signature.params.map((param) => ({
                        label: param,
                    })),
                },
            ],
            activeSignature: 0,
            activeParameter: Math.min(
                activeParameter,
                signature.params.length - 1
            ),
        };
    }

    handleHtmlSignature({ uri, position }) {
        const {
            positionToOffset,
            getWrappingTemplateName,
        } = require("./text-utils");

        const content = this.getFileContent(uri);
        const offset = positionToOffset(content, position);
        const textBefore = content.slice(0, offset);

        const mustacheStart = textBefore.lastIndexOf("{{");
        if (mustacheStart === -1) return;

        const mustacheText = textBefore.slice(mustacheStart + 2);
        if (
            mustacheText.includes("}}") ||
            mustacheText.startsWith(">") ||
            mustacheText.startsWith("/")
        ) {
            return;
        }

        // "formatAge person " -> helper name + args typed so far.
        const parts = mustacheText.replace(/^#/, "").trim().split(/\s+/);
        const [helperName, ...typedArgs] = parts;
        if (!helperName) return;

        const endsWithSpace = /\s$/.test(mustacheText);
        const activeParameter = endsWithSpace
            ? typedArgs.length
            : Math.max(0, typedArgs.length - 1);

        const { templateIndexMap, globalHelpersMap } =
            this.indexer.blazeIndexer;
        const wrappingTemplateName = getWrappingTemplateName(content, offset);

        const helper =
            (!!wrappingTemplateName &&
                templateIndexMap[wrappingTemplateName]?.helpers?.[
                    helperName
                ]) ||
            globalHelpersMap[helperName];
        if (!helper?.signature) return;

        return this.createSignatureHelp({
            name: helperName,
            signature: helper.signature,
            activeParameter,
        });
    }

    handleJsSignature({ uri, position }) {
        const content = this.getFileContent(uri);
        const linePrefix = (content.split("\n")[position.line] || "").slice(
            0,
            position.character
        );

        const methodMatch = linePrefix.match(
            SignatureHelpProvider.METHOD_CALL_REGEX
        );
        const subscribeMatch =
            !methodMatch &&
            linePrefix.match(SignatureHelpProvider.SUBSCRIBE_REGEX);

        const match = methodMatch || subscribeMatch;
        if (!match) return;

        const [, name, argsText] = match;
        const { methodsMap, publicationsMap } =
            this.indexer.methodsAndPublicationsIndexer;

        const definition = (methodMatch ? methodsMap : publicationsMap)[name];
        if (!definition?.signature) return;

        // The arguments after the name map onto the handler's parameters.
        const activeParameter = (argsText.match(/,/g) || []).length;

        return this.createSignatureHelp({
            name,
            signature: definition.signature,
            activeParameter,
        });
    }
}

module.exports = { SignatureHelpProvider };
