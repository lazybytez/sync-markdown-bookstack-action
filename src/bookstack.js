const core = require("@actions/core");
const axios = require("axios").default;

/**
 * @typedef {Object} BookstackPagePayload
 * @property {integer} book_id
 * @property {integer} chapter_id
 * @property {string} name
 * @property {string} html
 * @property {string} markdown
 * @property {int} priority
 */

const BOOKSTACK_API_PATH = "/api/";
const BOOKSTACK_API_PAGES_PATH = "/pages";
const BOOKSTACK_API_BOOKS_PATH = "/books";
const BOOKSTACK_API_CHAPTERS_PATH = "/chapters";

/**
 * @type {import('axios').AxiosInstance | null}
 */
let bookstackClient = null;

/**
 * Create a post/put payload from a page.
 *
 * @param {import('./configuration.js').PayloadDefaultsConfiguration} payloadDefaults
 *
 * @returns {BookstackPagePayload}
 */
function createPayloadFromPage(payloadDefaults, page) {
    const payload = {
        name: page.name,
        markdown: page.content,
    };

    if (payloadDefaults.bookId) {
        payload.book_id = payloadDefaults.bookId;
    }

    if (payloadDefaults.chapterId) {
        payload.chapter_id = payloadDefaults.chapterId;
    }

    return payload;
}

/**
 * Create post/put payloads from pages.
 *
 * @param {PayloadDefaultsConfiguration} payloadDefaults
 * @param {Page[]} pages
 *
 * @returns {BookstackPagePayload[]}
 */
function createPayloadsFromPages(payloadDefaults, pages) {
    return pages.map((page) => createPayloadFromPage(payloadDefaults, page));
}

/**
 * Get a prepared axios instance for the given bookstack configuration.
 *
 * @param {import('./configuration.js').BookstackCredentials} bookStackConfiguration
 *
 * @returns {import('axios').AxiosInstance}
 */
function getBookstackClient(bookStackConfiguration) {
    if (bookstackClient) {
        return bookstackClient;
    }

    bookstackClient = axios.create({
        baseURL:
            bookStackConfiguration.bookstackUrl.replace(/\/+$/, "") +
            BOOKSTACK_API_PATH,
        headers: {
            Authorization: `Token ${bookStackConfiguration.bookstackTokenId}:${bookStackConfiguration.bookStackTokenSecret}`,
            "Content-Type": "application/json",
        },
    });

    return bookstackClient;
}

/**
 * Retrieve existing pages from a chapter.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 *
 * @throws {Error} If the pages of the chapter could not be retrieved.
 *
 * @returns {Promise<Map<string, integer>>} A map of page names to page ids.
 */
async function retrieveExistingPagesFromChapter(config) {
    const bookstackClient = getBookstackClient(config.credentials);

    try {
        const result = await bookstackClient.get(
            `${BOOKSTACK_API_CHAPTERS_PATH}/${config.payloadDefaults.chapterId}`,
        );

        const pages = new Map();

        for (const page of result.data.pages) {
            pages.set(page.name, page.id);
            core.info(`📑 Retrieved page: ${page.name} - ${page.id}`);
        }

        return pages;
    } catch (error) {
        core.info(`❌ Failed to retrieve pages from chapter: ${error}`);

        throw error;
    }
}

/**
 * Retrieve existing pages from a book.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 *
 * @throws {Error} If the pages of the book could not be retrieved.
 *
 * @returns {Promise<Map<string, integer>>} A map of page names to page ids.
 */
async function retrieveExistingPagesFromBook(config) {
    const bookstackClient = getBookstackClient(config.credentials);

    try {
        const result = await bookstackClient.get(
            `${BOOKSTACK_API_BOOKS_PATH}/${config.payloadDefaults.bookId}`,
        );

        const pages = new Map();

        for (const entity of result.data.contents) {
            if (entity.type !== "page") {
                continue;
            }

            pages.set(entity.name, entity.id);
            core.info(`📑 Retrieved page: ${entity.name} - ${entity.id}`);
        }

        return pages;
    } catch (error) {
        core.info(`❌ Failed to retrieve pages from book: ${error}`);

        throw error;
    }
}

/**
 * Retrieve existing pages (their name) and their id from bookstack.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 *
 * @throws {Error} If the pages of the book or chapter could not be retrieved.
 *
 * @returns {Promise<Map<string, integer>>} A map of page names to page ids.
 */
async function retrieveExistingPages(config) {
    core.info("🔎 Retrieving existing pages from BookStack");

    if (!config.payloadDefaults.bookId && !config.payloadDefaults.chapterId) {
        throw new Error(
            "❌ Cannot pull existing pages as both book-id and chapter-id are missing",
        );
    }

    if (config.payloadDefaults.chapterId) {
        const pages = await retrieveExistingPagesFromChapter(config);

        core.info(`✅ Retrieved ${pages.size} existing pages from BookStack`);

        return pages;
    }

    const pages = await retrieveExistingPagesFromBook(config);
    core.info(`✅ Retrieved ${pages.size} existing pages from BookStack`);

    return pages;
}

/**
 * Create the supplied page in bookstack.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 * @param {import('./parser.js').Page} page
 */
async function createPage(config, page) {
    const pagePayload = createPayloadFromPage(config.payloadDefaults, page);
    const bookstackClient = getBookstackClient(config.credentials);

    try {
        const result = await bookstackClient.post(
            BOOKSTACK_API_PAGES_PATH,
            pagePayload,
        );
        core.info(`📝 Created page: ${page.name}`);

        return result;
    } catch (error) {
        core.info(`❌ Failed to create page: ${page.name} - ${error}`);

        throw error;
    }
}

/**
 * Update the supplied page in bookstack.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 * @param {integer} pageId
 * @param {import('./parser.js').Page} page
 */
async function updatePage(config, pageId, page) {
    const pagePayload = createPayloadFromPage(config.payloadDefaults, page);
    const bookstackClient = getBookstackClient(config.credentials);

    try {
        const result = await bookstackClient.put(
            `${BOOKSTACK_API_PAGES_PATH}/${pageId}`,
            pagePayload,
        );

        core.info(`📝 Updated page: ${page.name}`);

        return result;
    } catch (error) {
        core.info(`❌ Failed to create page: ${page.name} - ${error}`);
    }
}

/**
 * Create or update the supplied pages in bookstack.
 *
 * @param {import('./configuration.js').ActionConfiguration} config
 * @param {import('./parser.js').Page[]} pages
 */
async function upsertPages(config, pages) {
    const existingPages = await retrieveExistingPages(config);
    core.info("");

    core.info("🔁 Upserting pages in BookStack");
    for (const page of pages) {
        const pageId = existingPages.get(page.name);

        if (pageId) {
            await updatePage(config, pageId, page);
        } else {
            await createPage(config, page);
        }
    }
    core.info(`✅ Finished upserting pages to BookStack`);
}

module.exports = {
    upsertPages: upsertPages,
};
