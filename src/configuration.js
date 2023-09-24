const core = require("@actions/core");

/**
 * @typedef {Object} BookstackCredentials
 */

/**
 * @typedef {Object} BookstackCredentials
 * @property {string} bookstackUrl The URL of the Bookstack instance.
 * @property {string} bookstackTokenId The token ID used to authenticate with Bookstack.
 * @property {string} bookstackTokenSecret The token secret used to authenticate with Bookstack.
 */

/**
 * @typedef {Object} PayloadDefaultsConfiguration
 * @property {string} bookId The ID of the Bookstack book to sync with.
 * @property {string} chapterId The ID of the Bookstack chapter to sync with.
 */

/**
 * @typedef {Object} SyncConfiguration
 * @property {string} path The path to the Markdown files to sync.
 */

/**
 * @typedef {Object} ActionConfiguration
 * @property {BookstackCredentials} credentials The Bookstack credentials to use for authentication.
 * @property {PayloadDefaultsConfiguration} payloadDefaults The default payload configuration for synced pages.
 * @property {SyncConfiguration} syncConfiguration The sync configuration for the action.
 */

/**
 * Parse bookstack credentials from input
 *
 * @throws {Error} If any required input is missing.
 *
 * @returns {BookstackCredentials}
 */
function parseCredentialsConfiguration() {
    const bookstackUrl = core.getInput("url");
    const bookstackTokenId = core.getInput("token-id");
    const bookStackTokenSecret = core.getInput("token-secret");

    if (!bookstackUrl) {
        throw new Error("❌ Missing input: url");
    }
    if (!bookstackTokenId) {
        throw new Error("❌ Missing input: token-id");
    }
    if (!bookStackTokenSecret) {
        throw new Error("❌ Missing input: token-secret");
    }

    return {
        bookstackUrl: bookstackUrl,
        bookstackTokenId: bookstackTokenId,
        bookStackTokenSecret: bookStackTokenSecret,
    };
}

/**
 * Parse payload defaults from input
 *
 * @throws {Error} If any required input is missing.
 *
 * @returns {PayloadDefaultsConfiguration}
 */
function parsePayloadDefaultsConfiguration() {
    const bookId = core.getInput("book-id");
    const chapterId = core.getInput("chapter-id");

    if (!bookId && !chapterId) {
        throw new Error(
            "❌ Missing input: book-id or chapter-id (at least one needs to be set)",
        );
    }

    return {
        bookId: bookId,
        chapterId: chapterId,
    };
}

/**
 * Parse sync configuration from input
 *
 * @throws {Error} If any required input is missing.
 *
 * @returns {SyncConfiguration}
 */
function parseSyncConfiguration() {
    const path = core.getInput("path");

    if (!path) {
        throw new Error("❌ Missing input: path");
    }

    return {
        path: path,
    };
}

/**
 * Parse configuration from input.
 *
 * @throws {Error} If any required input is missing.
 *
 * @returns {ActionConfiguration}
 */
function parseActionsConfiguration() {
    return {
        credentials: parseCredentialsConfiguration(),
        payloadDefaults: parsePayloadDefaultsConfiguration(),
        syncConfiguration: parseSyncConfiguration(),
    };
}

module.exports = {
    parseActionsConfiguration,
};
