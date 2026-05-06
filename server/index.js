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
import http from "node:http";
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
import {
  listServices as listAutopilotServices,
  upsertService as upsertAutopilotService,
  deleteService as deleteAutopilotService,
} from "./lib/autopilotServicesStore.js";
import { collectDeepEvidence, getLatestEvidence, setMockEvidence, clearMockEvidence } from "./lib/deepEvidenceEngine.js";
import { listScenarios, buildScenario } from "./lib/mockEvidenceScenarios.js";
import { startMqttTap, stopMqttTap, getMqttSession, listMqttSessions } from "./lib/evidenceCollectors/mqttTruth.js";
import {
  upsertDevice, listDevices, getDevice, deleteDevice,
  listDeviceStates, getDeviceHistory, getDeviceTrend, openDb, dbInfo,
} from "./lib/healthDb.js";
import {
  startScheduler, stopScheduler, schedulerStatus,
  probeDeviceNow, sweepStale, refreshDevice,
} from "./lib/pollingScheduler.js";
import { icmpProbe } from "./lib/probes/icmpProbe.js";
import { tcpProbe as tcpProbeFn } from "./lib/probes/tcpProbe.js";
import { httpsProbe } from "./lib/probes/httpsProbe.js";
import { mqttConnectProbe } from "./lib/probes/mqttConnectProbe.js";
import { attachWsBus, wsClientCount } from "./lib/wsBus.js";
import multer from "multer";
import { parseCcpZipBuffer, isZipBuffer } from "./lib/ccpZipParser.js";
import { readSiteConfig, writeSiteConfig, siteConfigInfo } from "./lib/siteConfigStore.js";

const PORT = Number(process.env.PORT || 3001);
const BIND = process.env.BIND_HOST || "0.0.0.0"; // change to 127.0.0.1 for localhost-only

// Open the SQLite health store eagerly so first request is fast.
try { openDb(); } catch (err) { console.error("[tacera-agent] healthDb open failed:", err?.message || err); }

// Periodic stale sweep — every 30s. Cheap pass over devices.
const STALE_SWEEP_MS = 30_000;
const _staleTimer = setInterval(() => { try { sweepStale(); } catch {} }, STALE_SWEEP_MS);
if (typeof _staleTimer.unref === "function") _staleTimer.unref();

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

/* ===== AI Evidence Commander =====
 * One endpoint, six modes. Sanitized snapshot in, structured JSON out.
 * Failure is non-blocking: the route ALWAYS returns a usable response object.
 */
app.get("/api/ai/commander/health", async (_req, res) => {
  // Lightweight ping: is the local AI reachable? Times out at 1.5s.
  const endpoint = "http://localhost:11434/api/tags";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(endpoint, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return res.json({ ok: true, available: false, reason: `http_${r.status}` });
    return res.json({ ok: true, available: true });
  } catch (err) {
    clearTimeout(t);
    return res.json({ ok: true, available: false, reason: err?.name === "AbortError" ? "timeout" : "unreachable" });
  }
});

