import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { isWithin } from "../config/workspace.js";
import {
    nameAndPriority,
    normalizeTags,
    optionalText,
    parseMetadata,
    priorityOrDefault,
} from "./metadata.js";

/**
 * Groups selected files into the direct pages and first-level chapters of a target.
 * @param {{path: string, files: string[], chapterId?: number}} target
 * @param {{path: string}[]} targets
 */
export async function planTargetLayout(target, targets) {
    const flat = { files: target.files, chapters: [] };
    if (target.chapterId !== undefined) {
        return flat;
    }

    const root = await realpath(target.path);
    if (!(await stat(root)).isDirectory()) {
        return flat;
    }

    const otherRoots = await Promise.all(
        targets
            .filter((entry) => entry.path !== target.path)
            .map(({ path }) => realpath(path)),
    );
    const children = await readdir(root, { withFileTypes: true });
    const chapters = new Map();
    for (const child of children) {
        const directory = join(root, child.name);
        if (child.isDirectory() && !otherRoots.includes(directory)) {
            chapters.set(child.name, { directory, files: [] });
        }
    }

    const files = [];
    for (const file of target.files) {
        const chapter = chapters.get(relative(root, file).split(sep)[0]);
        if (chapter) {
            chapter.files.push(file);
        } else {
            files.push(file);
        }
    }
    return {
        files,
        chapters: [...chapters.values()]
            .filter((chapter) => chapter.files.length > 0)
            .sort((left, right) =>
                left.directory.localeCompare(right.directory),
            ),
    };
}

async function readChapterYaml(directory, file) {
    let path;
    try {
        path = await realpath(file);
    } catch (error) {
        if (error.code === "ENOENT") {
            return "";
        }
        throw error;
    }
    if (!isWithin(directory, path) || !(await stat(path)).isFile()) {
        throw new Error(
            "chapter metadata must be a regular file inside the chapter directory",
        );
    }
    return readFile(path, "utf8");
}

/**
 * Reads optional chapter.yaml and derives defaults from the directory.
 * @param {string} directory
 */
export async function readChapterMetadata(directory) {
    const file = join(directory, "chapter.yaml");
    try {
        const yaml = await readChapterYaml(await realpath(directory), file);
        const metadata = parseMetadata(yaml, [
            "name",
            "description",
            "priority",
            "tags",
        ]);
        const defaults = nameAndPriority(basename(directory));
        if (
            metadata.description !== undefined &&
            typeof metadata.description !== "string"
        ) {
            throw new Error("description must be a string");
        }
        return {
            name: optionalText(metadata.name, "name") ?? defaults.name,
            description: metadata.description ?? "",
            priority: priorityOrDefault(metadata.priority, defaults.priority),
            tags: normalizeTags(metadata.tags),
        };
    } catch (error) {
        throw new Error(`${file}: ${error.message}`);
    }
}

/**
 * Creates a chapter inside an existing book.
 * @param {{request: Function}} client
 * @param {number} bookId
 * @param {object} metadata
 */
export async function createChapter(client, bookId, metadata) {
    return client.request("POST", "/chapters", {
        body: { ...metadata, book_id: bookId },
    });
}

/**
 * Resolves the chapter before handing its pages to the sync operation.
 * @param {string[]} files
 * @param {() => Promise<number|string>} ensureChapter
 * @param {(file: string, chapterId: number|string) => Promise<void>} visit
 */
export async function syncChapterPages(files, ensureChapter, visit) {
    const chapterId = await ensureChapter();
    for (const file of files) {
        await visit(file, chapterId);
    }
}
