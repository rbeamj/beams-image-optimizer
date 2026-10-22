// Minimal typings for the Node built-ins used by tests (the project does not depend on @types/node).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}
declare const Buffer: { from(data: number[]): { toString(encoding: 'base64'): string } };
