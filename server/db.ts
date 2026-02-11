import { Sequelize, DataTypes, Model, Optional } from "sequelize";

// --- Sequelize instance ---

const sequelize = new Sequelize({
  dialect: "postgres",
  host: process.env.DB_HOST || "postgres.grid.local",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "nib",
  username: process.env.DB_USER || "grid_admin",
  password: process.env.DB_PASS,
  logging: process.env.NODE_ENV === "development" ? console.log : false,
});

// --- User model ---

interface UserAttributes {
  id: string;
  sub: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  created_at: Date;
}

type UserCreationAttributes = Optional<UserAttributes, "id" | "email" | "avatar_url" | "created_at">;

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  declare id: string;
  declare sub: string;
  declare username: string;
  declare email: string | null;
  declare avatar_url: string | null;
  declare created_at: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sub: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    username: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    avatar_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "users",
    timestamps: false,
  }
);

// --- Scene model ---

interface SceneAttributes {
  id: string;
  user_id: string | null;
  title: string;
  data: object;
  thumbnail: string | null;
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
}

type SceneCreationAttributes = Optional<
  SceneAttributes,
  "id" | "user_id" | "title" | "thumbnail" | "is_public" | "created_at" | "updated_at"
>;

class Scene extends Model<SceneAttributes, SceneCreationAttributes> implements SceneAttributes {
  declare id: string;
  declare user_id: string | null;
  declare title: string;
  declare data: object;
  declare thumbnail: string | null;
  declare is_public: boolean;
  declare created_at: Date;
  declare updated_at: Date;
}

Scene.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "Untitled",
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    thumbnail: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_public: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "scenes",
    timestamps: false,
    indexes: [
      { fields: ["user_id"], name: "idx_scenes_user" },
      { fields: ["is_public"], where: { is_public: true }, name: "idx_scenes_public" },
      { fields: [{ name: "updated_at", order: "DESC" }], name: "idx_scenes_updated" },
    ],
  }
);

// --- Associations ---

User.hasMany(Scene, { foreignKey: "user_id", as: "scenes" });
Scene.belongsTo(User, { foreignKey: "user_id", as: "user" });

export { sequelize, User, Scene };
export type { UserAttributes, UserCreationAttributes, SceneAttributes, SceneCreationAttributes };
