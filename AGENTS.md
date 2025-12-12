Use **Bun** as the canonical toolchain for this repository: runtime, package manager, installer, task runner, test runner, bundler, and publisher. Avoid introducing alternate runtimes or package managers.

## Bun-first defaults

### Install dependencies (authoritative lockfile)

```bash
bun install
```

Reproducible/CI installs (do not modify the lockfile):

```bash
bun install --frozen-lockfile
```

Production installs (omit dev dependencies):

```bash
bun install --production
# or
bun install --omit dev
```

Lockfile-only (update `bun.lock` without touching `node_modules`):

```bash
bun install --lockfile-only
```

Lockfile rules:
- `bun.lock` is authoritative and must be committed.
- Some older repos may still have `bun.lockb`; if it exists, treat it as authoritative until explicitly migrated.
- Do not hand-edit the lockfile.

### Run TypeScript code

Run a file directly (preferred for scripts/tools):

```bash
bun ./src/index.ts
bun ./scripts/smoke.ts
```

Watch / reload during development:

```bash
bun --watch ./src/index.ts   # hard restart on change
bun --hot   ./src/server.ts  # soft reload (preserves global state)
```

Run package scripts (preferred for project workflows):

```bash
bun run dev
bun run build
bun run start
```

### Run tests (Bun test runner)

```bash
bun test
```

Run a specific test file or path:

```bash
bun test ./test/user.test.ts
bun test ./src/auth
```

Filter by test name:

```bash
bun test -t "parses headers"
```

Watch mode for tests:

```bash
bun --watch test
```

### Typecheck (strict TypeScript)

Preferred:

```bash
bun run typecheck
```

If a script isn’t present:

```bash
bunx tsc --noEmit
```

### Lint / format

Prefer a single toolchain invoked via Bun. Recommended baseline:

```bash
bun run lint
bun run format
```

If scripts aren’t present, use Biome via `bunx`:

```bash
bunx biome check .
bunx biome check --write .
```

### Build

Prefer `bun run build` when the repo defines a build script. Otherwise:

Server/library build to `dist/`:

```bash
bun build ./src/index.ts --outdir ./dist --target bun
```

Browser build (HTML entrypoint):

```bash
bun build ./index.html --outdir ./dist
```

### Environment variables (.env)

Bun loads environment variables from `.env` files automatically. Do **not** add `dotenv`.
- Default: `.env`
- Mode-specific (when `NODE_ENV` is set): `.env.development`, `.env.production`, `.env.test`
- Local overrides: `.env.local` and `.env.<mode>.local`

To use an explicit env file:

```bash
bun --env-file=.env.local ./src/server.ts
```

To disable `.env` loading (useful in CI):

```bash
bun --no-env-file ./src/server.ts
```

## Dependency management

Add/remove deps:

```bash
bun add zod
bun add -d typescript
bun remove zod
```

Update deps:

```bash
bun update
bun update --interactive
bun update --latest
```

Audit and analysis:

```bash
bun audit
bun outdated
bun why zod
```

### Lifecycle scripts and trusted dependencies

Bun does **not** run dependency lifecycle scripts (e.g. `postinstall`) unless explicitly trusted.

If a dependency requires lifecycle scripts to function, add it to `trustedDependencies`:

```bash
bun pm trust <package>
```

Only trust packages when necessary, and prefer Bun-native APIs first (e.g., use `bun:sqlite` instead of packages that require native postinstall builds).

## One-off tools and CLIs

Prefer running tools without global installs:

```bash
bunx prettier --check .
bunx biome check .
```

(`bunx` is an alias for `bun x`.)

If a tool is part of the repo’s workflow, add it as a dev dependency and expose it via `package.json` scripts.

## Bun-native runtime APIs (preferred)

Use Bun’s built-in primitives when they fit:
- HTTP server: `Bun.serve()` (avoid adding a framework unless the repo already uses one)
- WebSockets: built-in `WebSocket` + `Bun.serve({ websocket: ... })`
- SQLite: `bun:sqlite`
- SQL databases: `Bun.sql` / `Bun.SQL`
- Redis: `Bun.redis` / `RedisClient`
- File I/O: `Bun.file(...)`, `Bun.write(...)`
- Shelling out: `import { $ } from "bun"; await $`cmd``

