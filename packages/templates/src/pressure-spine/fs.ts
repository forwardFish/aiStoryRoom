import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PressureSpineFileMap } from "./types";

export function safeResolve(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`CONTENT_PATH_INVALID:${relativePath}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`CONTENT_PATH_INVALID:${relativePath}`);
  }
  return absolutePath;
}

export function listRelativeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    }
  };
  walk(resolve(root));
  return files.sort();
}

export function readPressureSpineDirectory(root: string): PressureSpineFileMap {
  return new Map(listRelativeFiles(root).map((path) => [path, readFileSync(safeResolve(root, path))]));
}
