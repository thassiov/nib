import { Injectable, Inject } from "@nestjs/common";
import { UsersRepository } from "./users.repository.js";
import { UserModel } from "../database/models/user.model.js";

@Injectable()
export class UsersService {
  constructor(@Inject(UsersRepository) private readonly usersRepository: UsersRepository) {}

  async upsert(data: {
    sub: string;
    username: string;
    email: string | null;
    avatar_url: string | null;
    role: string;
  }): Promise<UserModel> {
    return this.usersRepository.upsert(data);
  }

  async findById(id: string): Promise<UserModel | null> {
    return this.usersRepository.findById(id);
  }

  async findBySub(sub: string): Promise<UserModel | null> {
    return this.usersRepository.findBySub(sub);
  }
}
