import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UserModel } from "./models/user.model.js";
import { SceneModel } from "./models/scene.model.js";

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: "postgres",
      host: process.env.DB_HOST || "postgres.grid.local",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "nib",
      username: process.env.DB_USER || "grid_admin",
      password: process.env.DB_PASS,
      logging: process.env.NODE_ENV === "development" ? console.log : false,
      models: [UserModel, SceneModel],
      autoLoadModels: true,
      synchronize: false,
    }),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
