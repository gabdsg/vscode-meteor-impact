const createPositionObject = (position) => ({
    line: position.line + 1,
    column: position.character,
});

class AstWalker {
    constructor(textContent, parserFn, options) {
        this.shouldStop = false;

        if (textContent && parserFn) {
            this.ast = parserFn(textContent, options);
        }
    }

    getSymbolAtPosition(_position) {
        const position = createPositionObject(_position);

        let symbol;
        let wrappingPartial;
        this.walkUntil((node) => {
            if (node.loc && this.isSymbolInPositionRange(position, node.loc)) {
                // Children are visited after their parents, so the
                // innermost matching node wins.
                symbol = node;

                if (node.type === NODE_TYPES.PARTIAL_STATEMENT) {
                    wrappingPartial = node;
                }
            }
        });

        // A position on an inclusion or on its template name resolves to
        // the inclusion itself (otherwise the name's path expression would
        // shadow it and read as a helper). Params and hash values keep
        // their own nodes, so helper=someHelper resolves to the helper.
        if (
            wrappingPartial &&
            (symbol === wrappingPartial || symbol === wrappingPartial.name)
        ) {
            return wrappingPartial;
        }

        return symbol;
    }

    isSymbolInPositionRange({ line, column }, { start, end }) {
        if (line < start.line || line > end.line) return false;
        if (line === start.line && column < start.column) return false;
        if (line === end.line && column > end.column) return false;
        return true;
    }

    _walk(node, callback) {
        if (this.shouldStop) return;

        if (this.isNode(node)) callback(node);

        for (const k in node) {
            if (!Object.hasOwnProperty.call(node, k)) continue;

            const v = node[k];
            if (this.isNode(v)) {
                this._walk(v, callback);
            }

            if (Array.isArray(v)) {
                v.forEach((n) => {
                    if (!this.isNode(n)) return;

                    this._walk(n, callback);
                });
            }
        }
    }

    walkUntil(callback) {
        if (this.shouldStop) this.shouldStop = false;

        this._walk(this.ast, callback);
    }

    stopWalking() {
        this.shouldStop = true;
    }

    isNode(node) {
        return (
            node && typeof node === "object" && typeof node.type === "string"
        );
    }

    // Trying to use a template
    isPartialStatement(node) {
        return this.isNode(node) && node.type === NODE_TYPES.PARTIAL_STATEMENT;
    }

    // Trying to use a helper/property from the template
    isMustacheStatement(node) {
        return this.isNode(node) && node.type === NODE_TYPES.MUSTACHE_STATEMENT;
    }

    // Block helpers
    isBlockStatement(node) {
        return this.isNode(node) && node.type === NODE_TYPES.BLOCK_STATEMENT;
    }

    // Parameters passed to helpers/templates
    isPathExpression(node) {
        return this.isNode(node) && node.type === NODE_TYPES.PATH_EXPRESSION;
    }
}

const NODE_TYPES = {
    // {{> Template}}
    PARTIAL_STATEMENT: "PartialStatement",
    // {{variable}}
    MUSTACHE_STATEMENT: "MustacheStatement",
    // {{#each a}}{{/each}}
    BLOCK_STATEMENT: "BlockStatement",
    PATH_EXPRESSION: "PathExpression",
    CONTENT_STATEMENT: "ContentStatement",
    IDENTIFIER: "Identifier",
    MEMBER_EXPRESSION: "MemberExpression",
    EXPRESSION_STATEMENT: "ExpressionStatement",
    OBJECT_EXPRESSION: "ObjectExpression",
    PROPERTY: "Property",
    CALL_EXPRESSION: "CallExpression",
    LITERAL: "Literal",
    NEW_EXPRESSION: "NewExpression",
};

const NODE_NAMES = {
    TEMPLATE: "Template",
};

/**
 * Parse JS/TS source with @babel/parser. The "estree" plugin keeps the AST
 * shape compatible with the previous acorn-based parsing (i.e "Property" and
 * "Literal" node types), so the existing walkers work unchanged.
 * With errorRecovery, files with recoverable syntax errors still produce an
 * AST instead of dropping out of the index.
 */
