const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY = 60_000;
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt, retryAfter) {
    const backoff = attempt * 1000;
    if (!retryAfter) {
        return backoff;
    }

    const requested = /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - Date.now();
    if (Number.isNaN(requested)) {
        return backoff;
    }
    return Math.max(backoff, Math.min(requested, MAX_RETRY_DELAY));
}

function requestError(method, path, detail, status) {
    const http = status === undefined ? "" : ` (HTTP ${status})`;
    return new Error(`${method} ${path} failed${http}: ${detail}`);
}

function readResponse(response, text, failure) {
    const fallback = response.statusText || "no BookStack error message";

    let result;
    if (text) {
        try {
            result = JSON.parse(text);
        } catch {
            throw failure(
                response.ok ? "invalid JSON response" : fallback,
                response.status,
            );
        }
    }

    if (!response.ok) {
        const message = result?.error?.message;
        throw failure(
            typeof message === "string" && message ? message : fallback,
            response.status,
        );
    }
    return result;
}

/**
 * Creates a client for JSON endpoints below a BookStack installation's /api path.
 *
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.tokenId
 * @param {string} options.tokenSecret
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {(milliseconds: number) => Promise<void>} [options.sleep]
 * @param {number} [options.timeout] Milliseconds allowed for each attempt.
 */
export function createBookStackClient({
    baseUrl,
    tokenId,
    tokenSecret,
    fetch: fetchRequest = globalThis.fetch,
    sleep = wait,
    timeout = 30_000,
}) {
    const apiUrl = URL.parse(baseUrl);
    if (!apiUrl || !["http:", "https:"].includes(apiUrl.protocol)) {
        throw new Error("Invalid BookStack base URL");
    }
    apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, "")}/api/`;
    apiUrl.search = "";
    apiUrl.hash = "";
    const authHeaders = {
        Accept: "application/json",
        Authorization: `Token ${tokenId}:${tokenSecret}`,
    };

    function resolveEndpoint(path, query) {
        const url = URL.parse(path.replace(/^\/+/, ""), apiUrl);
        if (
            !url ||
            url.origin !== apiUrl.origin ||
            !url.pathname.startsWith(apiUrl.pathname) ||
            url.username ||
            url.password
        ) {
            return undefined;
        }
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }
        return url;
    }

    function apiPath(url) {
        return `${url.pathname.slice(apiUrl.pathname.length - 1)}${url.search}`;
    }

    async function request(method, path, { body, query = {} } = {}) {
        const url = resolveEndpoint(path, query);
        if (!url) {
            throw requestError(
                method,
                path,
                "endpoint is outside the BookStack API",
            );
        }
        const failure = (detail, status) =>
            requestError(method, apiPath(url), detail, status);
        const options = {
            method,
            headers: { ...authHeaders },
            redirect: "manual",
        };
        if (body !== undefined) {
            options.headers["Content-Type"] = "application/json";
            try {
                options.body = JSON.stringify(body);
            } catch {
                throw failure("could not serialize request body");
            }
        }

        let status;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            let response;
            let text;
            try {
                response = await fetchRequest(url, {
                    ...options,
                    signal: AbortSignal.timeout(timeout),
                });
                text = await response.text();
            } catch {
                if (!IDEMPOTENT_METHODS.has(method.toUpperCase())) {
                    throw failure(
                        "network error, write outcome unknown",
                        response?.status,
                    );
                }
                status = response?.status;
                if (attempt < MAX_ATTEMPTS) {
                    await sleep(retryDelay(attempt));
                }
                continue;
            }

            if (response.status === 429 && attempt < MAX_ATTEMPTS) {
                await sleep(
                    retryDelay(attempt, response.headers.get("Retry-After")),
                );
                continue;
            }
            return readResponse(response, text, failure);
        }
        throw failure(`network error after ${MAX_ATTEMPTS} attempts`, status);
    }

    async function list(path, { count = 100 } = {}) {
        if (!Number.isSafeInteger(count) || count < 1) {
            throw requestError(
                "GET",
                path,
                "page count must be a positive integer",
            );
        }
        const items = [];
        let page;
        do {
            page = await request("GET", path, {
                query: { count, offset: items.length },
            });
            if (
                !Array.isArray(page?.data) ||
                !Number.isSafeInteger(page.total) ||
                page.total < 0
            ) {
                throw requestError(
                    "GET",
                    path,
                    "invalid BookStack list response",
                );
            }
            items.push(...page.data);
        } while (page.data.length > 0 && items.length < page.total);
        return items;
    }

    return { request, list };
}
