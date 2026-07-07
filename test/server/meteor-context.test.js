const assert = require("assert");
const path = require("path");

const { isServerSideFile } = require("../../server/src/meteor-context");

const ROOT = path.join("/tmp", "app");
const at = (...segments) => path.join(ROOT, ...segments);

describe("meteor-context - isServerSideFile", () => {
    it("detects server path segments", () => {
        for (const fsPath of [
            at("server", "main.js"),
            at("imports", "server", "api.js"),
            at("imports", "api", "tasks", "server", "publications.js"),
        ]) {
            const result = isServerSideFile({ fsPath, rootFsPath: ROOT });
            assert.strictEqual(result.isServer, true, fsPath);
            assert.strictEqual(result.reason, "path");
        }
    });

    it("does not match 'server' as a partial segment name", () => {
        const result = isServerSideFile({
            fsPath: at("client", "serverStatus.js"),
            rootFsPath: ROOT,
        });
        assert.strictEqual(result.isServer, false);
    });

    it("detects files defining methods or publications via the index", () => {
        const fsPath = at("imports", "api", "tasks.js");
        const indexer = {
            methodsAndPublicationsIndexer: {
                methodsMap: { "tasks.insert": { uri: { fsPath } } },
                publicationsMap: {},
            },
        };

        const result = isServerSideFile({
            fsPath,
            rootFsPath: ROOT,
            indexer,
        });
        assert.strictEqual(result.isServer, true);
        assert.strictEqual(result.reason, "defines-methods");
    });

    it("detects Meteor.isServer guards in shared files", () => {
        const result = isServerSideFile({
            fsPath: at("imports", "shared.js"),
            rootFsPath: ROOT,
            fileContent: "if (Meteor.isServer) { setupServer(); }",
        });
        assert.strictEqual(result.isServer, true);
        assert.strictEqual(result.reason, "isServer-guard");
    });

    it("returns false for plain client files", () => {
        const result = isServerSideFile({
            fsPath: at("client", "ui.js"),
            rootFsPath: ROOT,
            fileContent: "export const a = 1;",
        });
        assert.deepStrictEqual(result, { isServer: false });
    });
});
