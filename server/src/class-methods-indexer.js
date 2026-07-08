/**
 * Indexer for class instance methods, getters/setters and function-valued
 * class fields. Member calls the type system can't resolve - e.g.
 * Template.instance().controller.canSendEmail() - still navigate by name,
 * like WebStorm's loose resolution. Only consulted as a last-resort
 * fallback by the definition provider.
 */
class ClassMethodsIndexer {
    constructor() {
        // method name -> [{ className, uri, start, end, entryKey }]
        this.methodsMap = {};
    }

    indexClass({ node, uri }) {
        if (!node || !uri) {
            throw new Error(
                `Expected to receive node and uri, but got: ${node} and ${uri}`
            );
        }

        if (!["ClassDeclaration", "ClassExpression"].includes(node.type)) {
            return;
        }

        const className = node.id?.name;
        for (const member of node.body?.body || []) {
            if (member.computed) continue;

            const isMethod =
                member.type === "MethodDefinition" &&
                member.kind !== "constructor";
            const isFunctionField =
                ["PropertyDefinition", "ClassProperty"].includes(
                    member.type
                ) &&
                ["FunctionExpression", "ArrowFunctionExpression"].includes(
                    member.value?.type
                );
            if (!isMethod && !isFunctionField) continue;

            const name =
                member.key?.name ??
                (typeof member.key?.value === "string"
                    ? member.key.value
                    : undefined);
            if (!name || !member.key.loc) continue;

            const { start, end } = member.key.loc;
            const entryKey = `${uri.fsPath}:${start.line}:${start.column}`;

            // hasOwnProperty instead of truthiness: a method named
            // "toString"/"hasOwnProperty" must not resolve to
            // Object.prototype members.
            const list = (this.methodsMap[name] = Object.prototype.hasOwnProperty.call(
                this.methodsMap,
                name
            )
                ? this.methodsMap[name]
                : []);
            if (list.some(({ entryKey: existing }) => existing === entryKey))
                continue;

            list.push({ className, uri, start, end, entryKey });
        }
    }

    getDefinitions(name) {
        if (!Object.prototype.hasOwnProperty.call(this.methodsMap, name))
            return;

        const list = this.methodsMap[name];
        return list?.length ? list : undefined;
    }

    removeUri(fsPath) {
        for (const [name, list] of Object.entries(this.methodsMap)) {
            this.methodsMap[name] = list.filter(
                ({ uri }) => uri?.fsPath !== fsPath
            );
            if (!this.methodsMap[name].length) delete this.methodsMap[name];
        }
    }

    reset() {
        this.methodsMap = {};
    }
}

module.exports = { ClassMethodsIndexer };
