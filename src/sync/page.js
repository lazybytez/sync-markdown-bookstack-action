import { basename, extname } from "node:path";
import {
    nameAndPriority,
    normalizeTags,
    optionalText,
    parseMetadata,
    priorityOrDefault,
} from "./metadata.js";

function optionalId(value) {
    return Number.isSafeInteger(value)
        ? String(value)
        : optionalText(value, "id");
}

function splitFrontmatter(content) {
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!/^---[ \t]*$/.test(lines[0])) {
        return { metadata: {}, lines };
    }
    const end = lines.findIndex(
        (line, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line),
    );
    if (end === -1) {
        throw new Error("frontmatter has no closing delimiter");
    }
    return {
        metadata: parseMetadata(lines.slice(1, end).join("\n"), [
            "id",
            "title",
            "priority",
            "tags",
        ]),
        lines: lines.slice(end + 1),
    };
}

function takeHeading(lines) {
    let fence;
    for (const [index, line] of lines.entries()) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (
                marker &&
                marker[1][0] === fence[0] &&
                marker[1].length >= fence.length &&
                !marker[2].trim()
            ) {
                fence = undefined;
            }
            continue;
        }
        if (marker) {
            fence = marker[1];
            continue;
        }
        const name = /^ {0,3}#[ \t]+(.+)$/
            .exec(line)?.[1]
            .replace(/[ \t]+#+[ \t]*$/, "")
            .trim();
        if (name) {
            lines.splice(index, 1);
            return name;
        }
    }
    return undefined;
}

/**
 * Reads page metadata and content from Markdown.
 * @param {string} file
 * @param {string} content
 */
export function parsePage(file, content) {
    try {
        const { metadata, lines } = splitFrontmatter(content);
        const fallback = nameAndPriority(basename(file, extname(file)));
        const name =
            optionalText(metadata.title, "title") ??
            takeHeading(lines) ??
            fallback.name;
        return {
            id: optionalId(metadata.id),
            name,
            priority: priorityOrDefault(metadata.priority, fallback.priority),
            tags: normalizeTags(metadata.tags),
            markdown: lines
                .join("\n")
                .replace(/^(?:[ \t]*\n)+/, "")
                .trimEnd(),
        };
    } catch (error) {
        throw new Error(`${file}: ${error.message}`);
    }
}

/**
 * Rejects reuse of a stable page ID, naming both files.
 * @param {{file: string, id?: string}[]} pages
 */
export function validatePageIds(pages) {
    const seen = new Map();
    for (const { file, id } of pages) {
        if (id === undefined) {
            continue;
        }
        if (seen.has(id)) {
            throw new Error(
                `Duplicate page id "${id}" in "${seen.get(id)}" and "${file}"`,
            );
        }
        seen.set(id, file);
    }
}
