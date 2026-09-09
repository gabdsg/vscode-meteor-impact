const { createOrMergeJsonFile } = require("./helpers");
const { JSCONFIG, BASE_LAUNCH_CONFIG } = require("./constants");
const { uniqBy, uniq } = require("lodash");

// Both files go through createOrMergeJsonFile, which stats the known path
// itself: an existing file is merged into, never replaced.

// A launch configuration the user already has wins over the generated one of
// the same name, and deepmerge must not reach inside it either. `target` is
// what is in the file, `source` is what we generate; listing target first
// makes uniqBy keep the user's entry, and returning plain copies keeps
// deepmerge from merging a generated config's keys into it. Anything we
// generate that the user has no config for is still appended.
const preferExistingByName = (target, source) =>
    uniqBy([...target, ...source], ({ name }) => name).map((config) => ({
        ...config,
    }));

const addDebugAndRunOptions = () =>
    createOrMergeJsonFile(
        BASE_LAUNCH_CONFIG.uri,
        BASE_LAUNCH_CONFIG.baseConfig(),
        preferExistingByName
    );

const generateBaseJsConfig = () =>
    createOrMergeJsonFile(JSCONFIG.uri, JSCONFIG.baseConfig, (target, source) =>
        uniq([...target, ...source])
    );

module.exports = {
    addDebugAndRunOptions,
    generateBaseJsConfig,
};
