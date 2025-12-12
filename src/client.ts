import { initGrabr } from "./grabr";

export {
  initGrabr,
  createGrabrClient,
  ClipboardAgentProvider,
  defaultRuntimeConfig,
  mergeRuntimeConfig,
} from "./grabr";

export type {
  AgentProvider,
  ElementContextV2,
  GrabrApi,
  GrabrClient,
  GrabrInitOptions,
  GrabrRuntimeConfig,
  GrabrSession,
  ReactInspectorMode,
} from "./grabr";

export const setupGrabr = initGrabr;
