import { realpath, stat } from "node:fs/promises";
import { glob } from "glob";
import { isWithin } from "./workspace.js";

const DEFAULT_INCLUDE = ["**/*.md"];

async function resolveTarget(target, label, workspace) {
    let path;
    let info;
    try {
        path = await realpath(target.path);
        info = await stat(path);
    } catch (error) {
        throw new Error(
            `${label}: Could not access target path "${target.path}" (${error.code})`,
        );
    }
    if (!isWithin(workspace, path)) {
        throw new Error(
            `${label}: target path "${target.path}" resolves outside the workspace`,
        );
    }
    if (!info.isDirectory() && !info.isFile()) {
        throw new Error(
            `${label}: target path "${target.path}" must be a directory or regular file`,
        );
    }
    if (
        info.isFile() &&
        (target.include !== undefined || target.exclude !== undefined)
    ) {
        throw new Error(
            `${label}: target path "${target.path}" is a file, so include and exclude do not apply`,
        );
    }
    return { target, path, directory: info.isDirectory() };
}

async function directoryFiles({ target, path }) {
    const matches = await glob(target.include ?? DEFAULT_INCLUDE, {
        cwd: path,
        withFileTypes: true,
        realpath: true,
        nodir: true,
        dot: true,
        ignore: target.exclude ?? [],
    });
    return matches
        .filter((match) => match.isFile())
        .map((match) => match.fullpath());
}

/**
 * Selects absolute file paths for each configured target in configuration order.
 * The most specific path owns a file even when its filters omit that file.
 *
 * @param {Awaited<ReturnType<import("./targets.js").loadTargets>>} configuration
 */
export async function selectTargetFiles({ targets, source, cwd }) {
    const workspace = await realpath(cwd);
    const entries = await Promise.all(
        targets.map((target, index) =>
            resolveTarget(target, `${source}: target ${index + 1}`, workspace),
        ),
    );
    for (const [index, entry] of entries.entries()) {
        const duplicate = entries.findIndex(({ path }) => path === entry.path);
        if (duplicate !== index) {
            throw new Error(
                `${source}: target ${index + 1} (path "${entry.target.path}") resolves to the same path as target ${duplicate + 1}`,
            );
        }
    }

    const mostSpecificFirst = [...entries].sort(
        (left, right) => right.path.length - left.path.length,
    );
    function owner(file) {
        return mostSpecificFirst.find(({ path, directory }) =>
            directory ? isWithin(path, file) : path === file,
        );
    }

    return Promise.all(
        entries.map(async (entry) => {
            const candidates = entry.directory
                ? await directoryFiles(entry)
                : [entry.path];
            const files = candidates.filter((file) => owner(file) === entry);
            return { ...entry.target, files: files.sort() };
        }),
    );
}
