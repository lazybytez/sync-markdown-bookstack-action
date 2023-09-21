const core = require("@actions/core");
const github = require("@actions/github");
const { parseActionsConfiguration } = require("./configuration");

function readFiles() {}

try {
    const config = parseActionsConfiguration();
} catch (error) {
    core.setFailed(error.message);
}
