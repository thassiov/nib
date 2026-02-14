/**
 * Shared test helpers: Nest app factory via TestingModule, fixtures, session helpers.
 */
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { SequelizeModule, getConnectionToken } from "@nestjs/sequelize";
import session from "express-session";
import express from "express";
import { Sequelize } from "sequelize-typescript";
import { UserModel } from "../database/models/user.model.js";
import { SceneModel } from "../database/models/scene.model.js";
import { AuthModule } from "../auth/auth.module.js";
import { ScenesModule } from "../scenes/scenes.module.js";
import { UsersModule } from "../users/users.module.js";
import { AppController } from "../app.controller.js";
import { MetricsModule } from "../metrics/metrics.module.js";

/**
 * Creates a NestJS test application backed by a fresh SQLite in-memory DB.
 * Each test app gets its own Sequelize connection with tables synced.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      SequelizeModule.forRoot({
        dialect: "sqlite",
        storage: ":memory:",
        logging: false,
        models: [UserModel, SceneModel],
        synchronize: true, // Auto-create tables
      }),
      SequelizeModule.forFeature([UserModel, SceneModel]),
      UsersModule,
      AuthModule,
      ScenesModule,
      MetricsModule,
    ],
    controllers: [AppController],
  }).compile();

  const app = moduleRef.createNestApplication();

  // Session middleware (same as production — saveUninitialized: true for anonymous session tracking)
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
      name: "nib.sid",
    }),
  );

  app.use(express.json({ limit: "50mb" }));

  // Enable foreign keys in SQLite and sync tables
  const sequelize = moduleRef.get<Sequelize>(getConnectionToken());
  await sequelize.query("PRAGMA foreign_keys = ON;");
  await sequelize.sync({ force: true });

  await app.init();
  return app;
}

/**
 * Creates a NestJS test application with a pre-authenticated session.
 * Injects fake auth middleware before the Nest routes.
 */
export async function createAuthenticatedTestApp(
  sessionData: { userId: string; sub?: string; username?: string; role?: string },
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      SequelizeModule.forRoot({
        dialect: "sqlite",
        storage: ":memory:",
        logging: false,
        models: [UserModel, SceneModel],
        synchronize: true,
      }),
      SequelizeModule.forFeature([UserModel, SceneModel]),
      UsersModule,
      AuthModule,
      ScenesModule,
      MetricsModule,
    ],
    controllers: [AppController],
  }).compile();

  const app = moduleRef.createNestApplication();

  // Session middleware
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
      name: "nib.sid",
    }),
  );

  // Inject fake auth session data
  app.use((req: any, _res: any, next: any) => {
    if (req.session) {
      req.session.userId = sessionData.userId;
      req.session.sub = sessionData.sub || "test-sub";
      req.session.username = sessionData.username || "testuser";
      req.session.role = sessionData.role || "user";
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));

  // Enable foreign keys in SQLite and sync tables
  const sequelize = moduleRef.get<Sequelize>(getConnectionToken());
  await sequelize.query("PRAGMA foreign_keys = ON;");
  await sequelize.sync({ force: true });

  await app.init();
  return app;
}

/** Minimal valid Excalidraw scene for testing */
export const VALID_SCENE = {
  elements: [
    {
      id: "rect1",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    },
  ],
  appState: {},
  files: {},
};

/** Scene with a text element */
export const VALID_TEXT_SCENE = {
  elements: [
    {
      id: "text1",
      type: "text",
      x: 10,
      y: 10,
      width: 200,
      height: 24,
      text: "Hello",
      fontSize: 20,
    },
  ],
  appState: {},
  files: {},
};
