import { Router, Request, Response } from "express";
import { Scene, User } from "../db.js";
import { validateScene, checkSizeLimit } from "../services/validator.js";
import { requireAuth, optionalAuth } from "../auth/middleware.js";

const router = Router();

// ---------- Validation endpoint (no auth required) ----------

/**
 * POST /api/scenes/validate
 * Body: Excalidraw scene JSON
 * Returns validation result with detailed errors.
 * Does NOT persist anything.
 */
router.post("/validate", (req: Request, res: Response) => {
  const sizeError = checkSizeLimit(
    req.headers["content-length"] ? parseInt(req.headers["content-length"]) : 0,
  );
  if (sizeError) {
    res.status(413).json({ valid: false, errors: [sizeError], elementCount: 0 });
    return;
  }

  const result = validateScene(req.body);
  res.status(result.valid ? 200 : 422).json(result);
});

// ---------- User's scenes (must be before /:id) ----------

/**
 * GET /api/scenes/my
 * List scenes owned by the current user. Requires auth.
 */
router.get("/my", requireAuth, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await Scene.findAndCountAll({
      where: { user_id: req.session.userId },
      order: [["updated_at", "DESC"]],
      limit,
      offset,
      attributes: ["id", "title", "thumbnail", "is_public", "created_at", "updated_at"],
    });

    res.json({
      scenes: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error("Error listing user scenes:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Public gallery ----------

/**
 * GET /api/scenes
 * List public scenes (gallery). Paginated. No auth required.
 * Query: ?page=1&limit=20
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await Scene.findAndCountAll({
      where: { is_public: true },
      order: [["updated_at", "DESC"]],
      limit,
      offset,
      attributes: ["id", "title", "thumbnail", "is_public", "created_at", "updated_at"],
      include: [{ model: User, as: "user", attributes: ["id", "username", "avatar_url"] }],
    });

    res.json({
      scenes: rows,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error("Error listing scenes:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Get single scene ----------

/**
 * GET /api/scenes/:id
 * Get full scene data. Public scenes are accessible to anyone.
 * Private scenes are only accessible to the owner.
 */
router.get("/:id", optionalAuth, async (req: Request, res: Response) => {
  try {
    const scene = await Scene.findByPk(req.params.id, {
      include: [{ model: User, as: "user", attributes: ["id", "username", "avatar_url"] }],
    });

    if (!scene) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }

    // Private scenes: only the owner can view
    if (!scene.is_public && scene.user_id !== req.session.userId) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }

    res.json(scene);
  } catch (err) {
    console.error("Error fetching scene:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Create scene ----------

/**
 * POST /api/scenes
 * Body: { title?, data, is_public? }
 * Creates a new scene after validation. Requires auth.
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, data, is_public } = req.body;

    const validation = validateScene(data);
    if (!validation.valid) {
      res.status(422).json({
        error: "Invalid scene data",
        validation,
      });
      return;
    }

    const scene = await Scene.create({
      title: title || "Untitled",
      data,
      is_public: is_public ?? false,
      user_id: req.session.userId,
    });

    res.status(201).json(scene);
  } catch (err) {
    console.error("Error creating scene:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Update scene ----------

/**
 * PUT /api/scenes/:id
 * Body: { title?, data?, is_public?, thumbnail? }
 * Updates an existing scene. Requires auth + ownership.
 */
router.put("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const scene = await Scene.findByPk(req.params.id);
    if (!scene) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }

    if (scene.user_id !== req.session.userId) {
      res.status(403).json({ error: "Not authorized to modify this scene" });
      return;
    }

    const { title, data, is_public, thumbnail } = req.body;

    if (data !== undefined) {
      const validation = validateScene(data);
      if (!validation.valid) {
        res.status(422).json({
          error: "Invalid scene data",
          validation,
        });
        return;
      }
    }

    await scene.update({
      ...(title !== undefined && { title }),
      ...(data !== undefined && { data }),
      ...(is_public !== undefined && { is_public }),
      ...(thumbnail !== undefined && { thumbnail }),
      updated_at: new Date(),
    });

    res.json(scene);
  } catch (err) {
    console.error("Error updating scene:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Delete scene ----------

/**
 * DELETE /api/scenes/:id
 * Deletes a scene. Requires auth + ownership.
 */
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const scene = await Scene.findByPk(req.params.id);
    if (!scene) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }

    if (scene.user_id !== req.session.userId) {
      res.status(403).json({ error: "Not authorized to delete this scene" });
      return;
    }

    await scene.destroy();
    res.status(204).send();
  } catch (err) {
    console.error("Error deleting scene:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
