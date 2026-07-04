/**
 * Warm-start cache: persist the index maps plus per-file mtimes/sizes, so
 * an unchanged project restores instantly instead of re-parsing every
 * file. URIs round-trip through vscode-uri's toJSON/$mid + URI.revive.
 * The cache lives in the OS temp dir keyed by a hash of the project root,
 * so user repositories are never polluted.
 */

// Bump when the shape of the index maps changes.
const CACHE_VERSION = 1;

const cacheFilePath = (rootUri) => {
    const crypto = require("crypto");
    const os = require("os");
    const path = require("path");

    const hash = crypto
        .createHash("sha1")
        .update(rootUri.fsPath)
        .digest("hex")
        .slice(0, 16);
    return path.join(os.tmpdir(), "meteor-impact-cache", `${hash}.json`);
};

const collectFileMeta = async (uris) => {
    const fs = require("fs/promises");

    const meta = {};
    await Promise.all(
        uris.map(async (uri) => {
            try {
                const stat = await fs.stat(uri.fsPath);
                meta[uri.fsPath] = { mtimeMs: stat.mtimeMs, size: stat.size };
            } catch (e) {
                // Unreadable file: leave it out; the set comparison fails.
            }
        })
    );
    return meta;
};

const deepReviveUris = (value) => {
    if (Array.isArray(value)) return value.map(deepReviveUris);

    if (value && typeof value === "object") {
        if (value.$mid !== undefined) {
            return require("vscode-uri").URI.revive(value);
        }
        for (const key of Object.keys(value)) {
            value[key] = deepReviveUris(value[key]);
        }
    }
    return value;
};

const saveIndexCache = async (indexer, uris) => {
    try {
        const fs = require("fs/promises");
        const path = require("path");

        const {
            templateIndexMap,
            htmlUsageMap,
            globalHelpersMap,
            eventsMap,
            templateJsReferences,
            templateSelectorsMap,
        } = indexer.blazeIndexer;
        const { methodsMap, publicationsMap, usageMap } =
            indexer.methodsAndPublicationsIndexer;

        const data = {
            version: CACHE_VERSION,
            files: await collectFileMeta(uris),
            blaze: {
                templateIndexMap,
                htmlUsageMap,
                globalHelpersMap,
                eventsMap,
                templateJsReferences,
                templateSelectorsMap,
            },
            methods: { methodsMap, publicationsMap, usageMap },
        };

        const filePath = cacheFilePath(indexer.rootUri);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn(`Index cache save failed. ${e}`);
        return false;
    }
};

// Restores the maps when the file set and every mtime/size are unchanged.
const loadIndexCache = async (indexer, uris) => {
    try {
        const fs = require("fs/promises");

        const raw = await fs.readFile(cacheFilePath(indexer.rootUri), "utf-8");
        const data = JSON.parse(raw);
        if (data.version !== CACHE_VERSION) return false;

        const currentMeta = await collectFileMeta(uris);
        const cachedPaths = Object.keys(data.files);
        if (cachedPaths.length !== Object.keys(currentMeta).length) {
            return false;
        }
        const unchanged = cachedPaths.every(
            (fsPath) =>
                currentMeta[fsPath] &&
                currentMeta[fsPath].mtimeMs === data.files[fsPath].mtimeMs &&
                currentMeta[fsPath].size === data.files[fsPath].size
        );
        if (!unchanged) return false;

        Object.assign(indexer.blazeIndexer, deepReviveUris(data.blaze));
        Object.assign(
            indexer.methodsAndPublicationsIndexer,
            deepReviveUris(data.methods)
        );
        return true;
    } catch (e) {
        return false;
    }
};

module.exports = { saveIndexCache, loadIndexCache, cacheFilePath };
