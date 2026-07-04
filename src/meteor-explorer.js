const {
    window,
    workspace,
    commands,
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Uri,
    Range,
} = require("vscode");

const path = require("path");
const { filterOverview, hierarchyBranchMatches } = require("./explorer-data");

const createItem = ({
    label,
    icon,
    description,
    collapsible = TreeItemCollapsibleState.None,
    file,
    line,
    children = [],
}) => {
    const item = new TreeItem(label, collapsible);
    if (icon) item.iconPath = new ThemeIcon(icon);
    if (description) item.description = description;
    if (file) {
        item.command = {
            command: "meteorImpact.openLocation",
            title: "Open",
            arguments: [file, line],
        };
    }

    item.childrenItems = children;
    children.forEach((child) => {
        child.parent = item;
    });
    return item;
};

const locationDescription = ({ file, unused }) =>
    [file && path.basename(file), unused && "(unused)"]
        .filter(Boolean)
        .join(" ");

class BaseTreeProvider {
    constructor(fetchOverview) {
        this.fetchOverview = fetchOverview;
        this.changeEmitter = new EventEmitter();
        this.onDidChangeTreeData = this.changeEmitter.event;
        this.overview = null;
        this.filterText = "";
        this.elementByFile = new Map();
    }

    refresh({ reload = true } = {}) {
        if (reload) this.overview = null;
        this.changeEmitter.fire();
    }

    getTreeItem(element) {
        return element;
    }

    getParent(element) {
        return element.parent;
    }

    // Used by reveal-on-switch: the tree element representing a file.
    findElementForFile(fsPath) {
        return this.elementByFile.get(fsPath);
    }

    mapFile(file, element) {
        if (file && !this.elementByFile.has(file)) {
            this.elementByFile.set(file, element);
        }
    }

    async getChildren(element) {
        if (element) return element.childrenItems || [];

        this.overview = this.overview || (await this.fetchOverview());
        if (!this.overview) {
            return [createItem({ label: "Waiting for the index..." })];
        }

        this.elementByFile = new Map();
        return this.buildRoots();
    }
}

/**
 * "App Overview" tree: templates (helpers/events), global helpers,
 * methods and publications. Supports a search filter and a
 * current-file scope.
 */
class OverviewTreeProvider extends BaseTreeProvider {
    constructor(fetchOverview) {
        super(fetchOverview);
        this.scope = "all";
    }

    buildRoots() {
        const activeFile =
            this.scope === "file"
                ? window.activeTextEditor?.document.uri.fsPath
                : null;
        const data = filterOverview(this.overview, {
            query: this.filterText,
            activeFile,
        });

        // With an active filter/scope, surface the matches directly.
        const narrowed = !!this.filterText || this.scope === "file";
        const collapsibleFor = (hasChildren) =>
            !hasChildren
                ? TreeItemCollapsibleState.None
                : narrowed
                ? TreeItemCollapsibleState.Expanded
                : TreeItemCollapsibleState.Collapsed;

        const templateItems = data.templates.map((template) => {
            const children = [
                ...template.helpers.map((helper) => {
                    const item = createItem({
                        label: helper.name,
                        icon: "symbol-function",
                        description: locationDescription(helper),
                        file: helper.file,
                        line: helper.line,
                    });
                    return item;
                }),
                ...template.events.map((event) =>
                    createItem({
                        label: event.name,
                        icon: "symbol-event",
                        description: locationDescription(event),
                        file: event.file,
                        line: event.line,
                    })
                ),
            ];

            const item = createItem({
                label: template.name,
                icon: "symbol-class",
                description: locationDescription(template),
                file: template.file,
                line: template.line,
                collapsible: collapsibleFor(children.length),
                children,
            });

            // Reveal targets: the template's HTML and its code-behind(s).
            this.mapFile(template.file, item);
            [...template.helpers, ...template.events].forEach(({ file }) =>
                this.mapFile(file, item)
            );

            return item;
        });

        const leafItems = (entries, icon) =>
            entries.map((entry) => {
                const item = createItem({
                    label: entry.name,
                    icon,
                    description: locationDescription(entry),
                    file: entry.file,
                    line: entry.line,
                });
                this.mapFile(entry.file, item);
                return item;
            });

        const section = (label, icon, entries) =>
            createItem({
                label: `${label} (${entries.length})`,
                icon,
                collapsible: collapsibleFor(entries.length),
                children: entries,
            });

        return [
            section("Templates", "layout", templateItems),
            section(
                "Global Helpers",
                "globe",
                leafItems(data.globalHelpers, "symbol-function")
            ),
            section(
                "Methods",
                "zap",
                leafItems(data.methods, "symbol-method")
            ),
            section(
                "Publications",
                "radio-tower",
                leafItems(data.publications, "symbol-interface")
            ),
        ];
    }
}

/**
 * "Template Hierarchy" tree: the {{> }} inclusion graph, prunable by the
 * search filter (paths leading to a match are kept).
 */
