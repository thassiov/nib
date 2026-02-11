/**
 * Server-side Excalidraw scene validator.
 *
 * The @excalidraw/excalidraw `restore()` function can't run in Node directly
 * (it bundles React/DOM deps and ESM-only JSON imports). So we do structural
 * validation here - checking that the JSON conforms to the Excalidraw scene
 * schema. The client uses the actual `restore()` for full fidelity checks.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** Number of elements in the scene */
  elementCount: number;
}

// Known Excalidraw element types
const VALID_ELEMENT_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
  "magicframe",
  "group",
  "embeddable",
  "iframe",
  "selection",
]);

const VALID_STROKE_STYLES = new Set(["solid", "dashed", "dotted"]);
const VALID_FILL_STYLES = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);
const VALID_ROUNDNESS_TYPES = new Set([1, 2, 3]);

/**
 * Validate an Excalidraw scene JSON payload.
 * Returns detailed errors explaining what's wrong.
 */
export function validateScene(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (data === null || data === undefined) {
    return { valid: false, errors: [{ path: "$", message: "Scene data is null or undefined" }], elementCount: 0 };
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: [{ path: "$", message: "Scene data must be a JSON object, not " + (Array.isArray(data) ? "an array" : typeof data) }],
      elementCount: 0,
    };
  }

  const scene = data as Record<string, unknown>;

  // --- Validate elements ---

  if (!("elements" in scene)) {
    errors.push({ path: "$.elements", message: "Missing required field 'elements'" });
  } else if (!Array.isArray(scene.elements)) {
    errors.push({ path: "$.elements", message: "'elements' must be an array" });
  } else {
    for (let i = 0; i < scene.elements.length; i++) {
      const el = scene.elements[i];
      const prefix = `$.elements[${i}]`;

      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push({ path: prefix, message: "Element must be an object" });
        continue;
      }

      const elem = el as Record<string, unknown>;

      // Required string fields
      if (typeof elem.id !== "string" || elem.id.length === 0) {
        errors.push({ path: `${prefix}.id`, message: "Element must have a non-empty string 'id'" });
      }

      if (typeof elem.type !== "string") {
        errors.push({ path: `${prefix}.type`, message: "Element must have a string 'type'" });
      } else if (!VALID_ELEMENT_TYPES.has(elem.type)) {
        // Warn but don't fail - Excalidraw may add new types
        errors.push({
          path: `${prefix}.type`,
          message: `Unknown element type '${elem.type}'. Known types: ${[...VALID_ELEMENT_TYPES].join(", ")}`,
        });
      }

      // Required numeric fields
      for (const field of ["x", "y", "width", "height"] as const) {
        if (typeof elem[field] !== "number" || !isFinite(elem[field] as number)) {
          errors.push({ path: `${prefix}.${field}`, message: `Element must have a finite number '${field}'` });
        }
      }

      // Optional validated fields
      if (elem.strokeStyle !== undefined && !VALID_STROKE_STYLES.has(elem.strokeStyle as string)) {
        errors.push({
          path: `${prefix}.strokeStyle`,
          message: `Invalid strokeStyle '${elem.strokeStyle}'. Must be one of: ${[...VALID_STROKE_STYLES].join(", ")}`,
        });
      }

      if (elem.fillStyle !== undefined && !VALID_FILL_STYLES.has(elem.fillStyle as string)) {
        errors.push({
          path: `${prefix}.fillStyle`,
          message: `Invalid fillStyle '${elem.fillStyle}'. Must be one of: ${[...VALID_FILL_STYLES].join(", ")}`,
        });
      }

      if (elem.roundness !== undefined && elem.roundness !== null) {
        const r = elem.roundness as Record<string, unknown>;
        if (typeof r !== "object" || typeof r.type !== "number" || !VALID_ROUNDNESS_TYPES.has(r.type)) {
          errors.push({
            path: `${prefix}.roundness`,
            message: `Invalid roundness. Must be null or { type: 1|2|3 }`,
          });
        }
      }

      if (elem.angle !== undefined && (typeof elem.angle !== "number" || !isFinite(elem.angle as number))) {
        errors.push({ path: `${prefix}.angle`, message: "angle must be a finite number" });
      }

      if (elem.isDeleted !== undefined && typeof elem.isDeleted !== "boolean") {
        errors.push({ path: `${prefix}.isDeleted`, message: "isDeleted must be a boolean" });
      }

      // Text elements must have text content
      if (elem.type === "text") {
        if (typeof elem.text !== "string") {
          errors.push({ path: `${prefix}.text`, message: "Text elements must have a string 'text' field" });
        }
        if (typeof elem.fontSize !== "number") {
          errors.push({ path: `${prefix}.fontSize`, message: "Text elements must have a numeric 'fontSize'" });
        }
      }

      // Arrow/line elements should have points array
      if (elem.type === "arrow" || elem.type === "line" || elem.type === "freedraw") {
        if (!Array.isArray(elem.points)) {
          errors.push({ path: `${prefix}.points`, message: `${elem.type} elements must have a 'points' array` });
        }
      }

      // Image elements must reference a fileId
      if (elem.type === "image") {
        if (typeof elem.fileId !== "string" || elem.fileId.length === 0) {
          errors.push({ path: `${prefix}.fileId`, message: "Image elements must have a non-empty 'fileId'" });
        }
      }
    }
  }

  // --- Validate appState (optional, but check if present) ---

  if (scene.appState !== undefined && scene.appState !== null) {
    if (typeof scene.appState !== "object" || Array.isArray(scene.appState)) {
      errors.push({ path: "$.appState", message: "appState must be an object if provided" });
    }
  }

  // --- Validate files (optional, but check structure if present) ---

  if (scene.files !== undefined && scene.files !== null) {
    if (typeof scene.files !== "object" || Array.isArray(scene.files)) {
      errors.push({ path: "$.files", message: "files must be an object (map of fileId -> file data) if provided" });
    } else {
      const files = scene.files as Record<string, unknown>;
      for (const [fileId, fileData] of Object.entries(files)) {
        const prefix = `$.files["${fileId}"]`;
        if (typeof fileData !== "object" || fileData === null) {
          errors.push({ path: prefix, message: "File entry must be an object" });
          continue;
        }
        const f = fileData as Record<string, unknown>;
        if (typeof f.mimeType !== "string") {
          errors.push({ path: `${prefix}.mimeType`, message: "File entry must have a string 'mimeType'" });
        }
        if (typeof f.dataURL !== "string") {
          errors.push({ path: `${prefix}.dataURL`, message: "File entry must have a string 'dataURL'" });
        }
      }
    }
  }

  const elementCount = Array.isArray(scene.elements) ? scene.elements.length : 0;

  return {
    valid: errors.length === 0,
    errors,
    elementCount,
  };
}

/**
 * Size limit check (before parsing JSON).
 * Default max: 50MB (matches express JSON limit).
 */
export function checkSizeLimit(byteLength: number, maxBytes: number = 50 * 1024 * 1024): ValidationError | null {
  if (byteLength > maxBytes) {
    const sizeMB = (byteLength / (1024 * 1024)).toFixed(1);
    const limitMB = (maxBytes / (1024 * 1024)).toFixed(0);
    return {
      path: "$",
      message: `Scene data is ${sizeMB}MB, exceeding the ${limitMB}MB limit`,
    };
  }
  return null;
}
