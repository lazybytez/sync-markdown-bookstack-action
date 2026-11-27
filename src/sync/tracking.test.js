import { expect, test, vi } from "vitest";
import {
    findTrackedContent,
    loadBookInventory,
    syncChapter,
    syncPage,
} from "./tracking.js";

const repoTag = "org/repo";
const guide = {
    source: "docs/guide.md",
    name: "Guide",
    markdown: "Hello",
    priority: 0,
    tags: [],
};

function mockBook(pages = [], chapters = []) {
    const inventory = { bookId: 12, pages, chapters };
    const request = vi.fn(async (method) =>
        method === "POST" ? { id: 8 } : {},
    );
    const warn = vi.fn();
    return { inventory, request, client: { request }, warn };
}

function tracked(source, repo = repoTag, extra = []) {
    const tags = [{ name: "sync-source", value: source }, ...extra];
    if (repo !== undefined) {
        tags.push({ name: "sync-repo", value: repo });
    }
    return tags;
}

function writes(request) {
    return request.mock.calls.filter(([method]) => method !== "GET");
}

test("paginates BookStack search by page with the sync-source query", async () => {
    const data = Array.from({ length: 100 }, (_, id) => ({ id }));
    const request = vi
        .fn()
        .mockResolvedValueOnce({ data, total: 101 })
        .mockResolvedValueOnce({ data: [{ id: 100 }], total: 101 });

    await expect(findTrackedContent({ request })).resolves.toHaveLength(101);
    expect(request.mock.calls).toEqual([
        [
            "GET",
            "/search",
            { query: { query: "[sync-source]", count: 100, page: 1 } },
        ],
        [
            "GET",
            "/search",
            { query: { query: "[sync-source]", count: 100, page: 2 } },
        ],
    ]);
});

test("stops searching when a page of results is empty", async () => {
    const request = vi
        .fn()
        .mockResolvedValueOnce({ data: [{ id: 1 }], total: 5 })
        .mockResolvedValueOnce({ data: [], total: 5 });

    await expect(findTrackedContent({ request })).resolves.toEqual([{ id: 1 }]);
    expect(request).toHaveBeenCalledTimes(2);
});

test.each([
    ["data that is not a list", { data: {}, total: 1 }],
    ["a missing total", { data: [] }],
])("rejects a search response with %s", async (_label, response) => {
    const request = vi.fn().mockResolvedValue(response);

    await expect(findTrackedContent({ request })).rejects.toThrow(
        "Invalid BookStack tracking search response",
    );
});

test("joins tracked search results to the book inventory", async () => {
    const trackedTags = tracked("docs/guide.md");
    const request = vi.fn().mockResolvedValue({
        contents: [
            { id: 2, type: "page", name: "Read me" },
            {
                id: 9,
                type: "chapter",
                name: "Ops",
                pages: [{ id: 8, name: "Guide" }],
            },
        ],
    });

    const inventory = await loadBookInventory({ request }, 12, [
        { id: 8, type: "page", book_id: 12, tags: trackedTags },
        { id: 2, type: "page", book_id: 14, tags: trackedTags },
        { id: 9, type: "book", book_id: 12, tags: trackedTags },
    ]);
    expect(request).toHaveBeenCalledWith("GET", "/books/12");
    expect(inventory).toEqual({
        bookId: 12,
        pages: [
            { id: 2, type: "page", name: "Read me", chapter_id: null },
            { id: 8, name: "Guide", chapter_id: 9, tags: trackedTags },
        ],
        chapters: [
            {
                id: 9,
                type: "chapter",
                name: "Ops",
                pages: [{ id: 8, name: "Guide" }],
            },
        ],
    });
});

test.each([
    ["no contents list", {}, "Invalid BookStack contents for book 12"],
    [
        "a chapter without pages",
        { contents: [{ id: 9, type: "chapter", name: "Ops" }] },
        "Invalid BookStack contents for chapter 9",
    ],
])("rejects book contents with %s", async (_label, book, message) => {
    const request = vi.fn().mockResolvedValue(book);

    await expect(loadBookInventory({ request }, 12, [])).rejects.toThrow(
        message,
    );
});

test("creates a tracked page in the book", async () => {
    const book = mockBook();

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "created",
        id: 8,
    });
    expect(book.request.mock.calls).toEqual([
        [
            "POST",
            "/pages",
            {
                body: {
                    name: "Guide",
                    markdown: "Hello",
                    priority: 0,
                    book_id: 12,
                    tags: [
                        { name: "sync-source", value: "docs/guide.md" },
                        {
                            name: "sync-hash",
                            value: expect.stringMatching(/^[a-f0-9]{64}$/),
                        },
                        { name: "sync-repo", value: repoTag },
                    ],
                },
            },
        ],
    ]);
});

