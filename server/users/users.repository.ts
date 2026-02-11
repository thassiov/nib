import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { UserModel } from "../database/models/user.model.js";

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(UserModel)
    private readonly userModel: typeof UserModel,
  ) {}

  /**
   * Find or create a user by OIDC subject. Updates username/email/avatar on each login.
   */
  async upsert(data: {
    sub: string;
    username: string;
    email: string | null;
    avatar_url: string | null;
  }): Promise<UserModel> {
    const [user] = await this.userModel.upsert(data);
    return user;
  }

  async findById(id: string): Promise<UserModel | null> {
    return this.userModel.findByPk(id);
  }

  async findBySub(sub: string): Promise<UserModel | null> {
    return this.userModel.findOne({ where: { sub } });
  }
}
