import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { fileURLToPath } from "url";
import { AppController } from "./app.controller.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ScenesModule } from "./scenes/scenes.module.js";
import { UsersModule } from "./users/users.module.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const imports: any[] = [
  DatabaseModule,
  UsersModule,
  AuthModule,
  ScenesModule,
];

// Serve static files in production (SPA catch-all)
if (process.env.NODE_ENV === "production") {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "client"),
      exclude: ["/api/(.*)", "/auth/(.*)"],
    }),
  );
}

@Module({
  imports,
  controllers: [AppController],
})
export class AppModule {}
