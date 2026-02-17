/**
 * Server-side rendering of Excalidraw scenes to PNG.
 *
 * Pipeline: Excalidraw scene → SVG (via @excalidraw/utils) → PNG (via resvg-js).
 *
 * Uses resvg-js (Rust-based) instead of sharp/librsvg for SVG→PNG conversion
 * because librsvg mishandles embedded woff2 font metrics (letter spacing issues).
 * sharp is only used for post-render resizing when needed.
 *
 * All jsdom/shim setup is deferred to the first call to generateThumbnail()
 * so that importing this module doesn't pollute globals during tests.
 */

const MAX_THUMBNAIL_WIDTH = 300;

let _initialized = false;
let _exportToSvg: any = null;

async function ensureInitialized() {
  if (_initialized) return;

  // @ts-ignore -- jsdom has no bundled types; we only need the constructor
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");

  // Some properties (e.g. navigator) are read-only on globalThis in Node 21+,
  // so we use Object.defineProperty with configurable: true to override them.
  const globals: Record<string, any> = {
    window: dom.window,
    document: dom.window.document,
    devicePixelRatio: 1,
    DOMParser: dom.window.DOMParser,
    Image: dom.window.Image,
    navigator: dom.window.navigator,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }

  // FontFace shim — Excalidraw tries to register fonts for SVG export.
  // Must include unicodeRange (accessed via .split()) and other descriptor
  // properties that @excalidraw/utils reads during font CSS generation.
  class FontFaceShim {
    family: string;
    source: string;
    status = "loaded";
    style = "normal";
    weight = "normal";
    stretch = "normal";
    unicodeRange = "U+0-10FFFF";
    variant = "normal";
    featureSettings = "normal";
    display = "auto";
    constructor(family: string, source: string, descriptors?: any) {
      this.family = family;
      this.source = source;
      if (descriptors) {
        if (descriptors.style) this.style = descriptors.style;
        if (descriptors.weight) this.weight = descriptors.weight;
        if (descriptors.stretch) this.stretch = descriptors.stretch;
        if (descriptors.unicodeRange) this.unicodeRange = descriptors.unicodeRange;
        if (descriptors.variant) this.variant = descriptors.variant;
        if (descriptors.featureSettings) this.featureSettings = descriptors.featureSettings;
        if (descriptors.display) this.display = descriptors.display;
      }
    }
    async load() {
      return this;
    }
  }
  (globalThis as any).FontFace = FontFaceShim;

  // document.fonts shim
  if (!(dom.window.document as any).fonts) {
    (dom.window.document as any).fonts = {
      add: () => {},
      check: () => true,
      ready: Promise.resolve(),
      entries: () => [][Symbol.iterator](),
      forEach: () => {},
      has: () => false,
      values: () => [][Symbol.iterator](),
    };
  }

  // fetch() shim for data: URIs — @excalidraw/utils embeds all fonts as
  // base64 data URIs in the bundle and calls fetch() on them during font
  // inlining. Node's built-in fetch does not support data: URIs.
  const _originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const commaIdx = url.indexOf(",");
      const header = url.slice(0, commaIdx);
      const data = url.slice(commaIdx + 1);
      const isBase64 = header.includes(";base64");
      const mimeType = header.split(":")[1]?.split(";")[0] || "application/octet-stream";
      const buffer = isBase64
        ? Buffer.from(data, "base64")
        : Buffer.from(decodeURIComponent(data));
      return new Response(buffer, {
        status: 200,
        headers: { "Content-Type": mimeType },
      });
    }
    return _originalFetch(input, init);
  };

  const utils = await import("@excalidraw/utils");
  _exportToSvg = utils.exportToSvg;

  // Only mark initialized after everything succeeds
  _initialized = true;
}

/**
 * Generate a PNG thumbnail from Excalidraw scene data.
 *
 * @param sceneData - The Excalidraw scene object with elements, appState, files
 * @returns Base64 data URL (data:image/png;base64,...) or null on failure
 */
