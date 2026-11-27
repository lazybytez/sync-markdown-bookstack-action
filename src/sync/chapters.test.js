import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
    createChapter,
    planTargetLayout,
    readChapterMetadata,
    syncChapterPages,
} from "./chapters.js";

let cwd;
beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bookstack-chapters-"));
});
afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

test("groups deep files under first-level chapters and excludes nested targets", async () => {
    for (const path of ["02-operations/deep", "guides", "decisions", "empty"]) {
        await mkdir(join(cwd, path), { recursive: true });
    }
    const root = join(cwd, "index.md");
    const guide = join(cwd, "guides", "intro.md");
    const operation = join(cwd, "02-operations", "deep", "deploy.md");
    const target = { path: cwd, bookId: 12, files: [root, guide, operation] };
    const nested = { path: join(cwd, "decisions"), bookId: 34, files: [] };

    await expect(planTargetLayout(target, [target, nested])).resolves.toEqual({
        files: [root],
        chapters: [
            { directory: join(cwd, "02-operations"), files: [operation] },
            { directory: join(cwd, "guides"), files: [guide] },
        ],
    });
});

test("does not plan chapters for directories without selected pages", async () => {
    await mkdir(join(cwd, "images"));
    await writeFile(join(cwd, "images", "diagram.png"), "");
    await writeFile(join(cwd, "images", "chapter.yaml"), "name: Images\n");
    const target = { path: cwd, bookId: 12, files: [] };

    await expect(planTargetLayout(target, [target])).resolves.toEqual({
        files: [],
        chapters: [],
    });
});

test("chapter and single-file book targets use one flat file list", async () => {
    const file = join(cwd, "index.md");
    await writeFile(file, "Hello");
    await expect(
        planTargetLayout({ path: cwd, chapterId: 2, files: [file] }, []),
    ).resolves.toEqual({ files: [file], chapters: [] });
    await expect(
        planTargetLayout({ path: file, bookId: 2, files: [file] }, []),
    ).resolves.toEqual({ files: [file], chapters: [] });
});

test("derives chapter defaults and lets chapter.yaml override them", async () => {
    const directory = join(cwd, "02-operations");
    await mkdir(directory);
    await expect(readChapterMetadata(directory)).resolves.toEqual({
        name: "Operations",
        priority: 2,
        description: "",
        tags: [],
    });
    await writeFile(
        join(directory, "chapter.yaml"),
        "name: Deployment\npriority: 9\ndescription: Runbooks\ntags: [internal]\n",
    );
    await expect(readChapterMetadata(directory)).resolves.toEqual({
        name: "Deployment",
        priority: 9,
        description: "Runbooks",
        tags: [{ name: "internal", value: "" }],
    });
});

test("reports unknown chapter keys with the metadata file", async () => {
    await writeFile(join(cwd, "chapter.yaml"), "titel: Bad\n");
    await expect(readChapterMetadata(cwd)).rejects.toThrow(
        /chapter\.yaml.*unknown key "titel"/,
    );
});

test.each([
    [
        "a description that is not text",
        "description: [a]",
        "description must be a string",
    ],
    ["invalid YAML", "name: [", "invalid YAML"],
])("reports %s in chapter.yaml", async (_label, yaml, message) => {
    await writeFile(join(cwd, "chapter.yaml"), yaml);
    await expect(readChapterMetadata(cwd)).rejects.toThrow(
        `${join(cwd, "chapter.yaml")}: ${message}`,
    );
});

test("rejects chapter.yaml that links outside the chapter directory", async () => {
    const chapter = join(cwd, "guides");
    await mkdir(chapter);
    await writeFile(join(cwd, "shared.yaml"), "name: Shared\n");
    await symlink(join(cwd, "shared.yaml"), join(chapter, "chapter.yaml"));

    await expect(readChapterMetadata(chapter)).rejects.toThrow(
        "chapter metadata must be a regular file inside the chapter directory",
    );
});

test("rejects a directory named chapter.yaml", async () => {
    await mkdir(join(cwd, "chapter.yaml"));

    await expect(readChapterMetadata(cwd)).rejects.toThrow(
        "chapter metadata must be a regular file inside the chapter directory",
    );
});

test("reads chapter.yaml that links to a file inside the chapter directory", async () => {
    await writeFile(join(cwd, "meta.yaml"), "name: Linked\n");
    await symlink(join(cwd, "meta.yaml"), join(cwd, "chapter.yaml"));

    await expect(readChapterMetadata(cwd)).resolves.toMatchObject({
        name: "Linked",
    });
});

test("creates the chapter before syncing its pages", async () => {
    const calls = [];
    const request = vi.fn(async () => {
        calls.push("create");
        return { id: 8 };
    });
    const visit = vi.fn(async () => {
        calls.push("page");
    });
    const metadata = {
        name: "Ops",
        description: "Runbooks",
        priority: 3,
        tags: [],
    };
    await syncChapterPages(
        ["guide.md"],
        async () => {
            const chapter = await createChapter({ request }, 12, metadata);
            return chapter.id;
        },
        visit,
    );
    expect(calls).toEqual(["create", "page"]);
    expect(request).toHaveBeenCalledWith("POST", "/chapters", {
        body: { ...metadata, book_id: 12 },
    });
    expect(visit).toHaveBeenCalledWith("guide.md", 8);
});

test("does not sync chapter pages if creation fails", async () => {
    const visit = vi.fn();
    await expect(
        syncChapterPages(
            ["guide.md"],
            async () => {
                throw new Error("Denied");
            },
            visit,
        ),
    ).rejects.toThrow("Denied");
    expect(visit).not.toHaveBeenCalled();
});
