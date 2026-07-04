const { Uri, window, workspace, RelativePattern } = require("vscode");
const { TextDecoder, TextEncoder } = require("util");
const json5 = require("json5");
const { generateSettingsTypes } = require("./settings-types");

const OUTPUT_FILE = "meteor-settings.d.ts";

const pickSettingsFile = async () => {
    const workspaceRoot = workspace.workspaceFolders[0];

    // Root-level settings files only: nested ones are usually fixtures.
    const candidates = await workspace.findFiles(
        new RelativePattern(workspaceRoot, "settings*.json"),
        null,
        10
    );

    if (!candidates.length) {
        window.showErrorMessage(
            "No settings*.json file found at the workspace root."
        );
        return;
    }

    if (candidates.length === 1) return candidates[0];

    const picked = await window.showQuickPick(
        candidates.map((uri) => ({
            label: uri.path.split("/").pop(),
            uri,
        })),
        { placeHolder: "Which settings file should the types come from?" }
    );
    return picked?.uri;
};

/**
 * Generate meteor-settings.d.ts from the project's settings.json, so
 * Meteor.settings can be used through a typed cast.
 */
const generateMeteorSettingsTypes = async () => {
    const settingsUri = await pickSettingsFile();
    if (!settingsUri) return;

    let settings;
    try {
        const raw = await workspace.fs.readFile(settingsUri);
        settings = json5.parse(new TextDecoder().decode(raw));
    } catch (e) {
        window.showErrorMessage(
            `Unable to parse ${settingsUri.fsPath}: ${e.message}`
        );
        return;
    }

    const outputUri = Uri.joinPath(
        workspace.workspaceFolders[0].uri,
        OUTPUT_FILE
    );
    await workspace.fs.writeFile(
        outputUri,
        new TextEncoder().encode(generateSettingsTypes(settings))
    );

    await window.showTextDocument(outputUri);
    window.showInformationMessage(
        `Generated ${OUTPUT_FILE}. Use it with: Meteor.settings as MeteorSettings`
    );
};

module.exports = { generateMeteorSettingsTypes };
