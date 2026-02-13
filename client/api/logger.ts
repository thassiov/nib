/**
 * Client-side logger that mirrors logs to the server via POST /api/log.
 * Logs appear in `docker compose logs` alongside server output.
 *
 * Enabled by default. Toggle via logger.setEnabled(false) or the UI.
 * State persisted in localStorage under "nib:remote-logging".
 *
 * Usage:
 *   import { logger } from "./api/logger";
 *   logger.info("Scene saved", { id: "abc" });
 *   logger.error("Save failed", { status: 500 });
 */

const STORAGE_KEY = "nib:remote-logging";

function readEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

let enabled = readEnabled();
const listeners = new Set<(enabled: boolean) => void>();

function send(level: string, message: string, data?: any) {
  if (!enabled) return;

  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, message, ...(data !== undefined && { data }) }),
  }).catch(() => {
    // Silently ignore — logging should never break the app
  });
}

export const logger = {
  info: (message: string, data?: any) => send("info", message, data),
  warn: (message: string, data?: any) => send("warn", message, data),
  error: (message: string, data?: any) => send("error", message, data),

  isEnabled: () => enabled,

  setEnabled: (value: boolean) => {
    enabled = value;
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch { /* ignore */ }
    listeners.forEach((fn) => fn(value));
  },

  /** Subscribe to enable/disable changes. Returns unsubscribe function. */
  onToggle: (fn: (enabled: boolean) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
