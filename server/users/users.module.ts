import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { UserModel } from "../database/models/user.model.js";
import { UsersService } from "./users.service.js";
import { UsersRepository } from "./users.repository.js";

@Module({
  imports: [SequelizeModule.forFeature([UserModel])],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
