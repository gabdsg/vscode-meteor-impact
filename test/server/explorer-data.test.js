const assert = require("assert");

const {
    filterOverview,
    hierarchyBranchMatches,
} = require("../../src/explorer-data");

const overview = {
    templates: [
        {
            name: "taskItem",
            file: "/app/client/taskItem/taskItem.html",
            helpers: [
                { name: "checkedClass", file: "/app/client/taskItem/taskItem.ts" },
                { name: "isOwner", file: "/app/client/taskItem/taskItem.ts" },
            ],
            events: [
                { name: "click .js-delete", file: "/app/client/taskItem/taskItem.ts" },
            ],
            includes: [],
            includedBy: ["taskList"],
        },
        {
            name: "taskList",
            file: "/app/client/taskList/taskList.html",
            helpers: [{ name: "tasks", file: "/app/client/taskList/taskList.ts" }],
            events: [],
            includes: [{ name: "taskItem", file: "/app/client/taskList/taskList.html", line: 3 }],
            includedBy: ["home"],
        },
        {
            name: "home",
            file: "/app/client/home.html",
            helpers: [],
            events: [],
            includes: [{ name: "taskList", file: "/app/client/home.html", line: 2 }],
            includedBy: [],
        },
    ],
    globalHelpers: [{ name: "formatDate", file: "/app/client/globals.ts" }],
    methods: [
        { name: "tasks.insert", file: "/app/server/methods.ts" },
        { name: "users.ban", file: "/app/server/admin.ts" },
    ],
    publications: [{ name: "tasks.mine", file: "/app/server/publications.ts" }],
};

const templatesByName = Object.fromEntries(
    overview.templates.map((template) => [template.name, template])
);

describe("Explorer filtering", () => {
    it("keeps whole templates whose name matches the query", () => {
        const filtered = filterOverview(overview, { query: "taskitem" });

        assert.deepStrictEqual(
            filtered.templates.map(({ name }) => name),
            ["taskItem"]
        );
        // All children retained when the template itself matches.
        assert.strictEqual(filtered.templates[0].helpers.length, 2);
        assert.strictEqual(filtered.methods.length, 0);
    });

    it("prunes templates to matching helpers/events", () => {
        const filtered = filterOverview(overview, { query: "checked" });

        assert.strictEqual(filtered.templates.length, 1);
        assert.deepStrictEqual(
            filtered.templates[0].helpers.map(({ name }) => name),
            ["checkedClass"]
        );
        assert.strictEqual(filtered.templates[0].events.length, 0);
    });

    it("matches flat sections by query", () => {
        const filtered = filterOverview(overview, { query: "tasks." });

        assert.deepStrictEqual(
            filtered.methods.map(({ name }) => name),
            ["tasks.insert"]
        );
        assert.deepStrictEqual(
            filtered.publications.map(({ name }) => name),
            ["tasks.mine"]
        );
        assert.strictEqual(filtered.globalHelpers.length, 0);
    });

    it("scopes to the active file, including code-behinds", () => {
        const filtered = filterOverview(overview, {
            activeFile: "/app/client/taskItem/taskItem.ts",
        });

        assert.deepStrictEqual(
            filtered.templates.map(({ name }) => name),
            ["taskItem"]
        );
        assert.strictEqual(filtered.methods.length, 0);
    });

    it("combines scope and query", () => {
        const filtered = filterOverview(overview, {
            activeFile: "/app/client/taskItem/taskItem.ts",
            query: "owner",
        });

        assert.strictEqual(filtered.templates.length, 1);
        assert.deepStrictEqual(
            filtered.templates[0].helpers.map(({ name }) => name),
            ["isOwner"]
        );
    });

    it("keeps hierarchy branches leading to a match", () => {
        // home -> taskList -> taskItem: a query matching the leaf keeps
        // the whole chain.
        assert.strictEqual(
            hierarchyBranchMatches(templatesByName, "home", "taskItem"),
            true
        );
        assert.strictEqual(
            hierarchyBranchMatches(templatesByName, "taskList", "taskItem"),
            true
        );
        assert.strictEqual(
            hierarchyBranchMatches(templatesByName, "taskItem", "home"),
            false
        );
        // Empty query matches everything.
        assert.strictEqual(
            hierarchyBranchMatches(templatesByName, "taskItem", ""),
            true
        );
    });

    it("is cycle-safe", () => {
        const cyclic = {
            a: { name: "a", includes: [{ name: "b" }] },
            b: { name: "b", includes: [{ name: "a" }] },
        };

        assert.strictEqual(
            hierarchyBranchMatches(cyclic, "a", "nomatch"),
            false
        );
    });
});
