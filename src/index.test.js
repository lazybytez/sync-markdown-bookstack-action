import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);

test("the committed action bundle creates and updates a page in a book", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bookstack-action-"));
    const requests = [];
    let contents = [];
    const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body: body ? JSON.parse(body) : null,
        });

        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ contents }));
    });

    try {
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        await copyFile(
            new URL("../dist/index.js", import.meta.url),
            join(workspace, "index.js"),
        );
        await copyFile(
            new URL("../package.json", import.meta.url),
            join(workspace, "package.json"),
        );
        await writeFile(
            join(workspace, "guide.md"),
            "# Guide\n\nOriginal content.\n",
        );

        const runAction = () =>
            execFileAsync(process.execPath, ["index.js"], {
                cwd: workspace,
                env: {
                    INPUT_URL: `http://127.0.0.1:${server.address().port}/`,
                    "INPUT_TOKEN-ID": "test-id",
                    "INPUT_TOKEN-SECRET": "test-secret",
                    "INPUT_BOOK-ID": "42",
                    INPUT_PATH: "*.md",
                },
                timeout: 5000,
            });

        await runAction();
        contents = [{ type: "page", name: "Guide", id: 7 }];
        await writeFile(
            join(workspace, "guide.md"),
            "# Guide\n\nUpdated content.\n",
        );
        await runAction();

        expect(requests).toEqual([
            {
                method: "GET",
                url: "/api/books/42",
                authorization: "Token test-id:test-secret",
                body: null,
            },
            {
                method: "POST",
                url: "/api/pages",
                authorization: "Token test-id:test-secret",
                body: {
                    name: "Guide",
                    markdown: "Original content.",
                    book_id: "42",
                },
            },
            {
                method: "GET",
                url: "/api/books/42",
                authorization: "Token test-id:test-secret",
                body: null,
            },
            {
                method: "PUT",
                url: "/api/pages/7",
                authorization: "Token test-id:test-secret",
                body: {
                    name: "Guide",
                    markdown: "Updated content.",
                    book_id: "42",
                },
            },
        ]);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(workspace, { recursive: true, force: true });
    }
});
