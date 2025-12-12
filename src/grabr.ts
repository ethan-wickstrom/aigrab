/// <reference lib="dom" />

/**
 * grabr: React element context extraction for AI coding agents.
 *
 * Import "bippy" before React runs to enable React metadata. If the hook isn't
 * active, React info will be missing but DOM/styling still works.
 */

// -----------------------------------------------------------------------------
// Imports: bippy & source-location helpers
// -----------------------------------------------------------------------------

import {
  type Fiber,
  type ReactRenderer,
  getDisplayName,
  getFiberFromHostInstance,
  getFiberStack,
  getLatestFiber,
  isCompositeFiber,
  isHostFiber,
  traverseContexts,
  traverseProps,
  traverseState,
  hasRDTHook,
  isInstrumentationActive,
  detectReactBuildType,
  _renderers,
} from "bippy";

import { getSource } from "bippy/source";

// -----------------------------------------------------------------------------
// Global declarations (browser + Bun)
// -----------------------------------------------------------------------------

declare global {
  interface Window {
    grabr?: GrabrApi;
  }
}

// -----------------------------------------------------------------------------
// Core data types: context schema (ElementContextV2 and friends)
// -----------------------------------------------------------------------------

// Serializable values we may emit in props/state/context snapshots.
// This avoids dumping arbitrary functions or cyclic references.
export type SerializablePrimitive = string | number | boolean | null;

export interface SerializableObject {
  readonly [key: string]: SerializableValue;
}

export type SerializableValue =
  | SerializablePrimitive
  | readonly SerializableValue[]
  | SerializableObject;

// Selection metadata
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionIdentity {
  readonly tag: string;
  readonly id: string | null;
  readonly dataTestId: string | null;
  readonly role: string | null;
  readonly classes: readonly string[];
}

export interface SelectionInfo {
  readonly tag: string;
  readonly boundingBox: BoundingBox;
  readonly identity: SelectionIdentity;
  readonly componentDisplayName: string | null;
  readonly nearestSource: SourceLocation | null;
  readonly isLikelyServerComponent: boolean | null;
}

// DOM neighborhood
export interface DomNodeSummary {
  readonly tag: string;
  readonly id: string | null;
  readonly dataTestId: string | null;
  readonly classes: readonly string[];
  readonly textSnippet: string | null;
}

export interface SiblingSummary {
  readonly index: number;
  readonly total: number;
  readonly previous: DomNodeSummary | null;
  readonly next: DomNodeSummary | null;
}

export interface ChildSummary {
  readonly totalChildren: number;
  readonly tagCounts: { readonly [tag: string]: number };
  readonly samples: readonly DomNodeSummary[];
}

export interface DomNeighborhood {
  readonly snippet: string;
  readonly parents: readonly DomNodeSummary[];
  readonly siblings: SiblingSummary;
  readonly children: ChildSummary;
  readonly selectors: {
    readonly preferred: string;
    readonly all: readonly string[];
  };
}

// Source-location metadata: explicitly debug-only and fallible.
// Consumers should treat this as a hint, not a guarantee.
export type SourceConfidence = "none" | "low" | "medium" | "high";

export type SourceOrigin = "bippy" | "sourcemap" | "inline" | "unknown";

export interface SourceLocation {
  readonly fileName: string;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
  readonly confidence: SourceConfidence;
  readonly origin: SourceOrigin;
}

// React component stack and data slice
export interface ComponentFlags {
  readonly isHost: boolean;
  readonly isComposite: boolean;
  readonly isSuspenseBoundary: boolean | null;
  readonly isErrorBoundary: boolean | null;
  readonly isServerComponent: boolean | null;
  readonly isLayoutLike: boolean | null;
}

export interface PropHighlight {
  readonly name: string;
  readonly value: SerializableValue | null;
  readonly reason:
    | "text"
    | "design"
    | "children"
    | "test-id"
    | "aria-label"
    | "other";
}

export interface PropsSnapshot {
  readonly totalProps: number;
  readonly highlighted: readonly PropHighlight[];
}

export interface StateSnapshotEntry {
  readonly hookIndex: number;
  readonly value: SerializableValue | null;
}

export interface StateSnapshot {
  readonly totalHooks: number;
  readonly entries: readonly StateSnapshotEntry[];
}

export interface ContextEntry {
  readonly index: number;
  readonly value: SerializableValue | null;
}

export interface ContextSnapshot {
  readonly totalContexts: number;
  readonly entries: readonly ContextEntry[];
}

export interface ReactComponentFrame {
  readonly displayName: string | null;
  readonly isHost: boolean;
  readonly source: SourceLocation | null;
  readonly flags: ComponentFlags;
}

export interface ReactTreeSlice {
  readonly stack: readonly ReactComponentFrame[];
  readonly ownerIndex: number | null;
  readonly ownerProps: PropsSnapshot | null;
  readonly ownerState: StateSnapshot | null;
  readonly ownerContexts: ContextSnapshot | null;
}

// Styling / layout information
export interface MatchedRuleSummary {
  readonly selector: string;
  readonly origin: "author" | "user-agent" | "inline" | "unknown";
  readonly specificity: string;
  readonly importantCount: number;
}

export interface StyleFrame {
  readonly layout: {
    readonly display: string | null;
    readonly position: string | null;
    readonly flexDirection: string | null;
    readonly justifyContent: string | null;
    readonly alignItems: string | null;
    readonly gap: string | null;
    readonly gridTemplateColumns: string | null;
    readonly gridTemplateRows: string | null;
  };
  readonly spacing: {
    readonly margin: string | null;
    readonly padding: string | null;
  };
  readonly size: {
    readonly width: string | null;
    readonly height: string | null;
  };
  readonly typography: {
    readonly fontFamily: string | null;
    readonly fontSize: string | null;
    readonly fontWeight: string | null;
    readonly lineHeight: string | null;
  };
  readonly colors: {
    readonly color: string | null;
    readonly backgroundColor: string | null;
    readonly borderColor: string | null;
  };
  readonly clickable: boolean;

  /**
   * Reserved for future deep CSS rule analysis (e.g. matched CSS rules).
   * Currently left empty by the implementation, but modeled here so schema
   * can be extended without breaking compatibility.
   */
  readonly ruleSummaries?: readonly MatchedRuleSummary[];
}

// Behavior / event hints: explicitly inferred/speculative.
export type EventKind =
  | "click"
  | "change"
  | "submit"
  | "input"
  | "focus"
  | "blur"
  | "key"
  | "pointer"
  | "other";

export type BehaviorInferenceLevel = "none" | "prop-name-only";

export type BehaviorInferenceSource = "prop-name" | "runtime-hook";

export interface EventHandlerInfo {
  readonly propName: string;
  readonly inferredKind: EventKind;
  readonly functionName: string | null;
  readonly declaredOnComponent: string | null;
  readonly source: SourceLocation | null;
  readonly comment: string | null;
  readonly inferenceSource: BehaviorInferenceSource;
}

export interface BehaviorContext {
  readonly inferenceLevel: BehaviorInferenceLevel;
  readonly handlers: readonly EventHandlerInfo[];
}

// Data-flow & routing hints
export interface DataSourceHint {
  readonly kind: "react-query" | "swr" | "redux" | "trpc" | "custom" | "unknown";
  readonly identifier: string | null;
  readonly description: string | null;
}

export type InferredFramework =
  | "next-app"
  | "next-pages"
  | "remix"
  | "react-router"
  | "unknown";

export interface FrameworkDetectionResult {
  readonly framework: InferredFramework;
  readonly routePatternGuess: string | null;
  readonly routeParamsGuess: { readonly [key: string]: string } | null;
  readonly pageComponent: SourceLocation | null;
  readonly layoutComponents: readonly SourceLocation[];
}

export interface AppContext {
  readonly url: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly framework: InferredFramework;
  readonly routePatternGuess: string | null;
  readonly routeParamsGuess: { readonly [key: string]: string } | null;
  readonly pageComponent: SourceLocation | null;
  readonly layoutComponents: readonly SourceLocation[];
  readonly dataSources: readonly DataSourceHint[];
}

// Optional test hints
export interface TestHint {
  readonly type: "test" | "story" | "command";
  readonly location: SourceLocation;
  readonly description: string | null;
}

export interface TestsBlock {
  readonly hints: readonly TestHint[];
}

// React integration debug info
export type ReactBuildType = "development" | "production" | "unknown";

export type ReactInspectorStatus = "ok" | "no-hook" | "inactive" | "no-fiber" | "error";

export interface ReactDebugInfo {
  readonly buildType: ReactBuildType;
  readonly inspectorStatus: ReactInspectorStatus;
  readonly message: string | null;
}

// Main element context schema
export interface ElementContextV2 {
  readonly version: 2;
  readonly selection: SelectionInfo;
  readonly dom: DomNeighborhood;
  readonly react: ReactTreeSlice | null;
  readonly reactDebug: ReactDebugInfo;
  readonly styling: StyleFrame;
  readonly behavior: BehaviorContext;
  readonly app: AppContext;
  readonly tests?: TestsBlock;
}

// Session & agent integration
export interface GrabrSession {
  readonly id: string;
  readonly createdAt: string;
  readonly url: string;
  readonly userInstruction: string | null;
  readonly summary: string | null;
  readonly elements: readonly ElementContextV2[];
}

export interface AgentProvider {
  readonly id: string;
  readonly label: string;
  sendContext(session: GrabrSession): Promise<void>;
  onSuccess?(session: GrabrSession): void;
  onError?(session: GrabrSession, error: Error): void;
}

export interface GrabrApi {
  readonly version: string;
  startSelectionSession(userInstruction?: string | null): void;
  getCurrentSession(): GrabrSession | null;
  registerAgentProvider(provider: AgentProvider): void;
  setActiveAgentProvider(id: string): void;
}

