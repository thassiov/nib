import { Module, forwardRef } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { UsersModule } from "../users/users.module.js";
import { ScenesModule } from "../scenes/scenes.module.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { OptionalAuthGuard } from "./guards/optional-auth.guard.js";

@Module({
  imports: [UsersModule, forwardRef(() => ScenesModule)],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OptionalAuthGuard],
  exports: [AuthService, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
