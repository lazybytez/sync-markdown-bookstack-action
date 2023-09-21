const core = require("@actions/core");
const glob = require("glob");
const fs = require("fs");
const os = require("os");

/**
 * @typedef {Object} Page
 * @property {string} name
 * @property {string} content
 */

/**
 * Find all files at the given path.
 *
 * The function either returns the provided path or
 * tries to resolve the path using glob and return all found files.
 *
 * In any case, the function will return an array of paths.
 *
 * @param {string} path The path to find files at.
 *
 * @returns {string[]} An array of paths.
 */
function findFiles(path) {
    core.info(`🔍 Finding files using path: "${path}"`);
    let files = [path];

    if (path.includes("*")) {
        files = glob.sync(path);
    }

    if (files.length === 0) {
        throw new Error(`❌ No files found matching path "${path}"`);
    }

    core.info(`📚 Found ${files.length} files`);

    return files;
}

/**
 * Read all files at the given paths and return their content.
 *
 * This function will skip files that cannot be read and log a warning
 * instead of throwing an error.
 *
 * @param {string[]} files
 * @returns {string[]}
 */
function readPageFiles(files) {
    core.info(`📖 Reading ${files.length} files`);

    const pages = [];

    for (const file of files) {
        if (!fs.existsSync(file)) {
            core.warning(`⚠️ File "${file}" does not exist, skipping`);
            continue;
        }

        try {
            pages.push(fs.readFileSync(file, "utf8"));
        } catch (error) {
            core.warning(`⚠️ Could not read file "${file}", skipping`);
        }
    }

    core.info(`✅ Read ${pages.length} files`);

    return pages;
}

/**
 * Extract the heading from the given page content and create a Page object.
 *
 * This function will log a warning if the page does not have a heading.
 *
 * @param {string} content
 *
 * @returns {Page}
 */
function parsePage(content) {
    const headings = content.match(/^# (.*)$/m);

    if (!headings) {
        core.warning(`⚠️ Page does not have a heading, skipping`);
        return null;
    }

    const mainHeading = headings[1].trim();
    const contentWithoutHeading = content.replace(/^# (.*)$/m, "").trim();

    core.info(`📝 Parsed page "${mainHeading}"`);

    return {
        name: mainHeading,
        content: contentWithoutHeading,
    };
}

/**
 * Extract the heading from the given page contents and create a Page object.
 *
 * This function will log warnings if the page does not have a heading.
 *
 * @param {string[]} pagesContent
 * @returns {Page[]}
 */
function parsePages(pagesContent) {
    core.info(`🔎 Parsing ${pagesContent.length} pages`);

    const pages = [];

    for (const content of pagesContent) {
        const page = parsePage(content);

        if (page) {
            pages.push(page);
        }
    }

    core.info(`✅ Parsed ${pages.length} pages`);

    return pages;
}

/**
 * Parse all pages at the given path.
 *
 * This function tries to find all pages at the given path and returns them as an array.
 * You can use glob patterns in the path, which means you can either specify a concrete
 * path to a page or use wildcards to find multiple pages.
 *
 * If a page does not have at least one level-one heading, it will be ignored with a warning.
 *
 * @param {string} path
 *
 * @throws {Error} if no pages can be found at the given path
 *
 * @returns {Page[]}
 */
function parsePagesAtPath(path) {
    const files = findFiles(path);
    core.info(os.EOL);

    const pagesContent = readPageFiles(files);
    core.info(os.EOL);

    const pages = parsePages(pagesContent);
    core.info(os.EOL);

    return pages;
}

module.exports = {
    parsePagesAtPath,
};
