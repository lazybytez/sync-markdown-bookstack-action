import { createHash } from "node:crypto";
import { createChapter } from "./chapters.js";

const trackingFields = new Map([
    ["sync-source", "source"],
    ["sync-hash", "hash"],
    ["sync-repo", "repo"],
    ["sync-id", "id"],
]);

/**
 * Reads tracking tags, treating duplicate fields as ambiguous ownership.
 * @param {{tags?: {name: string, value: string}[]}} entity
 */
export function readTracking(entity) {
    const tracking = {};
    for (const tag of entity.tags ?? []) {
        const field = trackingFields.get(tag.name.toLowerCase());
        if (field) {
            if (Object.hasOwn(tracking, field)) {
                tracking.ambiguous = true;
            }
            tracking[field] = tag.value;
        }
    }
    return tracking;
}

/**
 * Checks whether an entity carries complete, unambiguous tracking for this repo.
 * @param {object} tracking
 * @param {string|false} repoTag
 */
export function ownsTracking(tracking, repoTag) {
    return Boolean(
        tracking.source && tracking.hash && hasRepository(tracking, repoTag),
    );
}

function hasRepository(tracking, repoTag) {
    return (
        !tracking.ambiguous &&
        (repoTag === false
            ? tracking.repo === undefined
            : tracking.repo === repoTag)
    );
}

function trackedTags(item, content, repoTag) {
    if (item.source !== item.source.trim()) {
        throw new Error("A sync source cannot begin or end with whitespace");
    }
    if (item.tags.some(({ name }) => trackingFields.has(name.toLowerCase()))) {
        throw new Error(
            "Tags named sync-source, sync-hash, sync-repo, and sync-id are reserved",
        );
    }
    const hash = createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex");
    const tags = [
        ...item.tags,
        { name: "sync-source", value: item.source },
        { name: "sync-hash", value: hash },
    ];
    if (repoTag !== false) {
        tags.push({ name: "sync-repo", value: repoTag });
    }
    if (item.id !== undefined) {
        tags.push({ name: "sync-id", value: item.id });
    }
    return tags;
}

/**
 * Fetches tagged pages and chapters from BookStack's page/count search endpoint.
 * @param {{request: Function}} client
 */
export async function findTrackedContent(client) {
    const items = [];
    let result;
    let page = 0;
    do {
        page++;
        result = await client.request("GET", "/search", {
            query: { query: "[sync-source]", count: 100, page },
        });
        if (
            !Array.isArray(result?.data) ||
            !Number.isSafeInteger(result.total) ||
            result.total < 0
        ) {
            throw new Error("Invalid BookStack tracking search response");
        }
        items.push(...result.data);
    } while (result.data.length > 0 && items.length < result.total);
    return items;
}

/**
 * Joins the contents of one book with tagged search results.
 * @param {{request: Function}} client
 * @param {number} bookId
 * @param {object[]} tracked
 */
export async function loadBookInventory(client, bookId, tracked) {
    const book = await client.request("GET", `/books/${bookId}`);
    if (!Array.isArray(book?.contents)) {
        throw new Error(`Invalid BookStack contents for book ${bookId}`);
    }
    const tagsByKey = new Map(
        tracked
            .filter((item) => item.book_id === bookId)
            .map((item) => [`${item.type}:${item.id}`, item.tags]),
    );

    function withTags(entity, type) {
        const tags = tagsByKey.get(`${type}:${entity.id}`);
        return tags === undefined ? entity : { ...entity, tags };
    }

    const pages = [];
    const chapters = [];
    for (const item of book.contents) {
        if (item.type === "page") {
            pages.push(withTags({ ...item, chapter_id: null }, "page"));
        }
        if (item.type === "chapter") {
            if (!Array.isArray(item.pages)) {
                throw new Error(
                    `Invalid BookStack contents for chapter ${item.id}`,
                );
            }
            chapters.push(withTags(item, "chapter"));
            for (const page of item.pages) {
                pages.push(withTags({ ...page, chapter_id: item.id }, "page"));
            }
        }
    }
    return { bookId, pages, chapters };
}

function singleMatch(matches, kind, name) {
    if (matches.length > 1) {
        throw new Error(
            `Ambiguous ${kind} "${name}": BookStack IDs ${matches.map(({ id }) => id).join(", ")}`,
        );
    }
    return matches[0];
}

function tagValues(entry, name) {
    return (entry.tags ?? [])
        .filter((tag) => tag.name.toLowerCase() === name)
        .map((tag) => tag.value);
}

function rejectDuplicateTracking(entries, kind, item) {
    const broken = entries.find(
        (entry) =>
            readTracking(entry).ambiguous &&
            (tagValues(entry, "sync-source").includes(item.source) ||
                (item.id !== undefined &&
                    tagValues(entry, "sync-id").includes(item.id))),
    );
    if (broken) {
        throw new Error(
            `BookStack ${kind} ${broken.id} has duplicate tracking tags`,
        );
    }
}

