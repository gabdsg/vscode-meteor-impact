/**
 * Prompt templates for the "... with Claude Code" code actions. Pure module
 * (no vscode import) so it can be unit-tested.
 *
 * Prompts MUST be single-line: they are typed into the Claude Code CLI
 * REPL via Terminal.sendText, where a newline submits the input.
 */

// "the Meteor method "tasks.insert"" / "" when the function isn't one.
const describeEnclosing = ({ enclosingKind, enclosingName }) =>
    enclosingKind && enclosingName
        ? `the Meteor ${enclosingKind} "${enclosingName}"`
        : "";

const locate = ({ functionName, filePath, startLine, endLine }) =>
    `\`${functionName}\` in ${filePath} (lines ${startLine}-${endLine})`;

const PROMPT_BUILDERS = {
    createTests(payload) {
        const enclosing = describeEnclosing(payload);
        return (
            "First inspect this workspace's existing tests to learn the conventions: " +
            "check the package.json test scripts and existing test files to identify " +
            "the framework, assertion style and test file location/naming patterns. " +
            `Then write tests for the function ${locate(payload)}` +
            (enclosing
                ? `, which implements ${enclosing} — include authorization (this.userId) and argument-validation cases`
                : "") +
            ". Match the existing conventions exactly and place the file where " +
            "similar tests live. Cover the success path, input validation and " +
            "error/edge cases, then run the test suite if a script exists."
        );
    },

    securityReview(payload) {
        const enclosing = describeEnclosing(payload);
        return (
            `Security-review ${enclosing || "the function"} implemented by ${locate(payload)}. ` +
            "It runs on the server and is callable/subscribable by any connected client. " +
            "Check for: missing or insufficient this.userId authorization, missing " +
            "argument validation (check/SimpleSchema/zod), NoSQL injection through " +
            "client-supplied selectors or modifiers, missing rate limiting " +
            "(DDPRateLimiter), over-exposure of fields in return values or " +
            "publication cursors, and unsafe trust of client-provided ids. " +
            "Report findings ordered by severity with a concrete fix for each; " +
            "do not change any code yet."
        );
    },

    addJsdoc(payload) {
        const enclosing = describeEnclosing(payload);
        return (
            `Add a JSDoc comment to the function ${locate(payload)}` +
            (enclosing ? ` (it implements ${enclosing})` : "") +
            ". Document each parameter with types inferred from usage, the " +
            "return value, and any Meteor.Error thrown. Match the JSDoc style " +
            "already used in this workspace. Only add the comment; do not " +
            "modify the function body."
        );
    },

    explain(payload) {
        return (
            `Explain the function ${locate(payload)}: purpose, inputs/outputs, ` +
            "side effects (database writes, publications affected), who calls it, " +
            "and any Meteor-specific behavior (method stub vs server execution, " +
            "reactivity). Be concise."
        );
    },
};

const buildPrompt = (payload) => {
    const builder = PROMPT_BUILDERS[payload?.action];
    if (!builder) {
        throw new Error(`Unknown Claude Code action: ${payload?.action}`);
    }

    // Single line, whatever the templates above end up doing.
    return builder(payload).replace(/\s*\n\s*/g, " ").trim();
};

module.exports = { buildPrompt };