Prefer Web-standard APIs (`fetch`, `Request`, `Response`, `URL`, `Headers`, `ReadableStream`) where possible.

## Project structure (typical)

```
.
├── bun.lock
├── package.json
├── tsconfig.json
├── src/
│   └── ...
├── test/            # or tests/
│   └── *.test.ts
└── scripts/
    └── *.ts
```

## Workspaces / monorepo

If the repo is a workspace (root `package.json` has `workspaces`), run installs from the repo root:

```bash
bun install
```

Filter workspace operations:

```bash
bun install --filter './packages/*'
bun outdated --filter 'pkg-*'
bun --filter '*' test
bun --filter '*' build
```

## Publishing (when applicable)

To publish to a registry:

```bash
bun publish
```

To pack first:

```bash
bun pm pack
bun publish ./package.tgz
```

## Debugging and common fixes

1. Dependency issues / “module not found”

```bash
bun install --frozen-lockfile
```

1. Confirm Bun version

```bash
bun --version
```

1. See why a dependency is present

```bash
bun why <package>
```

1. Inspect outdated packages

```bash
bun outdated
```

1. More logs

```bash
bun --verbose install
bun --verbose test
```

1. Watch-mode oddities in containers/mounted volumes
- Prefer `--watch` when filesystem events are reliable.
- If reload doesn’t trigger, confirm the environment supports file watching.

---

## Programming Principles

Always use each principle listed here to shape how you design, refactor, and verify code changes.

### Language and runtime

- Target **modern TypeScript** with **strict** settings.
- Prefer modern ECMAScript features that Bun supports (top-level `await`, `AbortController`, `Promise.allSettled`, `satisfies`, `const`inference, etc.).
- Bun is the canonical entrypoint for running code, dependency management, tests, builds, and publishing.
- Prefer **Web APIs** and **Bun-native APIs** over compatibility layers.
- Prefer dependencies already present in `package.json` before adding new ones.
- Write code that is:
  - Deterministic given its inputs.
  - Safe under concurrency (async tasks, workers, WebSockets) when used as documented.
  - Explicit about resource ownership and lifetimes (files, sockets, streams, DB connections, subprocesses).

### Functional design principles

Prefer pure functions over hidden side effects:
- A function that receives all inputs as parameters and returns all outputs as values is easier to test, compose, and parallelize.
- Separate computation from I/O:
  - Core logic transforms data.
  - Orchestration layers perform filesystem/network/DB access and call core logic.
- Pass dependencies explicitly (clients, clocks, random sources, config) rather than importing implicit singletons or relying on ambient globals.

Keep functions small and focused:
- Each function should have a single responsibility.
- Compose behavior from many small functions instead of large monoliths.
- When a function grows beyond ~20–30 lines or mixes concerns, refactor.
- Extract shared logic into utilities; do not copy/paste near-duplicates.

Favor immutability and local scope:
- Prefer `const`, `readonly`, `ReadonlyArray<T>`, and immutable return values.
- Isolate mutation to narrow scopes (e.g., building an array, then returning it).
- Avoid mutating arguments unless mutation is the explicit contract and documented.
- Avoid shared mutable state across async boundaries unless strictly necessary and carefully synchronized.

Write high-quality APIs:
- Give exported functions clear names, typed parameters, and well-defined return types.
- Document non-obvious preconditions, postconditions, error cases, and performance characteristics with short JSDoc where needed.
- Keep public APIs stable; avoid breaking changes without migration notes.

### Type system and parametric abstraction

Use TypeScript to enable reuse and catch errors early:
- Strongly type all exported functions, classes, and module-level values.
- Prefer `unknown` over `any`; narrow with type guards.
- Prefer structural typing:
  - `type` / `interface` for shapes
  - `satisfies` to validate objects without widening
- Use generics to reduce duplication; constrain when helpful.

Example: generic utility function

```ts
export function map<T, U>(items: Iterable<T>, fn: (item: T) => U): U[] {
  const out: U[] = [];
  for (const item of items) out.push(fn(item));
  return out;
}
```

Example: generic class

```ts
export class Stack<T> {
  readonly #items: T[] = [];

  push(item: T): void {
    this.#items.push(item);
  }

  pop(): T {
    const v = this.#items.pop();
    if (v === undefined) throw new Error("Stack underflow");
    return v;
  }
}
```