function trackedCandidates(entries, item) {
    const byId =
        item.id === undefined
            ? []
            : entries.filter((entry) => readTracking(entry).id === item.id);
    if (byId.length > 0) {
        return byId;
    }
    return entries.filter((entry) => {
        const tracking = readTracking(entry);
        return (
            tracking.source === item.source &&
            (item.id === undefined || tracking.id === undefined)
        );
    });
}

async function findExisting({
    client,
    entries,
    kind,
    endpoint,
    item,
    repoTag,
    warn,
}) {
    rejectDuplicateTracking(entries, kind, item);
    const candidates = trackedCandidates(entries, item);
    const owned = singleMatch(
        candidates.filter((entry) =>
            hasRepository(readTracking(entry), repoTag),
        ),
        kind,
        item.name,
    );
    if (owned) {
        return { existing: owned, adopted: false };
    }
    for (const entry of candidates) {
        const { repo } = readTracking(entry);
        warn(
            `Leaving BookStack ${kind} ${entry.id} alone: "${item.source}" is tracked there by ${repo ?? "a repository without repo-tag"}`,
        );
    }

    const sameName = entries.filter((entry) => entry.name === item.name);
    for (const entry of sameName) {
        if (!Array.isArray(entry.tags)) {
            const details = await client.request(
                "GET",
                `${endpoint}/${entry.id}`,
            );
            if (!Array.isArray(details?.tags)) {
                throw new Error(
                    `BookStack ${kind} ${entry.id} did not return its tags`,
                );
            }
            entry.tags = details.tags;
        }
    }
    const untracked = singleMatch(
        sameName.filter(
            (entry) => Object.keys(readTracking(entry)).length === 0,
        ),
        kind,
        item.name,
    );
    if (untracked) {
        return { existing: untracked, adopted: true };
    }
    return { existing: undefined, adopted: false };
}

function tagsMatch(actual, expected) {
    const key = ({ name, value }) => JSON.stringify([name, value ?? ""]);
    return (
        JSON.stringify((actual ?? []).map(key).sort()) ===
        JSON.stringify(expected.map(key).sort())
    );
}

async function writeImmediately(_operation, write) {
    return write();
}

async function syncEntity({
    client,
    entries,
    kind,
    endpoint,
    item,
    content,
    placement,
    repoTag,
    create,
    perform = writeImmediately,
    warn = () => {},
}) {
    const tags = trackedTags(item, content, repoTag);
    const { existing, adopted } = await findExisting({
        client,
        entries,
        kind,
        endpoint,
        item,
        repoTag,
        warn,
    });
    const chapterId = placement.chapter_id ?? null;
    const sameLocation =
        kind === "chapter" || (existing?.chapter_id ?? null) === chapterId;
    if (
        existing &&
        !adopted &&
        sameLocation &&
        tagsMatch(existing.tags, tags)
    ) {
        return { status: "skipped", id: existing.id };
    }

    const status = adopted ? "adopted" : existing ? "updated" : "created";
    const body = { ...content, ...placement, tags };
    const result = await perform(
        {
            status,
            kind,
            source: item.source,
            name: item.name,
            id: existing?.id,
        },
        () =>
            existing
                ? client.request("PUT", `${endpoint}/${existing.id}`, { body })
                : create(body),
    );
    const id = existing?.id ?? result?.id;
    if (id === undefined) {
        throw new Error(
            `BookStack did not return an ID for ${kind} "${item.name}"`,
        );
    }
    const updated = { id, name: item.name, tags, chapter_id: chapterId };
    if (existing) {
        Object.assign(existing, updated);
    } else {
        entries.push(updated);
    }
    return { status, id };
}

/**
 * Creates, updates, adopts, or skips a page within the target book inventory.
 * Options also take `client`, `repoTag`, and the optional `perform` and `warn` hooks.
 * @param {object} options
 */
export async function syncPage({ inventory, page, chapterId, ...options }) {
    const { name, markdown, priority, tags } = page;
    return syncEntity({
        ...options,
        entries: inventory.pages,
        kind: "page",
        endpoint: "/pages",
        item: page,
        content: { name, markdown, priority, tags },
        placement:
            chapterId == null
                ? { book_id: inventory.bookId }
                : { chapter_id: chapterId },
        create: (body) => options.client.request("POST", "/pages", { body }),
    });
}

/**
 * Creates, updates, adopts, or skips a chapter within the target book inventory.
 * Options also take `client`, `repoTag`, and the optional `perform` and `warn` hooks.
 * @param {object} options
 */
export async function syncChapter({ inventory, chapter, ...options }) {
    const { name, description, priority, tags } = chapter;
    return syncEntity({
        ...options,
        entries: inventory.chapters,
        kind: "chapter",
        endpoint: "/chapters",
        item: chapter,
        content: { name, description, priority, tags },
        placement: {},
        create: (body) => createChapter(options.client, inventory.bookId, body),
    });
}
