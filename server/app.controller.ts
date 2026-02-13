import { Controller, Get, Post, Body, Inject, HttpCode } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";
import * as oidcClient from "openid-client";

const OIDC_ISSUER = process.env.OIDC_ISSUER || "https://authelia.grid.local";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || "nib";
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || "";

@Controller()
export class AppController {
  constructor(@Inject(Sequelize) private readonly sequelize: Sequelize) {}

  @Get("api/health")
  async health() {
    let db = "disconnected";
    try {
      await this.sequelize.authenticate();
      db = "connected";
    } catch { /* db stays disconnected */ }

    let oidc = "unreachable";
    try {
      await oidcClient.discovery(new URL(OIDC_ISSUER), OIDC_CLIENT_ID, OIDC_CLIENT_SECRET);
      oidc = "reachable";
    } catch { /* oidc stays unreachable */ }

    return { status: "ok", service: "nib", db, oidc };
  }

  @Post("api/log")
  @HttpCode(204)
  clientLog(@Body() body: { level?: string; message?: string; data?: any }) {
    const level = body.level || "info";
    const message = body.message || "";
    const data = body.data ? ` ${JSON.stringify(body.data)}` : "";
    const prefix = `[client:${level}]`;

    if (level === "error") {
      console.error(prefix, message + data);
    } else if (level === "warn") {
      console.warn(prefix, message + data);
    } else {
      console.log(prefix, message + data);
    }
  }
}