Strengthen types over time:
- When modifying code, tighten weak types (`any`, overly broad unions) to concrete types.
- Keep typechecking green (`tsc --noEmit`).
- Avoid `@ts-ignore`. If unavoidable, scope it to the narrowest expression and explain why.

### Linearized algorithms and dataflow

Design “linearized” processing: single-pass, streaming-style transforms with clear data ownership.
- Prefer traversing data once, transforming and consuming elements as you go.
- Prefer iterators/generators (`Iterable`, `Iterator`, `AsyncIterable`) and streaming primitives (`ReadableStream`) to avoid large intermediates.
- Make ownership explicit: a value is produced, transformed through a pipeline, then consumed—rather than shared and mutated from multiple places.

Avoid hidden quadratic behavior:
- Avoid repeated `array.includes` in loops over the same array; prefer `Set`/`Map`.
- Avoid repeated string concatenation in loops; prefer array accumulation + `join`.
- Avoid repeated copying (e.g., `slice()`/spread) unless required; make copying explicit and justify it when it’s large.

Example: single-pass running maximum

```ts
export function* runningMax(values: Iterable<number>): Generator<number> {
  let has = false;
  let current = 0;

  for (const v of values) {
    if (!has) {
      current = v;
      has = true;
      yield current;
      continue;
    }
    if (v > current) current = v;
    yield current;
  }
}
```

Example: filtered projection without materializing intermediates

```ts
export type RecordLike = { id: number | null; enabled: boolean };

export function* iterEnabledIds(records: Iterable<RecordLike>): Generator<number> {
  for (const r of records) {
    if (r.enabled && r.id !== null) yield r.id;
  }
}
```

### Declarative and table-driven style

Where it improves clarity and performance, prefer mapping-based dispatch over long `if/else` chains.

```ts
type Action = "start" | "stop" | "pause";
type State = { status: string };

const ACTION_HANDLERS: Record<Action, (s: State) => State> = {
  start: (s) => ({ ...s, status: "running" }),
  stop: (s) => ({ ...s, status: "stopped" }),
  pause: (s) => ({ ...s, status: "paused" }),
};

export function dispatch(action: Action, state: State): State {
  return ACTION_HANDLERS[action](state);
}
```

Do not sacrifice readability for cleverness:
- Use table-driven patterns in repetitive/hot paths.
- In non-critical paths, a simple `if` can be clearer.

### Testing and verification

Run tests and tools as part of every change:
- After modifying behavior, run targeted tests:

  ```bash
  bun test ./test/some-area.test.ts
  
  ```
- Before finalizing larger changes, run the full suite:

  ```bash
  bun test
  
  ```
- Keep typechecking and lint/format clean:

  ```bash
  bun run typecheck
  bun run lint
  
  ```

Write informative error messages:
- Assertions/exceptions must include key context (ids, sizes, values) to make failures diagnosable.
- Prefer explicit checks + errors over silent failure.

Example: informative validation

```ts
export function withdraw(accountId: string, amount: number, balance: number): number {
  if (!(amount > 0)) {
    throw new Error(`withdraw amount must be positive; account=${accountId} amount=${amount}`);
  }
  if (balance < amount) {
    throw new Error(
      `insufficient funds; account=${accountId} requested=${amount} available=${balance}`,
    );
  }
  return balance - amount;
}
```

Strengthen tests over time:
- When fixing a bug, add a regression test that fails before the fix and passes after.
- When adding features, add unit tests for core logic and integration tests for workflows.
- Prefer deterministic tests: no real network, no real time, no shared global state.
- Parameterize tests via data tables:

```ts
import { test, expect } from "bun:test";

const cases = [
  { in: [1, 2, 3], out: [1, 2, 3] },
  { in: [3, 2, 4], out: [3, 3, 4] },
] as const;

for (const c of cases) {
  test(`runningMax(${c.in.join(",")})`, () => {
    // ...
    expect(true).toBe(true);
  });
}
```

Continuous improvement expectations:
- When touching code, opportunistically:
  - Strengthen types and remove unnecessary `any`/casts.
  - Simplify control flow and improve single-pass data processing.
  - Improve error messages and add missing edge-case tests.
- When catching errors, either handle fully (with useful context) or rethrow with additional context without obscuring the root cause.