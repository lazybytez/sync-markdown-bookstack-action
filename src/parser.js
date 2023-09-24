const core = require("@actions/core");
const glob = require("glob");
const fs = require("fs");

/**
 * @typedef {Object} FileContent
 * @property {string} file The path to the file.
 * @property {string} content The content of the file.
 */

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
 * @returns {Promise<string[]>} An array of paths.
 */
async function findFiles(path) {
    core.info(`🔍 Finding files using path: "${path}"`);
    let files = [path];

    if (path.includes("*")) {
        files = await glob.glob(path);
    }

    if (files.length === 0) {
        throw new Error(`❌ No files found matching path "${path}"`);
    }

    files.forEach((file) => core.info(`📄 Found file: "${file}"`));

    core.info(`✅ Found ${files.length} file(s)`);

    return files;
}

/**
 * Read all files at the given paths and return their content.
 *
 * This function will skip files that cannot be read and log a warning
 * instead of throwing an error.
 *
 * @param {string[]} files
 * @returns {Promise<FileContent[]>}
 */
async function readPageFiles(files) {
    core.info(`📖 Reading ${files.length} files`);

    const readPromises = [];

    files.forEach((file) => {
        readPromises.push(
            (async () => {
                try {
                    await fs.promises.stat(file);
                } catch (error) {
                    core.warning(`⚠️ File "${file}" does not exist, skipping`);

                    throw error;
                }

                try {
                    return {
                        file: file,
                        content: await fs.promises.readFile(file, "utf8"),
                    };
                } catch (error) {
                    core.warning(`⚠️ Could not read file "${file}", skipping`);
                }
            })(),
        );
    });

    const pagesResults = await Promise.allSettled(readPromises);
    const pages = [];

    for (const result of pagesResults) {
        if (result.status === "rejected") {
            continue;
        }

        pages.push(result.value);
        core.info(`📄 Read file: "${result.value.file}"`);
    }

    return pages;
}

/**
 * Extract the heading from the given page content and create a Page object.
 *
 * This function will log a warning if the page does not have a heading.
 *
 * @param {FileContent} fileContent
 *
 * @returns {Page}
 */
function parsePage(fileContent) {
    const file = fileContent.file;
    const content = fileContent.content;

    const headings = content.match(/^# (.*)$/m);

    if (!headings) {
        core.warning(
            `⚠️ Page content of file "${file}" does not have a heading, skipping`,
        );

        return null;
    }

    const mainHeading = headings[1].trim();
    const contentWithoutHeading = content.replace(/^# (.*)$/m, "").trim();

    core.info(`📝 Parsed page: "${mainHeading}"`);

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
 * @param {FileContent[]} fileContents
 * @returns {Page[]}
 */
function parsePages(fileContents) {
    core.info(`🪄 Parsing ${fileContents.length} pages`);

    const pages = [];

    for (const fileContent of fileContents) {
        const page = parsePage(fileContent);

        if (page) {
            pages.push(page);
        }
    }

    core.info(`✅ Parsed ${pages.length} page(s)`);

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
 * @returns {Promise<Page[]>}
 */
async function parsePagesAtPath(path) {
    const files = await findFiles(path);
    core.info("");

    const pagesContent = await readPageFiles(files);
    core.info("");

    const pages = parsePages(pagesContent);
    core.info("");

    return pages;
}

module.exports = {
    parsePagesAtPath,
};