export interface GrabrClient extends GrabrApi {
  readonly config: Readonly<GrabrRuntimeConfig>;
  dispose(): void;
}

// -----------------------------------------------------------------------------
// Heuristic strategy interfaces (framework & data sources)
// -----------------------------------------------------------------------------

export interface FrameworkDetectionInput {
  readonly reactSlice: ReactTreeSlice | null;
  readonly url: string;
  readonly pathname: string;
}

export interface FrameworkDetectionStrategy {
  readonly id: string;
  detect(input: FrameworkDetectionInput): FrameworkDetectionResult | null;
}

export interface DataSourceDetectionInput {
  readonly ownerProps: PropsSnapshot | null;
}

export interface DataSourceDetectionStrategy {
  readonly id: string;
  detect(input: DataSourceDetectionInput): readonly DataSourceHint[];
}

// Default framework strategies (string heuristics moved behind interfaces)

function inferFrameworkFromPath(path: string): InferredFramework {
  if (path.includes("/app/")) {
    return "next-app";
  }
  if (path.includes("/pages/")) {
    return "next-pages";
  }
  if (path.includes("react-router")) {
    return "react-router";
  }
  if (path.includes("remix")) {
    return "remix";
  }
  return "unknown";
}

function isLayoutLikeFromPath(path: string): boolean {
  return (
    path.endsWith("/layout.tsx") ||
    path.endsWith("/layout.jsx") ||
    path.endsWith("/_layout.tsx") ||
    path.endsWith("/_layout.jsx")
  );
}

function isPageLikeFromPath(path: string): boolean {
  return (
    path.endsWith("/page.tsx") ||
    path.endsWith("/page.jsx") ||
    path.endsWith("/index.tsx") ||
    path.endsWith("/index.jsx")
  );
}

const nextLikeFrameworkStrategy: FrameworkDetectionStrategy = {
  id: "next-like",
  detect(input: FrameworkDetectionInput): FrameworkDetectionResult | null {
    const layoutComponents: SourceLocation[] = [];
    let pageComponent: SourceLocation | null = null;
    let framework: InferredFramework = "unknown";

    if (!input.reactSlice) {
      return null;
    }

    for (const frame of input.reactSlice.stack) {
      const source = frame.source;
      if (!source) continue;
      const path = source.fileName;

      if (framework === "unknown") {
        framework = inferFrameworkFromPath(path);
      }
      if (isLayoutLikeFromPath(path)) {
        layoutComponents.push(source);
      }
      if (!pageComponent && isPageLikeFromPath(path)) {
        pageComponent = source;
      }
    }

    if (framework === "unknown" && !pageComponent && layoutComponents.length === 0) {
      return null;
    }

    const routeParamsGuess: { [key: string]: string } = {};
    const routePatternGuess: string | null =
      framework === "next-app" || framework === "next-pages"
        ? (() => {
            const segments = input.pathname.split("/").filter((s) => s.length > 0);
            const patternSegments: string[] = [];
            segments.forEach((seg, idx) => {
              if (/^\d+$/.test(seg)) {
                patternSegments.push(`[id${idx}]`);
                routeParamsGuess[`id${idx}`] = seg;
              } else if (seg.length > 2 && seg === seg.toLowerCase()) {
                patternSegments.push(seg);
              } else {
                patternSegments.push(`[param${idx}]`);
                routeParamsGuess[`param${idx}`] = seg;
              }
            });
            return `/${patternSegments.join("/")}`;
          })()
        : null;

    return {
      framework: framework === "unknown" ? "unknown" : framework,
      routePatternGuess,
      routeParamsGuess:
        Object.keys(routeParamsGuess).length > 0 ? routeParamsGuess : null,
      pageComponent,
      layoutComponents,
    };
  },
};

// Placeholder for additional frameworks; currently returns null (no-op).
const genericFrameworkStrategy: FrameworkDetectionStrategy = {
  id: "generic",
  detect(_input: FrameworkDetectionInput): FrameworkDetectionResult | null {
    return {
      framework: "unknown",
      routePatternGuess: null,
      routeParamsGuess: null,
      pageComponent: null,
      layoutComponents: [],
    };
  },
};

// Default data source strategy: React Query/SWR/Redux heuristic based on prop names.

const basicDataSourceStrategy: DataSourceDetectionStrategy = {
  id: "basic-data-props",
  detect(input: DataSourceDetectionInput): readonly DataSourceHint[] {
    const propNames: string[] =
      input.ownerProps?.highlighted.map((h) => h.name) ?? [];
    const lowerNames = propNames.map((p) => p.toLowerCase());

    const hints: DataSourceHint[] = [];
    const hasData = lowerNames.includes("data");
    const hasIsLoading =
      lowerNames.includes("isloading") || lowerNames.includes("loading");
    const hasError = lowerNames.includes("error");
    if (hasData && hasIsLoading && hasError) {
      hints.push({
        kind: "react-query",
        identifier: null,
        description: "Props suggest React Query-like async data (data/loading/error).",
      });
    }
    if (lowerNames.some((p) => p.includes("swr"))) {
      hints.push({
        kind: "swr",
        identifier: null,
        description: "Props mention SWR, likely SWR-based data.",
      });
    }
    if (lowerNames.some((p) => p.includes("selector"))) {
      hints.push({
        kind: "redux",
        identifier: null,
        description: "Selector-like props hint at Redux selectors.",
      });
    }

    if (hints.length === 0) {
      return [
        {
          kind: "unknown",
          identifier: null,
          description: null,
        },
      ];
    }
    return hints;
  },
};

// -----------------------------------------------------------------------------
// Runtime config
// -----------------------------------------------------------------------------

export type ReactInspectorMode = "best-effort" | "required" | "off";

export interface GrabrHeuristics {
  readonly frameworkStrategies: readonly FrameworkDetectionStrategy[];
  readonly dataSourceStrategies: readonly DataSourceDetectionStrategy[];
}

export interface GrabrRuntimeConfig {
  readonly reactInspectorMode: ReactInspectorMode;
  readonly maxReactStackFrames: number;
  readonly heuristics: GrabrHeuristics;
}

const defaultHeuristics: GrabrHeuristics = {
  frameworkStrategies: [nextLikeFrameworkStrategy, genericFrameworkStrategy],
  dataSourceStrategies: [basicDataSourceStrategy],
};

export const defaultRuntimeConfig: GrabrRuntimeConfig = {
  reactInspectorMode: "best-effort",
  maxReactStackFrames: 8,
  heuristics: defaultHeuristics,
};

export function mergeRuntimeConfig(
  partial: Partial<GrabrRuntimeConfig> | undefined
): GrabrRuntimeConfig {
  if (!partial) {
    return defaultRuntimeConfig;
  }
  const heuristics: GrabrHeuristics = {
    frameworkStrategies:
      partial.heuristics?.frameworkStrategies ?? defaultHeuristics.frameworkStrategies,
    dataSourceStrategies:
      partial.heuristics?.dataSourceStrategies ?? defaultHeuristics.dataSourceStrategies,
  };

  return {
    reactInspectorMode: partial.reactInspectorMode ?? defaultRuntimeConfig.reactInspectorMode,
    maxReactStackFrames:
      partial.maxReactStackFrames ?? defaultRuntimeConfig.maxReactStackFrames,
    heuristics,
  };
}

// -----------------------------------------------------------------------------
// Utility helpers (pure, testable)
// -----------------------------------------------------------------------------

const MAX_TEXT_SNIPPET = 80;
const MAX_PARENT_DEPTH = 4;
const MAX_CHILD_SAMPLES = 5;

export function truncateText(text: string, limit: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
}

function summarizeTextContent(node: Element): string | null {
  const text = node.textContent;
  if (text === null) {
    return null;
  }
  const summarized = truncateText(text, MAX_TEXT_SNIPPET);
  return summarized.length === 0 ? null : summarized;
}

function getDataTestId(el: Element): string | null {
  const value = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Build a simple CSS selector based on identity attributes.
export function buildPreferredSelector(el: Element): string {
  const id = el.id;
  if (id && id.length > 0 && !id.includes(" ")) {
    return `#${CSS.escape(id)}`;
  }
  const dataTestId = getDataTestId(el);
  if (dataTestId !== null) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }
  const classes = Array.from(el.classList).filter((cls) => cls.length > 0);
  const baseTag = el.tagName.toLowerCase();
  if (classes.length > 0) {
    return `${baseTag}.${classes.map((cls) => CSS.escape(cls)).join(".")}`;
  }
  const parent = el.parentElement;
  if (!parent) {
    return baseTag;
  }
  let index = 1;
  let sibling: Element | null = parent.firstElementChild;
  while (sibling) {
    if (sibling === el) {
      break;
    }
    if (sibling.tagName === el.tagName) {
      index += 1;
    }
    sibling = sibling.nextElementSibling;
  }
  return `${baseTag}:nth-of-type(${index})`;
}

// Build a simple ancestor selector path (e.g., div.card > button.primary)
function buildAncestorSelectorPath(el: Element, maxDepth: number): string {
  const segments: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < maxDepth) {
    const preferred = buildPreferredSelector(current);
    segments.unshift(preferred);
    current = current.parentElement;
    depth += 1;
  }
  return segments.join(" > ");
}

// Simple DOM-node summary from a real Element
function summarizeDomNode(el: Element): DomNodeSummary {
  const dataTestId = getDataTestId(el);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id && el.id.length > 0 ? el.id : null,
    dataTestId,
    classes: Array.from(el.classList),
    textSnippet: summarizeTextContent(el),
  };
}

