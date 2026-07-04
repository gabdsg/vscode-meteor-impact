const { Uri, window, workspace, ConfigurationTarget } = require("vscode");

// Cycle order: template -> code-behind -> style -> template...
const COUNTERPART_CYCLE = [[".html"], [".ts", ".js"], [".less", ".css"]];

const exists = async (uri) => {
    try {
        return !!(await workspace.fs.stat(uri));
    } catch (e) {
        return false;
    }
};

/**
 * Jump between a template's files: foo.html -> foo.ts/js -> foo.less/css
 * and back. Missing files are skipped.
 */
const goToCounterpart = async () => {
    const editor = window.activeTextEditor;
    if (!editor) return;

    const match = editor.document.uri.fsPath.match(
        /^(.*)(\.html|\.ts|\.js|\.less|\.css)$/
    );
    if (!match) return;

    const [, base, extension] = match;
    const groupIndex = COUNTERPART_CYCLE.findIndex((extensions) =>
        extensions.includes(extension)
    );

    for (let step = 1; step < COUNTERPART_CYCLE.length; step++) {
        const group =
            COUNTERPART_CYCLE[(groupIndex + step) % COUNTERPART_CYCLE.length];

        for (const candidateExtension of group) {
            const candidate = Uri.file(`${base}${candidateExtension}`);
            if (await exists(candidate)) {
                return window.showTextDocument(candidate);
            }
        }
    }

    window.showInformationMessage(
        "No counterpart file found for this file."
    );
};

const mergeNestingList = (existing, additions) => {
    const entries = `${existing || ""}`
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

    for (const addition of additions) {
        if (!entries.includes(addition)) entries.push(addition);
    }

    return entries.join(", ");
};

/**
 * Nest template .html and .less/.css files under their .ts/.js
 * code-behind in the explorer (workspace settings).
 */
const enableTemplateFileNesting = async () => {
    const configuration = workspace.getConfiguration();
    const nestedFiles = [
        "${capture}.html",
        "${capture}.less",
        "${capture}.css",
    ];

    const currentPatterns =
        configuration.inspect("explorer.fileNesting.patterns")
            ?.workspaceValue || {};
    const patterns = {
        ...currentPatterns,
        "*.ts": mergeNestingList(currentPatterns["*.ts"], nestedFiles),
        "*.js": mergeNestingList(currentPatterns["*.js"], nestedFiles),
    };

    await configuration.update(
        "explorer.fileNesting.enabled",
        true,
        ConfigurationTarget.Workspace
    );
    await configuration.update(
        "explorer.fileNesting.patterns",
        patterns,
        ConfigurationTarget.Workspace
    );

    window.showInformationMessage(
        "Template HTML and style files now nest under their code-behind in the explorer."
    );
};

module.exports = { goToCounterpart, enableTemplateFileNesting };
