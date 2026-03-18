/**
 * Server-side Mermaid → Excalidraw conversion.
 *
 * Runs @excalidraw/mermaid-to-excalidraw in Node.js using svgdom to provide
 * the SVG DOM that mermaid needs for rendering and layout (getBBox, etc.).
 *
 * Key shims required on top of svgdom:
 *   1. Element.getBoundingClientRect — svgdom only implements it for SVG
 *      elements; mermaid creates HTML elements for text measurement.
 *   2. Element.getBBox — same fallback for non-SVG elements.
 *   3. <textarea>.value — mermaid-to-excalidraw uses a textarea to decode
 *      HTML entities; svgdom doesn't implement form element .value.
 *
 * Mermaid config overrides:
 *   - securityLevel: "loose" — skips DOMPurify sanitization that strips SVG
 *     content in the headless environment.
 *   - htmlLabels: false — uses <text> SVG elements instead of <foreignObject>
 *     HTML, which svgdom can actually measure via fontkit.
 *
 * All shim setup is deferred to the first call so that importing this module
 * doesn't pollute globals during tests.
 */

let _initialized = false;
let _parseMermaidToExcalidraw: any = null;

async function ensureInitialized() {
  if (_initialized) return;

  const { createHTMLWindow } = await import("svgdom");
  const window = createHTMLWindow();
  const document = window.document;

  // --- Shim 1 & 2: getBoundingClientRect + getBBox for HTML elements ---
  // svgdom implements these for SVG elements but throws "Only implemented
  // for SVG Elements" on HTML elements. Mermaid creates <span>/<div> elements
  // for text measurement during rendering.
  const ElementProto = Object.getPrototypeOf(
    Object.getPrototypeOf(document.createElement("div")),
  );

  const origBCR = ElementProto.getBoundingClientRect;
  ElementProto.getBoundingClientRect = function () {
    try {
      return origBCR.call(this);
    } catch {
      // Approximate dimensions from text content.
      // mermaid-to-excalidraw configures mermaid with fontSize 25px using
      // "trebuchet ms". At that size, average character width is ~13px.
      // This estimate affects mermaid's dagre layout spacing between nodes.
      const text = (this as any).textContent || "";
      const width = Math.max(text.length * 13, 10);
      const height = 30;
      return {
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
      };
    }
  };

  const origGetBBox = ElementProto.getBBox;
  if (origGetBBox) {
    ElementProto.getBBox = function () {
      try {
        return origGetBBox.call(this);
      } catch {
        const r = this.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    };
  }

  // --- Shim 3: <textarea>.value ---
  // mermaid-to-excalidraw's entityCodesToText() sets innerHTML on a
  // <textarea> then reads .value to decode HTML entities. svgdom doesn't
  // implement .value on form elements.
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName: string, options?: any) {
    const el = origCreateElement(tagName, options);
    if (
      tagName.toLowerCase() === "textarea" &&
      !Object.getOwnPropertyDescriptor(el, "value")
    ) {
      Object.defineProperty(el, "value", {
        get() {
          return this.textContent;
        },
        set(v: string) {
          this.textContent = v;
        },
        configurable: true,
      });
    }
    return el;
  };

  // --- Browser globals ---
  if (!globalThis.requestAnimationFrame) {
    (globalThis as any).requestAnimationFrame = (cb: Function) =>
      setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
  }
  if (!globalThis.btoa) {
    (globalThis as any).btoa = (s: string) =>
      Buffer.from(s, "binary").toString("base64");
  }
  if (!globalThis.atob) {
    (globalThis as any).atob = (s: string) =>
      Buffer.from(s, "base64").toString("binary");
  }

  const globals: Record<string, any> = {
    window,
    document,
    self: window,
    navigator: { userAgent: "node" },
    devicePixelRatio: 1,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }

  // DOMPurify — mermaid requires it for SVG sanitization
  const DOMPurify = (await import("dompurify")).default;
  (globalThis as any).DOMPurify = DOMPurify(window as any);

  // Import the converter
  const mod = await import("@excalidraw/mermaid-to-excalidraw");
  _parseMermaidToExcalidraw = mod.parseMermaidToExcalidraw;

  _initialized = true;
}

