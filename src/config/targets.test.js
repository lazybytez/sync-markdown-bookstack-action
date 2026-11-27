import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadTargets } from "./targets.js";

const example = `targets:
    - path: docs
      book-id: 12
      exclude:
          - "**/README.md"
    - path: docs/decisions
      book-id: 34
`;

let cwd;

beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bookstack-targets-"));
    vi.stubEnv("INPUT_CONFIG", "");
    vi.stubEnv("INPUT_CONFIG-FILE", "");
});

afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(cwd, { recursive: true, force: true });
});

test("loads identical targets from the config input and default config file", async () => {
    await writeFile(join(cwd, "bookstack.yaml"), example);
    const { targets: fromFile } = await loadTargets({ cwd });

    vi.stubEnv("INPUT_CONFIG", example);
    const { targets: fromInline } = await loadTargets({ cwd });
    expect(fromInline).toEqual(fromFile);
    expect(fromFile).toStrictEqual([
        {
            path: join(cwd, "docs"),
            bookId: 12,
            include: undefined,
            exclude: ["**/README.md"],
        },
        {
            path: join(cwd, "docs", "decisions"),
            bookId: 34,
            include: undefined,
            exclude: undefined,
        },
    ]);
});

test("loads an explicit config file with a chapter target and custom globs", async () => {
    await writeFile(
        join(cwd, "targets.yml"),
        `targets:
    - path: docs
      chapter-id: "42"
      include: ["*.md"]
`,
    );
    vi.stubEnv("INPUT_CONFIG-FILE", "targets.yml");

    const { targets } = await loadTargets({ cwd });
    expect(targets).toStrictEqual([
        {
            path: join(cwd, "docs"),
            chapterId: 42,
            include: ["*.md"],
            exclude: undefined,
        },
    ]);
});

test("fails when both inputs are set", async () => {
    await expect(
        loadTargets({ cwd, config: example, configFile: "targets.yml" }),
    ).rejects.toThrow(/^Set either config or config-file, not both$/);
});

test("rejects a config file symlink outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bookstack-outside-"));
    const filename = join(cwd, "bookstack.yaml");
    try {
        await writeFile(join(outside, "targets.yml"), example);
        await symlink(join(outside, "targets.yml"), filename);

        await expect(loadTargets({ cwd })).rejects.toThrow(
            `Could not read config file "${filename}": resolves outside the workspace`,
        );
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test("rejects a directory used as a config file", async () => {
    const filename = join(cwd, "bookstack.yaml");
    await mkdir(filename);
    await expect(loadTargets({ cwd })).rejects.toThrow(
        `Could not read config file "${filename}": must be a regular file`,
    );
});

test.each([
    ["the default bookstack.yaml", undefined, "bookstack.yaml"],
    ["an explicit config file", "missing.yml", "missing.yml"],
])("reports %s that does not exist", async (_label, configFile, file) => {
    await expect(loadTargets({ cwd, configFile })).rejects.toThrow(
        `Could not read config file "${join(cwd, file)}": ENOENT`,
    );
});

test("rejects a config file path outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bookstack-outside-"));
    try {
        await writeFile(join(outside, "targets.yml"), example);
        const configFile = join(outside, "targets.yml");

        await expect(loadTargets({ cwd, configFile })).rejects.toThrow(
            `Could not read config file "${configFile}": resolves outside the workspace`,
        );
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test.each([
    [
        "both book-id and chapter-id",
        "path: docs\n      book-id: 1\n      chapter-id: 2",
        'target 1 (path "docs"): set exactly one of book-id or chapter-id',
    ],
    [
        "neither book-id nor chapter-id",
        "path: docs",
        'target 1 (path "docs"): set exactly one of book-id or chapter-id',
    ],
    [
        "a negative id",
        "path: docs\n      book-id: -1",
        'target 1 (path "docs"): book-id must be a positive integer',
    ],
    [
        "a zero id",
        "path: docs\n      chapter-id: 0",
        'target 1 (path "docs"): chapter-id must be a positive integer',
    ],
    [
        "a fractional id",
        "path: docs\n      book-id: 1.5",
        'target 1 (path "docs"): book-id must be a positive integer',
    ],
    [
        "a hexadecimal id string",
        'path: docs\n      book-id: "0x10"',
        'target 1 (path "docs"): book-id must be a positive integer',
    ],
    [
        "an unknown key",
        "path: docs\n      book-id: 1\n      includes: []",
        'target 1 (path "docs"): unknown key "includes"',
    ],
    [
        "a single include glob instead of a list",
        "path: docs\n      book-id: 1\n      include: '*.md'",
        'target 1 (path "docs"): include must be a list of non-empty glob strings',
    ],
    [
        "an empty exclude glob",
        "path: docs\n      book-id: 1\n      exclude: ['']",
        'target 1 (path "docs"): exclude must be a list of non-empty glob strings',
    ],
    [
        "a missing path",
        "book-id: 1",
        "target 1: path must be a non-empty string",
    ],
])("rejects a target with %s", async (_label, yaml, message) => {
    await expect(
        loadTargets({ cwd, config: `targets:\n    - ${yaml}\n` }),
    ).rejects.toThrow(`config input: ${message}`);
});

test("rejects a target that is not a mapping", async () => {
    await expect(
        loadTargets({ cwd, config: "targets:\n    - docs\n" }),
    ).rejects.toThrow("config input: target 1 must be a mapping");
});

test("rejects duplicate paths after normalization", async () => {
    await expect(
        loadTargets({
            cwd,
            config: `targets:
    - path: docs
      book-id: 12
    - path: ./docs/
      chapter-id: 34
`,
        }),
    ).rejects.toThrow(/target 2.*same path as target 1/);
});

test("names the file and target when config validation fails", async () => {
    const filename = join(cwd, "bookstack.yaml");
    await writeFile(
        filename,
        `targets:
    - path: docs
      book-id: 12
    - path: decisions
      book-id: 34
      typo: true
`,
    );

    const error = await loadTargets({ cwd }).catch((error) => error);
    expect(error.message).toContain(`config file "${filename}"`);
    expect(error.message).toContain(
        'target 2 (path "decisions"): unknown key "typo"',
    );
});

test.each([
    ["an empty target list", "targets: []", "targets must be a non-empty list"],
    ["a list at the top level", "- docs", "config must be a mapping"],
    [
        "an unknown top-level key",
        `${example}target: []`,
        'unknown key "target"',
    ],
    ["unclosed YAML", "targets: [", "invalid YAML"],
    ["a duplicate YAML key", "targets: []\ntargets: []", "invalid YAML"],
])("reports a config with %s", async (_label, config, message) => {
    await expect(loadTargets({ cwd, config })).rejects.toThrow(
        `config input: ${message}`,
    );
});

test.each([false, "another/repo"])(
    "accepts repository tracking setting %s",
    async (repoTag) => {
        await expect(
            loadTargets({
                cwd,
                config: `repo-tag: ${JSON.stringify(repoTag)}\n${example}`,
            }),
        ).resolves.toMatchObject({ repoTag });
    },
);

test.each(["true", '"  "', "42"])(
    "rejects the repository tracking setting %s",
    async (value) => {
        await expect(
            loadTargets({ cwd, config: `repo-tag: ${value}\n${example}` }),
        ).rejects.toThrow(
            "config input: repo-tag must be false or a non-empty string",
        );
    },
);

test("normalizes the repo tag as BookStack stores it", async () => {
    await expect(
        loadTargets({ cwd, config: `repo-tag: "  org/repo  "\n${example}` }),
    ).resolves.toMatchObject({ repoTag: "org/repo" });
});
