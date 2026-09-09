const assert = require("assert");
const Module = require("module");

// ponytail: the smallest in-memory `vscode` that lets src/helpers.js and
// src/base-configs.js load outside the extension host. Grow it when another
// client module gets a unit test.
const files = new Map(); // fsPath -> file content (string)
const fileNotFound = (uri) =>
    Object.assign(new Error(`ENOENT: ${uri.fsPath}`), {
        code: "FileNotFound",
    });
const statFromMap = async (uri) => {
    if (!files.has(uri.fsPath)) throw fileNotFound(uri);
    return { type: 1 };
};
let stat = statFromMap;

const vscode = {
    Uri: {
        joinPath: (base, ...parts) => ({
            fsPath: [base.fsPath, ...parts].join("/"),
        }),
    },
    window: { showErrorMessage: () => {} },
    commands: {},
    workspace: {
        workspaceFolders: [{ uri: { fsPath: "/ws" } }],
        getConfiguration: () => ({
            get: (key) => (key.endsWith(".port") ? "3000" : undefined),
        }),
        // The failure that triggered the bug: a search that finds nothing
        // while the file is right there.
        findFiles: async () => [],
        fs: {
            stat: (uri) => stat(uri),
            readFile: async (uri) => Buffer.from(files.get(uri.fsPath)),
            writeFile: async (uri, data) => {
                files.set(uri.fsPath, Buffer.from(data).toString());
            },
        },
    },
};

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    return request === "vscode"
        ? "vscode"
        : resolveFilename.call(this, request, ...rest);
};
require.cache.vscode = {
    id: "vscode",
    filename: "vscode",
    loaded: true,
    exports: vscode,
};

const {
    addDebugAndRunOptions,
    generateBaseJsConfig,
} = require("../../src/base-configs");

const LAUNCH = "/ws/.vscode/launch.json";
const JSCONFIG = "/ws/jsconfig.json";
const userLaunch = {
    version: "0.2.0",
    configurations: [
        {
            type: "node",
            request: "launch",
            name: "My API",
            env: { API_SECRET: "keep-me" },
        },
    ],
};
const names = (fsPath) =>
    JSON.parse(files.get(fsPath)).configurations.map(({ name }) => name);

describe("base-configs - generated files never replace existing ones", () => {
    beforeEach(() => {
        files.clear();
        stat = statFromMap;
    });

    it("merges into an existing launch.json even when findFiles returns []", async () => {
        files.set(LAUNCH, JSON.stringify(userLaunch));

        await addDebugAndRunOptions();

        // The user's own configs keep their place at the top of the list;
        // generated ones are appended after them.
        assert.deepStrictEqual(names(LAUNCH), [
            "My API",
            "Meteor: Run",
            "Meteor: Debug",
        ]);
        const mine = JSON.parse(files.get(LAUNCH)).configurations[0];
        assert.strictEqual(mine.env.API_SECRET, "keep-me");
    });

    it("creates launch.json only when stat reports FileNotFound", async () => {
        await addDebugAndRunOptions();

        assert.deepStrictEqual(names(LAUNCH), [
            "Meteor: Run",
            "Meteor: Debug",
        ]);
    });

    it("writes nothing when stat fails for any other reason", async () => {
        files.set(LAUNCH, JSON.stringify(userLaunch));
        stat = async () => {
            throw Object.assign(new Error("EACCES"), {
                code: "NoPermissions",
            });
        };

        await addDebugAndRunOptions();

        assert.strictEqual(files.get(LAUNCH), JSON.stringify(userLaunch));
    });

    it("keeps a user's own settings on a config named like a generated one", async () => {
        // The customisation that kept disappearing: same name as a generated
        // config, plus keys the template has no opinion about.
        files.set(
            LAUNCH,
            JSON.stringify({
                version: "0.2.0",
                configurations: [
                    {
                        type: "node",
                        request: "launch",
                        name: "Meteor: Run",
                        runtimeExecutable: "meteor",
                        envFile: "${workspaceFolder}/.env",
                        runtimeArgs: [
                            "run",
                            "--port",
                            "3000",
                            "--settings",
                            "settings.json",
                        ],
                    },
                ],
            })
        );

        await addDebugAndRunOptions();

        const configs = JSON.parse(files.get(LAUNCH)).configurations;
        const run = configs.find(({ name }) => name === "Meteor: Run");
        assert.strictEqual(run.envFile, "${workspaceFolder}/.env");
        assert.deepStrictEqual(run.runtimeArgs, [
            "run",
            "--port",
            "3000",
            "--settings",
            "settings.json",
        ]);
        // Nothing from the generated config bleeds into the one we kept.
        assert.ok(!("noDebug" in run));
        // A generated config the user does not have is still added.
        assert.ok(configs.some(({ name }) => name === "Meteor: Debug"));
    });

    it("leaves a launch.json that already has both generated configs alone", async () => {
        await addDebugAndRunOptions();
        const generated = files.get(LAUNCH);

        await addDebugAndRunOptions();

        assert.strictEqual(files.get(LAUNCH), generated);
    });

    it("applies the same guard to jsconfig.json", async () => {
        files.set(
            JSCONFIG,
            JSON.stringify({
                compilerOptions: { target: "es2022" },
                exclude: ["dist"],
            })
        );

        await generateBaseJsConfig();

        const out = JSON.parse(files.get(JSCONFIG));
        assert.strictEqual(out.compilerOptions.target, "es2022");
        assert.deepStrictEqual(out.exclude, [
            "dist",
            "node_modules",
            ".meteor",
        ]);
    });
});
