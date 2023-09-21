const core = require("@actions/core");
const github = require("@actions/github");
const { parseActionsConfiguration } = require("./configuration");
const { parsePagesAtPath } = require("./parser");

function readFiles() {}

try {
    const config = parseActionsConfiguration();
    const pages = parsePagesAtPath(config.syncConfiguration.path);

    core.info(JSON.stringify(pages));
} catch (error) {
    core.setFailed(error.message);
}