export interface MermaidConversionResult {
  /** Scene-ready Excalidraw elements with bound text */
  elements: any[];
  /** Optional binary files (e.g. for image-based fallback diagrams) */
  files?: Record<string, any>;
}

/**
 * Generate a random ID matching Excalidraw's format.
 */
function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

// Excalidraw constants for bound text
const BOUND_TEXT_PADDING = 5;
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
const TEXT_HEIGHT = FONT_SIZE * LINE_HEIGHT; // 25px

/**
 * Approximate text width for Excalidraw's default font (family 5, "Assistant")
 * at 20px. Character widths vary but averaging ~10px per character is a
 * reasonable approximation for layout purposes. Excalidraw will reflow on
 * first render regardless, but this keeps initial layout reasonable.
 */
function measureTextWidth(text: string, fontSize: number = FONT_SIZE): number {
  // Scale factor from default font size
  const scale = fontSize / 20;
  // Per-character width approximation at 20px — proportional font averages
  return text.length * 10.5 * scale;
}

/**
 * Compute container dimensions to fit bound text (matches Excalidraw's
 * computeContainerDimensionForBoundText logic).
 */
function containerDimForText(textDim: number): number {
  return textDim + BOUND_TEXT_PADDING * 2;
}

/**
 * Convert skeleton elements (from parseMermaidToExcalidraw) into proper
 * Excalidraw scene elements.
 *
 * The mermaid-to-excalidraw library produces "skeleton" elements where labels
 * live in a `.label` property. Excalidraw's actual scene format requires
 * labels as separate `text` elements bound to their container via
 * `containerId` / `boundElements`. This function performs that conversion.
 *
 * Key behaviours:
 *   - Containers (rectangles, diamonds, ellipses) are auto-sized to fit their
 *     text label using approximate font metrics. The center position is
 *     preserved from the mermaid layout so the overall DAG structure is kept.
 *   - Bound text elements have their x/y set to the container center.
 *     Excalidraw will recompute exact positions on first render.
 *   - Arrow start/end bindings are resolved by mapping skeleton IDs to
 *     generated IDs.
 *   - Arrow dimensions are computed from their points array.
 */
