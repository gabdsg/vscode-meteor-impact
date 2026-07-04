/**
 * Pure filtering for the Meteor Explorer views (query + current-file
 * scope), testable outside VS Code.
 */

const nameMatches = (name, query) =>
    !query || name.toLowerCase().includes(query.toLowerCase());

/**
 * Filter an app overview by search query and/or active file.
 * - File scope keeps a template when the file is its HTML or any of its
 *   helpers/events live there (its code-behind); flat sections keep
 *   entries defined in the file.
 * - A query keeps templates whose name matches (with all children) or
 *   that contain a matching helper/event (pruned to the matches).
 */
const filterOverview = (overview, { query = "", activeFile = null } = {}) => {
    let templates = overview.templates;

    if (activeFile) {
        templates = templates.filter(
            (template) =>
                template.file === activeFile ||
                template.helpers.some(({ file }) => file === activeFile) ||
                template.events.some(({ file }) => file === activeFile)
        );
    }

    if (query) {
        templates = templates
            .map((template) => {
                if (nameMatches(template.name, query)) return template;

                const helpers = template.helpers.filter(({ name }) =>
                    nameMatches(name, query)
                );
                const events = template.events.filter(({ name }) =>
                    nameMatches(name, query)
                );
                if (!helpers.length && !events.length) return null;

                return { ...template, helpers, events };
            })
            .filter(Boolean);
    }

    const filterFlat = (entries) =>
        entries
            .filter(({ file }) => !activeFile || file === activeFile)
            .filter(({ name }) => nameMatches(name, query));

    return {
        ...overview,
        templates,
        globalHelpers: filterFlat(overview.globalHelpers),
        methods: filterFlat(overview.methods),
        publications: filterFlat(overview.publications),
    };
};

/**
 * Does this template - or anything it transitively includes - match the
 * query? Used to prune the hierarchy tree while keeping the paths that
 * lead to matches. Cycle-safe.
 */
const hierarchyBranchMatches = (
    templatesByName,
    templateName,
    query,
    seen = new Set()
) => {
    if (!query) return true;
    if (nameMatches(templateName, query)) return true;
    if (seen.has(templateName)) return false;
    seen.add(templateName);

    const template = templatesByName[templateName];
    return (template?.includes || []).some(({ name }) =>
        hierarchyBranchMatches(templatesByName, name, query, seen)
    );
};

module.exports = { filterOverview, hierarchyBranchMatches };
