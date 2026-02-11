import {
  Table,
  Column,
  Model,
  DataType,
  HasMany,
  PrimaryKey,
  Default,
  AllowNull,
  Unique,
} from "sequelize-typescript";
import { SceneModel } from "./scene.model.js";

@Table({ tableName: "users", timestamps: false })
export class UserModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @AllowNull(false)
  @Unique
  @Column(DataType.TEXT)
  declare sub: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  declare username: string;

  @AllowNull(true)
  @Default(null)
  @Column(DataType.TEXT)
  declare email: string | null;

  @AllowNull(true)
  @Default(null)
  @Column(DataType.TEXT)
  declare avatar_url: string | null;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare created_at: Date;

  @HasMany(() => SceneModel, { onDelete: "CASCADE", hooks: true })
  declare scenes: SceneModel[];
}
