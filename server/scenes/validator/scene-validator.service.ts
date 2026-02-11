import { Injectable } from "@nestjs/common";
import { validateScene, checkSizeLimit } from "../../services/validator.js";
import type { ValidationResult, ValidationError } from "../../services/validator.js";

export { ValidationResult, ValidationError };

/**
 * Injectable wrapper around the structural Excalidraw scene validator.
 * The underlying validation logic is unchanged from the Express version.
 */
@Injectable()
export class SceneValidatorService {
  validateScene(data: unknown): ValidationResult {
    return validateScene(data);
  }

  checkSizeLimit(byteLength: number, maxBytes?: number): ValidationError | null {
    return checkSizeLimit(byteLength, maxBytes);
  }
}
