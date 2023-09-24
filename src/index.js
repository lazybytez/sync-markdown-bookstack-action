const core = require("@actions/core");
const { parseActionsConfiguration } = require("./configuration");
const { parsePagesAtPath } = require("./parser");
const { upsertPages } = require("./bookstack");

async function runAction() {
    try {
        const config = parseActionsConfiguration();
        const pages = await parsePagesAtPath(config.syncConfiguration.path);

        await upsertPages(config, pages);
    } catch (error) {
        core.setFailed(error.message);
    }
}

runAction();
