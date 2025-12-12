import { describe, expect, test } from "bun:test";
import { truncateText, buildPreferredSelector, toSerializableValue } from "../src/grabr";
import type { ElementContextV2, GrabrSession } from "../src/grabr";
import { renderElementContextPrompt, renderSessionPrompt } from "../src/grabr";

describe("DOM selector helpers", () => {
    test("truncateText", () => {
      const short = truncateText("hello world", 20);
      expect(short).toBe("hello world");
      const long = truncateText("a".repeat(30), 10);
      expect(long.length).toBe(11); // 10 chars + ellipsis
    });
  
    test("buildAncestorSelectorPath basic", () => {
      expect(typeof buildPreferredSelector).toBe("function");
    });
  });
  
  describe("Serializable value conversion", () => {
    test("primitives are preserved", () => {
      expect(toSerializableValue("x", 0)).toBe("x");
      expect(toSerializableValue(1, 0)).toBe(1);
      expect(toSerializableValue(true, 0)).toBe(true);
    });
  
    test("objects are truncated", () => {
      const obj = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 };
      const serial = toSerializableValue(obj, 0);
      expect(serial !== null && !Array.isArray(serial)).toBe(true);
    });
  
    test("arrays are truncated", () => {
      const arr = [1, 2, 3, 4, 5, 6];
      const serial = toSerializableValue(arr, 0);
      expect(Array.isArray(serial)).toBe(true);
      if (Array.isArray(serial)) {
        expect(serial.length).toBeLessThanOrEqual(5);
      }
    });
  });
  
  describe("Prompt rendering", () => {
    test("renderElementContextPrompt includes structured delimiters", () => {
      const fakeContext: ElementContextV2 = {
        version: 2,
        selection: {
          tag: "button",
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
          identity: {
            tag: "button",
            id: "test",
            dataTestId: "btn",
            role: "button",
            classes: ["primary"],
          },
          componentDisplayName: "TestButton",
          nearestSource: {
            fileName: "src/TestButton.tsx",
            lineNumber: 10,
            columnNumber: 5,
            confidence: "high",
            origin: "bippy",
          },
          isLikelyServerComponent: null,
        },
        dom: {
          snippet: "<button>Click me</button>",
          parents: [],
          siblings: {
            index: 0,
            total: 1,
            previous: null,
            next: null,
          },
          children: {
            totalChildren: 0,
            tagCounts: {},
            samples: [],
          },
          selectors: {
            preferred: "#test",
            all: ["#test"],
          },
        },
        react: null,
        reactDebug: {
          buildType: "development",
          inspectorStatus: "ok",
          message: null,
        },
        styling: {
          layout: {
            display: "inline-block",
            position: "static",
            flexDirection: null,
            justifyContent: null,
            alignItems: null,
            gap: null,
            gridTemplateColumns: null,
            gridTemplateRows: null,
          },
          spacing: {
            margin: null,
            padding: null,
          },
          size: {
            width: "100px",
            height: "40px",
          },
          typography: {
            fontFamily: "system-ui",
            fontSize: "14px",
            fontWeight: "400",
            lineHeight: "20px",
          },
          colors: {
            color: "#000000",
            backgroundColor: "#ffffff",
            borderColor: "#000000",
          },
          clickable: true,
        },
        behavior: {
          inferenceLevel: "none",
          handlers: [],
        },
        app: {
          url: "http://localhost:3000",
          pathname: "/",
          search: "",
          hash: "",
          framework: "unknown",
          routePatternGuess: null,
          routeParamsGuess: null,
          pageComponent: null,
          layoutComponents: [],
          dataSources: [
            {
              kind: "unknown",
              identifier: null,
              description: null,
            },
          ],
        },
      };

      const prompt = renderElementContextPrompt(fakeContext);
      expect(prompt.includes("<ai_grab_selection v=\"2\"")).toBe(true);
      expect(prompt.includes("[section:selection]")).toBe(true);
      expect(prompt.includes("[section:meta]")).toBe(true);
      expect(prompt.includes("[section:dom]")).toBe(true);
      expect(prompt.includes("[section:styling]")).toBe(true);
      expect(prompt.includes("<ai_grab_selection_end")).toBe(true);
    });

    test("renderSessionPrompt wraps multiple elements with hierarchical markers", () => {
      const baseContext: ElementContextV2 = {
        version: 2,
        selection: {
          tag: "div",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          identity: {
            tag: "div",
            id: null,
            dataTestId: null,
            role: null,
            classes: [],
          },
          componentDisplayName: null,
          nearestSource: null,
          isLikelyServerComponent: null,
        },
        dom: {
          snippet: "<div />",
          parents: [],
          siblings: {
            index: 0,
            total: 1,
            previous: null,
            next: null,
          },
          children: {
            totalChildren: 0,
            tagCounts: {},
            samples: [],
          },
          selectors: {
            preferred: "div",
            all: ["div"],
          },
        },
        react: null,
        reactDebug: {
          buildType: "unknown",
          inspectorStatus: "no-hook",
          message: null,
        },
        styling: {
          layout: {
            display: null,
            position: null,
            flexDirection: null,
            justifyContent: null,
            alignItems: null,
            gap: null,
            gridTemplateColumns: null,
            gridTemplateRows: null,
          },
          spacing: {
            margin: null,
            padding: null,
          },
          size: {
            width: null,
            height: null,
          },
          typography: {
            fontFamily: null,
            fontSize: null,
            fontWeight: null,
            lineHeight: null,
          },
          colors: {
            color: null,
            backgroundColor: null,
            borderColor: null,
          },
          clickable: false,
        },
        behavior: {
          inferenceLevel: "none",
          handlers: [],
        },
        app: {
          url: "",
          pathname: "",
          search: "",
          hash: "",
          framework: "unknown",
          routePatternGuess: null,
          routeParamsGuess: null,
          pageComponent: null,
          layoutComponents: [],
          dataSources: [
            {
              kind: "unknown",
              identifier: null,
              description: null,
            },
          ],
        },
      };

      const session: GrabrSession = {
        id: "session-1",
        createdAt: "2025-01-01T00:00:00.000Z",
        url: "http://localhost:3000",
        userInstruction: "Change the header copy.",
        summary: null,
        elements: [baseContext, baseContext],
      };

      const text = renderSessionPrompt(session);
      expect(text.includes("<ai_grab_session")).toBe(true);
      expect(text.includes("[section:elements]")).toBe(true);
      expect(text.includes("[element:0]")).toBe(true);
      expect(text.includes("[element:1]")).toBe(true);
      expect(text.includes("<ai_grab_session_end")).toBe(true);
    });
  });