export async function generateThumbnail(sceneData: any): Promise<string | null> {
  try {
    const elements = sceneData?.elements;
    if (!elements || !Array.isArray(elements) || elements.length === 0) {
      return null;
    }

    // Filter out deleted elements
    const visibleElements = elements.filter((el: any) => !el.isDeleted);
    if (visibleElements.length === 0) {
      return null;
    }

    await ensureInitialized();

    const svg = await _exportToSvg({
      elements: visibleElements,
      appState: {
        viewBackgroundColor: sceneData?.appState?.viewBackgroundColor ?? "#ffffff",
        exportBackground: true,
      },
      files: sceneData?.files ?? null,
    });

    const svgString = svg.outerHTML;

    // Render SVG to PNG via resvg (correct font handling), then resize with sharp
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svgString);
    const rendered = resvg.render();
    const fullPng = rendered.asPng();

    // Resize to thumbnail width
    const sharp = (await import("sharp")).default;
    const pngBuffer = await sharp(fullPng)
      .resize(MAX_THUMBNAIL_WIDTH, null, { fit: "inside" })
      .png()
      .toBuffer();

    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (err) {
    // Thumbnail generation is best-effort — never block the request
    console.error("Thumbnail generation failed:", (err as Error).message);
    return null;
  }
}

export interface ExportPngOptions {
  /** Max width in pixels. When set, the image is resized to fit within this width. */
  width?: number;
  /** Max height in pixels. When set together with width, aspect ratio is preserved via "inside" fit. */
  height?: number;
  /** Background color. Defaults to the scene's viewBackgroundColor or "#ffffff". */
  background?: string;
  /** Whether to include the background. Defaults to true. */
  exportBackground?: boolean;
  /** Device pixel ratio / scale factor. Defaults to 2 for crisp exports. */
  scale?: number;
}

/**
 * Export Excalidraw scene data to a full-resolution PNG buffer.
 *
 * Unlike generateThumbnail(), this returns a raw Buffer suitable for
 * streaming directly as an HTTP response, and does not constrain to
 * thumbnail dimensions.
 *
 * @param sceneData - The Excalidraw scene object with elements, appState, files
 * @param options - Optional sizing / background overrides
 * @returns PNG buffer
 * @throws Error if scene data is invalid or rendering fails
 */
export async function exportToPng(
  sceneData: any,
  options: ExportPngOptions = {},
): Promise<Buffer> {
  const elements = sceneData?.elements;
  if (!elements || !Array.isArray(elements) || elements.length === 0) {
    throw new Error("Scene has no elements to export");
  }

  const visibleElements = elements.filter((el: any) => !el.isDeleted);
  if (visibleElements.length === 0) {
    throw new Error("Scene has no visible elements to export");
  }

  await ensureInitialized();

  const exportBackground = options.exportBackground ?? true;
  const bgColor =
    options.background ??
    sceneData?.appState?.viewBackgroundColor ??
    "#ffffff";

  const svg = await _exportToSvg({
    elements: visibleElements,
    appState: {
      viewBackgroundColor: bgColor,
      exportBackground,
    },
    files: sceneData?.files ?? null,
  });

  const svgString = svg.outerHTML;

  // Render SVG to PNG via resvg (correct font handling)
  const { Resvg } = await import("@resvg/resvg-js");
  const scale = options.scale ?? 2;
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "zoom" as const, value: scale },
  });
  const rendered = resvg.render();
  let pngBuffer: Buffer = Buffer.from(rendered.asPng());

  // Optional resize via sharp (if width/height constraints are specified)
  if (options.width || options.height) {
    const sharp = (await import("sharp")).default;
    pngBuffer = await sharp(pngBuffer)
      .resize(
        options.width ?? null,
        options.height ?? null,
        { fit: "inside", withoutEnlargement: true },
      )
      .png()
      .toBuffer();
  }

  return pngBuffer;
}