// Compute sibling info
function summarizeSiblings(el: Element): SiblingSummary {
  const parent = el.parentElement;
  if (!parent) {
    return {
      index: 0,
      total: 1,
      previous: null,
      next: null,
    };
  }
  const siblings = Array.from(parent.children);
  const total = siblings.length;
  const index = siblings.indexOf(el);
  const previous =
    index > 0 ? summarizeDomNode(siblings[index - 1]!) : null;
  const next =
    index >= 0 && index < total - 1
      ? summarizeDomNode(siblings[index + 1]!)
      : null;
  return {
    index,
    total,
    previous,
    next,
  };
}

// Compute child summary
function summarizeChildren(el: Element): ChildSummary {
  const children = Array.from(el.children);
  const tagCounts: { [tag: string]: number } = {};
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    const prevCount = tagCounts[tag] ?? 0;
    tagCounts[tag] = prevCount + 1;
  }
  const samples: DomNodeSummary[] = children
    .slice(0, MAX_CHILD_SAMPLES)
    .map((c) => summarizeDomNode(c));
  return {
    totalChildren: children.length,
    tagCounts,
    samples,
  };
}

// Serialize a single element as a compact HTML-like snippet
function serializeElementSnippet(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  if (el.id) {
    attrs.push(`id="${el.id}"`);
  }
  const className = el.className.trim();
  if (className.length > 0) {
    attrs.push(`class="${truncateText(className, 40)}"`);
  }
  const dataTestId = getDataTestId(el);
  if (dataTestId !== null) {
    attrs.push(`data-testid="${dataTestId}"`);
  }
  const attrString = attrs.length > 0 ? " " + attrs.join(" ") : "";
  const text = summarizeTextContent(el);
  return `<${tag}${attrString}>${text ?? ""}</${tag}>`;
}

// Convert bippy Source → SourceLocation
type SourceLike = {
  readonly fileName?: string;
  readonly lineNumber?: number | null;
  readonly columnNumber?: number | null;
} | null;

function toSourceLocation(
  source: SourceLike,
  buildType: ReactBuildType
): SourceLocation | null {
  if (!source || !source.fileName) {
    return null;
  }
  const line =
    typeof source.lineNumber === "number" && Number.isFinite(source.lineNumber)
      ? source.lineNumber
      : null;
  const column =
    typeof source.columnNumber === "number" && Number.isFinite(source.columnNumber)
      ? source.columnNumber
      : null;

  const confidence: SourceConfidence =
    buildType === "development" ? "high" : buildType === "production" ? "low" : "medium";

  return {
    fileName: source.fileName,
    lineNumber: line,
    columnNumber: column,
    confidence,
    origin: "bippy",
  };
}

// Serializable-value conversion (best-effort)
export function toSerializableValue(
  value: unknown,
  depth: number
): SerializableValue | null {
  if (depth > 2) {
    return null;
  }
  if (value === null) {
    return null;
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return value as SerializablePrimitive;
  }
  if (Array.isArray(value)) {
    const items: SerializableValue[] = [];
    for (let i = 0; i < value.length && i < 5; i += 1) {
      const converted = toSerializableValue(value[i], depth + 1);
      if (converted !== null) {
        items.push(converted);
      }
    }
    return items;
  }
  if (t === "object") {
    const obj = value as { readonly [key: string]: unknown };
    const entries = Object.entries(obj);
    const out: { [key: string]: SerializableValue } = {};
    let count = 0;
    for (const [key, v] of entries) {
      if (count >= 8) {
        break;
      }
      const converted = toSerializableValue(v, depth + 1);
      if (converted !== null) {
        out[key] = converted;
        count += 1;
      }
    }
    return out;
  }
  return null;
}

// Whether a prop is particularly interesting to highlight
function classifyPropHighlight(
  name: string,
  value: SerializableValue | null
): PropHighlight["reason"] | null {
  const lower = name.toLowerCase();
  if (
    lower === "label" ||
    lower === "title" ||
    lower === "placeholder" ||
    lower === "text" ||
    lower === "children"
  ) {
    return "text";
  }
  if (
    lower === "variant" ||
    lower === "size" ||
    lower === "intent" ||
    lower === "tone" ||
    lower === "color" ||
    lower === "kind"
  ) {
    return "design";
  }
  if (lower === "data-testid" || lower === "testid") {
    return "test-id";
  }
  if (lower === "aria-label") {
    return "aria-label";
  }
  if (value === null) {
    return null;
  }
  return "other";
}

function inferEventKindFromPropName(name: string): EventKind {
  const lower = name.toLowerCase();
  if (lower === "onclick") return "click";
  if (lower === "onchange") return "change";
  if (lower === "onsubmit") return "submit";
  if (lower === "oninput") return "input";
  if (lower === "onfocus") return "focus";
  if (lower === "onblur") return "blur";
  if (lower.startsWith("onkey")) return "key";
  if (lower.startsWith("onpointer") || lower.startsWith("onmouse")) {
    return "pointer";
  }
  return "other";
}

// -----------------------------------------------------------------------------
// React / bippy integration: environment + tree slice
// -----------------------------------------------------------------------------

