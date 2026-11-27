import { parseDocument } from "yaml";

/**
 * Parses a YAML mapping and rejects fields outside the supplied schema.
 * @param {string} yaml
 * @param {string[]} keys
 */
export function parseMetadata(yaml, keys) {
    const document = parseDocument(yaml);
    if (document.errors.length) {
        throw new Error(`invalid YAML: ${document.errors[0].message}`);
    }
    const value = document.toJS();
    if (value === null && document.contents === null) {
        return {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("metadata must be a mapping");
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) {
            throw new Error(`unknown key "${key}"`);
        }
    }
    return value;
}

/**
 * Derives a display name and priority from a file stem or directory name.
 * @param {string} name
 */
export function nameAndPriority(name) {
    const prefix = /^(?:adr[-_ ])?(\d+)[-_. ]+/i.exec(name);
    const title =
        name
            .slice(prefix?.[0].length ?? 0)
            .replace(/[-_]+/g, " ")
            .trim() || name;
    const priority = Number(prefix?.[1] ?? 0);
    return {
        name: title.charAt(0).toUpperCase() + title.slice(1),
        priority: Number.isSafeInteger(priority) ? priority : 0,
    };
}

/**
 * Checks an optional string field and returns its normalized value.
 * @param {unknown} value
 * @param {string} field
 */
export function optionalText(value, field) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value.trim();
}

/**
 * Checks an optional priority.
 * @param {unknown} value
 * @param {number} fallback
 */
export function priorityOrDefault(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isSafeInteger(value)) {
        throw new Error("priority must be an integer");
    }
    return value;
}

/**
 * Converts user tag names and name/value pairs into BookStack tags.
 * @param {unknown} tags
 */
export function normalizeTags(tags = []) {
    if (!Array.isArray(tags)) {
        throw new Error("tags must be a list");
    }
    return tags.map((tag) => {
        if (typeof tag === "string") {
            return { name: optionalText(tag, "tag name"), value: "" };
        }
        if (!tag || typeof tag !== "object" || Array.isArray(tag)) {
            throw new Error("each tag must be a name or a name/value pair");
        }
        for (const key of Object.keys(tag)) {
            if (key !== "name" && key !== "value") {
                throw new Error(`unknown tag key "${key}"`);
            }
        }
        if (
            tag.name === undefined ||
            !["string", "number", "boolean"].includes(typeof tag.value)
        ) {
            throw new Error("each tag pair requires a name and a scalar value");
        }
        return {
            name: optionalText(tag.name, "tag name"),
            value: String(tag.value).trim(),
        };
    });
}
