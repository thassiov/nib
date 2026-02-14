/**
 * Server-side thumbnail generation using @excalidraw/utils + jsdom + sharp.
 *
 * Renders Excalidraw scene elements to SVG, then converts to a 300px-wide
 * PNG encoded as a base64 data URL.
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

  // FontFace shim — Excalidraw tries to register fonts for SVG export
  class FontFaceShim {
    family: string;
    source: string;
    status = "loaded";
    constructor(family: string, source: string, _descriptors?: any) {
      this.family = family;
      this.source = source;
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

    // Convert SVG to PNG, constrained to MAX_THUMBNAIL_WIDTH
    const sharp = (await import("sharp")).default;
    const pngBuffer = await sharp(Buffer.from(svgString))
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
