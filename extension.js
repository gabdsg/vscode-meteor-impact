const vscode = require("vscode");
const {
    addDebugAndRunOptions,
    generateBaseJsConfig,
} = require("./src/base-configs");
const {
    toggleAutoRunPackagesWatcher,
    clearMeteorBuildCache,
    isUsingMeteorPackage,
    isMeteorProject,
} = require("./src/helpers");
const {
    addImportedPackagesToJsConfig,
    addCustomPackageOptionsToJsConfig,
} = require("./src/packages-config");
const {
    connectToLanguageServer,
    stopServer,
} = require("./src/connect-to-server");
const { createTemplate } = require("./src/create-template");
const {
    goToCounterpart,
    enableTemplateFileNesting,
} = require("./src/file-navigation");
const {
    registerMeteorPackagesFileProviders,
} = require("./src/meteor-packages-file");
const {
    generateMeteorSettingsTypes,
} = require("./src/generate-settings-types");

const createOrUpdateJsConfigFile = () => {
    generateBaseJsConfig();
    addImportedPackagesToJsConfig();
    addCustomPackageOptionsToJsConfig();
};

let importedPackagesFileWatcher;
let customPackagesFileWatcher;

const disposeWatchers = () =>
    [importedPackagesFileWatcher, customPackagesFileWatcher].forEach(
        (watcher) => watcher?.dispose?.()
    );

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    if (!(await isMeteorProject())) {
        console.warn(
            "Not in a meteor project, not starting Meteor Impact extension..."
        );
        return;
    }

    console.log("Starting Meteor Impact extension...");

    // Gates the explorer context menu contributions.
    vscode.commands.executeCommand(
        "setContext",
        "meteorImpact.isMeteorProject",
        true
    );

    addDebugAndRunOptions();
    createOrUpdateJsConfigFile();

    const createTemplateDisposable = vscode.commands.registerCommand(
        "meteorImpact.createTemplate",
        createTemplate
    );
    const goToCounterpartDisposable = vscode.commands.registerCommand(
        "meteorImpact.goToCounterpart",
        goToCounterpart
    );
    const fileNestingDisposable = vscode.commands.registerCommand(
        "meteorImpact.enableTemplateFileNesting",
        enableTemplateFileNesting
    );
    const settingsTypesDisposable = vscode.commands.registerCommand(
        "meteorImpact.generateSettingsTypes",
        generateMeteorSettingsTypes
    );

    const toggleAutoRunPackagesWatcherDisposable =
        vscode.commands.registerCommand(
            "meteorImpact.toggleAutoRunPackagesWatcher",
            toggleAutoRunPackagesWatcher
        );

    const autoEnabled = vscode.workspace
        .getConfiguration()
        .get("conf.settingsEditor.meteorImpact.auto");

    const clearMeteorBuildCacheDisposable = vscode.commands.registerCommand(
        "meteorImpact.clearMeteorBuildCache",
        clearMeteorBuildCache
    );

    const regenerateLaunchJsonDisposable = vscode.commands.registerCommand(
        "meteorImpact.regenerateLaunchJson",
        addDebugAndRunOptions
    );

    const runOnceDisposable = vscode.commands.registerCommand(
        "meteorImpact.runOnce",
        () => {
            if (autoEnabled) {
                vscode.window.showInformationMessage(
                    "We are already watching your packages folder, no need to run the command manually."
                );
                return;
            }

            createOrUpdateJsConfigFile();
        }
    );

    console.log(
        `Packages file watcher is ${autoEnabled ? "enabled" : "disabled"}`
    );

    if (autoEnabled) {
        const currentWorkspace = vscode.workspace.workspaceFolders[0];
        importedPackagesFileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                currentWorkspace,
                ".meteor/{packages, versions}"
            )
        );
        customPackagesFileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                currentWorkspace,
                "packages/**/package.js"
            )
        );

        [importedPackagesFileWatcher, customPackagesFileWatcher].forEach(
            (watcher) => {
                watcher.onDidChange(createOrUpdateJsConfigFile);
                watcher.onDidCreate(createOrUpdateJsConfigFile);
                watcher.onDidDelete(createOrUpdateJsConfigFile);
            }
        );
    } else {
        disposeWatchers();
    }

    const restartDisposer = vscode.commands.registerCommand(
        "_meteorImpact.reloadExtension",
        () => {
            deactivate();
            for (const sub of context.subscriptions) {
                try {
                    sub.dispose();
                } catch (e) {
                    console.error(e);
                }
            }
            activate(context);
        }
    );

    if (await isUsingMeteorPackage("blaze-html-templates")) {
        console.log("Connecting to language server...");
        context.subscriptions.push(
            await connectToLanguageServer(context.asAbsolutePath)
        );
    }

    context.subscriptions.push(
        toggleAutoRunPackagesWatcherDisposable,
        runOnceDisposable,
        restartDisposer,
        clearMeteorBuildCacheDisposable,
        regenerateLaunchJsonDisposable,
        createTemplateDisposable,
        goToCounterpartDisposable,
        fileNestingDisposable,
        settingsTypesDisposable,
        ...registerMeteorPackagesFileProviders()
    );
}

// this method is called when your extension is deactivated
function deactivate() {
    disposeWatchers();
    stopServer();
}

module.exports = {
    activate,
    deactivate,
};
