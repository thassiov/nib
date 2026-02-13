import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { SceneModel } from "../database/models/scene.model.js";
import { UserModel } from "../database/models/user.model.js";
import type { WhereOptions } from "sequelize";
import { Op } from "sequelize";

export interface FindAllOptions {
  where: WhereOptions;
  page: number;
  limit: number;
  includeUser?: boolean;
}

export interface PaginatedResult<T> {
  rows: T[];
  count: number;
}

@Injectable()
export class ScenesRepository {
  constructor(
    @InjectModel(SceneModel)
    private readonly sceneModel: typeof SceneModel,
  ) {}

  /**
   * Unified list query with pagination.
   * Replaces the duplicated public gallery / my-scenes queries.
   */
  async findAll(options: FindAllOptions): Promise<PaginatedResult<SceneModel>> {
    const { where, page, limit, includeUser } = options;
    const offset = (page - 1) * limit;

    const include = includeUser
      ? [{ model: UserModel, as: "user", attributes: ["id", "username", "avatar_url"] }]
      : [];

    const { count, rows } = await this.sceneModel.findAndCountAll({
      where,
      order: [["updated_at", "DESC"]],
      limit,
      offset,
      attributes: ["id", "title", "thumbnail", "is_public", "created_at", "updated_at"],
      include,
    });

    return { count, rows };
  }

  async findById(id: string, includeUser = false): Promise<SceneModel | null> {
    const include = includeUser
      ? [{ model: UserModel, as: "user", attributes: ["id", "username", "avatar_url"] }]
      : [];

    return this.sceneModel.findByPk(id, { include });
  }

  async create(data: {
    title: string;
    data: object;
    is_public: boolean;
    user_id: string | null;
    thumbnail?: string;
  }): Promise<SceneModel> {
    return this.sceneModel.create(data);
  }

  async update(
    scene: SceneModel,
    data: Partial<{ title: string; data: object; is_public: boolean; thumbnail: string }>,
  ): Promise<SceneModel> {
    return scene.update({
      ...data,
      updated_at: new Date(),
    });
  }

  async delete(scene: SceneModel): Promise<void> {
    await scene.destroy();
  }

  /**
   * Adopt orphaned scenes: set user_id on scenes that currently have no owner.
   * Only updates scenes where user_id IS NULL (safety guard).
   * Returns the number of scenes adopted.
   */
  async adoptByIds(sceneIds: string[], userId: string): Promise<number> {
    if (!sceneIds.length) return 0;

    const [count] = await this.sceneModel.update(
      { user_id: userId } as any,
      {
        where: {
          id: { [Op.in]: sceneIds },
          user_id: null,
        },
      },
    );

    return count;
  }
}