function detectReactBuildTypeSafe(): ReactBuildType {
  try {
    const renderer = getAnyRenderer();
    if (!renderer) {
      return "unknown";
    }

    const result = detectReactBuildType(renderer);
    if (result === "development" || result === "production") {
      return result;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function getAnyRenderer(): ReactRenderer | null {
  for (const renderer of _renderers) {
    return renderer;
  }
  return null;
}

function getReactDebugInfoForElement(element: Element): ReactDebugInfo {
  const buildType = detectReactBuildTypeSafe();

  if (!hasRDTHook()) {
    return {
      buildType,
      inspectorStatus: "no-hook",
      message:
        "React DevTools hook is not installed. Import 'bippy' before React to enable React metadata.",
    };
  }

  if (!isInstrumentationActive()) {
    return {
      buildType,
      inspectorStatus: "inactive",
      message:
        "React instrumentation is not active yet. Ensure 'bippy' is imported before React renders.",
    };
  }

  try {
    const hostFiber = getFiberFromHostInstance(element);
    if (!hostFiber) {
      return {
        buildType,
        inspectorStatus: "no-fiber",
        message: "No React fiber associated with this element (non-React DOM).",
      };
    }
  } catch {
    return {
      buildType,
      inspectorStatus: "error",
      message:
        "Failed to access React fiber for this element. Instrumentation may be incompatible.",
    };
  }

  return {
    buildType,
    inspectorStatus: "ok",
    message: null,
  };
}

// Build ReactTreeSlice for a host DOM element (best-effort).
async function buildReactTreeSlice(
  element: Element,
  config: GrabrRuntimeConfig,
  debugInfo: ReactDebugInfo
): Promise<ReactTreeSlice | null> {
  if (config.reactInspectorMode === "off") {
    return null;
  }

  if (debugInfo.inspectorStatus !== "ok") {
    return null;
  }

  let hostFiber: Fiber | null = null;
  try {
    hostFiber = getFiberFromHostInstance(element);
  } catch {
    return null;
  }
  if (!hostFiber) {
    return null;
  }

  const latest = getLatestFiber(hostFiber);
  const stackFibers = getFiberStack(latest);
  if (stackFibers.length === 0) {
    return null;
  }
  const maxFrames = config.maxReactStackFrames;
  const takenFibers = stackFibers.slice(0, maxFrames);
  const sources: Array<SourceLocation | null> = await Promise.all(
    takenFibers.map(async (fiber) => {
      try {
        const location = await getSource(fiber);
        return toSourceLocation(location, debugInfo.buildType);
      } catch {
        return null;
      }
    })
  );
  const stack: ReactComponentFrame[] = takenFibers.map((fiber, index) => {
    const displayName = getDisplayName(fiber) ?? null;
    const source = sources[index] ?? null;
    const typed = fiber as Fiber & { readonly tag?: number };
    const tag = typeof typed.tag === "number" ? typed.tag : undefined;
    const isHost = isHostFiber(fiber);
    const isComposite = isCompositeFiber(fiber);
    const fileName = source?.fileName ?? "";
    const flags: ComponentFlags = {
      isHost,
      isComposite,
      isSuspenseBoundary:
        typeof tag === "number" && fileName.length > 0 && fileName.includes("Suspense")
          ? true
          : null,
      isErrorBoundary: displayName?.includes("ErrorBoundary") ?? null,
      isServerComponent:
        fileName.includes(".server.") || fileName.includes("/app/")
          ? true
          : null,
      isLayoutLike: isLayoutLikeFromPath(fileName),
    };
    return {
      displayName,
      isHost,
      source,
      flags,
    };
  });

  // Nearest composite "owner" for props/state/context snapshots
  let ownerIndex: number | null = null;
  for (let i = 0; i < takenFibers.length; i += 1) {
    const fiber = takenFibers[i];
    if (!fiber) continue;
    if (isCompositeFiber(fiber)) {
      ownerIndex = i;
      break;
    }
  }
  if (ownerIndex === null) {
    return {
      stack,
      ownerIndex,
      ownerProps: null,
      ownerState: null,
      ownerContexts: null,
    };
  }

  const ownerFiber = takenFibers[ownerIndex];
  if (!ownerFiber) {
    return {
      stack,
      ownerIndex: null,
      ownerProps: null,
      ownerState: null,
      ownerContexts: null,
    };
  }

  const ownerProps = snapshotProps(ownerFiber);
  const ownerState = snapshotState(ownerFiber);
  const ownerContexts = snapshotContexts(ownerFiber);

  return {
    stack,
    ownerIndex,
    ownerProps,
    ownerState,
    ownerContexts,
  };
}

function snapshotProps(fiber: Fiber): PropsSnapshot {
  const highlighted: PropHighlight[] = [];
  let totalProps = 0;
  traverseProps(fiber, (name, next) => {
    totalProps += 1;
    const serial = toSerializableValue(next, 0);
    const reason = classifyPropHighlight(name, serial);
    if (reason !== null) {
      highlighted.push({
        name,
        value: serial,
        reason,
      });
    }
  });
  const limitedHighlighted =
    highlighted.length > 12 ? highlighted.slice(0, 12) : highlighted;
  return {
    totalProps,
    highlighted: limitedHighlighted,
  };
}

function snapshotState(fiber: Fiber): StateSnapshot {
  const entries: StateSnapshotEntry[] = [];
  let index = 0;
  traverseState(fiber, (next) => {
    const value = toSerializableValue(next, 0);
    entries.push({
      hookIndex: index,
      value,
    });
    index += 1;
  });
  return {
    totalHooks: index,
    entries: entries.length > 12 ? entries.slice(0, 12) : entries,
  };
}

function snapshotContexts(fiber: Fiber): ContextSnapshot {
  const entries: ContextEntry[] = [];
  let index = 0;
  traverseContexts(fiber, (next) => {
    const value = toSerializableValue(next, 0);
    entries.push({
      index,
      value,
    });
    index += 1;
  });
  return {
    totalContexts: index,
    entries: entries.length > 12 ? entries.slice(0, 12) : entries,
  };
}

// Behavior: event handlers from owner + host fiber props (speculative).
function buildBehaviorContext(
  element: Element,
  reactSlice: ReactTreeSlice | null
): BehaviorContext {
  const handlers: EventHandlerInfo[] = [];

  let hostFiber: Fiber | null = null;
  try {
    hostFiber = getFiberFromHostInstance(element);
  } catch {
    hostFiber = null;
  }

  const seenNames = new Set<string>();

  const recordHandlersFromFiber = (
    fiber: Fiber | null,
    declaredOnComponent: string | null,
    source: SourceLocation | null
  ) => {
    if (!fiber) return;
    traverseProps(fiber, (name, next) => {
      if (!name.startsWith("on")) return;
      if (seenNames.has(name)) return;
      if (typeof next !== "function") return;
      seenNames.add(name);
      const fn = next as { readonly name?: string };
      const fnName =
        typeof fn.name === "string" && fn.name.length > 0 ? fn.name : null;
      const kind = inferEventKindFromPropName(name);
      const comment = `Handler ${name} likely handles ${kind} events on this element.`;
      handlers.push({
        propName: name,
        inferredKind: kind,
        functionName: fnName,
        declaredOnComponent,
        source,
        comment,
        inferenceSource: "prop-name",
      });
    });
  };

  if (hostFiber) {
    const stackFibers = getFiberStack(getLatestFiber(hostFiber));
    const source =
      reactSlice && reactSlice.stack.length > 0
        ? reactSlice.stack[0]?.source ?? null
        : null;
    const componentName =
      reactSlice && reactSlice.stack.length > 0
        ? reactSlice.stack[0]?.displayName ?? null
        : null;
    recordHandlersFromFiber(hostFiber, componentName, source);

    if (reactSlice && reactSlice.ownerIndex !== null) {
      const ownerFrame = reactSlice.stack[reactSlice.ownerIndex];
      const ownerSource = ownerFrame?.source ?? null;
      const ownerName = ownerFrame?.displayName ?? null;
      const ownerCompositeFiber = stackFibers[reactSlice.ownerIndex] ?? null;
      recordHandlersFromFiber(ownerCompositeFiber, ownerName, ownerSource);
    }
  }

  const inferenceLevel: BehaviorInferenceLevel =
    handlers.length === 0 ? "none" : "prop-name-only";

  return {
    inferenceLevel,
    handlers,
  };
}

// -----------------------------------------------------------------------------
// App context: URL, routing, data sources
// -----------------------------------------------------------------------------

function buildAppContext(
  reactSlice: ReactTreeSlice | null,
  config: GrabrRuntimeConfig
): AppContext {
  const url =
    typeof window !== "undefined" && typeof window.location !== "undefined"
      ? window.location.href
      : "";
  const pathname =
    typeof window !== "undefined" && typeof window.location !== "undefined"
      ? window.location.pathname
      : "";
  const search =
    typeof window !== "undefined" && typeof window.location !== "undefined"
      ? window.location.search
      : "";
  const hash =
    typeof window !== "undefined" && typeof window.location !== "undefined"
      ? window.location.hash
      : "";

  const frameworkResult =
    config.heuristics.frameworkStrategies
      .map((strategy) =>
        strategy.detect({
          reactSlice,
          url,
          pathname,
        })
      )
      .find((result) => result !== null) ?? {
      framework: "unknown" as InferredFramework,
      routePatternGuess: null,
      routeParamsGuess: null,
      pageComponent: null,
      layoutComponents: [],
    };

  const dataSources: readonly DataSourceHint[] = (() => {
    const input: DataSourceDetectionInput = {
      ownerProps: reactSlice?.ownerProps ?? null,
    };
    const collected: DataSourceHint[] = [];
    for (const strategy of config.heuristics.dataSourceStrategies) {
      const hints = strategy.detect(input);
      collected.push(...hints);
    }
    return collected.length > 0
      ? collected
      : [
          {
            kind: "unknown",
            identifier: null,
            description: null,
          },
        ];
  })();

  return {
    url,
    pathname,
    search,
    hash,
    framework: frameworkResult.framework,
    routePatternGuess: frameworkResult.routePatternGuess,
    routeParamsGuess: frameworkResult.routeParamsGuess,
    pageComponent: frameworkResult.pageComponent,
    layoutComponents: frameworkResult.layoutComponents,
    dataSources,
  };
}

// -----------------------------------------------------------------------------
// Styling / layout frame
// -----------------------------------------------------------------------------

function buildStyleFrame(el: Element): StyleFrame {
  const rect = el.getBoundingClientRect();
  const computed =
    typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(el)
      : null;

  const clickable =
    (computed && computed.cursor === "pointer") ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    el.getAttribute("role") === "button" ||
    el.getAttribute("role") === "link";

  const get = (prop: keyof CSSStyleDeclaration): string | null => {
    if (!computed) {
      return null;
    }
    const value = computed[prop];
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  return {
    layout: {
      display: get("display"),
      position: get("position"),
      flexDirection: get("flexDirection"),
      justifyContent: get("justifyContent"),
      alignItems: get("alignItems"),
      gap: get("gap"),
      gridTemplateColumns: get("gridTemplateColumns"),
      gridTemplateRows: get("gridTemplateRows"),
    },
    spacing: {
      margin: (() => {
        const top = get("marginTop");
        const right = get("marginRight");
        const bottom = get("marginBottom");
        const left = get("marginLeft");
        if (!top && !right && !bottom && !left) {
          return null;
        }
        return `${top ?? "0"} ${right ?? "0"} ${bottom ?? "0"} ${left ?? "0"}`;
      })(),
      padding: (() => {
        const top = get("paddingTop");
        const right = get("paddingRight");
        const bottom = get("paddingBottom");
        const left = get("paddingLeft");
        if (!top && !right && !bottom && !left) {
          return null;
        }
        return `${top ?? "0"} ${right ?? "0"} ${bottom ?? "0"} ${left ?? "0"}`;
      })(),
    },
    size: {
      width: rect.width > 0 ? `${Math.round(rect.width)}px` : null,
      height: rect.height > 0 ? `${Math.round(rect.height)}px` : null,
    },
    typography: {
      fontFamily: get("fontFamily"),
      fontSize: get("fontSize"),
      fontWeight: get("fontWeight"),
      lineHeight: get("lineHeight"),
    },
    colors: {
      color: get("color"),
      backgroundColor: get("backgroundColor"),
      borderColor: get("borderColor"),
    },
    clickable,
    ruleSummaries: [],
  };
}

// -----------------------------------------------------------------------------
// Selection and DOM neighborhood blocks
// -----------------------------------------------------------------------------

function buildSelectionInfo(
  el: Element,
  reactSlice: ReactTreeSlice | null
): SelectionInfo {
  const rect = el.getBoundingClientRect();
  const identity: SelectionIdentity = {
    tag: el.tagName.toLowerCase(),
    id: el.id && el.id.length > 0 ? el.id : null,
    dataTestId: getDataTestId(el),
    role: el.getAttribute("role"),
    classes: Array.from(el.classList),
  };

  const nearestSource: SourceLocation | null =
    reactSlice && reactSlice.stack.length > 0
      ? reactSlice.stack[0]?.source ?? null
      : null;

  const componentDisplayName =
    reactSlice && reactSlice.stack.length > 0
      ? reactSlice.stack[0]?.displayName ?? null
      : null;

  return {
    tag: el.tagName.toLowerCase(),
    boundingBox: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    identity,
    componentDisplayName,
    nearestSource,
    isLikelyServerComponent:
      reactSlice && reactSlice.stack.length > 0
        ? reactSlice.stack[0]?.flags.isServerComponent ?? null
        : null,
  };
}

function buildDomNeighborhood(el: Element): DomNeighborhood {
  const snippet = serializeElementSnippet(el);

  const parents: DomNodeSummary[] = [];
  let currentParent = el.parentElement;
  let depth = 0;
  while (currentParent && depth < MAX_PARENT_DEPTH) {
    parents.push(summarizeDomNode(currentParent));
    currentParent = currentParent.parentElement;
    depth += 1;
  }

  const siblings = summarizeSiblings(el);
  const children = summarizeChildren(el);

  const preferred = buildPreferredSelector(el);
  const path = buildAncestorSelectorPath(el, MAX_PARENT_DEPTH + 1);
  const selectors = {
    preferred,
    all: [preferred, path],
  };

  return {
    snippet,
    parents,
    siblings,
    children,
    selectors,
  };
}

// -----------------------------------------------------------------------------
// InspectorEngine: public context engine API
// -----------------------------------------------------------------------------

export interface InspectorEngine {
  readonly config: Readonly<GrabrRuntimeConfig>;
  getElementContext(selectedElement: Element): Promise<ElementContextV2>;
}

class DefaultInspectorEngine implements InspectorEngine {
  readonly config: Readonly<GrabrRuntimeConfig>;

  constructor(config: GrabrRuntimeConfig) {
    this.config = config;
  }

  async getElementContext(selectedElement: Element): Promise<ElementContextV2> {
    const reactDebug = getReactDebugInfoForElement(selectedElement);
    const reactSlice =
      this.config.reactInspectorMode === "off"
        ? null
        : await buildReactTreeSlice(selectedElement, this.config, reactDebug);

    const selection = buildSelectionInfo(selectedElement, reactSlice);
    const dom = buildDomNeighborhood(selectedElement);
    const styling = buildStyleFrame(selectedElement);
    const behavior = buildBehaviorContext(selectedElement, reactSlice);
    const app = buildAppContext(reactSlice, this.config);

    const context: ElementContextV2 = {
      version: 2,
      selection,
      dom,
      react: reactSlice,
      reactDebug,
      styling,
      behavior,
      app,
    };

    return context;
  }
}

let defaultInspectorEngine: InspectorEngine | null = null;

export function createInspectorEngine(
  partialConfig?: Partial<GrabrRuntimeConfig>
): InspectorEngine {
  const config = mergeRuntimeConfig(partialConfig);
  return new DefaultInspectorEngine(config);
}

/**
 * Convenience helper: builds an element context using a shared default engine.
 * This keeps a simple API for agents while allowing advanced users to provide
 * their own InspectorEngine instance.
 */
export async function getElementContext(
  selectedElement: Element,
  engine?: InspectorEngine
): Promise<ElementContextV2> {
  if (engine) {
    return engine.getElementContext(selectedElement);
  }
  if (!defaultInspectorEngine) {
    defaultInspectorEngine = createInspectorEngine();
  }
  return defaultInspectorEngine.getElementContext(selectedElement);
}

// -----------------------------------------------------------------------------
// Prompt rendering helpers
// -----------------------------------------------------------------------------

// Prompt rendering helpers (machine-first, hierarchical, checksumed)
function promptChecksum(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash >>> 0).toString(16);
}

function stringifyForPrompt(value: unknown, dropNull: boolean): string {
  return JSON.stringify(
    value,
    (_key, val) => {
      if (val === undefined) {
        return undefined;
      }
      if (dropNull && val === null) {
        return undefined;
      }
      return val;
    }
  );
}

function maybeAddLine(
  lines: string[],
  key: string,
  value: unknown,
  options?: { dropNull?: boolean; allowEmpty?: boolean }
): void {
  const dropNull = options?.dropNull ?? true;
  const allowEmpty = options?.allowEmpty ?? false;
  if (value === null || value === undefined) {
    if (dropNull) {
      return;
    }
  }
  const serialized = stringifyForPrompt(value, dropNull);
  if (!allowEmpty && (serialized === "{}" || serialized === "[]")) {
    return;
  }
  lines.push(`${key}=${serialized}`);
}

function formatSourceForPrompt(source: SourceLocation | null): Record<string, unknown> | null {
  if (!source) {
    return null;
  }
  const out: Record<string, unknown> = {
    file: source.fileName,
    confidence: source.confidence,
    origin: source.origin,
  };
  if (source.lineNumber !== null) {
    out["line"] = source.lineNumber;
  }
  if (source.columnNumber !== null) {
    out["col"] = source.columnNumber;
  }
  return out;
}

function deriveSelectionId(context: ElementContextV2): string {
  const s = context.selection;
  const parts = [
    s.identity.id ?? "",
    s.identity.dataTestId ?? "",
    s.tag,
    s.componentDisplayName ?? "",
    s.nearestSource?.fileName ?? "",
    Math.round(s.boundingBox.x).toString(),
    Math.round(s.boundingBox.y).toString(),
  ];
  return `sel_${promptChecksum(parts.join("|"))}`;
}

function formatReactStack(react: ReactTreeSlice): Array<Record<string, unknown>> {
  return react.stack.map((frame, idx) => {
    const formatted: Record<string, unknown> = {
      idx,
      displayName: frame.displayName ?? "<host>",
      isHost: frame.isHost,
      source: formatSourceForPrompt(frame.source),
      flags: frame.flags,
    };
    if (react.ownerIndex === idx) {
      formatted["owner"] = true;
    }
    return formatted;
  });
}

function formatPropsSnapshot(snapshot: PropsSnapshot | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }
  return {
    total: snapshot.totalProps,
    highlighted: snapshot.highlighted.map((h) => ({
      name: h.name,
      reason: h.reason,
      value: h.value,
    })),
  };
}

function formatStateSnapshot(snapshot: StateSnapshot | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }
  return {
    total: snapshot.totalHooks,
    entries: snapshot.entries,
  };
}

function formatContextSnapshot(snapshot: ContextSnapshot | null): Record<string, unknown> | null {
  if (!snapshot) {
    return null;
  }
  return {
    total: snapshot.totalContexts,
    entries: snapshot.entries,
  };
}

function formatBehaviorHandlers(handlers: readonly EventHandlerInfo[]): readonly Record<string, unknown>[] {
  return handlers.map((h) => ({
    prop: h.propName,
    kind: h.inferredKind,
    fn: h.functionName ?? "anonymous",
    component: h.declaredOnComponent ?? "unknown",
    source: formatSourceForPrompt(h.source),
    inference: h.inferenceSource,
  }));
}

export function renderElementContextPrompt(
  context: ElementContextV2
): string {
  const selectionId = deriveSelectionId(context);
  const checksum = promptChecksum(stringifyForPrompt(context, false));
  const lines: string[] = [];
  const s = context.selection;
  const dom = context.dom;
  const react = context.react;
  const style = context.styling;
  const app = context.app;
  const reactDebug: ReactDebugInfo =
    context.reactDebug ?? {
      buildType: "unknown",
      inspectorStatus: "no-hook",
      message: "React debug info unavailable.",
    };

  const section = (name: string, fn: () => void) => {
    lines.push(`[section:${name}]`);
    fn();
    lines.push(`[end:${name}]`);
  };

  lines.push(`<ai_grab_selection v="2" sel_id="${selectionId}" checksum="${checksum}">`);

  section("meta", () => {
    maybeAddLine(lines, "version", 2, { dropNull: false });
    maybeAddLine(lines, "sel_id", selectionId, { dropNull: false });
    maybeAddLine(lines, "checksum", checksum, { dropNull: false });
    maybeAddLine(lines, "react_available", react !== null);
    maybeAddLine(lines, "react_inspector_status", reactDebug.inspectorStatus);
    maybeAddLine(lines, "react_build", reactDebug.buildType);
    maybeAddLine(lines, "react_message", reactDebug.message, { dropNull: true });
    maybeAddLine(
      lines,
      "source_hint_present",
      s.nearestSource !== null
    );
    maybeAddLine(
      lines,
      "tests_present",
      Boolean(context.tests && context.tests.hints.length > 0)
    );
  });

  section("selection", () => {
    maybeAddLine(lines, "tag", s.tag, { dropNull: false });
    maybeAddLine(
      lines,
      "bounding_box",
      {
        x: Math.round(s.boundingBox.x),
        y: Math.round(s.boundingBox.y),
        w: Math.round(s.boundingBox.width),
        h: Math.round(s.boundingBox.height),
      },
      { dropNull: false }
    );
    maybeAddLine(
      lines,
      "identity",
      {
        id: s.identity.id,
        dataTestId: s.identity.dataTestId,
        role: s.identity.role,
        classes: s.identity.classes,
      },
      { dropNull: false }
    );
    maybeAddLine(lines, "component", s.componentDisplayName, { dropNull: true });
    maybeAddLine(lines, "nearest_source", formatSourceForPrompt(s.nearestSource));
    maybeAddLine(lines, "is_server_component", s.isLikelyServerComponent);
  });

  section("dom", () => {
    maybeAddLine(lines, "snippet", dom.snippet, { dropNull: false });
    maybeAddLine(lines, "parents", dom.parents);
    maybeAddLine(lines, "siblings", dom.siblings);
    maybeAddLine(lines, "children", dom.children);
    maybeAddLine(lines, "selectors", dom.selectors);
  });

  section("react", () => {
    maybeAddLine(
      lines,
      "status",
      {
        available: react !== null,
        inspectorStatus: reactDebug.inspectorStatus,
        build: reactDebug.buildType,
        message: reactDebug.message,
      },
      { dropNull: true }
    );
    if (react !== null) {
      maybeAddLine(lines, "owner_index", react.ownerIndex, { dropNull: false });
      maybeAddLine(lines, "stack", formatReactStack(react), { allowEmpty: true });
      maybeAddLine(lines, "owner_props", formatPropsSnapshot(react.ownerProps), {
        allowEmpty: true,
      });
      maybeAddLine(lines, "owner_state", formatStateSnapshot(react.ownerState), {
        allowEmpty: true,
      });
      maybeAddLine(
        lines,
        "owner_contexts",
        formatContextSnapshot(react.ownerContexts),
        { allowEmpty: true }
      );
    }
  });

  section("styling", () => {
    maybeAddLine(lines, "layout", style.layout, { dropNull: true, allowEmpty: false });
    maybeAddLine(lines, "spacing", style.spacing, { dropNull: true, allowEmpty: false });
    maybeAddLine(lines, "size", style.size, { dropNull: true, allowEmpty: false });
    maybeAddLine(lines, "typography", style.typography, {
      dropNull: true,
      allowEmpty: false,
    });
    maybeAddLine(lines, "colors", style.colors, { dropNull: true, allowEmpty: false });
    maybeAddLine(lines, "clickable", style.clickable, { dropNull: false });
  });

  section("behavior", () => {
    maybeAddLine(lines, "inference_level", context.behavior.inferenceLevel, {
      dropNull: false,
    });
    maybeAddLine(lines, "handlers", formatBehaviorHandlers(context.behavior.handlers), {
      allowEmpty: true,
    });
  });

  section("app", () => {
    maybeAddLine(
      lines,
      "url",
      {
        full: app.url,
        pathname: app.pathname,
        search: app.search,
        hash: app.hash,
      },
      { dropNull: true }
    );
    maybeAddLine(
      lines,
      "routing",
      {
        framework: app.framework,
        routePatternGuess: app.routePatternGuess,
        routeParamsGuess: app.routeParamsGuess,
        pageComponent: formatSourceForPrompt(app.pageComponent),
        layoutComponents: app.layoutComponents.map((loc) => formatSourceForPrompt(loc)),
      },
      { dropNull: true, allowEmpty: true }
    );
    maybeAddLine(lines, "data_sources", app.dataSources, { allowEmpty: true });
  });

  if (context.tests) {
    section("tests", () => {
      maybeAddLine(lines, "hints", context.tests?.hints ?? [], { allowEmpty: true });
    });
  }

  lines.push(`<ai_grab_selection_end sel_id="${selectionId}" checksum="${checksum}"/>`);
  return lines.join("\n");
}

export function renderSessionPrompt(session: GrabrSession): string {
  const checksum = promptChecksum(stringifyForPrompt(session, false));
  const lines: string[] = [];
  lines.push(`<ai_grab_session id="${session.id}" checksum="${checksum}">`);
  const section = (name: string, fn: () => void) => {
    lines.push(`[section:${name}]`);
    fn();
    lines.push(`[end:${name}]`);
  };

  section("meta", () => {
    maybeAddLine(lines, "created_at", session.createdAt, { dropNull: false });
    maybeAddLine(lines, "url", session.url, { dropNull: false });
    maybeAddLine(lines, "instruction", session.userInstruction ?? "(none)", {
      dropNull: false,
    });
    maybeAddLine(
      lines,
      "summary",
      session.summary ?? `Session with ${session.elements.length} elements.`,
      { dropNull: false }
    );
    maybeAddLine(lines, "element_count", session.elements.length, { dropNull: false });
  });

  section("elements", () => {
    session.elements.forEach((ctx, idx) => {
      lines.push(`[element:${idx}]`);
      lines.push(renderElementContextPrompt(ctx));
      lines.push(`[end:element:${idx}]`);
    });
  });

  lines.push(`<ai_grab_session_end id="${session.id}" checksum="${checksum}"/>`);
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Default AgentProvider: clipboard + console
// -----------------------------------------------------------------------------

export class ClipboardAgentProvider implements AgentProvider {
  readonly id: string = "clipboard";
  readonly label: string = "Clipboard (default)";

  async sendContext(session: GrabrSession): Promise<void> {
    const text = renderSessionPrompt(session);

    const copyFailureReasons: string[] = [];
    const copied = await tryCopyTextToClipboard(text, copyFailureReasons);

    // eslint-disable-next-line no-console
    console.log("[grabr] Session context:\n", text);

    if (!copied) {
      const suffix =
        copyFailureReasons.length > 0
          ? ` Reasons: ${copyFailureReasons.join(" | ")}`
          : "";
      throw new Error(`Failed to copy session context to clipboard.${suffix}`);
    }
  }
}

async function tryCopyTextToClipboard(
  text: string,
  reasonsOut: string[]
): Promise<boolean> {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      reasonsOut.push(
        error instanceof Error
          ? `navigator.clipboard.writeText failed: ${error.message}`
          : "navigator.clipboard.writeText failed"
      );
    }
  } else {
    reasonsOut.push("navigator.clipboard.writeText not available.");
  }

  if (typeof document === "undefined" || !document.body) {
    reasonsOut.push("document/body not available for execCommand fallback.");
    return false;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    textarea.setAttribute("readonly", "true");

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (!ok) {
      reasonsOut.push("document.execCommand('copy') returned false.");
    }
    return ok;
  } catch (error) {
    reasonsOut.push(
      error instanceof Error
        ? `execCommand fallback failed: ${error.message}`
        : "execCommand fallback failed"
    );
    return false;
  }
}

