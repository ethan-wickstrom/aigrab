# grabr

React element context extraction for AI coding agents.

## Install

```bash
bun add grabr
```

## Usage (browser app)

`grabr` can extract DOM + (optionally) React component context for a clicked element.

**Important:** install the React DevTools hook via `bippy` *before React runs*.

```ts
import "bippy"; // installs DevTools hook before React
import { initGrabr } from "grabr";

initGrabr(); // attaches overlay + sets window.grabr
```

Then start a selection session from the console:

```js
window.grabr?.startSelectionSession("Update the button styles.");
```

## Local dev

To install dependencies:

```bash
bun install
```

To run the Bun demo server:

```bash
bun run demo
```

## Build (for publishing)

```bash
bun run build
```

## Releasing

Releases are fully automated via Release Please + a weekly release train.

See `RELEASING.md` for the opinionated workflow, required secrets, and cadence.
