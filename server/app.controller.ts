import { Controller, Get, Inject } from "@nestjs/common";
import { Sequelize } from "sequelize-typescript";

@Controller()
export class AppController {
  constructor(@Inject(Sequelize) private readonly sequelize: Sequelize) {}

  @Get("api/health")
  async health() {
    try {
      await this.sequelize.authenticate();
      return { status: "ok", service: "nib", db: "connected" };
    } catch {
      return { status: "ok", service: "nib", db: "disconnected" };
    }
  }
}
