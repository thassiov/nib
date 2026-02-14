import { Module, forwardRef } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { SceneModel } from "../database/models/scene.model.js";
import { ScenesController } from "./scenes.controller.js";
import { ScenesService } from "./scenes.service.js";
import { ScenesRepository } from "./scenes.repository.js";
import { SceneValidatorService } from "./validator/scene-validator.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";

@Module({
  imports: [SequelizeModule.forFeature([SceneModel]), forwardRef(() => AuthModule), MetricsModule],
  controllers: [ScenesController],
  providers: [ScenesService, ScenesRepository, SceneValidatorService],
  exports: [ScenesRepository],
})
export class ScenesModule {}