const parseJsSource = (
    textContent,
    { extension = ".js", errorRecovery = true } = {}
) => {
    const { FILE_EXTENSIONS } = require("./constants");
    const isTypescript = extension === FILE_EXTENSIONS.TS;

    return require("@babel/parser").parse(textContent, {
        sourceType: "unambiguous",
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        errorRecovery,
        plugins: [
            "estree",
            "decorators-legacy",
            isTypescript ? "typescript" : "jsx",
        ],
    });
};

/**
 * Parameter list of a function node, as source text (including TS
 * annotations), for signature help. Babel keeps char offsets on nodes, so
 * the raw text can be sliced out.
 */
const extractFunctionSignature = (fnNode, fileContent) => {
    if (
        !fnNode ||
        !Array.isArray(fnNode.params) ||
        typeof fileContent !== "string"
    ) {
        return;
    }

    return {
        params: fnNode.params.map((param) =>
            param.start != null && param.end != null
                ? fileContent.slice(param.start, param.end)
                : param.name || "arg"
        ),
    };
};

/**
 * Cleaned text of the JSDoc block sitting directly above the node that
 * starts at nodeStart (only whitespace in between), or undefined.
 */
const extractJsDoc = (fileContent, nodeStart) => {
    if (typeof fileContent !== "string" || nodeStart == null) return;

    const before = fileContent.slice(0, nodeStart).trimEnd();
    if (!before.endsWith("*/")) return;

    // Comments don't nest: the last "/*" opens the trailing comment.
    // Plain "/*" blocks are not documentation.
    const open = before.lastIndexOf("/*");
    if (open === -1 || !before.startsWith("/**", open)) return;

    const text = before
        .slice(open + 3, before.length - 2)
        .split("\n")
        .map((line) => line.replace(/^\s*\*? ?/, "").trimEnd())
        .join("\n")
        .trim();

    return text || undefined;
};

const FUNCTION_NODE_TYPES = [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
];

/**
 * The innermost function containing the position, with the best name the
 * surrounding syntax provides (declaration id, object property key - which
 * covers Meteor.methods({ "tasks.insert"() {} }) string keys -, class
 * method key or variable declarator id), plus the Meteor method/publication
 * wrapping the position when there is one.
 *
 * The walker has no parent links, so naming containers (Property,
 * VariableDeclarator, MethodDefinition) are recorded as candidates using
 * their function value's location; the smallest span wins.
 */
