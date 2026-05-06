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
import { testSshAuth, pullLogs } from "./lib/ssh.js";
import { diagnoseService, runServiceDiagnosis } from "./lib/services.js";
import { explainWithOllama } from "./lib/ollamaExplain.js";
import { explainPlan as aiExplainPlan, explainExecution as aiExplainExecution } from "./lib/autopilotAi.js";
import { runCommander, COMMANDER_MODES, buildFallbackResponse } from "./lib/aiCommander.js";
import { buildTraceResult } from "./lib/traceEngine.js";
import {
  runScan as autopilotScan,
  startLoop as autopilotStart,
  stopLoop as autopilotStop,
  getStatus as autopilotStatus,
  getPlan as autopilotGetPlan,
  executeActions as autopilotExecute,
  runReadOnlyChecks as autopilotReadOnly,
} from "./lib/autopilotEngine.js";
import { listRecentPlans } from "./lib/autopilotStore.js";
import { collectDeepEvidence, getLatestEvidence, setMockEvidence, clearMockEvidence } from "./lib/deepEvidenceEngine.js";
import { listScenarios, buildScenario } from "./lib/mockEvidenceScenarios.js";
import { startMqttTap, stopMqttTap, getMqttSession, listMqttSessions } from "./lib/evidenceCollectors/mqttTruth.js";

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

/* ===== SSH / service-driven endpoints ===== */

