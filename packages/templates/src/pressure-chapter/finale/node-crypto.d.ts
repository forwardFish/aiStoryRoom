// The templates package carries a minimal Node ambient declaration instead of
// @types/node. Shared canonical hashing legally passes an explicit UTF-8
// encoding, so this public overload widens that local shim for consumers.
declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(
      value: string | Uint8Array,
      inputEncoding?: "utf8",
    ): { digest(encoding: "hex"): string };
    digest(encoding: "hex"): string;
  };
}
