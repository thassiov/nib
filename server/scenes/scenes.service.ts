import { Injectable, Inject, NotFoundException, ForbiddenException } from "@nestjs/common";
import { ScenesRepository } from "./scenes.repository.js";
import { SceneValidatorService } from "./validator/scene-validator.service.js";
import { SceneModel } from "../database/models/scene.model.js";
import { generateThumbnail, exportToPng, type ExportPngOptions } from "../services/thumbnail.js";
import { MetricsService } from "../metrics/metrics.service.js";

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
    @Inject(MetricsService) private readonly metricsService: MetricsService,
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

    const isPublic = data.is_public ?? false;
    const scene = await this.scenesRepository.create({
      title: data.title || "Untitled",
      data: data.data,
      is_public: isPublic,
      user_id: userId ?? null,
      ...(thumbnail && { thumbnail }),
    });

    this.metricsService.incDrawingCreated(isPublic);

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
   * Incremental update: merge upserted elements and remove deleted ones.
   * Much more efficient than replacing the entire scene on every autosave.
   */
  async patchElements(
    id: string,
    patch: {
      elements: { upserts: Array<{ id: string; [k: string]: unknown }>; deletes: string[] };
      appState?: Record<string, unknown>;
      files?: Record<string, unknown>;
      thumbnail?: string;
    },
    userId?: string,
    ownedScenes?: string[],
  ): Promise<{ scene?: SceneModel }> {
    const scene = await this.scenesRepository.findById(id);

    if (!scene) {
      throw new NotFoundException("Scene not found");
    }

    if (!this.canModify(scene, userId, ownedScenes)) {
      throw new ForbiddenException("Not authorized to modify this scene");
    }

    // Merge elements: index existing by ID, apply upserts, remove deletes
    const data = (scene.data || {}) as Record<string, unknown>;
    const existingElements = (data.elements || []) as Array<{ id: string; [k: string]: unknown }>;

    const elementMap = new Map<string, { id: string; [k: string]: unknown }>();
    for (const el of existingElements) {
      elementMap.set(el.id, el);
    }

    // Apply upserts (insert or replace by ID)
    for (const el of patch.elements.upserts) {
      elementMap.set(el.id, el);
    }

    // Apply deletes
    for (const deleteId of patch.elements.deletes) {
      elementMap.delete(deleteId);
    }

    // Rebuild the data object
    const newData: Record<string, unknown> = {
      ...data,
      elements: Array.from(elementMap.values()),
    };
    if (patch.appState !== undefined) newData.appState = patch.appState;
    if (patch.files !== undefined) newData.files = patch.files;

    const updatePayload: any = { data: newData };
    if (patch.thumbnail !== undefined) updatePayload.thumbnail = patch.thumbnail;

    const updated = await this.scenesRepository.update(scene, updatePayload);
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
    this.metricsService.incDrawingDeleted();
  }

  /**
   * Export a scene as a full-resolution PNG buffer.
   * Respects visibility rules: public scenes are accessible to anyone,
   * private scenes only to the owner.
   */
  async exportPng(
    id: string,
    options: ExportPngOptions = {},
    requestingUserId?: string,
    ownedScenes?: string[],
  ): Promise<Buffer> {
    const scene = await this.scenesRepository.findById(id);

    if (!scene) {
      throw new NotFoundException("Scene not found");
    }

    if (!scene.is_public && !this.canModify(scene, requestingUserId, ownedScenes)) {
      throw new NotFoundException("Scene not found");
    }

    return exportToPng(scene.data, options);
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
