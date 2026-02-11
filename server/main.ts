import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import session from "express-session";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Trust reverse proxy (nginx)
  app.set("trust proxy", 1);

  // Session middleware (same config as the Express version)
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "nib-dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      name: "nib.sid",
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    }),
  );

  // Body parsing limit
  app.useBodyParser("json", { limit: "50mb" });

  const PORT = process.env.PORT || 3000;
  await app.listen(PORT);
  console.log(`nib listening on port ${PORT}`);
}

bootstrap();
