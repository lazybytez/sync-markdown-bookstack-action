import { afterEach, expect, test, vi } from "vitest";
import { createBookStackClient } from "./client.js";

const secret = "test-token-secret";

function setup() {
    const fetch = vi.fn();
    const sleep = vi.fn(async () => {});
    const client = createBookStackClient({
        baseUrl: "https://bookstack.example/wiki/",
        tokenId: "test-id",
        tokenSecret: secret,
        fetch,
        sleep,
    });
    return { client, fetch, sleep };
}

afterEach(() => {
    vi.restoreAllMocks();
});

test("sends authenticated JSON requests under the BookStack API path", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ id: 7 }, { status: 201 }));

    await expect(
        client.request("POST", "/pages", { body: { name: "Guide" } }),
    ).resolves.toEqual({ id: 7 });
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://bookstack.example/wiki/api/pages");
    expect(options).toMatchObject({
        method: "POST",
        redirect: "manual",
        headers: {
            Authorization: `Token test-id:${secret}`,
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: '{"name":"Guide"}',
    });
});

test("retries a 429 and respects Retry-After", async () => {
    const { client, fetch, sleep } = setup();
    fetch
        .mockResolvedValueOnce(
            new Response(null, {
                status: 429,
                headers: { "Retry-After": "5" },
            }),
        )
        .mockResolvedValueOnce(Response.json({ id: 7 }));

    await expect(client.request("GET", "/pages/7")).resolves.toEqual({ id: 7 });
    expect(sleep.mock.calls).toEqual([[5000]]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, second] = fetch.mock.calls.map(
        ([url, { signal, ...options }]) => [url, options],
    );
    expect(second).toEqual(first);
});

const now = Date.parse("2026-01-01T12:00:00Z");

test.each([
    ["caps a long delay", "3600", 60_000],
    ["never waits less than the backoff", "0", 1000],
    ["ignores an unparseable value", "soon", 1000],
    ["accepts an HTTP date", new Date(now + 10_000).toUTCString(), 10_000],
    [
        "ignores an HTTP date in the past",
        new Date(now - 10_000).toUTCString(),
        1000,
    ],
])("Retry-After %s", async (_label, retryAfter, delay) => {
    vi.useFakeTimers({ toFake: ["Date"], now });
    try {
        const { client, fetch, sleep } = setup();
        fetch
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 429,
                    headers: { "Retry-After": retryAfter },
                }),
            )
            .mockResolvedValueOnce(Response.json({ id: 7 }));

        await client.request("GET", "/pages/7");
        expect(sleep.mock.calls).toEqual([[delay]]);
    } finally {
        vi.useRealTimers();
    }
});

test("reports the final 429 after three attempts with increasing delays", async () => {
    const { client, fetch, sleep } = setup();
    for (let attempt = 0; attempt < 3; attempt++) {
        fetch.mockResolvedValueOnce(
            Response.json(
                { error: { message: "Too many requests" } },
                { status: 429 },
            ),
        );
    }

    await expect(client.request("GET", "/pages")).rejects.toThrow(
        "GET /pages failed (HTTP 429): Too many requests",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
});

test("retries network failures and hides their original error details", async () => {
    const { client, fetch, sleep } = setup();
    fetch.mockRejectedValue(new TypeError(`transport echoed ${secret}`));

    await expect(client.request("GET", "/books")).rejects.toThrow(
        /^GET \/books failed: network error after 3 attempts$/,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
});

test.each(["HEAD", "PUT", "DELETE", "put"])(
    "retries a %s after a network failure",
    async (method) => {
        const { client, fetch, sleep } = setup();
        fetch
            .mockRejectedValueOnce(new TypeError("socket hang up"))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));

        await expect(
            client.request(method, "/pages/7"),
        ).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(sleep.mock.calls).toEqual([[1000]]);
    },
);

test.each(["POST", "PATCH"])(
    "does not repeat a %s after a network failure",
    async (method) => {
        const { client, fetch, sleep } = setup();
        fetch.mockRejectedValue(new TypeError("socket hang up"));

        await expect(
            client.request(method, "/pages", { body: { name: "Guide" } }),
        ).rejects.toThrow(
            `${method} /pages failed: network error, write outcome unknown`,
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    },
);

test("retries a POST rejected with 429", async () => {
    const { client, fetch } = setup();
    fetch
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(Response.json({ id: 7 }, { status: 201 }));

    await expect(
        client.request("POST", "/pages", { body: { name: "Guide" } }),
    ).resolves.toEqual({ id: 7 });
    expect(fetch).toHaveBeenCalledTimes(2);
});

test("limits each attempt with a fresh timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { client, fetch, sleep } = setup();
    fetch
        .mockRejectedValueOnce(
            new DOMException("The operation timed out", "TimeoutError"),
        )
        .mockResolvedValueOnce(Response.json({ id: 7 }));

    await expect(client.request("GET", "/pages/7")).resolves.toEqual({ id: 7 });
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
    const [first, second] = fetch.mock.calls.map(
        ([, options]) => options.signal,
    );
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
    expect(sleep.mock.calls).toEqual([[1000]]);
});

