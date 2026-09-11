/**
 * Ambient declaration for build-time environment access.
 *
 * Vite `define` statically replaces the literal expressions `process.env.API_BASE_URL`
 * and `process.env.NODE_ENV` at build time, so no runtime `process` global is ever
 * referenced inside the browser bundle. All accesses are additionally guarded with
 * `typeof process` checks so bundles built without the define degrade gracefully.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
