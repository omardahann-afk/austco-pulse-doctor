/**
 * server.js — Pulse Doctor Backend
 *
 * Port: 3030
 * 
 * Endpoints:
 *   POST /api/agent/ingest          ← agents POST here
 *   GET  /api/dashboard             ← frontend polls this
 *   GET  /api/appliance/:ip         ← click detail for one appliance
 *   GET  /api/appliance/:ip/repair  ← get repair plan
 *   POST /api/appliance/:ip/repair/run  ← execute a repair step
 *   POST /api/appliance/:ip/repair/verify ← verify fix worked
 *   POST /api/system/sweep          ← active SSH sweep
 */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { normalizeAgentPayload } from './engines/evidenceNormalizer.js';
import { applianceStore } from './engines/applianceState.js';
import { getRepairPlan } from './engines/repairEngine.js';
import { sweepAcsServer } from './lib/taceraSystemCollector.js';
import { execOverSsh } from './lib/sshExecutor.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Agent ingestion ──────────────────────────────────────────────────────────

/**
 * POST /api/agent/ingest
 * Agents POST raw telemetry here.
 * We normalize it, run causal analysis, update appliance state.
 */
app.post('/api/agent/ingest', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.ip) {
      return res.status(400).json({ ok: false, reason: 'missing_ip' });
    }

    // Normalize raw blobs → structured events
    const normalized = normalizeAgentPayload(payload);

    // Update appliance state with new evidence
    applianceStore.ingest(
      payload.ip,
      payload.role || 'unknown',
      normalized.events,
    );

    res.json({
      ok: true,
      ip: payload.ip,
      eventsExtracted: normalized.events.length,
      summary: normalized.summary,
    });
  } catch (err) {
    console.error('ingest error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Legacy endpoints — redirect to new ingest
app.post('/api/agent/report', (req, res) => {
  req.url = '/api/agent/ingest';
  app.handle(req, res);
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * GET /api/dashboard
 * Returns all appliance states for the single-screen operational view.
 * This is the ONLY thing the frontend needs to render the main screen.
 */
app.get('/api/dashboard', (_req, res) => {
  try {
    const appliances = applianceStore.getAllStates();
    const blastRadius = applianceStore.getBlastRadius();

    // Overall system health
    const criticalCount = appliances.filter(a => a.health === 'CRITICAL').length;
    const degradedCount = appliances.filter(a => a.health === 'DEGRADED').length;
    const systemHealth = criticalCount > 0 ? 'CRITICAL' : degradedCount > 0 ? 'DEGRADED' : 'OK';

    res.json({
      ok: true,
      systemHealth,
      criticalCount,
      degradedCount,
      totalAppliances: appliances.length,
      blastRadius,
      appliances,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Appliance detail ─────────────────────────────────────────────────────────

/**
 * GET /api/appliance/:ip
 * Full detail for one appliance — shown when user clicks a tile.
 */
app.get('/api/appliance/:ip', (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const state = applianceStore.getState(ip);
  if (!state) return res.status(404).json({ ok: false, reason: 'not_found' });
  res.json({ ok: true, appliance: state });
});

/**
 * GET /api/appliance/:ip/repair
 * Get the repair plan for an appliance's current root cause.
 */
app.get('/api/appliance/:ip/repair', (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const state = applianceStore.getState(ip);
  if (!state) return res.status(404).json({ ok: false, reason: 'not_found' });
  if (!state.rootCauseType) {
    return res.json({ ok: true, plan: { title: 'No active issue detected', steps: [] } });
  }
  const plan = getRepairPlan(state.rootCauseType, { ip, role: state.role });
  res.json({ ok: true, plan });
});

/**
 * POST /api/appliance/:ip/repair/run
 * Execute a single repair step via SSH.
 * Body: { stepIndex, sshCreds: { host, username, password }, approved }
 */
app.post('/api/appliance/:ip/repair/run', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const { stepIndex, sshCreds, approved = false } = req.body || {};

  const state = applianceStore.getState(ip);
  if (!state || !state.rootCauseType) {
    return res.status(404).json({ ok: false, reason: 'no_active_issue' });
  }

  const plan = getRepairPlan(state.rootCauseType);
  const step = plan.steps?.[stepIndex];
  if (!step) return res.status(400).json({ ok: false, reason: 'invalid_step' });

  // Manual-only steps
  if (step.risk === 'MANUAL' || !step.cmd) {
    return res.json({
      ok: true,
      blocked: true,
      reason: 'MANUAL_STEP',
      instruction: step.instruction || step.label,
    });
  }

  // Medium risk requires approval
  if (step.risk === 'MEDIUM' && !approved) {
    return res.json({
      ok: false,
      blocked: true,
      reason: 'REQUIRES_APPROVAL',
      label: step.label,
      command: step.cmd,
    });
  }

  if (!sshCreds?.host && !sshCreds?.username) {
    return res.status(400).json({ ok: false, reason: 'no_ssh_creds' });
  }

  try {
    const result = await execOverSsh(sshCreds || { host: ip, username: 'tech' }, step.cmd);
    res.json({
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout?.slice(0, 4096),
      stderr: result.stderr?.slice(0, 1024),
      command: step.cmd,
      durationMs: result.durationMs,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/appliance/:ip/repair/verify
 * Run the verify command for the current repair plan.
 */
app.post('/api/appliance/:ip/repair/verify', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const { sshCreds } = req.body || {};

  const state = applianceStore.getState(ip);
  if (!state?.rootCauseType) return res.status(404).json({ ok: false, reason: 'no_active_issue' });

  const plan = getRepairPlan(state.rootCauseType);
  if (!plan.verifyCmd) return res.json({ ok: true, verified: null, note: 'No verify command for this issue type' });

  try {
    const result = await execOverSsh(sshCreds || { host: ip, username: 'tech' }, plan.verifyCmd);
    const passed = result.ok && result.stdout?.match(plan.verifyExpect);

    if (passed) {
      // Clear the appliance evidence so it goes green
      applianceStore.clearAppliance(ip);
    }

    res.json({
      ok: true,
      verified: !!passed,
      stdout: result.stdout?.slice(0, 1024),
      message: passed ? '✓ Fix verified — appliance cleared' : '✗ Issue still present',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Active SSH sweep ─────────────────────────────────────────────────────────

/**
 * POST /api/system/sweep
 * Actively SSH into a server and run the full system collector.
 * Injects findings back into the appliance store.
 */
app.post('/api/system/sweep', async (req, res) => {
  const { sshCreds, serverConfig = {} } = req.body || {};
  if (!sshCreds?.host || !sshCreds?.username) {
    return res.status(400).json({ ok: false, reason: 'missing_ssh_creds' });
  }
  try {
    const result = await sweepAcsServer(sshCreds, serverConfig);
    if (result.ok && result.findings.length) {
      // Convert sweep findings into agent-style events and ingest
      const events = result.findings.map(f => ({
        type: f.id,
        severity: f.severity,
        weight: f.severity === 'CRITICAL' ? 90 : f.severity === 'HIGH' ? 70 : 40,
        layer: 'system',
        component: 'sweep',
        source: 'active_sweep',
        timestamp: new Date().toISOString(),
        raw: f.title + (f.detail ? ' — ' + f.detail : ''),
        host: result.hostname,
        ip: sshCreds.host,
        role: serverConfig.role || 'integration_server',
      }));
      applianceStore.ingest(sshCreds.host, serverConfig.role || 'integration_server', events);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Legacy endpoints (keep existing agents working) ─────────────────────────

app.get('/api/agent/summary', (_req, res) => {
  res.json({ ok: true, appliances: applianceStore.getAllStates() });
});

app.post('/api/agent/evidence', (req, res) => {
  const { ip } = req.body || {};
  const state = ip ? applianceStore.getState(ip) : null;
  res.json({ ok: true, state });
});

app.get('/api/causal-root-cause', (_req, res) => {
  const states = applianceStore.getAllStates();
  const worst = states.find(s => s.health === 'CRITICAL') || states[0];
  res.json({ ok: true, appliance: worst });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3030;
app.listen(PORT, () => {
  console.log(`Pulse Doctor backend running on port ${PORT}`);
});

export default app;

// ─── Groq AI endpoints ────────────────────────────────────────────────────────

import { getAiExplanation, groqRepairPlan } from './engines/groqEngine.js';
import { getCredentials } from './sshCredentials.js';

/**
 * POST /api/ai/explain/:ip
 * Get AI explanation for an appliance's current issue.
 * Called automatically when a tile turns red, or on demand.
 */
app.post('/api/ai/explain/:ip', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const state = applianceStore.getState(ip);

  if (!state || state.health === 'OK' || state.health === 'UNKNOWN') {
    return res.json({ ok: true, explanation: null, reason: 'no_active_issue' });
  }

  try {
    const result = await getAiExplanation({
      rootCauseType: state.rootCauseType,
      rootCauseLabel: state.rootCauseLabel,
      cascade: state.cascade,
      events: state.topEvents,
      role: state.role,
      ip,
    });

    res.json({ ok: true, explanation: result?.text || null, source: result?.source || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/ai/repair-plan/:ip
 * Get AI-generated repair checklist for an appliance.
 */
app.post('/api/ai/repair-plan/:ip', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const state = applianceStore.getState(ip);
  if (!state) return res.status(404).json({ ok: false, reason: 'not_found' });

  try {
    const plan = await groqRepairPlan({
      rootCauseType: state.rootCauseType,
      rootCauseLabel: state.rootCauseLabel,
      ip,
      role: state.role,
    });
    res.json({ ok: true, plan: plan || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/appliance/:ip/repair/run-auto
 * Run a repair step using stored SSH credentials — no need to pass creds from frontend.
 * Body: { stepIndex, approved }
 */
app.post('/api/appliance/:ip/repair/run-auto', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const { stepIndex, approved = false } = req.body || {};

  const state = applianceStore.getState(ip);
  if (!state?.rootCauseType) return res.status(404).json({ ok: false, reason: 'no_active_issue' });

  // Load stored credentials — never from frontend
  const creds = getCredentials(ip);
  if (!creds.password) return res.status(400).json({ ok: false, reason: 'no_stored_credentials', message: `No SSH credentials stored for ${ip}` });

  const plan = getRepairPlan(state.rootCauseType);
  const step = plan.steps?.[stepIndex];
  if (!step) return res.status(400).json({ ok: false, reason: 'invalid_step' });

  if (step.risk === 'MANUAL' || !step.cmd) {
    return res.json({ ok: true, blocked: true, reason: 'MANUAL_STEP', instruction: step.instruction || step.label });
  }

  if (step.risk === 'MEDIUM' && !approved) {
    return res.json({ ok: false, blocked: true, reason: 'REQUIRES_APPROVAL', label: step.label, command: step.cmd, description: step.description });
  }

  try {
    const result = await execOverSsh(creds, step.cmd);
    res.json({
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout?.slice(0, 4096),
      stderr: result.stderr?.slice(0, 1024),
      command: step.cmd,
      durationMs: result.durationMs,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/appliance/:ip/repair/verify-auto
 * Verify a fix using stored credentials.
 */
app.post('/api/appliance/:ip/repair/verify-auto', async (req, res) => {
  const ip = decodeURIComponent(req.params.ip);
  const state = applianceStore.getState(ip);
  if (!state?.rootCauseType) return res.status(404).json({ ok: false, reason: 'no_active_issue' });

  const plan = getRepairPlan(state.rootCauseType);
  if (!plan.verifyCmd) return res.json({ ok: true, verified: null, note: 'No verify command' });

  const creds = getCredentials(ip);
  if (!creds.password) return res.status(400).json({ ok: false, reason: 'no_stored_credentials' });

  try {
    const result = await execOverSsh(creds, plan.verifyCmd);
    const passed = result.ok && result.stdout?.match(plan.verifyExpect);
    if (passed) applianceStore.clearAppliance(ip);
    res.json({ ok: true, verified: !!passed, stdout: result.stdout?.slice(0, 1024), message: passed ? '✓ Fix verified' : '✗ Issue still present' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
