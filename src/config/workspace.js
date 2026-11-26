import { isAbsolute, relative, sep } from "node:path";

/**
 * Checks whether an absolute path is the root or a descendant of it.
 *
 * @param {string} root
 * @param {string} file
 */
export function isWithin(root, file) {
    const path = relative(root, file);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