const OVERLAY_STYLES = `
.grabr-ui {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  z-index: 2147483647;
}

.grabr-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.grabr-highlight {
  position: fixed;
  z-index: 2147483646;
  outline: 2px solid var(--grabr-accent, #38bdf8);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--grabr-accent, #38bdf8) 12%, transparent);
  border-radius: 6px;
  display: none;
}

.grabr-highlight-label {
  position: absolute;
  top: -22px;
  left: 0;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  color: var(--grabr-label-fg, #0b1220);
  background: var(--grabr-accent, #38bdf8);
  box-shadow: 0 6px 18px rgba(0,0,0,0.20);
  white-space: nowrap;
  max-width: 70vw;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 120ms ease;
}

.grabr-highlight-label.visible {
  opacity: 1;
}

.grabr-selected {
  position: fixed;
  z-index: 2147483645;
  outline: 2px solid var(--grabr-ok, #22c55e);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--grabr-ok, #22c55e) 10%, transparent);
  border-radius: 6px;
}

.grabr-hud {
  position: fixed;
  left: 16px;
  bottom: 16px;
  min-width: 260px;
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--grabr-fg, #e5e7eb) 18%, transparent);
  background: color-mix(in srgb, var(--grabr-bg, #0b1220) 92%, transparent);
  color: var(--grabr-fg, #e5e7eb);
  box-shadow: 0 18px 60px rgba(0,0,0,0.32);
  display: none;
}

.grabr-hud.visible {
  display: block;
}

.grabr-hud-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.grabr-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.9;
}

.grabr-status {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grabr-sub {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.8;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.grabr-kbd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid color-mix(in srgb, var(--grabr-fg, #e5e7eb) 14%, transparent);
  background: color-mix(in srgb, var(--grabr-bg, #0b1220) 70%, transparent);
}

.grabr-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.95;
}

.grabr-help {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--grabr-fg, #e5e7eb) 12%, transparent);
  font-size: 12px;
  opacity: 0.85;
  display: none;
}

.grabr-help.visible {
  display: block;
}

.grabr-toast {
  position: fixed;
  right: 16px;
  top: 16px;
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--grabr-fg, #e5e7eb) 16%, transparent);
  background: color-mix(in srgb, var(--grabr-bg, #0b1220) 92%, transparent);
  color: var(--grabr-fg, #e5e7eb);
  box-shadow: 0 18px 60px rgba(0,0,0,0.32);
  transform: translateY(-6px);
  opacity: 0;
  transition: transform 180ms ease, opacity 180ms ease;
  pointer-events: none;
}

.grabr-toast.visible {
  transform: translateY(0);
  opacity: 1;
}

.grabr-toast.ok {
  border-color: color-mix(in srgb, var(--grabr-ok, #22c55e) 45%, transparent);
}

.grabr-toast.err {
  border-color: color-mix(in srgb, var(--grabr-err, #ef4444) 55%, transparent);
}

@media (prefers-color-scheme: light) {
  .grabr-ui {
      --grabr-bg: #ffffff;
      --grabr-fg: #0b1220;
      --grabr-label-fg: #0b1220;
      --grabr-accent: #0284c7;
      --grabr-ok: #16a34a;
      --grabr-err: #dc2626;
  }
}

@media (prefers-reduced-motion: reduce) {
  .grabr-highlight-label,
  .grabr-toast {
      transition: none;
  }
}
`;

function injectGrabrStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("grabr-styles")) return;

  const style = document.createElement("style");
  style.id = "grabr-styles";
  style.textContent = OVERLAY_STYLES;
  document.head.appendChild(style);
}

type SelectionFinalizeProgress =
  | { readonly phase: "building-context"; readonly completed: number; readonly total: number }
  | { readonly phase: "sending"; readonly completed: number; readonly total: number }
  | { readonly phase: "done"; readonly completed: number; readonly total: number }
  | { readonly phase: "error"; readonly completed: number; readonly total: number; readonly message: string };

function isFiniteIntegerInRange(
  value: unknown,
  min: number,
  max: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validateRuntimeConfigOrThrow(config: GrabrRuntimeConfig): void {
  if (
    config.reactInspectorMode !== "best-effort" &&
    config.reactInspectorMode !== "required" &&
    config.reactInspectorMode !== "off"
  ) {
    throw new Error(
      `Invalid config.reactInspectorMode: expected "best-effort" | "required" | "off", got ${String(
        config.reactInspectorMode
      )}`
    );
  }

  if (!isFiniteIntegerInRange(config.maxReactStackFrames, 1, 64)) {
    throw new Error(
      `Invalid config.maxReactStackFrames: expected integer in range [1, 64], got ${String(
        config.maxReactStackFrames
      )}`
    );
  }
}

function dedupeElementsPreserveOrder(elements: readonly Element[]): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const el of elements) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}

function isElementConnectedToDocument(el: Element): boolean {
  if (typeof document === "undefined") return false;
  return el.isConnected || document.documentElement.contains(el);
}

function formatElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id && el.id.trim().length > 0 ? `#${el.id.trim()}` : "";
  const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
  const testIdPart = testId && testId.trim().length > 0 ? `[data-testid="${testId.trim()}"]` : "";
  if (id) return `${tag}${id}`;
  if (testIdPart) return `${tag}${testIdPart}`;
  return tag;
}

class GrabrController implements GrabrApi {
  readonly version: string = "2.2.0";
  readonly config: Readonly<GrabrRuntimeConfig>;

  private readonly inspector: InspectorEngine;
  private readonly providerRegistry: Map<string, AgentProvider> = new Map();
  private activeProvider: AgentProvider;

  private currentSession: GrabrSession | null = null;
  private currentInstruction: string | null = null;

  private overlay: SelectionOverlay | null = null;

  constructor(
    inspector: InspectorEngine,
    initialProvider: AgentProvider,
    config: GrabrRuntimeConfig
  ) {
    this.inspector = inspector;
    this.activeProvider = initialProvider;
    this.providerRegistry.set(initialProvider.id, initialProvider);
    this.config = config;
  }