function skeletonToExcalidraw(skeletons: any[]): any[] {
  const elements: any[] = [];
  const idMap = new Map<string, string>();
  // Store final container bounds for arrow endpoint adjustment
  const containerBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

  // First pass: assign new IDs and compute container bounds
  for (const skel of skeletons) {
    const newId = randomId();
    if (skel.id) {
      idMap.set(skel.id, newId);
    }

    // Pre-compute container bounds (same logic as below)
    const isContainer = ["rectangle", "diamond", "ellipse"].includes(skel.type);
    if (isContainer && skel.id) {
      let w = skel.width || 100;
      let h = skel.height || 50;
      let cx = (skel.x || 0) + w / 2;
      let cy = (skel.y || 0) + h / 2;

      if (skel.label?.text) {
        const textWidth = measureTextWidth(skel.label.text, skel.label.fontSize || FONT_SIZE);
        const newW = containerDimForText(textWidth);
        const newH = containerDimForText(TEXT_HEIGHT);
        w = Math.max(newW, w);
        h = Math.max(newH, h);
      }

      containerBounds.set(skel.id, {
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
      });
    }
  }

  for (const skel of skeletons) {
    const newId = idMap.get(skel.id) || randomId();
    const label = skel.label;
    const boundElements: any[] = [];

    // For containers with labels, auto-size to fit text and re-center
    let width = skel.width || 100;
    let height = skel.height || 50;
    let x = skel.x || 0;
    let y = skel.y || 0;

    const isContainer = ["rectangle", "diamond", "ellipse"].includes(skel.type);

    if (isContainer && label?.text) {
      const textWidth = measureTextWidth(label.text, label.fontSize || FONT_SIZE);
      const textHeight = TEXT_HEIGHT;
      const newWidth = containerDimForText(textWidth);
      const newHeight = containerDimForText(textHeight);

      // Preserve the center point from mermaid's layout
      const centerX = x + width / 2;
      const centerY = y + height / 2;

      width = Math.max(newWidth, width); // Don't shrink below mermaid's size
      height = Math.max(newHeight, height);
      x = centerX - width / 2;
      y = centerY - height / 2;
    }

    // Common properties for all elements
    const base: Record<string, any> = {
      id: newId,
      type: skel.type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: skel.strokeColor || "#1e1e1e",
      backgroundColor: skel.backgroundColor || "transparent",
      fillStyle: skel.fillStyle || "solid",
      strokeWidth: skel.strokeWidth || 2,
      strokeStyle: skel.strokeStyle || "solid",
      roughness: 1,
      opacity: 100,
      groupIds: skel.groupIds || [],
      roundness: skel.roundness || null,
      isDeleted: false,
      version: 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
      updated: Date.now(),
      link: skel.link || null,
      locked: false,
    };

    if (skel.type === "arrow" || skel.type === "line") {
      // Linear elements: use points from mermaid skeleton
      let points: number[][] = skel.points || [[0, 0], [skel.width || 100, skel.height || 0]];

      // Adjust arrow endpoints to sit at container edges.
      // Mermaid computed arrow positions based on its own box sizes; since we
      // resize containers, the arrow start/end may now be inside the boxes.
      // We recalculate so arrows start/end at the container bottom/top edge.
      const startContainer = skel.start?.id ? containerBounds.get(skel.start.id) : null;
      const endContainer = skel.end?.id ? containerBounds.get(skel.end.id) : null;

      if (startContainer) {
        // Move arrow origin to the bottom-center of the start container
        const startCx = startContainer.x + startContainer.width / 2;
        const startBottom = startContainer.y + startContainer.height;
        const dx = startCx - base.x;
        const dy = startBottom + 1 - base.y; // +1 gap

        // Shift arrow origin and adjust all points to compensate
        base.x = startCx;
        base.y = startBottom + 1;
        points = points.map((p, i) =>
          i === 0 ? [0, 0] : [p[0] - dx + (points[0][0]), p[1] - dy + (points[0][1])],
        );
      }

      if (endContainer) {
        // Adjust the last point to reach the top-center of the end container
        const endCx = endContainer.x + endContainer.width / 2;
        const endTop = endContainer.y;
        const lastIdx = points.length - 1;
        points[lastIdx] = [
          endCx - base.x,
          endTop - 1 - base.y, // -1 gap
        ];
      }

      base.points = points;

      // Compute actual bounding box from points
      if (points.length >= 2) {
        const xs = points.map((p: number[]) => p[0]);
        const ys = points.map((p: number[]) => p[1]);
        base.width = Math.max(...xs) - Math.min(...xs);
        base.height = Math.max(...ys) - Math.min(...ys);
      }

      base.lastCommittedPoint = null;
      base.startBinding = null;
      base.endBinding = null;
      base.startArrowhead = skel.startArrowhead || null;
      base.endArrowhead = skel.endArrowhead !== undefined ? skel.endArrowhead : "arrow";
      base.roundness = skel.roundness || { type: 2 };
      base.elbowed = false;

      // Resolve start/end bindings
      if (skel.start?.id) {
        const boundId = idMap.get(skel.start.id);
        if (boundId) {
          base.startBinding = {
            elementId: boundId,
            focus: 0,
            gap: 1,
            fixedPoint: null,
          };
        }
      }
      if (skel.end?.id) {
        const boundId = idMap.get(skel.end.id);
        if (boundId) {
          base.endBinding = {
            elementId: boundId,
            focus: 0,
            gap: 1,
            fixedPoint: null,
          };
        }
      }
    }

    if (skel.type === "text") {
      // Standalone text elements (e.g. from class diagrams)
      base.text = skel.text || "";
      base.fontSize = skel.fontSize || FONT_SIZE;
      base.fontFamily = 5;
      base.textAlign = skel.textAlign || "center";
      base.verticalAlign = skel.verticalAlign || "middle";
      base.containerId = null;
      base.originalText = skel.text || "";
      base.autoResize = true;
      base.lineHeight = LINE_HEIGHT;
    }

    // Create bound text element for labels
    if (label?.text) {
      const textId = randomId();
      boundElements.push({ id: textId, type: "text" });

      const fontSize = label.fontSize || FONT_SIZE;
      const textWidth = measureTextWidth(label.text, fontSize);

      const textElement: Record<string, any> = {
        id: textId,
        type: "text",
        // Center text in container — Excalidraw will recompute on render
        x: base.x + (base.width - textWidth) / 2,
        y: base.y + (base.height - TEXT_HEIGHT) / 2,
        width: textWidth,
        height: TEXT_HEIGHT,
        angle: 0,
        strokeColor: label.strokeColor || "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
        opacity: 100,
        groupIds: label.groupIds || skel.groupIds || [],
        roundness: null,
        isDeleted: false,
        version: 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
        link: null,
        locked: false,
        text: label.text,
        fontSize,
        fontFamily: 5,
        textAlign: "center",
        verticalAlign: label.verticalAlign || "middle",
        containerId: newId,
        originalText: label.text,
        autoResize: true,
        lineHeight: LINE_HEIGHT,
      };

      elements.push({ ...base, boundElements });
      elements.push(textElement);
      continue;
    }

    base.boundElements = boundElements.length > 0 ? boundElements : null;
    elements.push(base);
  }

  // Second pass: add arrow bindings to container elements' boundElements
  for (const el of elements) {
    if (el.type === "arrow") {
      if (el.startBinding?.elementId) {
        const container = elements.find((e: any) => e.id === el.startBinding.elementId);
        if (container) {
          if (!container.boundElements) container.boundElements = [];
          container.boundElements.push({ id: el.id, type: "arrow" });
        }
      }
      if (el.endBinding?.elementId) {
        const container = elements.find((e: any) => e.id === el.endBinding.elementId);
        if (container) {
          if (!container.boundElements) container.boundElements = [];
          container.boundElements.push({ id: el.id, type: "arrow" });
        }
      }
    }
  }

  return elements;
}

/**
 * Convert a Mermaid diagram definition to Excalidraw elements.
 *
 * Supported diagram types (native parsing → proper Excalidraw shapes):
 *   - Flowcharts (graph TD/LR/etc.)
 *   - Class diagrams
 *
 * Unsupported types fall back to an SVG image representation.
 *
 * @param definition - Mermaid diagram text (e.g. "graph TD\n  A --> B")
 * @returns Excalidraw elements and optional files
 * @throws Error if the mermaid definition is invalid or rendering fails
 */
export async function convertMermaidToExcalidraw(
  definition: string,
): Promise<MermaidConversionResult> {
  await ensureInitialized();

  const result = await _parseMermaidToExcalidraw(definition, {
    // securityLevel: "loose" skips DOMPurify's SVG sanitization which
    // strips content in the headless svgdom environment.
    securityLevel: "loose",
    // htmlLabels: false uses <text> SVG elements instead of <foreignObject>.
    // svgdom can measure <text> via fontkit but cannot handle foreignObject.
    flowchart: { curve: "linear", htmlLabels: false },
  });

  // Convert skeleton elements to scene-ready Excalidraw elements
  const elements = skeletonToExcalidraw(result.elements || []);

  return {
    elements,
    files: result.files || undefined,
  };
}
