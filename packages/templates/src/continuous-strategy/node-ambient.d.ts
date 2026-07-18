declare const __dirname: string;
declare const require: { main: unknown };
declare const module: unknown;

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(value: string): { digest(encoding: "hex"): string };
    digest(encoding: "hex"): string;
  };
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export const sep: string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function resolve(...paths: string[]): string;
}