  attachOverlay(overlay: SelectionOverlay): void {
    this.overlay = overlay;
  }

  startSelectionSession(userInstruction?: string | null): void {
    const trimmed =
      typeof userInstruction === "string" ? userInstruction.trim() : null;
    this.currentInstruction = trimmed && trimmed.length > 0 ? trimmed : null;

    if (this.overlay) {
      this.overlay.beginSelection();
    } else {
      // eslint-disable-next-line no-console
      console.warn("[grabr] startSelectionSession called, but no overlay attached.");
    }
  }

  getCurrentSession(): GrabrSession | null {
    return this.currentSession;
  }

  registerAgentProvider(provider: AgentProvider): void {
    this.providerRegistry.set(provider.id, provider);
  }

  setActiveAgentProvider(id: string): void {
    const provider = this.providerRegistry.get(id);
    if (provider) this.activeProvider = provider;
  }

  async finalizeSelection(
    elements: readonly Element[],
    onProgress?: (progress: SelectionFinalizeProgress) => void
  ): Promise<void> {
    const connected = dedupeElementsPreserveOrder(elements).filter(
      isElementConnectedToDocument
    );

    if (connected.length === 0) {
      onProgress?.({
        phase: "error",
        completed: 0,
        total: 0,
        message: "No valid elements to capture.",
      });
      return;
    }

    const createdAt = new Date().toISOString();
    const url = window.location.href;

    const sessionId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${createdAt}-${Math.random().toString(16).slice(2)}`;

    const total = connected.length;
    onProgress?.({ phase: "building-context", completed: 0, total });

    let completed = 0;
    let failed = 0;

    const contextsOrNull = await mapWithConcurrencyLimit(
      connected,
      2,
      async (el): Promise<ElementContextV2 | null> => {
        try {
          return await this.inspector.getElementContext(el);
        } catch (error) {
          failed += 1;
          // eslint-disable-next-line no-console
          console.warn(
            "[grabr] Failed to capture element context:",
            error instanceof Error ? error.message : error
          );
          return null;
        } finally {
          completed += 1;
          onProgress?.({ phase: "building-context", completed, total });
        }
      }
    );

    const contexts = contextsOrNull.filter(
      (c): c is ElementContextV2 => c !== null
    );

    if (contexts.length === 0) {
      onProgress?.({
        phase: "error",
        completed,
        total,
        message: "Failed to capture context for all selected elements.",
      });
      return;
    }

    const summary =
      failed > 0
        ? `Session with ${contexts.length} element(s) captured; ${failed} failed.`
        : `Session with ${contexts.length} element(s) captured.`;

    const session: GrabrSession = {
      id: sessionId,
      createdAt,
      url,
      userInstruction: this.currentInstruction,
      summary,
      elements: contexts,
    };

    this.currentSession = session;

    onProgress?.({ phase: "sending", completed: total, total });

    try {
      await this.activeProvider.sendContext(session);
      this.activeProvider.onSuccess?.(session);

      onProgress?.({ phase: "done", completed: total, total });

      this.overlay?.showToast(
        contexts.length === 1
          ? "Copied context for 1 element."
          : `Copied context for ${contexts.length} elements.`,
        false
      );

      if (failed > 0) {
        this.overlay?.showToast(
          `Warning: ${failed} element(s) failed to capture.`,
          true
        );
      }
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Failed to send context.");
      this.activeProvider.onError?.(session, err);
      onProgress?.({
        phase: "error",
        completed: total,
        total,
        message: err.message,
      });
      this.overlay?.showToast(err.message, true);
    }
  }

  dispose(): void {
    if (!this.overlay) return;
    this.overlay.dispose();
    this.overlay = null;
  }
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  mapper: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  };

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, () => runWorker());
  await Promise.all(workers);
  return results;
}

class SelectionOverlay {
  private readonly controller: GrabrController;

  private readonly root: HTMLDivElement;
  private readonly highlight: HTMLDivElement;
  private readonly highlightLabel: HTMLDivElement;

  private readonly hud: HTMLDivElement;
  private readonly hudStatus: HTMLDivElement;
  private readonly hudSub: HTMLDivElement;
  private readonly hudHelp: HTMLDivElement;

  private readonly toast: HTMLDivElement;

  private readonly selectionBoxes: HTMLDivElement[] = [];

  private selecting = false;
  private sending = false;
  private helpVisible = false;

  private hoveredElement: Element | null = null;
  private selectedElements: Element[] = [];

  private rafPending = false;
  private rafReflowPending = false;

  private toastTimer: number | null = null;

  constructor(controller: GrabrController) {
    this.controller = controller;

    injectGrabrStyles();

    this.root = document.createElement("div");
    this.root.className = "grabr-ui grabr-root";

    this.highlight = document.createElement("div");
    this.highlight.className = "grabr-highlight";

    this.highlightLabel = document.createElement("div");
    this.highlightLabel.className = "grabr-highlight-label";
    this.highlight.appendChild(this.highlightLabel);

    this.hud = document.createElement("div");
    this.hud.className = "grabr-hud";

    const hudRow = document.createElement("div");
    hudRow.className = "grabr-hud-row";

    const hudTitle = document.createElement("div");
    hudTitle.className = "grabr-title";
    hudTitle.textContent = "AI Grab";

    this.hudStatus = document.createElement("div");
    this.hudStatus.className = "grabr-status";
    this.hudStatus.textContent = "Idle";

    hudRow.appendChild(hudTitle);
    hudRow.appendChild(this.hudStatus);

    this.hudSub = document.createElement("div");
    this.hudSub.className = "grabr-sub";
    this.hudSub.innerHTML = `
      <span class="grabr-kbd"><span class="grabr-key">Click</span> select</span>
      <span class="grabr-kbd"><span class="grabr-key">Shift</span> multi</span>
      <span class="grabr-kbd"><span class="grabr-key">Enter</span> finish</span>
      <span class="grabr-kbd"><span class="grabr-key">Esc</span> cancel</span>
      <span class="grabr-kbd"><span class="grabr-key">?</span> help</span>
    `.trim();

    this.hudHelp = document.createElement("div");
    this.hudHelp.className = "grabr-help";
    this.hudHelp.textContent =
      "Shortcuts: Backspace=undo, X=clear, ArrowUp/P=parent, Enter=finish, Esc=cancel.";

    this.hud.appendChild(hudRow);
    this.hud.appendChild(this.hudSub);
    this.hud.appendChild(this.hudHelp);

    this.toast = document.createElement("div");
    this.toast.className = "grabr-toast";
    this.toast.setAttribute("role", "status");
    this.toast.setAttribute("aria-live", "polite");

    this.root.appendChild(this.highlight);
    this.root.appendChild(this.hud);
    this.root.appendChild(this.toast);

    document.documentElement.appendChild(this.root);

    this.registerGlobalToggleShortcut();
  }

  beginSelection(): void {
    if (this.sending) return;

    this.selectedElements = [];
    this.hoveredElement = null;
    this.helpVisible = false;

    this.clearSelectionBoxes();

    this.selecting = true;
    this.hud.classList.add("visible");

    this.updateHudState();
    this.attachSelectionListeners();
  }

  dispose(): void {
    this.detachSelectionListeners();
    this.clearSelectionBoxes();

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }

    this.root.parentElement?.removeChild(this.root);
  }

  showToast(message: string, isError: boolean): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }

    this.toast.textContent = message;
    this.toast.classList.remove("ok", "err");
    this.toast.classList.add(isError ? "err" : "ok");
    this.toast.classList.add("visible");

    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("visible");
      this.toastTimer = null;
    }, 2600);
  }

  private registerGlobalToggleShortcut(): void {
    document.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (
          event.altKey &&
          event.shiftKey &&
          (event.key.toLowerCase() === "g" || event.code === "KeyG")
        ) {
          event.preventDefault();
          if (this.selecting || this.sending) {
            this.cancelSelection();
          } else {
            this.beginSelection();
          }
        }
      },
      false
    );
  }

  private attachSelectionListeners(): void {
    document.addEventListener("mousemove", this.onMouseMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("resize", this.onViewportChange, true);
  }

  private detachSelectionListeners(): void {
    document.removeEventListener("mousemove", this.onMouseMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange, true);
  }

  private onViewportChange = (): void => {
    if (!this.selecting) return;
    if (this.rafReflowPending) return;

    this.rafReflowPending = true;
    window.requestAnimationFrame(() => {
      this.rafReflowPending = false;
      this.reflowOverlays();
    });
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.selecting || this.sending) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.root.contains(target)) return;
    if (target === this.hoveredElement) return;

    this.hoveredElement = target;

    if (this.rafPending) return;
    this.rafPending = true;

    window.requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateHighlight();
    });
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.selecting || this.sending) return;
    if (event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.root.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();

    const multi = event.shiftKey || event.metaKey || event.ctrlKey;
    this.toggleSelection(target, multi);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.selecting || this.sending) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.cancelSelection();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void this.finalizeSelection();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      this.undoSelection();
      return;
    }

    if (event.key === "?" || event.key.toLowerCase() === "h") {
      event.preventDefault();
      this.toggleHelp();
      return;
    }

    if (event.key === "ArrowUp" || event.key.toLowerCase() === "p") {
      event.preventDefault();
      this.selectHoveredParent();
      return;
    }

    if (event.key.toLowerCase() === "x") {
      event.preventDefault();
      this.clearSelection();
      return;
    }
  };

  private cancelSelection(): void {
    this.selecting = false;
    this.sending = false;
    this.helpVisible = false;

    this.hoveredElement = null;
    this.selectedElements = [];

    this.detachSelectionListeners();
    this.clearSelectionBoxes();

    this.highlight.style.display = "none";
    this.hud.classList.remove("visible");
    this.hudHelp.classList.remove("visible");
  }

  private toggleHelp(): void {
    this.helpVisible = !this.helpVisible;
    this.hudHelp.classList.toggle("visible", this.helpVisible);
  }

  private clearSelection(): void {
    this.selectedElements = [];
    this.updateSelectionBoxes();
    this.updateHudState();
  }

  private undoSelection(): void {
    if (this.selectedElements.length === 0) return;
    this.selectedElements.pop();
    this.updateSelectionBoxes();
    this.updateHudState();
  }

  private selectHoveredParent(): void {
    if (!this.hoveredElement) return;
    const parent = this.hoveredElement.parentElement;
    if (!parent) return;
    if (this.root.contains(parent)) return;

    this.hoveredElement = parent;
    this.updateHighlight();
  }

  private async finalizeSelection(): Promise<void> {
    if (this.selectedElements.length === 0 && this.hoveredElement) {
      this.selectedElements = [this.hoveredElement];
    }

    const connected = dedupeElementsPreserveOrder(this.selectedElements).filter(
      isElementConnectedToDocument
    );

    if (connected.length === 0) {
      this.cancelSelection();
      return;
    }

    this.sending = true;
    this.updateHudState();

    this.detachSelectionListeners();
    this.highlight.style.display = "none";

    try {
      await this.controller.finalizeSelection(connected, (progress) =>
        this.updateHudProgress(progress)
      );
    } finally {
      this.selecting = false;
      this.sending = false;
      this.helpVisible = false;

      this.clearSelectionBoxes();
      this.hud.classList.remove("visible");
      this.hudHelp.classList.remove("visible");
    }
  }

  private updateHudProgress(progress: SelectionFinalizeProgress): void {
    const total = progress.total;

    if (progress.phase === "building-context") {
      this.hudStatus.textContent = `Capturing context… ${progress.completed}/${total}`;
      return;
    }
    if (progress.phase === "sending") {
      this.hudStatus.textContent = "Sending…";
      return;
    }
    if (progress.phase === "done") {
      this.hudStatus.textContent = "Done.";
      return;
    }
    this.hudStatus.textContent = `Error: ${progress.message}`;
  }

  private updateHudState(): void {
    if (!this.selecting) {
      this.hudStatus.textContent = "Idle";
      return;
    }
    if (this.sending) {
      const count = this.selectedElements.length;
      this.hudStatus.textContent =
        count === 1
          ? "Capturing context… (1 element)"
          : `Capturing context… (${count} elements)`;
      return;
    }

    const count = this.selectedElements.length;
    const hovered = this.hoveredElement;

    if (count === 0) {
      this.hudStatus.textContent = hovered
        ? `Hovering: ${formatElementLabel(hovered)}`
        : "Hover an element to inspect";
    } else if (count === 1) {
      this.hudStatus.textContent = `Selected: 1 (${formatElementLabel(
        this.selectedElements[0]!
      )})`;
    } else {
      const last = this.selectedElements[this.selectedElements.length - 1]!;
      this.hudStatus.textContent = `Selected: ${count} (last: ${formatElementLabel(
        last
      )})`;
    }
  }

  private toggleSelection(el: Element, multi: boolean): void {
    if (!multi) {
      this.selectedElements = [el];
    } else {
      const index = this.selectedElements.indexOf(el);
      if (index >= 0) {
        this.selectedElements.splice(index, 1);
      } else {
        this.selectedElements.push(el);
      }
    }

    this.selectedElements = this.selectedElements.filter(
      isElementConnectedToDocument
    );

    this.updateSelectionBoxes();
    this.updateHudState();
  }

  private updateHighlight(): void {
    const el = this.hoveredElement;
    if (!el || !isElementConnectedToDocument(el)) {
      this.highlight.style.display = "none";
      this.highlightLabel.classList.remove("visible");
      return;
    }

    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || rect.width <= 0 || rect.height <= 0) {
      this.highlight.style.display = "none";
      this.highlightLabel.classList.remove("visible");
      return;
    }

    this.highlight.style.display = "block";
    this.highlight.style.left = `${rect.left}px`;
    this.highlight.style.top = `${rect.top}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;

    this.highlightLabel.textContent = formatElementLabel(el);
    this.highlightLabel.classList.add("visible");

    this.updateHudState();
  }

