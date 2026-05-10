/**
 * Site Config Store (Phase 7A — backend)
 * ---------------------------------------
 * Persistent JSON store for the global site config. Atomic writes via
 * tmp-file + rename. Free-form shape — the agent does not validate the
 * structure beyond "must be a JSON object". Validation lives client-side.
 *
 * Default path: server/data/site-config.json (override via SITE_CONFIG_PATH).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = process.env.SITE_CONFIG_PATH ||
  path.resolve(__dirname, "..", "data", "site-config.json");

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readSiteConfig(filePath = DEFAULT_PATH) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : null;
  } catch (err) {
    return { _readError: err?.message || String(err) };
  }
}

export function writeSiteConfig(config, filePath = DEFAULT_PATH) {
  if (!config || typeof config !== "object") {
    throw new Error("config must be a JSON object");
  }
  ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
  return { path: filePath, bytes: fs.statSync(filePath).size, savedAt: new Date().toISOString() };
}

export function siteConfigInfo(filePath = DEFAULT_PATH) {
  let exists = false, size = 0, mtime = null;
  try {
    const st = fs.statSync(filePath);
    exists = true; size = st.size; mtime = st.mtime.toISOString();
  } catch {}
  return { path: filePath, exists, size, mtime };
}