import { rm } from "node:fs/promises";

// Cross-platform clean (no `rm -rf` shell dependency).
await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });

