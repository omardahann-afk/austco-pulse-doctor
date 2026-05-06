/**
 * Autopilot Engine — deterministic monitor → detect → plan → (approve) → execute → verify.
 *
 * Safety rules:
 *   - Engine NEVER executes high-risk actions automatically.
 *   - Engine NEVER executes ANY action without an explicit /api/autopilot/execute
 *     call carrying { planId, actionId, approval: { acknowledged: true } }.
 *   - Commands are produced from sshExecutor templates only — frontend cannot
 *     supply raw shell.
 *   - Continuous loop is OFF by default; technician must POST /api/autopilot/start.
 */
import { runServiceDiagnosis } from "./services.js";
import { matchPlaybook } from "./remediationPlaybooks.js";
import { buildAllowlist, resolveCommand, execOverSsh } from "./sshExecutor.js";
import { savePlan, loadPlan, saveExecution, saveScan, saveApproval, listRecentScans, listRecentPlans, listRecentExecutions } from "./autopilotStore.js";

const state = {
  loopRunning: false,
  intervalMs: 60_000,
  intervalHandle: null,
  lastScanAt: null,
  lastScan: null,            // { scanId, startedAt, finishedAt, services, issues, planIds }
  monitoredCount: 0,
  // In-memory cache of recent plans for fast lookup; persisted copy in autopilotStore.
  plans: new Map(),          // planId -> plan
};

function nowIso() { return new Date().toISOString(); }
function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

function confidenceFor(serviceResult, playbookId) {
  // Crude deterministic scoring: SERVICE_DOWN (port closed) = 0.9, log-only = 0.6, etc.
  if (playbookId === "service_down") return 0.9;
  if (playbookId === "webmin_down") return 0.85;
  if (playbookId === "mqtt_down") return 0.9;
  if (playbookId === "license_issue") return 0.7;
  if (playbookId === "error_storm") return 0.7;
  if (playbookId === "disk_full") return 0.95;
  if (playbookId === "cert_issue") return 0.65;
  return 0.5;
}

function buildPlanForService(serviceResult, allowlist, services) {
  const pb = matchPlaybook(serviceResult, allowlist);
  if (!pb) return null;
  const skeleton = pb.build({ serviceResult, allowlist });

  const svcEntry = (services || []).find((s) => s.id === serviceResult.serviceId) || null;

  const actions = skeleton.actions.map((a) => {
    let resolved;
    try { resolved = resolveCommand(a.templateId, a.params, allowlist); }
    catch (err) {
      return {
        id: a.id, label: a.label, templateId: a.templateId, params: a.params,
        risk: a.risk, requiresSudo: false,
        command: null, blocked: true, blockReason: err.message,
        explanation: `Action could not be prepared: ${err.message}`,
        timeoutSeconds: 30,
        verifyCommand: null, rollbackCommand: null,
      };
    }
    let verifyCommand = null;
    if (a.verifyTemplateId) {
      try { verifyCommand = resolveCommand(a.verifyTemplateId, a.verifyParams || {}, allowlist).command; } catch {}
    }
    return {
      id: a.id,
      label: a.label,
      templateId: a.templateId,
      params: a.params,
      risk: a.risk,
      requiresSudo: resolved.requiresSudo,
      command: resolved.command,
      explanation: explainAction(a, resolved),
      timeoutSeconds: 30,
      verifyCommand,
      verifyExpect: a.verifyExpect ? a.verifyExpect.source : null,
      rollbackCommand: null,
    };
  });

  // Compute final risk: HIGH playbooks would be flagged here. Today no playbook
  // emits HIGH actions; HIGH-risk remediations (cert/CCP/db) are surfaced as
  // manualNotes with no executable action.
  const riskLevel = skeleton.riskLevel || "LOW";

  const plan = {
    planId: uid("plan"),
    createdAt: nowIso(),
    serviceId: serviceResult.serviceId,
    serviceName: serviceResult.name,
    role: serviceResult.role,
    host: serviceResult.host,
    issueType: skeleton.issueType,
    rootCause: pb.title,
    confidence: confidenceFor(serviceResult, pb.id),
    riskLevel,
    requiresApproval: true, // ALWAYS true — engine never auto-executes.
    summary: skeleton.summary,
    evidence: collectEvidence(serviceResult),
    actions,
    verification: actions.find((a) => a.verifyCommand) ? "automatic" : "manual",
    rollbackAvailable: Boolean(skeleton.rollbackAvailable),
    manualNotes: skeleton.manualNotes || [],
    // Stash credentials reference (not the password) so execute can locate the service.
    serviceRef: svcEntry ? { id: svcEntry.id, host: svcEntry.host, port: svcEntry.port, username: svcEntry.username } : null,
  };
  return plan;
}

function explainAction(a, resolved) {
  if (resolved.kind === "read") return `Read-only check (${a.label}). No state change.`;
  if (resolved.kind === "write") return `Restart action (${a.label}). Requires technician approval.`;
  return a.label;
}

function collectEvidence(s) {
  const ev = [];
  for (const st of s.steps || []) {
    if (st.status === "FAIL" || st.status === "WARN") ev.push(`[${st.status}] ${st.name}: ${st.detail}`);
  }
  const findings = (s.parsedLogs || []).flatMap((p) => p.findings || []);
  for (const f of findings.slice(0, 5)) {
    ev.push(`[LOG] ${f.type || ""} ${f.message || f.raw || ""}`.trim());
  }
  return ev;
}

/* ===== Public engine API ===== */

/**
 * Run a single scan over the configured services. Generates plans
 * automatically — but never executes them.
 * @param {object[]} services - service entries (may include passwords)
 * @param {object}   vmInfo
 * @param {object}   siteOverrides - { systemd: [], docker: [] }
 */
export async function runScan({ services = [], vmInfo, siteOverrides = {} }) {
  const allowlist = buildAllowlist(siteOverrides);
  const startedAt = nowIso();
  const diag = await runServiceDiagnosis(services, vmInfo);
  const serviceResults = diag?.ok ? diag.services : [];
  state.monitoredCount = services.filter((s) => s.enabled !== false).length;

  const issues = [];
  const planIds = [];
  for (const s of serviceResults) {
    if (s.status === "PASS") continue;
    const plan = buildPlanForService(s, allowlist, services);
    if (!plan) continue;
    state.plans.set(plan.planId, plan);
    savePlan(plan);
    planIds.push(plan.planId);
    issues.push({
      planId: plan.planId,
      serviceId: s.serviceId,
      serviceName: s.name,
      role: s.role,
      host: s.host,
      severity: s.status, // FAIL / WARN
      issueType: plan.issueType,
      rootCause: plan.rootCause,
      confidence: plan.confidence,
      riskLevel: plan.riskLevel,
    });
  }

  const scan = {
    scanId: uid("scan"),
    startedAt,
    finishedAt: nowIso(),
    monitoredCount: state.monitoredCount,
    issueCount: issues.length,
    issues,
    planIds,
  };
  state.lastScan = scan;
  state.lastScanAt = scan.finishedAt;
  saveScan(scan);
  return { ok: true, scan, allowlist };
}

export function getStatus() {
  return {
    ok: true,
    loopRunning: state.loopRunning,
    intervalMs: state.intervalMs,
    lastScanAt: state.lastScanAt,
    monitoredCount: state.monitoredCount,
    currentIssueCount: state.lastScan ? state.lastScan.issueCount : 0,
    lastScan: state.lastScan,
    recentPlans: listRecentPlans(20).map(stripPlanForList),
    recentExecutions: listRecentExecutions(20),
    recentScans: listRecentScans(20).map((s) => ({
      scanId: s.scanId, startedAt: s.startedAt, finishedAt: s.finishedAt,
      monitoredCount: s.monitoredCount, issueCount: s.issueCount,
    })),
  };
}

function stripPlanForList(p) {
  if (!p) return p;
  return {
    planId: p.planId, createdAt: p.createdAt,
    serviceName: p.serviceName, role: p.role, host: p.host,
    issueType: p.issueType, rootCause: p.rootCause,
    riskLevel: p.riskLevel, confidence: p.confidence,
    actionCount: Array.isArray(p.actions) ? p.actions.length : 0,
  };
}

/** Start the optional interval loop. Idempotent. */
export function startLoop({ services, vmInfo, siteOverrides, intervalMs }) {
  if (state.loopRunning) return { ok: true, alreadyRunning: true };
  state.intervalMs = Math.max(15_000, Number(intervalMs) || 60_000);
  state.loopRunning = true;
  // Kick off an immediate scan, then schedule.
  runScan({ services, vmInfo, siteOverrides }).catch(() => {});
  state.intervalHandle = setInterval(() => {
    runScan({ services, vmInfo, siteOverrides }).catch(() => {});
  }, state.intervalMs);
  return { ok: true, alreadyRunning: false, intervalMs: state.intervalMs };
}

export function stopLoop() {
  if (state.intervalHandle) clearInterval(state.intervalHandle);
  state.intervalHandle = null;
  state.loopRunning = false;
  return { ok: true };
}

/** Look up a plan by id (memory first, store fallback). */
export function getPlan(planId) {
  return state.plans.get(planId) || loadPlan(planId);
}

/**
 * Execute one or more actions of a plan. Enforces:
 *   - plan must exist
 *   - action must belong to plan and not be blocked
 *   - HIGH-risk actions are NEVER executed
 *   - MEDIUM-risk requires explicit acknowledged === true
 *   - LOW-risk (read-only) may run with acknowledged === false
 */
export async function executeActions({ planId, actionIds, password, acknowledged }) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, reason: "plan_not_found" };
  if (!plan.serviceRef || !plan.serviceRef.host) return { ok: false, reason: "service_ref_missing" };
  if (!password) return { ok: false, reason: "credentials_required", message: "SSH password required for execution." };

  const ids = Array.isArray(actionIds) && actionIds.length ? actionIds : plan.actions.map((a) => a.id);
  const startedAt = nowIso();
  const results = [];
  for (const id of ids) {
    const action = plan.actions.find((a) => a.id === id);
    if (!action) { results.push({ actionId: id, ok: false, reason: "action_not_found" }); continue; }
    if (action.blocked) { results.push({ actionId: id, label: action.label, ok: false, reason: "blocked", error: action.blockReason }); continue; }
    if (action.risk === "HIGH") { results.push({ actionId: id, label: action.label, ok: false, reason: "high_risk_blocked" }); continue; }
    if (action.risk === "MEDIUM" && !acknowledged) { results.push({ actionId: id, label: action.label, ok: false, reason: "approval_required" }); continue; }

    const ssh = { host: plan.serviceRef.host, port: plan.serviceRef.port || 22, username: plan.serviceRef.username, password };
    // Capture BEFORE state for actions that have a verify command (so the
    // technician sees a real before/after comparison, not just an "after").
    let beforeRes = null;
    if (action.verifyCommand && action.risk !== "LOW") {
      beforeRes = await execOverSsh(ssh, action.verifyCommand, 15_000);
      if (action.verifyExpect) {
        try { beforeRes.matched = new RegExp(action.verifyExpect, "m").test(beforeRes.stdout || ""); } catch {}
      }
    }
    const cmdRes = await execOverSsh(ssh, action.command, (action.timeoutSeconds || 30) * 1000);
    let verifyRes = null;
    if (action.verifyCommand && cmdRes.ok) {
      verifyRes = await execOverSsh(ssh, action.verifyCommand, 15_000);
      if (action.verifyExpect) {
        try {
          const re = new RegExp(action.verifyExpect, "m");
          verifyRes.matched = re.test(verifyRes.stdout || "");
        } catch {}
      }
    }
    results.push({
      actionId: id, label: action.label, risk: action.risk,
      command: action.command, ok: cmdRes.ok, exitCode: cmdRes.exitCode,
      stdout: cmdRes.stdout, stderr: cmdRes.stderr, durationMs: cmdRes.durationMs,
      stage: cmdRes.stage || null, error: cmdRes.error || null,
      before: beforeRes,
      verify: verifyRes,
      verifyCommand: action.verifyCommand || null,
      verifyExpect: action.verifyExpect || null,
    });
  }

  const success = results.every((r) => r.ok);
  // Determine "fix verified" only when at least one MEDIUM action's verify
  // command transitioned from not-matching (or unknown) to matching.
  const fixVerified = results.some((r) =>
    r.risk === "MEDIUM" && r.verify && r.verify.matched === true &&
    (!r.before || r.before.matched !== true)
  );
  const report = {
    executionId: uid("exec"),
    planId,
    startedAt, finishedAt: nowIso(),
    actionsRun: results.length,
    success,
    fixVerified,
    commandOutputs: results,
    verificationResult: results.map((r) => r.verify).filter(Boolean),
    nextSteps: success ? ["Re-run a scan to confirm health is restored."] : ["Review failed action output. Escalate if unclear."],
  };
  saveExecution(report);
  saveApproval({ at: startedAt, planId, actionIds: ids, acknowledged: !!acknowledged });
  return { ok: true, report };
}

/** Run only the read-only (LOW-risk) actions in a plan. No approval required. */
export async function runReadOnlyChecks({ planId, password }) {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, reason: "plan_not_found" };
  const lowIds = plan.actions.filter((a) => a.risk === "LOW" && !a.blocked).map((a) => a.id);
  return executeActions({ planId, actionIds: lowIds, password, acknowledged: false });
}