test("sends no write request when nothing changed", async () => {
    const book = mockBook();
    await syncPage({ ...book, page: guide, repoTag });

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "skipped",
        id: 8,
    });
    expect(book.request).toHaveBeenCalledTimes(1);
});

const audience = { name: "audience", value: "ops" };

test.each([
    ["the heading", { name: "Renamed" }, { name: "Renamed" }],
    ["the content", { markdown: "Changed" }, { markdown: "Changed" }],
    ["the priority", { priority: 3 }, { priority: 3 }],
    [
        "a user tag",
        { tags: [audience] },
        { tags: expect.arrayContaining([audience]) },
    ],
])(
    "updates the existing page when %s changes",
    async (_label, change, body) => {
        const book = mockBook();
        await syncPage({ ...book, page: guide, repoTag });

        await expect(
            syncPage({ ...book, page: { ...guide, ...change }, repoTag }),
        ).resolves.toEqual({ status: "updated", id: 8 });
        expect(book.request.mock.calls[1]).toEqual([
            "PUT",
            "/pages/8",
            { body: expect.objectContaining(body) },
        ]);
    },
);

test("moves a page with a stable ID to another chapter and updates its source", async () => {
    const book = mockBook();
    const page = { ...guide, id: "guide" };
    await syncPage({ ...book, page, chapterId: 1, repoTag });

    await expect(
        syncPage({
            ...book,
            page: { ...page, source: "docs/moved/guide.md" },
            chapterId: 2,
            repoTag,
        }),
    ).resolves.toEqual({ status: "updated", id: 8 });
    expect(book.request.mock.calls[1][2].body).toMatchObject({
        chapter_id: 2,
        tags: expect.arrayContaining([
            { name: "sync-source", value: "docs/moved/guide.md" },
            { name: "sync-id", value: "guide" },
        ]),
    });
});

test("moves a page out of its chapter when the file moves to the book root", async () => {
    const book = mockBook();
    await syncPage({ ...book, page: guide, chapterId: 4, repoTag });

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "updated",
        id: 8,
    });
    expect(book.request.mock.calls[1][2].body).toMatchObject({ book_id: 12 });
});

test("keeps the page when a stable ID is added to an already synced file", async () => {
    const book = mockBook([
        { id: 5, name: "Guide", tags: tracked(guide.source) },
    ]);

    await expect(
        syncPage({ ...book, page: { ...guide, id: "guide" }, repoTag }),
    ).resolves.toEqual({ status: "updated", id: 5 });
    expect(book.request.mock.calls[0][2].body.tags).toContainEqual({
        name: "sync-id",
        value: "guide",
    });
});

test("does not take over a page whose stable ID differs", async () => {
    const book = mockBook([
        {
            id: 5,
            name: "Guide",
            tags: tracked(guide.source, repoTag, [
                { name: "sync-id", value: "other" },
            ]),
        },
    ]);

    await expect(
        syncPage({ ...book, page: { ...guide, id: "guide" }, repoTag }),
    ).resolves.toEqual({ status: "created", id: 8 });
});

test("adopts the single untracked page with the same name and replaces its tags", async () => {
    const book = mockBook([{ id: 2, name: "Guide" }]);
    book.request.mockResolvedValueOnce({
        id: 2,
        tags: [{ name: "manual", value: "" }],
    });

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "adopted",
        id: 2,
    });
    expect(book.request.mock.calls[0]).toEqual(["GET", "/pages/2"]);
    const [method, path, { body }] = book.request.mock.calls[1];
    expect([method, path]).toEqual(["PUT", "/pages/2"]);
    expect(body.tags.map(({ name }) => name)).toEqual([
        "sync-source",
        "sync-hash",
        "sync-repo",
    ]);
});

test("fails without writing when two untracked pages share the name", async () => {
    const book = mockBook([
        { id: 2, name: "Guide", tags: [] },
        { id: 3, name: "Guide", tags: [] },
    ]);

    await expect(syncPage({ ...book, page: guide, repoTag })).rejects.toThrow(
        'Ambiguous page "Guide": BookStack IDs 2, 3',
    );
    expect(book.request).not.toHaveBeenCalled();
});

test("fails when BookStack does not return the tags of a name match", async () => {
    const book = mockBook([{ id: 2, name: "Guide" }]);
    book.request.mockResolvedValueOnce({ id: 2 });

    await expect(syncPage({ ...book, page: guide, repoTag })).rejects.toThrow(
        "BookStack page 2 did not return its tags",
    );
    expect(writes(book.request)).toEqual([]);
});

test("leaves a page of another repository alone, reports it and creates its own page", async () => {
    const book = mockBook([
        { id: 4, name: "Guide", tags: tracked(guide.source, "other/repo") },
    ]);

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "created",
        id: 8,
    });
    expect(
        writes(book.request).map(([method, path]) => [method, path]),
    ).toEqual([["POST", "/pages"]]);
    expect(book.warn).toHaveBeenCalledWith(
        'Leaving BookStack page 4 alone: "docs/guide.md" is tracked there by other/repo',
    );
});

