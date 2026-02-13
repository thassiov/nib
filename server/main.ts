import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Trust reverse proxy (nginx)
  app.set("trust proxy", 1);

  // Session store: PostgreSQL in production, in-memory for dev/test
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "nib-dev-secret-change-me",
    resave: false,
    saveUninitialized: true,
    name: "nib.sid",
    cookie: {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  };

  if (process.env.DB_HOST) {
    const PgStore = connectPgSimple(session);
    const pool = new pg.Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "nib",
      user: process.env.DB_USER || "nib",
      password: process.env.DB_PASS,
    });
    sessionConfig.store = new PgStore({
      pool,
      createTableIfMissing: true,
    });
    console.log("Session store: PostgreSQL");
  } else {
    console.log("Session store: in-memory (no DB_HOST set)");
  }

  app.use(session(sessionConfig));

  // Body parsing limit
  app.useBodyParser("json", { limit: "50mb" });

  const PORT = process.env.PORT || 3000;
  await app.listen(PORT);
  console.log(`nib listening on port ${PORT}`);
}

bootstrap();
