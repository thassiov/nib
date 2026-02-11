import {
  Table,
  Column,
  Model,
  DataType,
  BelongsTo,
  ForeignKey,
  PrimaryKey,
  Default,
  AllowNull,
} from "sequelize-typescript";
import { UserModel } from "./user.model.js";

@Table({
  tableName: "scenes",
  timestamps: false,
  // Note: Partial indexes are added conditionally in database.module.ts
  // since SQLite doesn't support them
})
export class SceneModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @AllowNull(true)
  @Column(DataType.UUID)
  declare user_id: string | null;

  @AllowNull(false)
  @Default("Untitled")
  @Column(DataType.TEXT)
  declare title: string;

  @AllowNull(false)
  @Column(DataType.JSON)
  declare data: object;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare thumbnail: string | null;

  @Default(false)
  @Column(DataType.BOOLEAN)
  declare is_public: boolean;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare created_at: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare updated_at: Date;

  @BelongsTo(() => UserModel, { foreignKey: "user_id", onDelete: "CASCADE" })
  declare user: UserModel;
}
