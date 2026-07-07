/**
 * Indexer for reactive state keys: Session.get/set/setDefault/equals and
 * the same calls on variables initialized with `new ReactiveDict(...)`.
 * Only string-literal keys are indexed - dynamic keys are invisible on
 * purpose (they can't be resolved statically).
 *
 * ReactiveVar is out of scope: its get/set take no key.
 */
const SESSION_IDENTIFIER = "Session";
const REACTIVE_DICT_IDENTIFIER = "ReactiveDict";

const READ_METHODS = ["get", "equals"];
const WRITE_METHODS = ["set", "setDefault"];

class SessionKeysIndexer {
    constructor() {
        // key -> { sets: [{ node, uri, entryKey }], gets: [...] }
        this.keysMap = {};
        // fsPath -> [identifier names initialized with new ReactiveDict()]
        this.reactiveDictVars = {};
    }

    indexCall({ node, uri }) {
        if (!node || !uri) {
            throw new Error(
                `Expected to receive node and uri, but got: ${node} and ${uri}`
            );
        }

        const { NODE_TYPES } = require("./ast-helpers");

        // const state = new ReactiveDict("...") - remember the variable so
        // state.get("x") below is recognized as a reactive key access.
        if (
            node.type === "VariableDeclarator" &&
            node.init?.type === NODE_TYPES.NEW_EXPRESSION &&
            node.init.callee?.type === NODE_TYPES.IDENTIFIER &&
            node.init.callee.name === REACTIVE_DICT_IDENTIFIER &&
            node.id?.type === NODE_TYPES.IDENTIFIER
        ) {
            const vars = (this.reactiveDictVars[uri.fsPath] =
                this.reactiveDictVars[uri.fsPath] || []);
            if (!vars.includes(node.id.name)) vars.push(node.id.name);
            return;
        }

        if (node.type !== NODE_TYPES.CALL_EXPRESSION) return;

        const { callee } = node;
        if (
            callee?.type !== NODE_TYPES.MEMBER_EXPRESSION ||
            callee.computed ||
            callee.object?.type !== NODE_TYPES.IDENTIFIER ||
            callee.property?.type !== NODE_TYPES.IDENTIFIER
        ) {
            return;
        }

        const methodName = callee.property.name;
        const isRead = READ_METHODS.includes(methodName);
        const isWrite = !isRead && WRITE_METHODS.includes(methodName);
        if (!isRead && !isWrite) return;

        const receiverName = callee.object.name;
        const isReactiveReceiver =
            receiverName === SESSION_IDENTIFIER ||
            (this.reactiveDictVars[uri.fsPath] || []).includes(receiverName);
        if (!isReactiveReceiver) return;

        const keyNode = node.arguments?.[0];
        if (
            keyNode?.type !== NODE_TYPES.LITERAL ||
            typeof keyNode.value !== "string"
        ) {
            return;
        }

        this.addEntry({ node: keyNode, uri, isWrite });
    }

    addEntry({ node, uri, isWrite }) {
        const {
            value,
            loc: {
                start: { line: startLine, column: startColumn },
                end: { line: endLine, column: endColumn },
            },
        } = node;
        const entryKey = `${uri.fsPath}${startLine}${startColumn}${endLine}${endColumn}`;

        const entry = (this.keysMap[value] = this.keysMap[value] || {
            sets: [],
            gets: [],
        });
        const list = isWrite ? entry.sets : entry.gets;

        if (list.some(({ entryKey: existing }) => existing === entryKey)) {
            return;
        }

        list.push({ node, uri, entryKey });
    }

    // Go-to-definition target: the first place the key is set.
    getDefinition(key) {
        return this.keysMap[key]?.sets[0];
    }

    getReferences(key) {
        const entry = this.keysMap[key];
        if (!entry) return;

        const references = [...entry.sets, ...entry.gets];
        return references.length ? references : undefined;
    }

    removeUri(fsPath) {
        const matches = (uri) => uri?.fsPath === fsPath;

        for (const [key, entry] of Object.entries(this.keysMap)) {
            entry.sets = entry.sets.filter(({ uri }) => !matches(uri));
            entry.gets = entry.gets.filter(({ uri }) => !matches(uri));

            if (!entry.sets.length && !entry.gets.length) {
                delete this.keysMap[key];
            }
        }

        delete this.reactiveDictVars[fsPath];
    }

    reset() {
        this.keysMap = {};
        this.reactiveDictVars = {};
    }
}

module.exports = { SessionKeysIndexer };