  private reflowOverlays(): void {
    this.updateHighlight();
    this.updateSelectionBoxes();
  }

  private clearSelectionBoxes(): void {
    for (const box of this.selectionBoxes) {
      box.parentElement?.removeChild(box);
    }
    this.selectionBoxes.length = 0;
  }

  private updateSelectionBoxes(): void {
    this.clearSelectionBoxes();

    for (const el of this.selectedElements) {
      if (!isElementConnectedToDocument(el)) continue;

      const rect = el.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const box = document.createElement("div");
      box.className = "grabr-selected";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;

      this.root.appendChild(box);
      this.selectionBoxes.push(box);
    }
  }
}

export function createGrabrClient(partialConfig?: Partial<GrabrRuntimeConfig>): GrabrClient {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("createGrabrClient must be called in a browser environment.");
  }

  const config = mergeRuntimeConfig(partialConfig);
  validateRuntimeConfigOrThrow(config);

  const controller = new GrabrController(
    createInspectorEngine(config),
    new ClipboardAgentProvider(),
    config
  );
  const overlay = new SelectionOverlay(controller);
  controller.attachOverlay(overlay);

  return {
    version: controller.version,
    config: controller.config,
    startSelectionSession(userInstruction?: string | null): void {
      controller.startSelectionSession(userInstruction ?? null);
    },
    getCurrentSession(): GrabrSession | null {
      return controller.getCurrentSession();
    },
    registerAgentProvider(providerToAdd: AgentProvider): void {
      controller.registerAgentProvider(providerToAdd);
    },
    setActiveAgentProvider(id: string): void {
      controller.setActiveAgentProvider(id);
    },
    dispose(): void {
      controller.dispose();
    },
  };
}

export function initGrabr(partialConfig?: Partial<GrabrRuntimeConfig>): GrabrClient {
  const client = createGrabrClient(partialConfig);
  window.grabr = {
    version: client.version,
    startSelectionSession: client.startSelectionSession.bind(client),
    getCurrentSession: client.getCurrentSession.bind(client),
    registerAgentProvider: client.registerAgentProvider.bind(client),
    setActiveAgentProvider: client.setActiveAgentProvider.bind(client),
  };
  return client;
}

// -----------------------------------------------------------------------------
// Bun dev server demo (server-only, opt-in)
// -----------------------------------------------------------------------------

/**
 * startGrabrDemoServer
 *
 * A small Bun-powered demo server that serves a static HTML page with the
 * bundled grabr client script. This function is intentionally NOT invoked
 * at module load to keep server concerns separate from the browser runtime.
 *
 * Usage:
 *   // demo.ts (Bun entrypoint)
 *   import { startGrabrDemoServer } from "./grabr";
 *   startGrabrDemoServer();
 */
export async function startGrabrDemoServer(port: number = 3000): Promise<void> {
  if (typeof Bun === "undefined") {
    throw new Error("startGrabrDemoServer can only be used in a Bun runtime.");
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AI Grab Demo</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
      }
      .app-root {
        padding: 2rem;
      }
      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 1rem;
      }
      .card {
        background: #020617;
        border-radius: 0.75rem;
        padding: 1rem;
        border: 1px solid rgba(148, 163, 184, 0.4);
      }
      .card h2 {
        margin: 0 0 0.25rem;
      }
      .card p {
        margin: 0 0 0.75rem;
        font-size: 0.875rem;
        color: #cbd5f5;
      }
      .card button {
        border-radius: 9999px;
        border: none;
        background: #38bdf8;
        color: #0f172a;
        font-weight: 600;
        padding: 0.25rem 0.75rem;
        cursor: pointer;
      }
      .hint {
        margin-bottom: 1rem;
        font-size: 0.875rem;
        color: #94a3b8;
      }
      a {
        color: #38bdf8;
      }
    </style>
    <script type="module">
      import { initGrabr } from "/grabr.js";
      initGrabr();
    </script>
  </head>
  <body>
    <div class="app-root">
      <div class="hint">
        Demo app rendered by Bun. Use <strong>Alt+Shift+G</strong> to enter selection mode,
        then click elements to send context via the clipboard provider.
      </div>
      <div class="card-grid">
        <div class="card" data-testid="profile-card">
          <h2>Profile</h2>
          <p>Change how this text looks using your AI agent.</p>
          <button type="button">Edit profile</button>
        </div>
        <div class="card" data-testid="billing-card">
          <h2>Billing</h2>
          <p>Adjust your subscription plan and payment details.</p>
          <button type="button">Manage billing</button>
        </div>
        <div class="card" data-testid="notifications-card">
          <h2>Notifications</h2>
          <p>Fine-tune how and when we notify you about activity.</p>
          <button type="button">Edit notifications</button>
        </div>
      </div>
      <p style="margin-top:2rem;font-size:0.75rem;color:#64748b;">
        In a real app, mount your React tree here and ensure <code>bippy</code> is imported
        before React so grabr can attach to React fibers.
      </p>
    </div>
  </body>
</html>`;

  const entryUrl = new URL(import.meta.url);
  const entryPath = decodeURIComponent(entryUrl.pathname);

  const buildResult = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    outdir: "",
    splitting: false,
  });

  if (!buildResult.success || buildResult.outputs.length === 0) {
    throw new Error("Failed to build grabr client bundle for demo.");
  }

  const clientBundle =
    buildResult.outputs[0] !== undefined
      ? await buildResult.outputs[0].text()
      : "";

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/grabr.js") {
        return new Response(clientBundle, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
          },
        });
      }
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });

  // eslint-disable-next-line no-console
  console.log(`[grabr] Demo server listening on ${server.url}`);
}
