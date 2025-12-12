/**
 * Public package entrypoint.
 *
 * Keep this file **side-effect free** so importing `grabr` never starts servers,
 * touches the DOM, or modifies globals.
 *
 * For browser apps, prefer importing from `@ethan-wickstrom/grabr/client`.
 * For the Bun demo server, see `examples/demo.ts`.
 */
export * from "./grabr";
