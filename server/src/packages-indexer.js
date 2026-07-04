/**
 * Read-only awareness of installed Meteor packages, scanned from the
 * project's built bundles in .meteor/local/build (present after the app
 * has run at least once). Compiled Blaze templates leave recognizable
 * markers in the package JS, so templates and global helpers provided by
 * packages (e.g. loginButtons from accounts-ui) can resolve in
 * definitions, completions and diagnostics - without ever being touched
 * by rename/quick fixes.
 */

const PACKAGES_BUILD_PATH = [
    ".meteor",
    "local",
    "build",
    "programs",
    "web.browser",
    "packages",
];

const TEMPLATE_MARKER_REGEXES = [
    /Template\.__checkName\("([^"]+)"\)/g,
    /Template\["([^"]+)"\]\s*=\s*new\s+Template\(/g,
];
const GLOBAL_HELPER_REGEX = /Template\.registerHelper\(\s*"([^"]+)"/g;

class PackagesIndexer {
    constructor() {
        this.templates = {};
        this.globalHelpers = {};
        this.loaded = false;
    }

    async load(rootUri) {
        const fs = require("fs/promises");
        const path = require("path");
        const { URI } = require("vscode-uri");
        const { offsetToLoc } = require("./text-utils");

        this.templates = {};
        this.globalHelpers = {};
        this.loaded = true;

        const packagesDir = path.join(
            rootUri.fsPath,
            ...PACKAGES_BUILD_PATH
        );

        let files;
        try {
            files = await fs.readdir(packagesDir);
        } catch (e) {
            // No local build yet: package symbols simply stay unknown.
            return;
        }

        for (const file of files.filter((f) => f.endsWith(".js"))) {
            const fsPath = path.join(packagesDir, file);
            // Bundled file names use underscores for scoped packages.
            const packageName = file
                .replace(/\.js$/, "")
                .replace(/_/g, ":");

            let content;
            try {
                content = await fs.readFile(fsPath, "utf-8");
            } catch (e) {
                continue;
            }

            const uri = URI.file(fsPath);
            const addEntry = (map, name, offset) => {
                if (map[name]) return;
                map[name] = {
                    packageName,
                    uri,
                    loc: offsetToLoc(content, offset),
                };
            };

            for (const regex of TEMPLATE_MARKER_REGEXES) {
                for (const match of content.matchAll(regex)) {
                    addEntry(this.templates, match[1], match.index);
                }
            }

            for (const match of content.matchAll(GLOBAL_HELPER_REGEX)) {
                addEntry(this.globalHelpers, match[1], match.index);
            }
        }
    }
}

module.exports = { PackagesIndexer };
