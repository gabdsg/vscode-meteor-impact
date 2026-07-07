/**
 * Heuristics to decide whether a file runs on the Meteor server. There is
 * no build-time truth for this in a Meteor project, so we combine:
 *  1 - Path conventions: any "server" path segment (server/,
 *      imports/server/, imports/api/x/server/...).
 *  2 - The index: the file defines a method or publication.
 *  3 - A Meteor.isServer guard anywhere in the content (weakest signal:
 *      shared files with server blocks still count as server-capable).
 */
const path = require("path");

const SERVER_SEGMENT = "server";

const hasServerPathSegment = (fsPath, rootFsPath) => {
    const relativePath = rootFsPath
        ? path.relative(rootFsPath, fsPath)
        : fsPath;

    return relativePath
        .split(/[\\/]/)
        .some((segment) => segment === SERVER_SEGMENT);
};

const definesMethodOrPublication = (fsPath, indexer) => {
    const maps = [
        indexer?.methodsAndPublicationsIndexer?.methodsMap,
        indexer?.methodsAndPublicationsIndexer?.publicationsMap,
    ];

    return maps.some((map) =>
        Object.values(map || {}).some(({ uri }) => uri?.fsPath === fsPath)
    );
};

const hasIsServerGuard = (fileContent) =>
    typeof fileContent === "string" &&
    /\bMeteor\s*\.\s*isServer\b/.test(fileContent);

const isServerSideFile = ({ fsPath, rootFsPath, indexer, fileContent }) => {
    if (hasServerPathSegment(fsPath, rootFsPath)) {
        return { isServer: true, reason: "path" };
    }

    if (definesMethodOrPublication(fsPath, indexer)) {
        return { isServer: true, reason: "defines-methods" };
    }

    if (hasIsServerGuard(fileContent)) {
        return { isServer: true, reason: "isServer-guard" };
    }

    return { isServer: false };
};

module.exports = { isServerSideFile };
