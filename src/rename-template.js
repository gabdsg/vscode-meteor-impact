const { Uri, window, workspace } = require("vscode");

const TEMPLATE_EXTENSIONS = [".html", ".ts", ".js", ".less", ".css"];

const exists = async (uri) => {
    try {
        return !!(await workspace.fs.stat(uri));
    } catch (e) {
        return false;
    }
};

const resolveTemplateFolder = async (clickedUri) => {
    if (clickedUri) {
        const stat = await workspace.fs.stat(clickedUri);
        // FileType.Directory === 2.
        return stat.type === 2 ? clickedUri : Uri.joinPath(clickedUri, "..");
    }

    const activeUri = window.activeTextEditor?.document.uri;
    return activeUri && Uri.joinPath(activeUri, "..");
};

/**
 * Rename a template folder as a whole: the template symbol everywhere
 * (via the language server), the import specifiers, and the
 * folder/files themselves.
 */
const renameTemplate = async (clickedUri, languageClient) => {
    const folderUri = await resolveTemplateFolder(clickedUri);
    if (!folderUri) return;

    const oldName = folderUri.path.split("/").pop();
    if (!(await exists(Uri.joinPath(folderUri, `${oldName}.html`)))) {
        window.showErrorMessage(
            `"${oldName}" doesn't look like a template folder (no ${oldName}.html inside).`
        );
        return;
    }

    const newName = await window.showInputBox({
        prompt: `New name for template "${oldName}"`,
        value: oldName,
        validateInput: (value) =>
            /^[\w-]+$/.test(value)
                ? undefined
                : "Template names can only contain letters, numbers, _ and -.",
    });
    if (!newName || newName === oldName) return;

    const targetFolder = Uri.joinPath(folderUri, "..", newName);
    if (await exists(targetFolder)) {
        window.showErrorMessage(
            `A folder named "${newName}" already exists here.`
        );
        return;
    }

    // 1. Symbol usages + template tag + Template.X refs + import
    //    specifiers, computed and applied by the language server.
    const response = await languageClient.sendRequest(
        "meteorImpact/renameTemplateFiles",
        {
            folderUri: folderUri.toString(),
            oldName,
            newName,
        }
    );
    if (response?.applied === false) return;

    // The edits live in dirty buffers: persist before touching files.
    await workspace.saveAll(false);

    // 2. Rename the files, then the folder.
    try {
        for (const extension of TEMPLATE_EXTENSIONS) {
            const oldFile = Uri.joinPath(
                folderUri,
                `${oldName}${extension}`
            );
            if (await exists(oldFile)) {
                await workspace.fs.rename(
                    oldFile,
                    Uri.joinPath(folderUri, `${newName}${extension}`)
                );
            }
        }

        await workspace.fs.rename(folderUri, targetFolder);
    } catch (e) {
        window.showErrorMessage(`Unable to rename template files: ${e}`);
        return;
    }

    // Land in the renamed code-behind when there is one.
    for (const extension of [".ts", ".js", ".html"]) {
        const scriptUri = Uri.joinPath(
            targetFolder,
            `${newName}${extension}`
        );
        if (await exists(scriptUri)) {
            await window.showTextDocument(scriptUri);
            break;
        }
    }
};

module.exports = { renameTemplate };
