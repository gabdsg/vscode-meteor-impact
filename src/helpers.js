const { Uri, workspace, window, commands } = require("vscode");
const { TextDecoder, TextEncoder } = require("util");
const { isEqual } = require("lodash");
const json5 = require("json5");
const merge = require("deepmerge");

const writeToFile = async (data, targetUri) => {
    const path = targetUri.fsPath;
    try {
        await workspace.fs.writeFile(targetUri, data);
        console.log(`Successfully wrote to file ${path}!`);
    } catch (e) {
        window.showErrorMessage(`Unable to write contents to file: ${path}`);
    }
};

const createFileFromScratch = async (data, targetUri) => {
    console.log(`${targetUri.fsPath} does not exist, creating one...`);

    const baseConfigAsString = JSON.stringify(data, null, 2);
    const encodedBaseConfig = new TextEncoder().encode(baseConfigAsString);

    return writeToFile(encodedBaseConfig, targetUri);
};

const appendToExistingFile = async (dataObject, targetUri, arrayMergeMode) => {
    console.log(`${targetUri.fsPath} exists, appending needed info.`);

    const existingFileContent = await workspace.fs.readFile(targetUri);
    const existingDecodedConfig = json5.parse(
        new TextDecoder().decode(existingFileContent)
    );

    const newConfig = merge(existingDecodedConfig, dataObject, {
        arrayMerge: arrayMergeMode,
    });

    if (isEqual(existingDecodedConfig, newConfig)) {
        console.log(
            `Generated configs are equal to existing ones for file: ${targetUri.fsPath}. No work to do.`
        );
        return;
    }

    return writeToFile(
        new TextEncoder().encode(JSON.stringify(newConfig, null, 2)),
        targetUri
    );
};

// The only entry point for generated config files (launch.json, jsconfig.json).
// Existence is decided by a direct stat of the known path, never by
// workspace.findFiles: a file search can come back empty for reasons that have
// nothing to do with the file being absent (search service still cold, ripgrep
// killed mid-walk, files.exclude, .gitignore once
// search.experimental.useIgnoreFilesInFindFiles is on), and treating that as
// "absent" overwrote users' launch.json. Only FileNotFound means "create";
// any other stat error means "leave the file alone".
const createOrMergeJsonFile = async (relativePath, data, arrayMergeMode) => {
    const targetUri = Uri.joinPath(
        workspace.workspaceFolders[0].uri,
        relativePath
    );

    try {
        await workspace.fs.stat(targetUri);
    } catch (e) {
        if (e?.code !== "FileNotFound") {
            console.error(
                `Could not stat ${targetUri.fsPath}, leaving it untouched.`,
                e
            );
            return;
        }
        return createFileFromScratch(data, targetUri);
    }

    return appendToExistingFile(data, targetUri, arrayMergeMode);
};

// Workaround to reload only the extension.
const reloadExtension = () =>
    commands.executeCommand("_meteorImpact.reloadExtension");

const toggleAutoRunPackagesWatcher = async () => {
    const configuration = workspace.getConfiguration();

    const { auto, ...currentValue } = configuration.get(
        "conf.settingsEditor.meteorImpact"
    );

    const newValue = { ...currentValue, ...{ auto: !!!auto } };

    await configuration.update("conf.settingsEditor.meteorImpact", newValue);
    await reloadExtension();
};

const clearMeteorBuildCache = async () => {
    const workspaceRoot = workspace.workspaceFolders[0].uri;
    const localMeteorPath = [".meteor", "local"];

    const webBuildPath = Uri.joinPath(
        workspaceRoot,
        ...localMeteorPath,
        "build"
    );
    const cordovaBuildPath = Uri.joinPath(
        workspaceRoot,
        ...localMeteorPath,
        "cordova-build"
    );

    await Promise.all(
        [webBuildPath, cordovaBuildPath].map(async (dir) => {
            try {
                const folderExists = await workspace.fs.stat(dir);
                if (!folderExists) return;

                console.log(`Removing ${dir}...`);
                await workspace.fs.delete(dir, { recursive: true });
            } catch (e) {
                // Don' throw errors from stat(), it means the path does not exists.
                console.error(e);
            }
        })
    );

    window.showInformationMessage("Successfully cleared meteor build cache.");
};

const isWindows = () => process.platform === "win32";

const isMeteorProject = async () => {
    const projectRoot = Uri.joinPath(
        workspace.workspaceFolders[0].uri,
        ".meteor"
    );

    let exists;
    try {
        exists = !!(await workspace.fs.stat(projectRoot));
    } catch (e) {
        console.error(e);
        exists = false;
    }

    return exists;
};

const isUsingMeteorPackage = async (pkgName) => {
    if (!pkgName || typeof pkgName !== "string") {
        throw new Error(`Invalid meteor package name, received: ${pkgName}`);
    }

    if (!(await isMeteorProject())) {
        return;
    }

    const pkgFilesUri = Uri.joinPath(
        workspace.workspaceFolders[0].uri,
        ".meteor/packages"
    );

    const existingFileContent = await workspace.fs.readFile(pkgFilesUri);

    return existingFileContent.includes(pkgName);
};

module.exports = {
    createOrMergeJsonFile,
    appendToExistingFile,
    toggleAutoRunPackagesWatcher,
    isWindows,
    clearMeteorBuildCache,
    isUsingMeteorPackage,
    isMeteorProject,
};