test("accepts a custom request timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn().mockResolvedValue(Response.json({}));
    const client = createBookStackClient({
        baseUrl: "https://bookstack.example",
        tokenId: "test-id",
        tokenSecret: secret,
        fetch,
        timeout: 120_000,
    });

    await client.request("GET", "/books");
    expect(timeout.mock.calls).toEqual([[120_000]]);
});

test("reports the BookStack error message without retrying a 401", async () => {
    const { client, fetch, sleep } = setup();
    fetch.mockResolvedValueOnce(
        Response.json({ error: { message: "Invalid token" } }, { status: 401 }),
    );

    await expect(client.request("GET", "/pages")).rejects.toThrow(
        /^GET \/pages failed \(HTTP 401\): Invalid token$/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
});

test("keeps the HTTP status when the server sends an HTML error", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(
        new Response(`<html>${secret}</html>`, {
            status: 502,
            statusText: "Bad Gateway",
        }),
    );

    await expect(client.request("GET", "/books")).rejects.toThrow(
        /^GET \/books failed \(HTTP 502\): Bad Gateway$/,
    );
});

test("returns undefined for an empty successful response", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(client.request("DELETE", "/pages/7")).resolves.toBeUndefined();
});

test("reports malformed successful JSON without echoing the body", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response(secret));

    await expect(client.request("GET", "/books")).rejects.toThrow(
        /^GET \/books failed \(HTTP 200\): invalid JSON response$/,
    );
});

test.each([
    ["another host", "https://elsewhere.example/wiki/api/pages"],
    ["another scheme", "http://bookstack.example/wiki/api/pages"],
    ["a parent directory", "../pages"],
    ["a sibling path sharing the prefix", "../apix/pages"],
    [
        "credentials in the URL",
        "https://user:pw@bookstack.example/wiki/api/pages",
    ],
])("rejects %s before sending credentials", async (_label, endpoint) => {
    const { client, fetch } = setup();

    await expect(client.request("GET", endpoint)).rejects.toThrow(
        `GET ${endpoint} failed: endpoint is outside the BookStack API`,
    );
    expect(fetch).not.toHaveBeenCalled();
});

test("accepts an absolute URL inside the API", async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ id: 7 }));

    await client.request("GET", "https://bookstack.example/wiki/api/pages/7");
    expect(String(fetch.mock.calls[0][0])).toBe(
        "https://bookstack.example/wiki/api/pages/7",
    );
});

test.each(["not a url", "ftp://bookstack.example", "file:///etc/passwd"])(
    "rejects the base URL %s",
    (baseUrl) => {
        expect(() =>
            createBookStackClient({ baseUrl, tokenId: "id", tokenSecret: "s" }),
        ).toThrow("Invalid BookStack base URL");
    },
);

test("paginates using the number of items actually returned", async () => {
    const { client, fetch } = setup();
    fetch
        .mockResolvedValueOnce(Response.json({ data: [{ id: 1 }], total: 3 }))
        .mockResolvedValueOnce(
            Response.json({ data: [{ id: 2 }, { id: 3 }], total: 3 }),
        );

    await expect(
        client.list("/pages?filter%5Bbook_id%5D=42", { count: 2 }),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(
        fetch.mock.calls.map(([url]) => Object.fromEntries(url.searchParams)),
    ).toEqual([
        { "filter[book_id]": "42", count: "2", offset: "0" },
        { "filter[book_id]": "42", count: "2", offset: "1" },
    ]);
});

test("stops pagination when a response has no more items", async () => {
    const { client, fetch } = setup();
    fetch
        .mockResolvedValueOnce(Response.json({ data: [{ id: 1 }], total: 2 }))
        .mockResolvedValueOnce(Response.json({ data: [], total: 2 }));

    await expect(client.list("/pages")).resolves.toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
    ["data that is not a list", { data: {}, total: 1 }],
    ["a missing total", { data: [{ id: 1 }] }],
    ["a negative total", { data: [], total: -1 }],
    ["a fractional total", { data: [], total: 1.5 }],
])("rejects a list response with %s", async (_label, page) => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json(page));

    await expect(client.list("/pages")).rejects.toThrow(
        /^GET \/pages failed: invalid BookStack list response$/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([0, -1, 1.5, "100"])(
    "rejects the page count %s without sending a request",
    async (count) => {
        const { client, fetch } = setup();

        await expect(client.list("/pages", { count })).rejects.toThrow(
            /^GET \/pages failed: page count must be a positive integer$/,
        );
        expect(fetch).not.toHaveBeenCalled();
    },
);

test("retries when the connection closes while reading the response body", async () => {
    const { client, fetch, sleep } = setup();
    fetch
        .mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(
                            new TypeError(`connection closed: ${secret}`),
                        );
                    },
                }),
            ),
        )
        .mockResolvedValueOnce(Response.json({ id: 7 }));

    await expect(client.request("GET", "/pages/7")).resolves.toEqual({ id: 7 });
    expect(sleep.mock.calls).toEqual([[1000]]);
    expect(fetch).toHaveBeenCalledTimes(2);
});
