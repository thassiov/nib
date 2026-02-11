import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Inject,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { ScenesService } from "./scenes.service.js";
import { AuthGuard } from "../auth/guards/auth.guard.js";
import { OptionalAuthGuard } from "../auth/guards/optional-auth.guard.js";

@Controller("api/scenes")
export class ScenesController {
  constructor(@Inject(ScenesService) private readonly scenesService: ScenesService) {}

  /**
   * POST /api/scenes/validate
   * Validates scene data without persisting.
   */
  @Post("validate")
  @HttpCode(HttpStatus.OK)
  validate(@Body() body: any, @Req() req: Request) {
    const contentLength = req.headers["content-length"]
      ? parseInt(req.headers["content-length"])
      : 0;

    const result = this.scenesService.validate(body, contentLength);
    // Return 413 for size errors, 422 for validation errors, 200 for valid
    return result;
  }

  /**
   * GET /api/scenes/my
   * List scenes owned by the current user. Requires auth.
   */
  @Get("my")
  @UseGuards(AuthGuard)
  async listMine(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Req() req?: Request,
  ) {
    const session = (req as any).session;
    const p = Math.max(1, parseInt(page || "") || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit || "") || 20));

    return this.scenesService.list({
      filter: "mine",
      userId: session.userId,
      page: p,
      limit: l,
    });
  }

  /**
   * GET /api/scenes
   * List public scenes (gallery). Paginated.
   */
  @Get()
  async listPublic(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const p = Math.max(1, parseInt(page || "") || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit || "") || 20));

    return this.scenesService.list({
      filter: "public",
      page: p,
      limit: l,
    });
  }

  /**
   * GET /api/scenes/:id
   * Get full scene data. Respects visibility rules.
   */
  @Get(":id")
  @UseGuards(OptionalAuthGuard)
  async findOne(@Param("id") id: string, @Req() req: Request) {
    const session = (req as any).session;
    return this.scenesService.findById(id, session?.userId);
  }

  /**
   * POST /api/scenes/upload
   * Upload an .excalidraw file, validate, and create a scene.
   * Works with or without authentication:
   *   - Authenticated: user_id = session user, is_public defaults to false
   *   - Anonymous: user_id = null, is_public defaults to true
   * Accepts multipart form with:
   *   - file: the .excalidraw file (required)
   *   - title: scene title (optional, defaults to filename or "Untitled")
   *   - is_public: "true"/"false" (optional, overrides default)
   */
  @Post("upload")
  @UseInterceptors(FileInterceptor("file", {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req: any, file: any, cb: any) => {
      // Accept .excalidraw and .json files, or application/json and application/octet-stream
      const allowedMimes = ["application/json", "application/octet-stream"];
      const allowedExts = [".excalidraw", ".json"];
      const ext = file.originalname?.toLowerCase().slice(file.originalname.lastIndexOf("."));
      if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new BadRequestException(`Invalid file type: ${file.mimetype}. Expected .excalidraw or .json file`), false);
      }
    },
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { title?: string; is_public?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!file) {
      res.status(400).json({ error: "No file provided. Send a multipart form with a 'file' field." });
      return;
    }

    // Parse file content as JSON
    let sceneData: unknown;
    try {
      sceneData = JSON.parse(file.buffer.toString("utf-8"));
    } catch {
      res.status(400).json({ error: "File is not valid JSON" });
      return;
    }

    const session = (req as any).session;
    const userId: string | undefined = session?.userId;
    const isAuthenticated = !!userId;

    const title = body.title || file.originalname?.replace(/\.(excalidraw|json)$/i, "") || "Untitled";

    // Determine is_public: explicit form value wins, otherwise default based on auth
    let isPublic: boolean;
    if (body.is_public !== undefined) {
      isPublic = body.is_public === "true";
    } else {
      // Anonymous uploads default to public; authenticated uploads default to private
      isPublic = !isAuthenticated;
    }

    const result = await this.scenesService.create(
      { title, data: sceneData as object, is_public: isPublic },
      userId,
    );

    if (result.validation) {
      res.status(422).json({
        error: "Invalid scene data",
        validation: result.validation,
      });
      return;
    }

    res.status(201).json(result.scene);
  }

  /**
   * POST /api/scenes
   * Create a new scene. Requires auth.
   */
  @Post()
  @UseGuards(AuthGuard)
  async create(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const session = (req as any).session;
    const { title, data, is_public } = body;

    const result = await this.scenesService.create(
      { title, data, is_public },
      session.userId,
    );

    if (result.validation) {
      res.status(422).json({
        error: "Invalid scene data",
        validation: result.validation,
      });
      return;
    }

    res.status(201).json(result.scene);
  }

  /**
   * PUT /api/scenes/:id
   * Update an existing scene. Requires auth + ownership.
   */
  @Put(":id")
  @UseGuards(AuthGuard)
  async update(
    @Param("id") id: string,
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const session = (req as any).session;
    const { title, data, is_public, thumbnail } = body;

    const result = await this.scenesService.update(
      id,
      { title, data, is_public, thumbnail },
      session.userId,
    );

    if (result.validation) {
      res.status(422).json({
        error: "Invalid scene data",
        validation: result.validation,
      });
      return;
    }

    res.json(result.scene);
  }

  /**
   * DELETE /api/scenes/:id
   * Delete a scene. Requires auth + ownership.
   */
  @Delete(":id")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: Request) {
    const session = (req as any).session;
    await this.scenesService.delete(id, session.userId);
  }
}
