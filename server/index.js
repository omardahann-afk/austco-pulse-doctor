/**
 * Tacera Doctor — Local Diagnostic Agent
 * --------------------------------------
 * Runs on the on-site Ubuntu VM. Provides REAL network tests against the
 * site config the technician enters in the Command Center frontend.
 *
 * Endpoints:
 *   GET  /api/health
 *   POST /api/diagnosis/run   — body: { siteConfig }
 *   POST /api/logs/analyze    — body: { files: [{ name, type, content }] }
 *
 * No defaults. No fake IPs. Empty config => 400 "insufficient_config".
 */

import express from "express";
import cors from "cors";
import os from "node:os";
import { runDiagnosis } from "./lib/diagnose.js";
import { analyzeLogs } from "./lib/logs.js";

const PORT = Number(process.env.PORT || 3001);
const BIND = process.env.BIND_HOST || "0.0.0.0"; // change to 127.0.0.1 for localhost-only

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

function vmInfo() {
  const nics = os.networkInterfaces();
  const addrs = [];
  for (const list of Object.values(nics)) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) addrs.push(a.address);
    }
  }
  return { hostname: os.hostname(), addrs, platform: `${os.type()} ${os.release()}` };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "tacera-doctor-agent", version: "1.0.0", vm: vmInfo(), time: new Date().toISOString() });
});

app.post("/api/diagnosis/run", async (req, res) => {
  try {
    const cfg = req.body?.siteConfig;
    if (!cfg || typeof cfg !== "object") {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "siteConfig is required" });
    }
    const result = await runDiagnosis(cfg, vmInfo());
    res.json(result);
  } catch (err) {
    console.error("diagnosis error:", err);
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.post("/api/logs/analyze", async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, reason: "no_files", message: "Upload or paste at least one log file." });
    }
    const result = analyzeLogs(files, vmInfo());
    res.json(result);
  } catch (err) {
    console.error("logs error:", err);
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.listen(PORT, BIND, () => {
  const v = vmInfo();
  console.log(`[tacera-agent] listening on http://${BIND}:${PORT}`);
  console.log(`[tacera-agent] VM: ${v.hostname}  IPs: ${v.addrs.join(", ") || "(none)"}`);
});
