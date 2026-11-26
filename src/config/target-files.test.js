import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { selectTargetFiles } from "./target-files.js";
import { loadTargets } from "./targets.js";

let cwd;

beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bookstack-files-"));
});

afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
});

async function writeFiles(...paths) {
    for (const path of paths) {
        const absolutePath = join(cwd, path);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, "# Test\n");
    }
}

async function select(config) {
    const configuration = await loadTargets({ cwd, config });
    const selections = await selectTargetFiles(configuration);
    return selections.map(({ files, ...target }) => ({
        ...target,
        files: files.map((file) => relative(cwd, file)),
    }));
}

test("assigns files to the most specific target and honors filters separately", async () => {
    await writeFiles(
        "docs/README.md",
        "docs/guides/quickstart.md",
        "docs/operations/deploy.md",
        "docs/decisions/README.md",
        "docs/decisions/001.md",
        "docs/decisions-old/001.md",
        "docs/decisions/notes.txt",
    );

    const selections = await select(`targets:
    - path: docs
      book-id: 12
      exclude: ["**/README.md"]
    - path: docs/decisions
      book-id: 34
`);
    expect(selections).toMatchObject([
        {
            bookId: 12,
            files: [
                join("docs", "decisions-old", "001.md"),
                join("docs", "guides", "quickstart.md"),
                join("docs", "operations", "deploy.md"),
            ],
        },
        {
            bookId: 34,
            files: [
                join("docs", "decisions", "001.md"),
                join("docs", "decisions", "README.md"),
            ],
        },
    ]);
});

test("does not pass files excluded by a nested target back to its parent", async () => {
    await writeFiles(
        "docs/guide.md",
        "docs/decisions/001.md",
        "docs/decisions/002.md",
        "docs/decisions/003.md",
    );
    const selections = await select(`targets:
    - path: docs/decisions
      book-id: 34
      include: ["00[12].md"]
      exclude: ["002.md"]
    - path: docs
      book-id: 12
`);

    expect(selections).toMatchObject([
        { bookId: 34, files: [join("docs", "decisions", "001.md")] },
        { bookId: 12, files: [join("docs", "guide.md")] },
    ]);
});

test("assigns a single-file target before its parent directory", async () => {
    await writeFiles("docs/guide.md", "docs/other.md");
    const selections = await select(`targets:
    - path: docs
      book-id: 12
    - path: docs/guide.md
      chapter-id: 21
`);

    expect(selections).toMatchObject([
        { bookId: 12, files: [join("docs", "other.md")] },
        { chapterId: 21, files: [join("docs", "guide.md")] },
    ]);
});

test("selects a single-file target regardless of its extension", async () => {
    await writeFiles("docs/notes.txt", "docs/guide.md");
    const selections = await select(`targets:
    - path: docs/notes.txt
      chapter-id: 21
`);

    expect(selections).toMatchObject([
        { chapterId: 21, files: [join("docs", "notes.txt")] },
    ]);
});

test.each(["include", "exclude"])(
    "rejects %s on a single-file target",
    async (key) => {
        await writeFiles("docs/guide.md");

        await expect(
            select(`targets:
    - path: docs/guide.md
      chapter-id: 21
      ${key}: ["*.md"]
`),
        ).rejects.toThrow(
            `config input: target 1: target path "${join(cwd, "docs", "guide.md")}" is a file, so include and exclude do not apply`,
        );
    },
);

test("rejects a target path outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bookstack-outside-"));
    try {
        const path = relative(cwd, outside);

        await expect(
            select(`targets:
    - path: ${path}
      book-id: 12
`),
        ).rejects.toThrow(
            `config input: target 1: target path "${join(cwd, path)}" resolves outside the workspace`,
        );
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test("rejects a symlinked target directory outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bookstack-outside-"));
    try {
        await writeFile(join(outside, "secret.md"), "# Secret\n");
        await symlink(outside, join(cwd, "docs"));

        await expect(
            select(`targets:
    - path: docs
      book-id: 12
`),
        ).rejects.toThrow("resolves outside the workspace");
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test("rejects two targets that resolve to the same directory", async () => {
    await writeFiles("docs/guide.md");
    await symlink(join(cwd, "docs"), join(cwd, "manual"));

    await expect(
        select(`targets:
    - path: docs
      book-id: 12
    - path: manual
      book-id: 34
`),
    ).rejects.toThrow(
        `config input: target 2 (path "${join(cwd, "manual")}") resolves to the same path as target 1`,
    );
});

test("keeps matches within the target when a glob or symlink points elsewhere", async () => {
    await writeFiles("docs/guide.md", "private/local.md");
    await symlink(
        join(cwd, "private", "local.md"),
        join(cwd, "docs", "linked.md"),
    );
    const selections = await select(`targets:
    - path: docs
      book-id: 12
      include: ["**/*.md", "../private/*.md"]
`);

    expect(selections).toMatchObject([
        { bookId: 12, files: [join("docs", "guide.md")] },
    ]);
});

test("reports an inaccessible target path", async () => {
    await expect(
        select(`targets:
    - path: missing
      book-id: 12
`),
    ).rejects.toThrow(`Could not access target path "${join(cwd, "missing")}"`);
});

test("selects only regular files matching the target globs", async () => {
    await writeFiles("docs/guide.md");
    const server = createServer();
    await new Promise((resolve) =>
        server.listen(join(cwd, "docs", "socket.md"), resolve),
    );
    try {
        await expect(
            select(`targets:
    - path: docs
      book-id: 12
`),
        ).resolves.toMatchObject([{ files: [join("docs", "guide.md")] }]);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("names the config file when its target path is missing", async () => {
    await writeFile(
        join(cwd, "bookstack.yaml"),
        `targets:
    - path: missing
      book-id: 12
`,
    );
    const configuration = await loadTargets({ cwd });

    await expect(selectTargetFiles(configuration)).rejects.toThrow(
        /config file ".*bookstack.yaml".*target 1.*Could not access target path/,
    );
});
