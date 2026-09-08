const { createOrMergeJsonFile } = require("./helpers");
const { JSCONFIG, BASE_LAUNCH_CONFIG } = require("./constants");
const { uniqBy, uniq } = require("lodash");

// Both files go through createOrMergeJsonFile, which stats the known path
// itself: an existing file is merged into, never replaced.
const addDebugAndRunOptions = () =>
    createOrMergeJsonFile(
        BASE_LAUNCH_CONFIG.uri,
        BASE_LAUNCH_CONFIG.baseConfig(),
        (target, source) => uniqBy([...source, ...target], ({ name }) => name)
    );

const generateBaseJsConfig = () =>
    createOrMergeJsonFile(JSCONFIG.uri, JSCONFIG.baseConfig, (target, source) =>
        uniq([...target, ...source])
    );

module.exports = {
    addDebugAndRunOptions,
    generateBaseJsConfig,
};
