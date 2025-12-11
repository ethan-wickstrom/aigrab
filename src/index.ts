/**
 * Public package entrypoint.
 *
 * Keep this file **side-effect free** so importing `aigrab` never starts servers,
 * touches the DOM, or modifies globals.
 *
 * For the Bun demo server, see `examples/demo.ts`.
 */
export * from "./aigrab";
