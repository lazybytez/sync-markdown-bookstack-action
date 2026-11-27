import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { getInput } from "@actions/core";
import { parseDocument } from "yaml";
import { isWithin } from "./workspace.js";

const TARGET_KEYS = ["path", "book-id", "chapter-id", "include", "exclude"];

function isMapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonBlank(value) {
    return typeof value === "string" && value.trim() !== "";
}

function rejectUnknownKeys(value, allowed, label) {
    const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
    if (unknownKey !== undefined) {
        throw new Error(`${label}: unknown key ${JSON.stringify(unknownKey)}`);
    }
}

function readGlobs(target, key, label) {
    if (!Object.hasOwn(target, key)) {
        return undefined;
    }
    const globs = target[key];
    if (!Array.isArray(globs) || !globs.every(isNonBlank)) {
        throw new Error(
            `${label}: ${key} must be a list of non-empty glob strings`,
        );
    }
    return globs;
}

function readId(target, key, label) {
    const input = target[key];
    const id =
        typeof input === "string" && /^\d+$/.test(input)
            ? Number(input)
            : input;
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error(`${label}: ${key} must be a positive integer`);
    }
    return id;
}

function readTarget(target, index, cwd, source) {
    const name = `${source}: target ${index + 1}`;
    if (!isMapping(target)) {
        throw new Error(`${name} must be a mapping`);
    }
    const label = isNonBlank(target.path)
        ? `${name} (path ${JSON.stringify(target.path)})`
        : name;
    rejectUnknownKeys(target, TARGET_KEYS, label);
    if (!isNonBlank(target.path)) {
        throw new Error(`${label}: path must be a non-empty string`);
    }

    const hasBook = Object.hasOwn(target, "book-id");
    const hasChapter = Object.hasOwn(target, "chapter-id");
    if (hasBook === hasChapter) {
        throw new Error(`${label}: set exactly one of book-id or chapter-id`);
    }

    return {
        path: resolve(cwd, target.path),
        ...(hasBook
            ? { bookId: readId(target, "book-id", label) }
            : { chapterId: readId(target, "chapter-id", label) }),
        include: readGlobs(target, "include", label),
        exclude: readGlobs(target, "exclude", label),
    };
}

function parseConfig(yaml, source, cwd) {
    let config;
    try {
        const document = parseDocument(yaml);
        if (document.errors.length > 0) {
            throw document.errors[0];
        }
        config = document.toJS();
    } catch (error) {
        throw new Error(`${source}: invalid YAML: ${error.message}`);
    }

    if (!isMapping(config)) {
        throw new Error(`${source}: config must be a mapping`);
    }
    rejectUnknownKeys(config, ["targets"], source);
    if (!Array.isArray(config.targets) || config.targets.length === 0) {
        throw new Error(`${source}: targets must be a non-empty list`);
    }

    const targets = [];
    for (const [index, value] of config.targets.entries()) {
        const target = readTarget(value, index, cwd, source);
        const duplicate = targets.findIndex(({ path }) => path === target.path);
        if (duplicate !== -1) {
            throw new Error(
                `${source}: target ${index + 1} (path ${JSON.stringify(value.path)}) has the same path as target ${duplicate + 1}`,
            );
        }
        targets.push(target);
    }
    return { targets, source, cwd };
}

/**
 * Loads v2 sync targets from the action inputs. Target paths are relative to cwd.
 *
 * @param {{config?: string, configFile?: string, cwd?: string}} [options]
 */
export async function loadTargets({
    config = getInput("config", { trimWhitespace: false }),
    configFile = getInput("config-file"),
    cwd = process.cwd(),
} = {}) {
    if (config.trim()) {
        if (configFile) {
            throw new Error("Set either config or config-file, not both");
        }
        return parseConfig(config, "config input", cwd);
    }

    const path = resolve(cwd, configFile || "bookstack.yaml");
    let yaml;
    try {
        const file = await realpath(path);
        if (!isWithin(await realpath(cwd), file)) {
            throw new Error("resolves outside the workspace");
        }
        if (!(await stat(file)).isFile()) {
            throw new Error("must be a regular file");
        }
        yaml = await readFile(file, "utf8");
    } catch (error) {
        throw new Error(
            `Could not read config file "${path}": ${error.code ?? error.message}`,
        );
    }
    return parseConfig(yaml, `config file "${path}"`, cwd);
}