const findEnclosingFunctionContext = ({ astWalker, position, indexer }) => {
    const wrappedPosition = createPositionObject(position);

    const containsPosition = (loc) =>
        !!loc && astWalker.isSymbolInPositionRange(wrappedPosition, loc);
    const span = ({ start, end }) =>
        (end.line - start.line) * 1e6 + (end.column - start.column);

    const propertyKeyName = (key) =>
        key && (key.name ?? (typeof key.value === "string" ? key.value : undefined));

    let candidate;
    // Containment is checked against the whole declaration node (which
    // includes the function's name), not just the function expression -
    // otherwise a cursor on the name of a class method or object property
    // (whose function value starts at the parameter paren) finds nothing.
    const addCandidate = (name, declarationNode) => {
        if (!declarationNode?.loc || !containsPosition(declarationNode.loc))
            return;
        if (candidate && span(candidate.loc) <= span(declarationNode.loc))
            return;

        candidate = { functionName: name, loc: declarationNode.loc };
    };

    // Function nodes whose name lives on a wrapping Property /
    // MethodDefinition / VariableDeclarator. Parents are visited before
    // children, so by the time the bare function node comes around its
    // naming container has already claimed it - the function must not
    // compete as a smaller anonymous candidate.
    const claimedFunctions = new Set();

    let container;
    astWalker.walkUntil((node) => {
        const { type } = node;

        if (
            type === NODE_TYPES.PROPERTY &&
            FUNCTION_NODE_TYPES.includes(node.value?.type)
        ) {
            claimedFunctions.add(node.value);
            addCandidate(propertyKeyName(node.key), node);
        } else if (
            type === "MethodDefinition" &&
            FUNCTION_NODE_TYPES.includes(node.value?.type)
        ) {
            claimedFunctions.add(node.value);
            addCandidate(propertyKeyName(node.key), node);
        } else if (
            type === "VariableDeclarator" &&
            FUNCTION_NODE_TYPES.includes(node.init?.type)
        ) {
            claimedFunctions.add(node.init);
            addCandidate(node.id?.name, node);
        } else if (
            (FUNCTION_NODE_TYPES.includes(type) ||
                ["ObjectMethod", "ClassMethod"].includes(type)) &&
            !claimedFunctions.has(node)
        ) {
            addCandidate(node.id?.name || propertyKeyName(node.key), node);
        }

        // Innermost Meteor.methods / Meteor.publish / publishComposite /
        // new ValidatedMethod call wrapping the position.
        const methodsAndPublicationsIndexer =
            indexer?.methodsAndPublicationsIndexer;
        if (
            methodsAndPublicationsIndexer &&
            [NODE_TYPES.CALL_EXPRESSION, NODE_TYPES.NEW_EXPRESSION].includes(
                type
            ) &&
            node.callee &&
            containsPosition(node.loc)
        ) {
            if (methodsAndPublicationsIndexer.isMethod(node)) {
                container = { node, kind: "method" };
            } else if (methodsAndPublicationsIndexer.isPublication(node)) {
                container = { node, kind: "publication" };
            }
        }
    });

    if (!candidate) return;

    return {
        ...candidate,
        functionName: candidate.functionName || "(anonymous)",
        ...extractEnclosingMeteorName({ container, containsPosition }),
    };
};

/**
 * Name of the method/publication whose declaration wraps the position:
 * the property key of the Meteor.methods entry containing the position,
 * the "name" property of a ValidatedMethod, or the first string-literal
 * argument of Meteor.publish / publishComposite.
 */
const extractEnclosingMeteorName = ({ container, containsPosition }) => {
    if (!container) return {};

    const {
        METEOR_SUPPORTED_PACKAGES_IDENTIFIER,
        METEOR_IDENTIFIERS,
    } = require("./constants");
    const { node, kind } = container;
    const nodeArguments = Array.isArray(node.arguments) ? node.arguments : [];

    const result = (name) =>
        name ? { enclosingKind: kind, enclosingName: name } : {};

    if (kind === "publication") {
        const literal = nodeArguments.find(
            ({ type, value }) =>
                type === NODE_TYPES.LITERAL && typeof value === "string"
        );
        return result(literal?.value);
    }

    const isValidatedMethod =
        node.callee?.name ===
        METEOR_SUPPORTED_PACKAGES_IDENTIFIER.VALIDATED_METHODS.NAME;
    const isMeteorMethods =
        node.callee?.object?.name === METEOR_IDENTIFIERS.METEOR;

    for (const arg of nodeArguments) {
        if (
            arg.type !== NODE_TYPES.OBJECT_EXPRESSION ||
            !Array.isArray(arg.properties)
        ) {
            continue;
        }

        for (const property of arg.properties) {
            if (
                isValidatedMethod &&
                property.key?.name ===
                    METEOR_SUPPORTED_PACKAGES_IDENTIFIER.VALIDATED_METHODS.KEY
            ) {
                return result(property.value?.value);
            }

            if (
                isMeteorMethods &&
                property.loc &&
                containsPosition(property.loc)
            ) {
                return result(
                    property.key?.name ??
                        (typeof property.key?.value === "string"
                            ? property.key.value
                            : undefined)
                );
            }
        }
    }

    return {};
};

module.exports = {
    createPositionObject,
    AstWalker,
    NODE_TYPES,
    parseJsSource,
    extractFunctionSignature,
    extractJsDoc,
    findEnclosingFunctionContext,
    NODE_NAMES,
};
