/**
 * Parsers for the .meteor/packages and .meteor/versions files. Pure
 * functions, so they are testable outside VS Code.
 */

// "accounts-base@2.2.8" lines -> { "accounts-base": "2.2.8", ... }
const parseVersionsFile = (content) => {
    const versions = {};

    for (const line of `${content || ""}`.split("\n")) {
        const match = line.trim().match(/^([\w:.-]+)@([\w.+-]+)$/);
        if (match) versions[match[1]] = match[2];
    }

    return versions;
};

// Package names listed in .meteor/packages, comments stripped.
const parsePackagesFile = (content) => {
    return `${content || ""}`
        .split("\n")
        .map((line) => line.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .map((entry) => entry.split("@")[0].trim());
};

module.exports = { parseVersionsFile, parsePackagesFile };
