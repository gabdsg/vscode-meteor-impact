/**
 * Text-based detection of "the cursor is at a field-name position inside a
 * Mongo query" - used by completion (broken ASTs while typing) and by
 * hover/definition. Returns undefined whenever the context isn't
 * confidently classified: false negatives over false positives.
 */

const CURSOR_METHODS = [
    "find",
    "findOne",
    "findOneAsync",
    "count",
    "countAsync",
    "countDocuments",
    "update",
    "updateAsync",
    "upsert",
    "upsertAsync",
    "insert",
    "insertAsync",
    "remove",
    "removeAsync",
];

// Update operators whose value object holds field paths as keys.
const FIELD_MODIFIER_OPERATORS = [
    "$set",
    "$unset",
    "$inc",
    "$mul",
    "$min",
    "$max",
    "$push",
    "$addToSet",
    "$pull",
    "$pop",
    "$setOnInsert",
    "$currentDate",
    "$rename",
];

const CALL_REGEX = new RegExp(
    `\\b(\\w+(?:\\.users)?)\\s*\\.\\s*(${CURSOR_METHODS.join("|")})\\s*\\(`,
    "g"
);

/**
 * Scan from a call's opening paren up to `end`, tracking the argument
 * index and the stack of object keys wrapping the position. Strings and
 * comments are skipped. Returns undefined when the call closes before the
 * position (the cursor isn't inside it).
 */
const scanCallBody = (content, openParenIndex, end) => {
    // Frames: { type: "paren"|"object"|"array", key, currentKey }
    const stack = [];
    let argIndex = 0;
    let lastWord = "";
    let lastWordWasKey = false;

    let i = openParenIndex + 1;
    while (i < end) {
        const char = content[i];

        // Strings: skip, but remember quoted words - they can be keys.
        if (char === '"' || char === "'" || char === "`") {
            const quote = char;
            let j = i + 1;
            let value = "";
            while (j < end && content[j] !== quote) {
                if (content[j] === "\\") j++;
                else value += content[j];
                j++;
            }
            if (j >= end) {
                // The position is inside this string.
                return { stack, argIndex, openString: { quote, value } };
            }
            lastWord = value;
            i = j + 1;
            continue;
        }

        // Comments.
        if (char === "/" && content[i + 1] === "/") {
            while (i < end && content[i] !== "\n") i++;
            continue;
        }
        if (char === "/" && content[i + 1] === "*") {
            i += 2;
            while (i < end && !(content[i] === "*" && content[i + 1] === "/"))
                i++;
            i += 2;
            continue;
        }

        if (/[\w$]/.test(char)) {
            let j = i;
            while (j < end && /[\w$]/.test(content[j])) j++;
            lastWord = content.slice(i, j);
            i = j;
            continue;
        }

        const frame = stack[stack.length - 1];
        switch (char) {
            case ":":
                if (frame?.type === "object") frame.currentKey = lastWord;
                lastWordWasKey = true;
                break;
            case "{":
                stack.push({
                    type: "object",
                    key: frame?.currentKey,
                    currentKey: undefined,
                });
                break;
            case "[":
                stack.push({ type: "array", key: frame?.currentKey });
                break;
            case "(":
                stack.push({ type: "paren", key: frame?.currentKey });
                break;
            case "}":
            case "]":
                stack.pop();
                break;
            case ")":
                if (!stack.length) return undefined; // call closed
                stack.pop();
                break;
            case ",":
                if (!stack.length) argIndex++;
                else if (frame?.type === "object") {
                    frame.currentKey = undefined;
                }
                break;
            default:
                break;
        }
        void lastWordWasKey;
        i++;
    }

    return { stack, argIndex };
};

const classify = ({ method, argIndex, stack }) => {
    const baseMethod = method.replace(/Async$/, "");
    const keysInward = stack
        .filter(({ type }) => type === "object")
        .map(({ key }) => key);

    const modifierIndex = keysInward.findIndex((key) =>
        FIELD_MODIFIER_OPERATORS.includes(key)
    );
    const projectionIndex = keysInward.findIndex((key) =>
        ["fields", "projection"].includes(key)
    );

    // Which keys count toward the dotted prefix: everything after the
    // anchor frame, skipping $ operators ($or/$and/$elemMatch/...) and
    // undefined keys (arg roots, array elements).
    const prefixFrom = (startIndex) =>
        keysInward
            .slice(startIndex)
            .filter((key) => key && !key.startsWith("$"))
            .join(".");

    if (argIndex === 0) {
        if (["update", "upsert", "remove", "count"].includes(baseMethod)) {
            return { argContext: "selector", pathPrefix: prefixFrom(1) };
        }
        if (["find", "findOne"].includes(baseMethod)) {
            return { argContext: "selector", pathPrefix: prefixFrom(1) };
        }
        if (baseMethod === "insert") {
            return { argContext: "insert-doc", pathPrefix: prefixFrom(1) };
        }
        return undefined;
    }

    if (argIndex === 1) {
        if (["update", "upsert"].includes(baseMethod)) {
            if (modifierIndex === -1) return undefined;
            return {
                argContext: "modifier",
                modifierOperator: keysInward[modifierIndex],
                pathPrefix: prefixFrom(modifierIndex + 1),
            };
        }
        if (["find", "findOne"].includes(baseMethod)) {
            if (projectionIndex === -1) return undefined;
            return {
                argContext: "projection",
                pathPrefix: prefixFrom(projectionIndex + 1),
            };
        }
    }

    return undefined;
};

/**
 * Field context at `offset` in `fileContent`, or undefined. Shape:
 * { collectionVarName, method, argContext, modifierOperator, pathPrefix,
 *   openString }.
 */
const getMongoFieldContext = (fileContent, offset) => {
    const textBefore = fileContent.slice(0, offset);

    // The innermost still-open call wins: scan candidates from the last
    // match backwards.
    const matches = [...textBefore.matchAll(CALL_REGEX)];
    for (let m = matches.length - 1; m >= 0; m--) {
        const match = matches[m];
        const openParenIndex = match.index + match[0].length - 1;

        const scan = scanCallBody(fileContent, openParenIndex, offset);
        if (!scan) continue;

        const classification = classify({
            method: match[2],
            argIndex: scan.argIndex,
            stack: scan.stack,
        });
        if (!classification) return undefined;

        return {
            collectionVarName: match[1],
            method: match[2],
            openString: scan.openString,
            ...classification,
        };
    }

    return undefined;
};

module.exports = { getMongoFieldContext, FIELD_MODIFIER_OPERATORS };
