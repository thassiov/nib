import { Injectable, Inject, NotFoundException, ForbiddenException } from "@nestjs/common";
import { ScenesRepository } from "./scenes.repository.js";
import { SceneValidatorService } from "./validator/scene-validator.service.js";
import { SceneModel } from "../database/models/scene.model.js";
import { generateThumbnail } from "../services/thumbnail.js";

export interface ListOptions {
  filter: "public" | "mine";
  userId?: string;
  page: number;
  limit: number;
}

export interface PaginatedScenes {
  scenes: SceneModel[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

@Injectable()
export class ScenesService {
  constructor(
    @Inject(ScenesRepository) private readonly scenesRepository: ScenesRepository,
    @Inject(SceneValidatorService) private readonly sceneValidator: SceneValidatorService,
  ) {}

  /**
   * Unified list method. One method, different filters.
   */
  async list(options: ListOptions): Promise<PaginatedScenes> {
    const { filter, userId, page, limit } = options;

    const where =
      filter === "mine"
        ? { user_id: userId }
        : { is_public: true };

    const { count, rows } = await this.scenesRepository.findAll({
      where,
      page,
      limit,
      includeUser: filter === "public",
    });

    return {
      scenes: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * Check if the requester can modify a scene.
   * Ownership is established by either:
   *   - Authenticated: scene.user_id matches the requesting user's ID
   *   - Anonymous session: scene.id is in the session's ownedScenes list
   */
  private canModify(scene: SceneModel, userId?: string, ownedScenes?: string[]): boolean {
    if (userId && scene.user_id === userId) return true;
    if (ownedScenes?.includes(scene.id)) return true;
    return false;
  }

  /**
   * Get a single scene by ID.
   * Public scenes are accessible to anyone; private scenes only to owner.
   * Returns a plain object with a `canEdit` flag indicating edit permission.
   */
  async findById(
    id: string,
    requestingUserId?: string,
    ownedScenes?: string[],
  ): Promise<Record<string, unknown>> {
    const scene = await this.scenesRepository.findById(id, true);

    if (!scene) {
      throw new NotFoundException("Scene not found");
    }

    // Private scenes: only the owner can view
    if (!scene.is_public && !this.canModify(scene, requestingUserId, ownedScenes)) {
      throw new NotFoundException("Scene not found");
    }

    const json = scene.toJSON();
    return {
      ...json,
      canEdit: this.canModify(scene, requestingUserId, ownedScenes),
    };
  }

  /**
   * Create a new scene after validation.
   */
  async create(
    data: { title?: string; data: object; is_public?: boolean; thumbnail?: string },
    userId?: string,
  ): Promise<{ scene?: SceneModel; validation?: any }> {
    const validation = this.sceneValidator.validateScene(data.data);
    if (!validation.valid) {
      return { validation };
    }

    // Generate server-side thumbnail if none provided
    let thumbnail = data.thumbnail ?? null;
    if (!thumbnail) {
      thumbnail = await generateThumbnail(data.data);
    }

    const scene = await this.scenesRepository.create({
      title: data.title || "Untitled",
      data: data.data,
      is_public: data.is_public ?? false,
      user_id: userId ?? null,
      ...(thumbnail && { thumbnail }),
    });

    return { scene };
  }

  /**
   * Update an existing scene. Requires ownership via user_id or session ownedScenes.
   */
  async update(
    id: string,
    data: { title?: string; data?: object; is_public?: boolean; thumbnail?: string },
    userId?: string,
    ownedScenes?: string[],
  ): Promise<{ scene?: SceneModel; validation?: any }> {
    const scene = await this.scenesRepository.findById(id);

    if (!scene) {
      throw new NotFoundException("Scene not found");
    }

    if (!this.canModify(scene, userId, ownedScenes)) {
      throw new ForbiddenException("Not authorized to modify this scene");
    }

    // Validate scene data if provided
    if (data.data !== undefined) {
      const validation = this.sceneValidator.validateScene(data.data);
      if (!validation.valid) {
        return { validation };
      }
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.data !== undefined) updateData.data = data.data;
    if (data.is_public !== undefined) updateData.is_public = data.is_public;
    if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail;

    const updated = await this.scenesRepository.update(scene, updateData);
    return { scene: updated };
  }

  /**
   * Delete a scene. Requires ownership via user_id or session ownedScenes.
   */
  async delete(id: string, userId?: string, ownedScenes?: string[]): Promise<void> {
    const scene = await this.scenesRepository.findById(id);

    if (!scene) {
      throw new NotFoundException("Scene not found");
    }

    if (!this.canModify(scene, userId, ownedScenes)) {
      throw new ForbiddenException("Not authorized to delete this scene");
    }

    await this.scenesRepository.delete(scene);
  }

  /**
   * Validate scene data without persisting.
   */
  validate(data: unknown, contentLength: number) {
    const sizeError = this.sceneValidator.checkSizeLimit(contentLength);
    if (sizeError) {
      return { valid: false, errors: [sizeError], elementCount: 0 };
    }
    return this.sceneValidator.validateScene(data);
  }
}
