import { join } from "node:path";
import { expect, test } from "vitest";
import { isWithin } from "./workspace.js";

const root = join("/", "work", "repo");

test.each([
    ["the root itself", root, true],
    ["a descendant", join(root, "docs", "guide.md"), true],
    [
        "a directory whose name starts with two dots",
        join(root, "..notes"),
        true,
    ],
    ["the parent", join("/", "work"), false],
    [
        "a sibling sharing the name prefix",
        join("/", "work", "repo-other"),
        false,
    ],
])("treats %s correctly", (_label, path, expected) => {
    expect(isWithin(root, path)).toBe(expected);
});