app.post("/api/ssh/test", async (req, res) => {
  try {
    const { host, port = 22, username, password } = req.body || {};
    if (!host || !username) return res.status(400).json({ ok: false, reason: "invalid_request", message: "host and username are required" });
    const r = await testSshAuth({ host, port, username, password: password || "" });
    res.json({ ...r, host, port: Number(port) || 22, username, at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.post("/api/ssh/pull-logs", async (req, res) => {
  try {
    const { host, port = 22, username, password, paths = [] } = req.body || {};
    if (!host || !username) return res.status(400).json({ ok: false, reason: "invalid_request", message: "host and username are required" });
    if (!Array.isArray(paths) || paths.length === 0) return res.status(400).json({ ok: false, reason: "no_paths", message: "paths must be a non-empty array" });
    const r = await pullLogs({ host, port, username, password: password || "" }, paths);
    res.json({ ...r, host, port: Number(port) || 22, at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.post("/api/services/diagnose-one", async (req, res) => {
  try {
    const svc = req.body?.service;
    if (!svc) return res.status(400).json({ ok: false, reason: "invalid_request", message: "service is required" });
    const r = await diagnoseService(svc);
    res.json({ ok: true, vm: vmInfo(), service: r });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.post("/api/services/diagnose", async (req, res) => {
  try {
    const services = Array.isArray(req.body?.services) ? req.body.services : [];
    const r = await runServiceDiagnosis(services, vmInfo());
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.post("/api/ai/explain", async (req, res) => {
  try {
    const { diagnosis, endpoint, model } = req.body || {};
    if (!diagnosis) {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "diagnosis is required" });
    }
    const r = await explainWithOllama({ diagnosis, endpoint, model });
    res.json(r);
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

/* ===== Trace Signal Path ===== */

app.post("/api/trace/run", async (req, res) => {
  try {
    const { target, siteConfig, services } = req.body || {};
    if (!target) {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "target is required" });
    }
    // If services array provided, run live diagnosis to produce serviceResults.
    // Otherwise, accept already-computed serviceResults via body.serviceResults.
    let serviceResults = Array.isArray(req.body?.serviceResults) ? req.body.serviceResults : [];
    if (serviceResults.length === 0 && Array.isArray(services) && services.length > 0) {
      const r = await runServiceDiagnosis(services, vmInfo());
      if (r?.ok) serviceResults = r.services || [];
    }
    const trace = buildTraceResult({
      target,
      siteConfig: siteConfig || {},
      serviceResults,
      deviceResults: Array.isArray(req.body?.deviceResults) ? req.body.deviceResults : [],
      deepEvidence: getLatestEvidence(),
    });
    if (!trace.ok) return res.status(400).json(trace);
    res.json({ ...trace, vm: vmInfo() });
  } catch (err) {
    console.error("trace error:", err);
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

/* ===== Autopilot ===== */

app.get("/api/autopilot/status", (_req, res) => {
  try { res.json(autopilotStatus()); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/scan", async (req, res) => {
  try {
    const services = Array.isArray(req.body?.services) ? req.body.services : [];
    const siteOverrides = req.body?.siteOverrides || {};
    const r = await autopilotScan({ services, vmInfo: vmInfo(), siteOverrides });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/start", (req, res) => {
  try {
    const services = Array.isArray(req.body?.services) ? req.body.services : [];
    const siteOverrides = req.body?.siteOverrides || {};
    const intervalMs = Number(req.body?.intervalMs) || 60_000;
    const r = autopilotStart({ services, vmInfo: vmInfo(), siteOverrides, intervalMs });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/stop", (_req, res) => {
  try { res.json(autopilotStop()); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/plan", (req, res) => {
  try {
    const planId = String(req.body?.planId || "");
    if (!planId) return res.status(400).json({ ok: false, reason: "invalid_request", message: "planId required" });
    const plan = autopilotGetPlan(planId);
    if (!plan) return res.status(404).json({ ok: false, reason: "plan_not_found" });
    res.json({ ok: true, plan });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

/**
 * Read-only list of recently generated plans. Used by the Evidence Playback
 * Timeline to correlate "which Autopilot plan was generated from this
 * contradiction". Plans are already redacted by autopilotStore.
 */
app.get("/api/autopilot/plans", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
    res.json({ ok: true, plans: listRecentPlans(limit) });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/execute", async (req, res) => {
  try {
    const { planId, actionIds, password, acknowledged, approvalConfirmed } = req.body || {};
    if (!planId) return res.status(400).json({ ok: false, reason: "invalid_request", message: "planId required" });
    const ack = Boolean(acknowledged) || Boolean(approvalConfirmed);
    const r = await autopilotExecute({ planId, actionIds, password, acknowledged: ack });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/verify", async (req, res) => {
  try {
    const { planId, password } = req.body || {};
    if (!planId) return res.status(400).json({ ok: false, reason: "invalid_request", message: "planId required" });
    const r = await autopilotReadOnly({ planId, password });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/rollback", (_req, res) => {
  // No automatic rollbacks in v1 — rollback for service restarts is "do nothing".
  res.json({ ok: false, reason: "not_implemented", message: "Automatic rollback is not implemented. Restart actions have no rollback. Configuration changes are HIGH risk and remain manual." });
});

/* ===== Autopilot AI Copilot (explanation only — never executes) ===== */

app.post("/api/autopilot/explain-plan", async (req, res) => {
  try {
    const { planId, endpoint, model } = req.body || {};
    if (!planId) return res.status(400).json({ ok: false, reason: "invalid_request", message: "planId required" });
    const plan = autopilotGetPlan(String(planId));
    if (!plan) return res.status(404).json({ ok: false, reason: "plan_not_found" });
    const r = await aiExplainPlan({ plan, endpoint, model });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/autopilot/explain-execution", async (req, res) => {
  try {
    const { planId, report, endpoint, model } = req.body || {};
    if (!report || typeof report !== "object") {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "report required" });
    }
    const plan = planId ? autopilotGetPlan(String(planId)) : null;
    const r = await aiExplainExecution({ report, plan, endpoint, model });
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

/* ===== Deep Evidence Layer ===== */

app.post("/api/evidence/collect", async (req, res) => {
  try {
    const { siteConfig = {}, services = [], mqttSessionId = null, recentLogFindings = [] } = req.body || {};
    const r = await collectDeepEvidence({ siteConfig, services, mqttSessionId, recentLogFindings });
    res.json({ ok: true, evidence: r });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.get("/api/evidence/latest", (_req, res) => {
  const r = getLatestEvidence();
  if (!r) return res.json({ ok: false, reason: "no_evidence", message: "No evidence collected yet." });
  res.json({ ok: true, evidence: r });
});

app.post("/api/evidence/mqtt/start", async (req, res) => {
  try {
    const r = await startMqttTap(req.body || {});
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/evidence/mqtt/stop", (req, res) => {
  const sessionId = String(req.body?.sessionId || "");
  if (!sessionId) return res.status(400).json({ ok: false, reason: "invalid_request", message: "sessionId required" });
  res.json(stopMqttTap(sessionId));
});

app.get("/api/evidence/mqtt/events", (req, res) => {
  const sessionId = String(req.query?.sessionId || "");
  if (!sessionId) return res.json({ ok: true, sessions: listMqttSessions() });
  const s = getMqttSession(sessionId);
  if (!s) return res.status(404).json({ ok: false, reason: "session_not_found" });
  res.json({ ok: true, session: s });
});

/* ===== Deep Evidence — DEV MOCK scenarios =====
 * These endpoints inject synthetic evidence for QA. The cache is marked
 * `mock: true` so Autopilot refuses to execute against it.
 */
app.get("/api/evidence/mock/scenarios", (_req, res) => {
  res.json({ ok: true, scenarios: listScenarios() });
});

app.post("/api/evidence/mock/set", (req, res) => {
  try {
    const id = String(req.body?.scenarioId || "");
    if (!id) return res.status(400).json({ ok: false, reason: "invalid_request", message: "scenarioId required" });
    const evidence = buildScenario(id);
    const stored = setMockEvidence(evidence);
    res.json({ ok: true, evidence: stored });
  } catch (err) {
    res.status(400).json({ ok: false, reason: "scenario_error", message: err?.message || String(err) });
  }
});

app.post("/api/evidence/mock/clear", (_req, res) => {
  res.json(clearMockEvidence());
});

app.listen(PORT, BIND, () => {
  const v = vmInfo();
  console.log(`[tacera-agent] listening on http://${BIND}:${PORT}`);
  console.log(`[tacera-agent] VM: ${v.hostname}  IPs: ${v.addrs.join(", ") || "(none)"}`);
});