app.post("/api/ai/commander", async (req, res) => {
  try {
    const mode = String(req.body?.mode || "explain_on_site");
    const context = req.body?.context || {};
    const endpoint = req.body?.endpoint;
    const model = req.body?.model;
    if (!COMMANDER_MODES.includes(mode)) {
      return res.status(400).json({
        ok: false,
        reason: "invalid_mode",
        message: `mode must be one of: ${COMMANDER_MODES.join(", ")}`,
        response: buildFallbackResponse(mode, {}, { confidenceWarning: "", safetyWarning: "Deterministic engine remains active." }, "invalid_mode"),
      });
    }
    const r = await runCommander({ mode, context, endpoint, model });
    // Always 200 — caller renders deterministic fallback if ok=false.
    res.json(r);
  } catch (err) {
    res.status(200).json({
      ok: false,
      reason: "agent_error",
      message: err?.message || String(err),
      response: buildFallbackResponse(req.body?.mode, {}, { confidenceWarning: "", safetyWarning: "Deterministic engine remains active." }, "agent_error"),
    });
  }
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

/* ===== Live Monitoring (real probes + polling) =====
 * Foundation phase: real ICMP/TCP/HTTPS/MQTT-connect probes, persistent
 * device registry in SQLite, polling scheduler with reconnect backoff and
 * stale detection. Every result returns an evidence record with source,
 * timestamp, protocol, device, and raw payload.
 */

const ALLOWED_PROTOCOLS = new Set(["icmp", "tcp", "http", "https", "mqtt", "mqtt-fresh", "webmin"]);

function validateDeviceInput(body) {
  const errors = [];
  if (!body || typeof body !== "object") { errors.push("body required"); return { errors }; }
  const id = String(body.id || "").trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(id)) errors.push("id required (alnum . _ : - up to 128 chars)");
  const protocol = String(body.protocol || "").toLowerCase();
  if (!ALLOWED_PROTOCOLS.has(protocol)) errors.push(`protocol must be one of ${[...ALLOWED_PROTOCOLS].join(", ")}`);
  const kind = String(body.kind || "generic");
  if (kind.length > 64) errors.push("kind too long");
  const intervalMs = Number(body.intervalMs || 30000);
  if (!Number.isFinite(intervalMs) || intervalMs < 2000 || intervalMs > 24 * 60 * 60_000) {
    errors.push("intervalMs must be between 2000 and 86400000");
  }
  if (protocol === "https" || protocol === "http") {
    if (!body.url || typeof body.url !== "string") errors.push("url required for http/https");
  } else if (protocol === "mqtt" || protocol === "mqtt-fresh" || protocol === "tcp") {
    if (!body.host) errors.push("host required");
    if (protocol === "tcp" && !Number.isInteger(Number(body.port))) errors.push("port required for tcp");
  } else if (protocol === "icmp" || protocol === "webmin") {
    if (!body.host) errors.push(`host required for ${protocol}`);
  }
  return { errors, id, protocol, kind, intervalMs };
}

app.get("/api/monitor/info", (_req, res) => {
  res.json({ ok: true, db: dbInfo(), scheduler: schedulerStatus(), supportedProtocols: [...ALLOWED_PROTOCOLS] });
});

app.get("/api/monitor/devices", (_req, res) => {
  try { res.json({ ok: true, devices: listDevices() }); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/monitor/devices", (req, res) => {
  const v = validateDeviceInput(req.body);
  if (v.errors.length) return res.status(400).json({ ok: false, reason: "invalid_request", errors: v.errors });
  try {
    const d = upsertDevice({ ...req.body, id: v.id, protocol: v.protocol, kind: v.kind, intervalMs: v.intervalMs });
    refreshDevice(d.id);
    res.json({ ok: true, device: d });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.delete("/api/monitor/devices/:id", (req, res) => {
  try {
    const r = deleteDevice(req.params.id);
    refreshDevice(req.params.id);
    res.json({ ok: true, ...r });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.get("/api/monitor/state", (_req, res) => {
  try { res.json({ ok: true, devices: listDeviceStates() }); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.get("/api/monitor/history/:id", (req, res) => {
  try {
    const d = getDevice(req.params.id);
    if (!d) return res.status(404).json({ ok: false, reason: "device_not_found" });
    const limit = Math.min(2000, Math.max(1, Number(req.query?.limit) || 200));
    res.json({ ok: true, device: d, history: getDeviceHistory(d.id, { limit }), trend: getDeviceTrend(d.id, { limit: Math.min(limit, 200) }) });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/monitor/probe-now/:id", async (req, res) => {
  try {
    const r = await probeDeviceNow(req.params.id);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

/** Ad-hoc probe — does NOT persist, does NOT register the device. Useful for
 *  the UI's "test this host" affordance before the user commits to monitoring it. */
app.post("/api/monitor/probe", async (req, res) => {
  const v = validateDeviceInput({ ...req.body, id: req.body?.id || "adhoc" });
  if (v.errors.length) return res.status(400).json({ ok: false, reason: "invalid_request", errors: v.errors });
  try {
    const device = { ...req.body, id: v.id, protocol: v.protocol };
    let evidence;
    switch (v.protocol) {
      case "icmp": evidence = await icmpProbe(device); break;
      case "tcp":  evidence = await tcpProbeFn(device); break;
      case "http":
      case "https": evidence = await httpsProbe(device); break;
      case "mqtt": evidence = await mqttConnectProbe(device); break;
      case "mqtt-fresh": {
        const { mqttFreshnessProbe } = await import("./lib/probes/mqttFreshnessProbe.js");
        evidence = await mqttFreshnessProbe(device); break;
      }
      case "webmin": {
        const { webminProbe } = await import("./lib/probes/webminProbe.js");
        evidence = await webminProbe(device); break;
      }
      default: return res.status(400).json({ ok: false, reason: "unsupported_protocol" });
    }
    res.json({ ok: true, evidence });
  } catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/monitor/start", (req, res) => {
  try { res.json(startScheduler(req.body || {})); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.post("/api/monitor/stop", (_req, res) => {
  try { res.json(stopScheduler()); }
  catch (err) { res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) }); }
});

app.get("/api/monitor/status", (_req, res) => {
  res.json({ ok: true, ...schedulerStatus() });
});

app.get("/api/monitor/ws-info", (_req, res) => {
  res.json({ ok: true, path: "/ws/monitor", clients: wsClientCount() });
});

/* ------------------------------------------------------------------ */
/* CCP ZIP parsing — accepts a real Austco/IPConnect .ccp file        */
/* (a ZIP archive) and returns the structured manifest. Local-only.   */
/* ------------------------------------------------------------------ */
const ccpUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.post("/api/ccp/parse", ccpUpload.single("file"), (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ ok: false, reason: "no_file", message: "Upload a .ccp file in the 'file' form field." });
    const buf = req.file.buffer;
    const filename = req.file.originalname || "upload.ccp";
    if (!isZipBuffer(buf)) {
      return res.json({
        ok: true,
        result: {
          parserStatus: "parse_failed",
          fileType: "ccp",
          filename,
          archive: { isZip: false, internalFileCount: 0, xmlFileCount: 0, files: [] },
          plugins: [], endpoints: [], controllers: [], devices: [], rooms: [], zones: [],
          warnings: ["File is not a ZIP archive (no PK magic). Try the text parser for .cnfg."],
          unknown: [],
        },
      });
    }
    const result = parseCcpZipBuffer(buf, { filename });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

/* ------------------------------------------------------------------ */
/* Site Config — persistent JSON store backing the global Zustand     */
/* store on the frontend. Phase 7A.                                   */
/* ------------------------------------------------------------------ */
app.get("/api/site-config", (_req, res) => {
  try {
    const config = readSiteConfig();
    res.json({ ok: true, config: config || null, info: siteConfigInfo() });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

app.put("/api/site-config", (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "JSON body required" });
    }
    const info = writeSiteConfig(req.body);
    res.json({ ok: true, info });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

// Convenience POST alias — same as PUT (replaces full config).
app.post("/api/site-config", (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ ok: false, reason: "invalid_request", message: "JSON body required" });
    }
    const info = writeSiteConfig(req.body);
    res.json({ ok: true, info });
  } catch (err) {
    res.status(500).json({ ok: false, reason: "agent_error", message: err?.message || String(err) });
  }
});

const httpServer = http.createServer(app);
attachWsBus(httpServer, { path: "/ws/monitor" });
httpServer.listen(PORT, BIND, () => {
  const v = vmInfo();
  console.log(`[tacera-agent] listening on http://${BIND}:${PORT}`);
  console.log(`[tacera-agent] ws bus on    ws://${BIND}:${PORT}/ws/monitor`);
  console.log(`[tacera-agent] VM: ${v.hostname}  IPs: ${v.addrs.join(", ") || "(none)"}`);
});