class HierarchyTreeProvider extends BaseTreeProvider {
    templateNode(template, ancestors) {
        const children = (template.includes || [])
            .filter((include) => !ancestors.has(include.name))
            .filter((include) =>
                hierarchyBranchMatches(
                    this.byName,
                    include.name,
                    this.filterText
                )
            )
            .map((include) => {
                const target = this.byName[include.name];
                if (!target) {
                    return createItem({
                        label: include.name,
                        icon: "symbol-class",
                        description: "(package or missing)",
                        file: include.file,
                        line: include.line,
                    });
                }
                return this.templateNode(
                    target,
                    new Set([...ancestors, include.name])
                );
            });

        const item = createItem({
            label: template.name,
            icon: "symbol-class",
            description: locationDescription(template),
            file: template.file,
            line: template.line,
            collapsible: children.length
                ? TreeItemCollapsibleState.Expanded
                : TreeItemCollapsibleState.None,
            children,
        });

        this.mapFile(template.file, item);
        (template.helpers || []).forEach(({ file }) =>
            this.mapFile(file, item)
        );

        return item;
    }

    buildRoots() {
        this.byName = Object.fromEntries(
            this.overview.templates.map((template) => [
                template.name,
                template,
            ])
        );

        return this.overview.templates
            .filter((template) => !template.includedBy.length)
            .filter((template) =>
                hierarchyBranchMatches(
                    this.byName,
                    template.name,
                    this.filterText
                )
            )
            .map((template) =>
                this.templateNode(template, new Set([template.name]))
            );
    }
}

const registerMeteorExplorer = (client) => {
    const fetchOverview = async () => {
        try {
            return await client.sendRequest("meteorImpact/appOverview");
        } catch (e) {
            return null;
        }
    };

    const overviewProvider = new OverviewTreeProvider(fetchOverview);
    const hierarchyProvider = new HierarchyTreeProvider(fetchOverview);

    const overviewView = window.createTreeView("meteorImpactOverview", {
        treeDataProvider: overviewProvider,
        showCollapseAll: true,
    });
    const hierarchyView = window.createTreeView("meteorImpactHierarchy", {
        treeDataProvider: hierarchyProvider,
        showCollapseAll: true,
    });

    const updateDescriptions = () => {
        const overviewParts = [];
        if (overviewProvider.scope === "file") {
            overviewParts.push("current file");
        }
        if (overviewProvider.filterText) {
            overviewParts.push(`"${overviewProvider.filterText}"`);
        }
        overviewView.description = overviewParts.join(" · ") || undefined;
        hierarchyView.description = hierarchyProvider.filterText
            ? `"${hierarchyProvider.filterText}"`
            : undefined;
    };

    const setScopeContext = (scopedToFile) =>
        commands.executeCommand(
            "setContext",
            "meteorImpact.explorerScopedToFile",
            scopedToFile
        );
    setScopeContext(false);

    const refreshBoth = ({ reload = true } = {}) => {
        overviewProvider.refresh({ reload });
        hierarchyProvider.refresh({ reload });
    };

    // Reveal the active file's template in the visible views.
    const revealActiveFile = (fsPath) => {
        for (const [view, provider] of [
            [overviewView, overviewProvider],
            [hierarchyView, hierarchyProvider],
        ]) {
            if (!view.visible) continue;

            const element = provider.findElementForFile(fsPath);
            if (!element) continue;

            view
                .reveal(element, { select: true, focus: false, expand: true })
                .then(undefined, () => {});
        }
    };

    const editorListener = window.onDidChangeActiveTextEditor((editor) => {
        const fsPath = editor?.document?.uri?.fsPath;
        if (!fsPath) return;

        if (overviewProvider.scope === "file") {
            overviewProvider.refresh({ reload: false });
        }
        // Give a rebuilding tree a beat before revealing into it.
        setTimeout(() => revealActiveFile(fsPath), 150);
    });

    // Keep the views loosely in sync with edits.
    let refreshTimeout;
    const saveListener = workspace.onDidSaveTextDocument(() => {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => refreshBoth({ reload: true }), 2000);
    });

    return [
        overviewView,
        hierarchyView,
        editorListener,
        saveListener,
        commands.registerCommand("meteorImpact.refreshExplorer", () =>
            refreshBoth({ reload: true })
        ),
        commands.registerCommand("meteorImpact.searchExplorer", async () => {
            const query = await window.showInputBox({
                prompt: "Filter the Meteor Explorer (leave empty to clear)",
                value: overviewProvider.filterText,
                placeHolder: "template, helper, method or event name...",
            });
            if (query === undefined) return;

            overviewProvider.filterText = query;
            hierarchyProvider.filterText = query;
            refreshBoth({ reload: false });
            updateDescriptions();
        }),
        commands.registerCommand("meteorImpact.explorerScopeToFile", () => {
            overviewProvider.scope = "file";
            setScopeContext(true);
            overviewProvider.refresh({ reload: false });
            updateDescriptions();
        }),
        commands.registerCommand("meteorImpact.explorerScopeToAll", () => {
            overviewProvider.scope = "all";
            setScopeContext(false);
            overviewProvider.refresh({ reload: false });
            updateDescriptions();
        }),
        commands.registerCommand(
            "meteorImpact.openLocation",
            async (file, line) => {
                await window.showTextDocument(Uri.file(file), {
                    selection: new Range(
                        Math.max(0, (line || 1) - 1),
                        0,
                        Math.max(0, (line || 1) - 1),
                        0
                    ),
                });
            }
        ),
    ];
};

module.exports = { registerMeteorExplorer };
