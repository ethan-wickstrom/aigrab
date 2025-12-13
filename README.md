# grabr

React element context extraction for AI coding agents.

## Install

```bash
bun add @ethan-wickstrom/grabr
```

## Quick start (React app)

`grabr` extracts DOM + (optionally) React component context for clicked elements.

**Important:** import `@ethan-wickstrom/grabr/client` as early as possible in your client bundle, before React renders.

```ts
import { setupGrabr } from "@ethan-wickstrom/grabr/client";

setupGrabr(); // installs overlay + sets window.grabr
```

Then start a selection session from the console:

```js
window.grabr?.startSelectionSession("Update the button styles.");
```

## Configuration

```ts
setupGrabr({
  config: {
    reactInspectorMode: "best-effort",
    maxReactStackFrames: 8,
  },
  // "Alt+Shift+G" by default. Set to false to disable the global toggle.
  hotkey: "Alt+Shift+G",
});
```

If you don't want a global, use `createGrabrClient({ attachToWindow: false })` from the same entrypoint.

## Local dev

To install dependencies:

```bash
bun install
```

To run the Bun demo server:

```bash
bun run demo
```

You can also start the demo server directly in a Bun script to explore the internal client bundle and the enhanced React metadata capture flow:

```ts
import { startGrabrDemoServer } from "@ethan-wickstrom/grabr/grabr";

await startGrabrDemoServer(3000);
// Visit http://localhost:3000 and press Alt+Shift+G to toggle selection.
// React component stacks, props, context, and DOM styling are captured for the clicked element.
```

## Build (for publishing)

```bash
bun run build
```

## Releasing

Releases are fully automated via Release Please + a weekly release train.

See `RELEASING.md` for the opinionated workflow, required secrets, and cadence.
