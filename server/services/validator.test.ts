import { describe, it, expect } from "vitest";
import { validateScene, checkSizeLimit } from "./validator.js";

describe("validateScene", () => {
  // --- Top-level structure ---

  it("rejects null", () => {
    const r = validateScene(null);
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/null/);
  });

  it("rejects non-object", () => {
    expect(validateScene("string").valid).toBe(false);
    expect(validateScene(42).valid).toBe(false);
    expect(validateScene([]).valid).toBe(false);
  });

  it("rejects missing elements", () => {
    const r = validateScene({});
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "$.elements")).toBe(true);
  });

  it("rejects non-array elements", () => {
    const r = validateScene({ elements: "not-an-array" });
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/array/);
  });

  // --- Valid scenes ---

  it("accepts empty scene", () => {
    const r = validateScene({ elements: [] });
    expect(r.valid).toBe(true);
    expect(r.elementCount).toBe(0);
  });

  it("accepts scene with rectangle", () => {
    const r = validateScene({
      elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
    });
    expect(r.valid).toBe(true);
    expect(r.elementCount).toBe(1);
  });

  it("accepts scene with all known element types", () => {
    const types = ["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"];
    const elements = types.map((type, i) => {
      const base: Record<string, unknown> = { id: `e${i}`, type, x: 0, y: 0, width: 10, height: 10 };
      if (type === "text") { base.text = "hi"; base.fontSize = 20; }
      if (type === "arrow" || type === "line" || type === "freedraw") { base.points = [[0, 0], [10, 10]]; }
      if (type === "image") { base.fileId = "file1"; }
      return base;
    });
    const r = validateScene({ elements });
    expect(r.valid).toBe(true);
    expect(r.elementCount).toBe(types.length);
  });

  // --- Element validation ---

  it("rejects element without id", () => {
    const r = validateScene({ elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".id"))).toBe(true);
  });

  it("rejects element without type", () => {
    const r = validateScene({ elements: [{ id: "x", x: 0, y: 0, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".type"))).toBe(true);
  });

  it("warns on unknown element type", () => {
    const r = validateScene({ elements: [{ id: "x", type: "alien_shape", x: 0, y: 0, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("Unknown element type"))).toBe(true);
  });

  it("rejects missing numeric fields (x, y, width, height)", () => {
    const r = validateScene({ elements: [{ id: "x", type: "rectangle" }] });
    expect(r.valid).toBe(false);
    expect(r.errors.filter((e) => e.message.includes("finite number")).length).toBe(4);
  });

  it("rejects NaN/Infinity in numeric fields", () => {
    const r = validateScene({ elements: [{ id: "x", type: "rectangle", x: NaN, y: Infinity, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  // --- Type-specific validation ---

  it("rejects text element without text field", () => {
    const r = validateScene({ elements: [{ id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, fontSize: 20 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".text"))).toBe(true);
  });

  it("rejects text element without fontSize", () => {
    const r = validateScene({ elements: [{ id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "hi" }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".fontSize"))).toBe(true);
  });

  it("rejects arrow without points", () => {
    const r = validateScene({ elements: [{ id: "a", type: "arrow", x: 0, y: 0, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".points"))).toBe(true);
  });

  it("rejects image without fileId", () => {
    const r = validateScene({ elements: [{ id: "i", type: "image", x: 0, y: 0, width: 10, height: 10 }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes(".fileId"))).toBe(true);
  });

  // --- Optional field validation ---

  it("rejects invalid strokeStyle", () => {
    const r = validateScene({ elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 10, height: 10, strokeStyle: "wavy" }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("strokeStyle"))).toBe(true);
  });

  it("rejects invalid fillStyle", () => {
    const r = validateScene({ elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 10, height: 10, fillStyle: "polka-dots" }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("fillStyle"))).toBe(true);
  });

  it("accepts valid optional fields", () => {
    const r = validateScene({
      elements: [{
        id: "x", type: "rectangle", x: 0, y: 0, width: 10, height: 10,
        strokeStyle: "dashed", fillStyle: "solid", angle: 1.5, isDeleted: false,
        roundness: { type: 2 },
      }],
    });
    expect(r.valid).toBe(true);
  });

  // --- appState and files ---

  it("accepts valid appState", () => {
    const r = validateScene({ elements: [], appState: { zoom: 1, theme: "dark" } });
    expect(r.valid).toBe(true);
  });

  it("rejects non-object appState", () => {
    const r = validateScene({ elements: [], appState: "bad" });
    expect(r.valid).toBe(false);
  });

  it("validates files map structure", () => {
    const r = validateScene({
      elements: [],
      files: { f1: { mimeType: "image/png", dataURL: "data:..." } },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects file entry without mimeType", () => {
    const r = validateScene({
      elements: [],
      files: { f1: { dataURL: "data:..." } },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("mimeType"))).toBe(true);
  });
});

describe("checkSizeLimit", () => {
  it("returns null for small payloads", () => {
    expect(checkSizeLimit(1000)).toBeNull();
  });

  it("returns error for oversized payloads", () => {
    const err = checkSizeLimit(60 * 1024 * 1024);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/exceeding/);
  });

  it("respects custom max", () => {
    expect(checkSizeLimit(2000, 1000)).not.toBeNull();
    expect(checkSizeLimit(500, 1000)).toBeNull();
  });
});
