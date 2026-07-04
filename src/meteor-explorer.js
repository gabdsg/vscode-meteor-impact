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

const createItem = ({
    label,
    icon,
    description,
    collapsible = TreeItemCollapsibleState.None,
    file,
    line,
    children,
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
    return item;
};

const locationDescription = ({ file, unused }) =>
    [file && path.basename(file), unused && "(unused)"]
        .filter(Boolean)
        .join(" ");

/**
 * "App Overview" tree: Templates (helpers/events), Global Helpers,
 * Methods and Publications, app-wide, from the language server's index.
 */
class OverviewTreeProvider {
    constructor(fetchOverview) {
        this.fetchOverview = fetchOverview;
        this.changeEmitter = new EventEmitter();
        this.onDidChangeTreeData = this.changeEmitter.event;
        this.overview = null;
    }

    refresh() {
        this.overview = null;
        this.changeEmitter.fire();
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        if (element) return element.childrenItems || [];

        this.overview = this.overview || (await this.fetchOverview());
        if (!this.overview) {
            return [createItem({ label: "Waiting for the index..." })];
        }

        const { templates, globalHelpers, methods, publications } =
            this.overview;

        const templateItems = templates.map((template) =>
            createItem({
                label: template.name,
                icon: "symbol-class",
                description: locationDescription(template),
                file: template.file,
                line: template.line,
                collapsible:
                    template.helpers.length || template.events.length
                        ? TreeItemCollapsibleState.Collapsed
                        : TreeItemCollapsibleState.None,
                children: [
                    ...template.helpers.map((helper) =>
                        createItem({
                            label: helper.name,
                            icon: "symbol-function",
                            description: locationDescription(helper),
                            file: helper.file,
                            line: helper.line,
                        })
                    ),
                    ...template.events.map((event) =>
                        createItem({
                            label: event.name,
                            icon: "symbol-event",
                            description: locationDescription(event),
                            file: event.file,
                            line: event.line,
                        })
                    ),
                ],
            })
        );

        const section = (label, icon, entries) =>
            createItem({
                label: `${label} (${entries.length})`,
                icon,
                collapsible: entries.length
                    ? TreeItemCollapsibleState.Collapsed
                    : TreeItemCollapsibleState.None,
                children: entries,
            });

        const leafItems = (entries, icon) =>
            entries.map((entry) =>
                createItem({
                    label: entry.name,
                    icon,
                    description: locationDescription(entry),
                    file: entry.file,
                    line: entry.line,
                })
            );

        return [
            section("Templates", "layout", templateItems),
            section(
                "Global Helpers",
                "globe",
                leafItems(globalHelpers, "symbol-function")
            ),
            section("Methods", "zap", leafItems(methods, "symbol-method")),
            section(
                "Publications",
                "radio-tower",
                leafItems(publications, "symbol-interface")
            ),
        ];
    }
}

/**
 * "Template Hierarchy" tree: the {{> }} inclusion graph. Roots are the
 * templates nobody includes; children are the templates they include.
 */
class HierarchyTreeProvider {
    constructor(fetchOverview) {
        this.fetchOverview = fetchOverview;
        this.changeEmitter = new EventEmitter();
        this.onDidChangeTreeData = this.changeEmitter.event;
        this.overview = null;
    }

    refresh() {
        this.overview = null;
        this.changeEmitter.fire();
    }

    getTreeItem(element) {
        return element;
    }

    templateNode(template, ancestors) {
        const includes = template.includes || [];
        const children = includes
            .filter((include) => !ancestors.has(include.name))
            .map((include) => {
                const target = this.byName[include.name];
                if (!target) {
                    // Package-provided or missing template: leaf node.
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

        return createItem({
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
    }

    async getChildren(element) {
        if (element) return element.childrenItems || [];

        this.overview = this.overview || (await this.fetchOverview());
        if (!this.overview) {
            return [createItem({ label: "Waiting for the index..." })];
        }

        this.byName = Object.fromEntries(
            this.overview.templates.map((template) => [
                template.name,
                template,
            ])
        );

        return this.overview.templates
            .filter((template) => !template.includedBy.length)
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

    const refresh = () => {
        overviewProvider.refresh();
        hierarchyProvider.refresh();
    };

    // Keep the views loosely in sync with edits.
    let refreshTimeout;
    const saveListener = workspace.onDidSaveTextDocument(() => {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(refresh, 2000);
    });

    return [
        window.registerTreeDataProvider(
            "meteorImpactOverview",
            overviewProvider
        ),
        window.registerTreeDataProvider(
            "meteorImpactHierarchy",
            hierarchyProvider
        ),
        commands.registerCommand("meteorImpact.refreshExplorer", refresh),
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
        saveListener,
    ];
};

module.exports = { registerMeteorExplorer };
