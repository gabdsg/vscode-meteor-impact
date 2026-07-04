const { Uri, window, workspace } = require("vscode");
const { TextEncoder } = require("util");
const { isUsingMeteorPackage } = require("./helpers");
const {
    buildTemplateScaffolding,
    TEMPLATE_NAME_REGEX,
} = require("./template-scaffolding");

const exists = async (uri) => {
    try {
        return !!(await workspace.fs.stat(uri));
    } catch (e) {
        return false;
    }
};

const resolveTargetDirectory = async (clickedUri) => {
    if (!clickedUri) return workspace.workspaceFolders[0].uri;

    const stat = await workspace.fs.stat(clickedUri);
    // FileType.Directory === 2.
    if (stat.type === 2) return clickedUri;

    return Uri.joinPath(clickedUri, "..");
};

/**
 * Explorer context menu command: scaffold a new Blaze template folder with
 * <name>.html, <name>.js/.ts and optionally <name>.less/.css.
 */
const createTemplate = async (clickedUri) => {
    const targetDirectory = await resolveTargetDirectory(clickedUri);

    const name = await window.showInputBox({
        prompt: "Name for the new template",
        placeHolder: "myTemplate",
        validateInput: (value) =>
            TEMPLATE_NAME_REGEX.test(value)
                ? undefined
                : "Template names can only contain letters, numbers, _ and -.",
    });
    if (!name) return;

    const templateFolder = Uri.joinPath(targetDirectory, name);
    if (await exists(templateFolder)) {
        window.showErrorMessage(
            `A folder named "${name}" already exists here.`
        );
        return;
    }

    const scriptPick = await window.showQuickPick(
        [
            { label: "JavaScript", description: `${name}.js`, extension: ".js" },
            { label: "TypeScript", description: `${name}.ts`, extension: ".ts" },
        ],
        { placeHolder: "Language for the template code-behind" }
    );
    if (!scriptPick) return;
    const scriptExtension = scriptPick.extension;

    // Style file: .less when the meteor less package is installed.
    const preferredStyleExtension = (await isUsingMeteorPackage("less"))
        ? ".less"
        : ".css";
    const stylePick = await window.showQuickPick(["Yes", "No"], {
        placeHolder: `Create a ${name}${preferredStyleExtension} style file?`,
    });
    if (!stylePick) return;

    const styleExtension =
        stylePick === "Yes" ? preferredStyleExtension : null;

    const files = buildTemplateScaffolding({
        name,
        scriptExtension,
        styleExtension,
    });

    try {
        await workspace.fs.createDirectory(templateFolder);
        await Promise.all(
            files.map(({ fileName, content }) =>
                workspace.fs.writeFile(
                    Uri.joinPath(templateFolder, fileName),
                    new TextEncoder().encode(content)
                )
            )
        );
    } catch (e) {
        window.showErrorMessage(`Unable to create template "${name}": ${e}`);
        return;
    }

    // Land in the code-behind file, ready to write helpers.
    const scriptUri = Uri.joinPath(
        templateFolder,
        `${name}${scriptExtension}`
    );
    await window.showTextDocument(scriptUri);
};

module.exports = { createTemplate };
