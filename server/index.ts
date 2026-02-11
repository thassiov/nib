import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { sequelize } from "./db.js";
import scenesRouter from "./routes/scenes.js";
import authRouter from "./routes/auth.js";

// Import session type augmentation (side-effect only)
import "./auth/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// --- Session ---

app.set("trust proxy", 1); // Trust reverse proxy (nginx)

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

// --- Body parsing ---

app.use(express.json({ limit: "50mb" }));

// --- API routes ---

app.get("/api/health", async (_req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: "ok", service: "nib", db: "connected" });
  } catch {
    res.json({ status: "ok", service: "nib", db: "disconnected" });
  }
});

app.use("/auth", authRouter);
app.use("/api/scenes", scenesRouter);

// --- Static files (production) ---

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(__dirname, "../client");
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

// --- Start ---

async function start() {
  try {
    await sequelize.authenticate();
    console.log("Database connected.");
  } catch (err) {
    console.warn(
      "Database not reachable at startup (will retry on requests):",
      (err as Error).message,
    );
  }

  app.listen(PORT, () => {
    console.log(`nib listening on port ${PORT}`);
  });
}

start();
