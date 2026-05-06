/**
 * ServiceNow recorder — best-effort, opt-in.
 *
 * ServiceNow is NOT the fixer. It only records what Autopilot did.
 * Activation: set env vars SERVICENOW_INSTANCE, SERVICENOW_USER, SERVICENOW_PASSWORD.
 * If any are missing, this module is a silent no-op so the engine keeps working.
 *
 * On success: creates/updates an incident with "Resolved by Autopilot",
 * including before state, commands executed, after state, verification result.
 * On failure: creates/updates an incident with "Autopilot remediation failed",
 * including command output and next manual steps.
 */

function shortDescription(plan, report) {
  const verb = report.success ? (report.fixVerified ? "Resolved by Autopilot" : "Executed by Autopilot") : "Autopilot remediation failed";
  return `[${verb}] ${plan.serviceName} — ${plan.rootCause}`;
}

function buildWorkNotes(plan, report) {
  const lines = [];
  lines.push(`Autopilot plan ${plan.planId}`);
  lines.push(`Service: ${plan.serviceName} (${plan.role}) on ${plan.host}`);
  lines.push(`Issue: ${plan.issueType} — ${plan.rootCause}`);
  lines.push(`Risk: ${plan.riskLevel}  Confidence: ${(plan.confidence * 100).toFixed(0)}%`);
  lines.push("");
  for (const r of report.commandOutputs || []) {
    lines.push(`--- ${r.label} [${r.risk}] ---`);
    if (r.before) {
      lines.push(`BEFORE (${r.verifyCommand || "verify"}): matched=${r.before.matched ?? "?"}`);
      if (r.before.stdout) lines.push(r.before.stdout.trim().slice(0, 800));
    }
    if (r.command) lines.push(`CMD: ${r.command}`);
    lines.push(`exit=${r.exitCode ?? "?"} ok=${r.ok}`);
    if (r.stdout) lines.push(`STDOUT: ${r.stdout.trim().slice(0, 800)}`);
    if (r.stderr) lines.push(`STDERR: ${r.stderr.trim().slice(0, 800)}`);
    if (r.verify) {
      lines.push(`AFTER (${r.verifyCommand || "verify"}): matched=${r.verify.matched ?? "?"}`);
      if (r.verify.stdout) lines.push(r.verify.stdout.trim().slice(0, 800));
    }
    lines.push("");
  }
  if (!report.success) {
    lines.push("Next manual steps:");
    for (const s of report.nextSteps || []) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}

function isConfigured() {
  return Boolean(process.env.SERVICENOW_INSTANCE && process.env.SERVICENOW_USER && process.env.SERVICENOW_PASSWORD);
}

/**
 * Record an Autopilot execution against ServiceNow. Returns:
 *   { ok: true, skipped: true, reason } when not configured
 *   { ok: true, sysId } on success
 *   { ok: false, error } on failure
 * Never throws — caller can ignore the result.
 */
export async function recordAutopilotResult({ plan, report }) {
  if (!isConfigured()) return { ok: true, skipped: true, reason: "servicenow_not_configured" };

  const instance = process.env.SERVICENOW_INSTANCE.replace(/\/+$/, "");
  const auth = "Basic " + Buffer.from(`${process.env.SERVICENOW_USER}:${process.env.SERVICENOW_PASSWORD}`).toString("base64");
  const body = {
    short_description: shortDescription(plan, report),
    description: buildWorkNotes(plan, report),
    category: "software",
    impact: report.success ? 3 : 2,
    urgency: report.success ? 3 : 2,
    state: report.success && report.fixVerified ? 6 /* Resolved */ : 2 /* In Progress */,
    work_notes: `Autopilot ${report.success ? "succeeded" : "failed"} at ${report.finishedAt}.`,
    correlation_id: plan.planId,
    correlation_display: "Autopilot",
  };
  try {
    const url = `${instance}/api/now/table/incident`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `ServiceNow API ${res.status}: ${text.slice(0, 300)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, sysId: data?.result?.sys_id || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}