test("does not adopt a same-named page of another repository", async () => {
    const book = mockBook([
        { id: 4, name: "Guide", tags: tracked("docs/other.md", "other/repo") },
    ]);

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "created",
        id: 8,
    });
    expect(book.warn).not.toHaveBeenCalled();
});

test("treats pages with a repository tag as foreign when repo tags are off", async () => {
    const book = mockBook([
        { id: 4, name: "Guide", tags: tracked(guide.source, "org/repo") },
    ]);

    await expect(
        syncPage({ ...book, page: guide, repoTag: false }),
    ).resolves.toEqual({ status: "created", id: 8 });
    expect(book.warn).toHaveBeenCalledOnce();
});

test.each([
    [
        "duplicate tracking tags",
        [
            {
                id: 4,
                name: "Guide",
                tags: tracked(guide.source, repoTag, [
                    { name: "sync-source", value: "docs/other.md" },
                ]),
            },
        ],
        "BookStack page 4 has duplicate tracking tags",
    ],
    [
        "two tracked pages for the same source",
        [
            { id: 4, name: "Guide", tags: tracked(guide.source) },
            { id: 5, name: "Guide", tags: tracked(guide.source) },
        ],
        'Ambiguous page "Guide": BookStack IDs 4, 5',
    ],
])("fails without writing for %s", async (_label, pages, message) => {
    const book = mockBook(pages);

    await expect(syncPage({ ...book, page: guide, repoTag })).rejects.toThrow(
        message,
    );
    expect(book.request).not.toHaveBeenCalled();
});

test("repairs a missing hash on a page that keeps its source and repository tags", async () => {
    const book = mockBook([
        { id: 9, name: "Guide", tags: tracked(guide.source) },
    ]);

    await expect(syncPage({ ...book, page: guide, repoTag })).resolves.toEqual({
        status: "updated",
        id: 9,
    });
});

test("rejects user tags that use a tracking name before writing", async () => {
    const book = mockBook();

    await expect(
        syncPage({
            ...book,
            page: { ...guide, tags: [{ name: "Sync-Repo", value: "foreign" }] },
            repoTag,
        }),
    ).rejects.toThrow(
        "Tags named sync-source, sync-hash, sync-repo, and sync-id are reserved",
    );
    expect(book.request).not.toHaveBeenCalled();
});

test("fails when BookStack does not return the ID of a created page", async () => {
    const book = mockBook();
    book.request.mockResolvedValueOnce({});

    await expect(syncPage({ ...book, page: guide, repoTag })).rejects.toThrow(
        'BookStack did not return an ID for page "Guide"',
    );
});

test("adopts a uniquely named chapter without a repository tag and then skips it", async () => {
    const book = mockBook([], [{ id: 9, name: "Ops", tags: [] }]);
    const options = {
        ...book,
        chapter: {
            source: "docs/ops",
            name: "Ops",
            priority: 2,
            description: "Runbooks",
            tags: [],
        },
        repoTag: false,
    };

    await expect(syncChapter(options)).resolves.toEqual({
        status: "adopted",
        id: 9,
    });
    const [method, path, { body }] = book.request.mock.calls[0];
    expect([method, path]).toEqual(["PUT", "/chapters/9"]);
    expect(body).toMatchObject({ name: "Ops", description: "Runbooks" });
    expect(body.tags.map(({ name }) => name)).toEqual([
        "sync-source",
        "sync-hash",
    ]);
    await expect(syncChapter(options)).resolves.toEqual({
        status: "skipped",
        id: 9,
    });
    expect(book.request).toHaveBeenCalledOnce();
});

test("creates a missing chapter in the target book", async () => {
    const book = mockBook();

    await syncChapter({
        ...book,
        chapter: {
            source: "docs/ops",
            name: "Ops",
            priority: 2,
            description: "",
            tags: [],
        },
        repoTag,
    });
    expect(book.request.mock.calls[0]).toEqual([
        "POST",
        "/chapters",
        { body: expect.objectContaining({ name: "Ops", book_id: 12 }) },
    ]);
});

test("lets a perform hook replace the write", async () => {
    const book = mockBook();
    const perform = vi.fn(async () => ({ id: 77 }));

    await expect(
        syncPage({ ...book, page: guide, repoTag, perform }),
    ).resolves.toEqual({ status: "created", id: 77 });
    expect(perform).toHaveBeenCalledWith(
        {
            status: "created",
            kind: "page",
            source: "docs/guide.md",
            name: "Guide",
            id: undefined,
        },
        expect.any(Function),
    );
    expect(book.request).not.toHaveBeenCalled();
});
