const { Uri, languages, workspace, MarkdownString } = require("vscode");
const { TextDecoder } = require("util");
const { parseVersionsFile, parsePackagesFile } = require("./meteor-versions");

const PACKAGES_FILE_SELECTOR = { pattern: "**/.meteor/packages" };
const PACKAGE_NAME_REGEX = /[\w:.-]+/;

const readVersions = async () => {
    try {
        const uri = Uri.joinPath(
            workspace.workspaceFolders[0].uri,
            ".meteor/versions"
        );
        const raw = await workspace.fs.readFile(uri);
        return parseVersionsFile(new TextDecoder().decode(raw));
    } catch (e) {
        return {};
    }
};

/**
 * Hover and completion for the .meteor/packages file, resolved against
 * the pinned versions in .meteor/versions.
 */
const registerMeteorPackagesFileProviders = () => {
    const hoverProvider = languages.registerHoverProvider(
        PACKAGES_FILE_SELECTOR,
        {
            async provideHover(document, position) {
                const wordRange = document.getWordRangeAtPosition(
                    position,
                    PACKAGE_NAME_REGEX
                );
                if (!wordRange) return;

                const packageName = document.getText(wordRange);
                const versions = await readVersions();
                const version = versions[packageName];

                const markdown = new MarkdownString(
                    version
                        ? `**${packageName}** — resolved to \`${version}\` in \`.meteor/versions\``
                        : `**${packageName}** — not found in \`.meteor/versions\` (not installed yet?)`
                );

                return { contents: [markdown], range: wordRange };
            },
        }
    );

    const completionProvider = languages.registerCompletionItemProvider(
        PACKAGES_FILE_SELECTOR,
        {
            async provideCompletionItems(document) {
                const versions = await readVersions();
                const alreadyListed = new Set(
                    parsePackagesFile(document.getText())
                );

                const { CompletionItem, CompletionItemKind } =
                    require("vscode");

                return Object.entries(versions)
                    .filter(([name]) => !alreadyListed.has(name))
                    .map(([name, version]) => {
                        const item = new CompletionItem(
                            name,
                            CompletionItemKind.Module
                        );
                        item.detail = version;
                        item.documentation =
                            "Installed package (from .meteor/versions)";
                        return item;
                    });
            },
        }
    );

    return [hoverProvider, completionProvider];
};

module.exports = { registerMeteorPackagesFileProviders };
