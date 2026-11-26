import { expect, test } from "vitest";
import { parsePage, validatePageIds } from "./page.js";

test("frontmatter sets the title, priority, ID and tags", () => {
    expect(
        parsePage(
            "docs/01-intro.md",
            "---\nid: intro\ntitle: Start here\npriority: 7\ntags: [{name: audience, value: developers}, reviewed]\n---\n# Outline\n\nHello",
        ),
    ).toEqual({
        id: "intro",
        name: "Start here",
        priority: 7,
        tags: [
            { name: "audience", value: "developers" },
            { name: "reviewed", value: "" },
        ],
        markdown: "# Outline\n\nHello",
    });
});

test("uses and removes the first H1 when no title is set", () => {
    expect(parsePage("01-intro.md", "\n# Start here\n\nHello")).toMatchObject({
        name: "Start here",
        priority: 1,
        markdown: "Hello",
    });
});

test.each([
    ["01-intro.md", "Intro", 1],
    ["adr-007-caching.md", "Caching", 7],
    ["user_guide.md", "User guide", 0],
])("uses the file name %s when there is no heading", (file, name, priority) => {
    expect(parsePage(file, "Hello")).toMatchObject({
        name,
        priority,
        markdown: "Hello",
    });
});

test("accepts integer IDs and scalar tag values written without quotes", () => {
    const content =
        "---\nid: 42\ntags: [{name: version, value: 2}, {name: draft, value: false}]\n---\nText";
    expect(parsePage("guide.md", content)).toMatchObject({
        id: "42",
        tags: [
            { name: "version", value: "2" },
            { name: "draft", value: "false" },
        ],
    });
});

test("treats empty frontmatter as no metadata", () => {
    expect(parsePage("01-guide.md", "---\n---\nText")).toEqual({
        id: undefined,
        name: "Guide",
        priority: 1,
        tags: [],
        markdown: "Text",
    });
});

test.each([
    ["an unknown key", "titel: Oops", 'unknown key "titel"'],
    ["a fractional priority", "priority: 1.5", "priority must be an integer"],
    ["an empty title", 'title: " "', "title must be a non-empty string"],
    ["a list as ID", "id: []", "id must be a non-empty string"],
    ["a fractional ID", "id: 1.5", "id must be a non-empty string"],
    ["tags that are not a list", "tags: reviewed", "tags must be a list"],
    [
        "a tag that is a number",
        "tags: [7]",
        "each tag must be a name or a name/value pair",
    ],
    [
        "an unknown tag key",
        "tags: [{name: x, typo: 1}]",
        'unknown tag key "typo"',
    ],
    [
        "a tag pair without a value",
        "tags: [{name: x}]",
        "each tag pair requires a name and a scalar value",
    ],
    [
        "a tag pair with a list value",
        "tags: [{name: x, value: [1]}]",
        "each tag pair requires a name and a scalar value",
    ],
    ["frontmatter that is a list", "- title", "metadata must be a mapping"],
    ["invalid YAML", "title: [", "invalid YAML"],
])("reports %s in the frontmatter", (_label, yaml, message) => {
    expect(() => parsePage("guide.md", `---\n${yaml}\n---\nText`)).toThrow(
        `guide.md: ${message}`,
    );
});

test("reads Windows line endings and a byte order mark", () => {
    const content = "﻿---\r\ntitle: Start\r\n---\r\n# Outline\r\n\r\nHello\r\n";
    expect(parsePage("guide.md", content)).toMatchObject({
        name: "Start",
        markdown: "# Outline\n\nHello",
    });
});

test("accepts ... as the closing frontmatter delimiter", () => {
    expect(
        parsePage("guide.md", "---\ntitle: Start\n...\nHello"),
    ).toMatchObject({ name: "Start", markdown: "Hello" });
});

test("strips closing hashes from the heading", () => {
    expect(parsePage("guide.md", "# Start here ##\n\nHello")).toMatchObject({
        name: "Start here",
        markdown: "Hello",
    });
});

test.each([
    ["an indented code block", "    # Not a heading\n\nHello"],
    ["a heading without a space", "#hashtag\n\nHello"],
    ["an unclosed code fence", "```\n# Example\n\nHello"],
    ["a fence closed by the other marker", "```\n# Example\n~~~\n# Still code"],
    [
        "a fence closed by a shorter marker",
        "````\n# Example\n```\n# Still code",
    ],
])("falls back to the file name after %s", (_label, content) => {
    expect(parsePage("user-guide.md", content)).toMatchObject({
        name: "User guide",
        markdown: content,
    });
});

test("names both files that use the same ID", () => {
    expect(() =>
        validatePageIds([
            { file: "a.md", id: "guide" },
            { file: "b.md", id: "guide" },
        ]),
    ).toThrow(/guide.*a\.md.*b\.md/);
    expect(() =>
        validatePageIds([{ file: "a.md" }, { file: "b.md", id: "guide" }]),
    ).not.toThrow();
});

test("reports an opening delimiter without a closing delimiter", () => {
    expect(() => parsePage("guide.md", "---\ntitle: Test")).toThrow(
        /guide\.md.*closing/,
    );
});

test("ignores headings inside code fences", () => {
    const content = "~~~md\n# Example\n~~~\n# Real heading\n\nHello";
    expect(parsePage("guide.md", content)).toMatchObject({
        name: "Real heading",
        markdown: "~~~md\n# Example\n~~~\n\nHello",
    });
});
