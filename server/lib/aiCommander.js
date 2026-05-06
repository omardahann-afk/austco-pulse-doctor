/**
 * AI Evidence Commander.
 *
 * One endpoint, six modes. AI is a senior-engineer brain that explains,
 * challenges, summarizes, and drafts wording. It NEVER:
 *   - executes commands
 *   - generates or modifies shell commands
 *   - changes root cause / risk / confidence / approval
 *   - invents evidence, hosts, IPs, services, log lines, numbers
 *
 * Failure is non-blocking: callers get a deterministic fallback object
 * and the deterministic engine remains the source of truth.
 */

const DEFAULT_ENDPOINT = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "llama3.2:3b";
const DEFAULT_TIMEOUT_MS = 30_000;

const MAX_LINE = 280;
const MAX_EVIDENCE = 25;
const MAX_ACTIONS = 10;

export const COMMANDER_MODES = [
  "explain_on_site",
  "evidence_challenge",
  "escalation_writer",
  "root_cause_defender",
  "fix_plan_explainer",
  "post_fix_analyst",
];

const DISCLAIMER = "AI explanation only. Deterministic engine controls root cause, risk, approval, and execution.";

function trunc(s, n = MAX_LINE) {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…[truncated]" : str;
}

const SECRET_KEYS = new Set([
  "password", "passwd", "pass", "token", "apikey", "api_key",
  "privatekey", "private_key", "secret", "authorization", "ssh_password",
  "servicenow_password", "servicenow_token", "bearer",
]);

function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(String(k).toLowerCase())) continue;
    out[k] = (v && typeof v === "object") ? stripSecrets(v) : v;
  }
  return out;
}

/* ---------- Sanitized snapshot builder ---------- */

function safeRootCauseSnap(rc) {
  if (!rc || typeof rc !== "object") return null;
  return stripSecrets({
    primaryCause: trunc(rc.primaryCause || rc.cause || "", 500),
    confidence: typeof rc.confidence === "number" ? rc.confidence : null,
    confidenceReasons: (Array.isArray(rc.confidenceReasons) ? rc.confidenceReasons.slice(0, 10) : []).map((s) => trunc(s)),
    breakFoundAt: trunc(rc.breakFoundAt || "", 200),
    affectedServices: Array.isArray(rc.affectedServices) ? rc.affectedServices.slice(0, 20) : [],
    affectedHosts: Array.isArray(rc.affectedHosts) ? rc.affectedHosts.slice(0, 20) : [],
    affectedCpIds: Array.isArray(rc.affectedCpIds) ? rc.affectedCpIds.slice(0, 20) : [],
    ruledOut: Array.isArray(rc.ruledOut) ? rc.ruledOut.slice(0, 10).map((r) => trunc(r)) : [],
    deepEvidenceUsed: !!rc.deepEvidenceUsed,
    evidenceSource: rc.evidenceSource || null,
  });
}

function safeTraceSnap(tr) {
  if (!tr || typeof tr !== "object") return null;
  return stripSecrets({
    overallStatus: tr.overallStatus,
    signalStatus: tr.signalStatus,
    breakFoundAt: tr.breakFoundAt || null,
    confidence: typeof tr.confidence === "number" ? tr.confidence : null,
    propagationPath: (Array.isArray(tr.propagationPath) ? tr.propagationPath.slice(0, 12) : []).map((n) => ({
      layer: n.layer, componentName: n.componentName, status: n.status,
      breakDetected: !!n.breakDetected,
      evidenceSource: n.evidenceSource || null,
    })),
    suspectedFailures: (Array.isArray(tr.suspectedFailures) ? tr.suspectedFailures.slice(0, 5) : []).map((s) => ({
      layer: s.layer, componentName: s.componentName, reason: s.reason,
      explanation: trunc(s.explanation || "", 240),
    })),
    ruledOutFailures: Array.isArray(tr.ruledOutFailures) ? tr.ruledOutFailures.slice(0, 10) : [],
  });
}

function safeDeepEvidenceSnap(de) {
  if (!de || typeof de !== "object") return null;
  return stripSecrets({
    collectedAt: de.collectedAt || null,
    mock: !!de.mock,
    mockTag: de.mockTag || null,
    network: de.network ? { summary: trunc(de.network.summary || "", 240) } : null,
    process: de.process ? { summary: trunc(de.process.summary || "", 240) } : null,
    port: de.port ? { summary: trunc(de.port.summary || "", 240) } : null,
    mqtt: de.mqtt ? { summary: trunc(de.mqtt.summary || "", 240) } : null,
    config: de.config ? { summary: trunc(de.config.summary || "", 240) } : null,
    contradictions: (Array.isArray(de.contradictions) ? de.contradictions.slice(0, 5) : []).map((c) => ({
      kind: c.kind, likelyLayer: c.likelyLayer,
      confidence: typeof c.confidence === "number" ? c.confidence : null,
      why: trunc(c.why || "", 240),
      sourceA: { layer: c.sourceA?.layer, said: trunc(c.sourceA?.said || "", 200) },
      sourceB: { layer: c.sourceB?.layer, said: trunc(c.sourceB?.said || "", 200) },
      target: c.target || null,
    })),
  });
}

function safePlanSnap(plan) {
  if (!plan || typeof plan !== "object") return null;
  return stripSecrets({
    planId: plan.planId,
    serviceName: plan.serviceName, role: plan.role, host: plan.host,
    issueType: plan.issueType,
    rootCause: trunc(plan.rootCause || "", 500),
    confidence: typeof plan.confidence === "number" ? plan.confidence : null,
    riskLevel: plan.riskLevel,
    summary: trunc(plan.summary || "", 500),
    mockEvidence: !!plan.mockEvidence,
    actions: (Array.isArray(plan.actions) ? plan.actions.slice(0, MAX_ACTIONS) : []).map((a) => ({
      label: a.label, risk: a.risk,
      blocked: !!a.blocked, blockReason: a.blockReason || null,
      explanation: trunc(a.explanation || "", 300),
      // Note: we deliberately do NOT include raw command strings to AI.
    })),
  });
}

function safeExecutionSnap(report) {
  if (!report || typeof report !== "object") return null;
  return stripSecrets({
    success: !!report.success,
    fixVerified: !!report.fixVerified,
    actionsRun: report.actionsRun,
    commandOutputs: (Array.isArray(report.commandOutputs) ? report.commandOutputs.slice(0, MAX_ACTIONS) : []).map((r) => ({
      label: r.label, risk: r.risk, ok: !!r.ok,
      reason: r.reason || null,
      exitCode: typeof r.exitCode === "number" ? r.exitCode : null,
      before: r.before ? { ok: !!r.before.ok, matched: r.before.matched ?? null } : null,
      verify: r.verify ? { ok: !!r.verify.ok, matched: r.verify.matched ?? null } : null,
    })),
    nextSteps: Array.isArray(report.nextSteps) ? report.nextSteps.slice(0, 8).map((n) => trunc(n)) : [],
  });
}

function safeContextSnap(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  return {
    rootCause: safeRootCauseSnap(c.rootCause),
    trace: safeTraceSnap(c.trace),
    deepEvidence: safeDeepEvidenceSnap(c.deepEvidence),
    plan: safePlanSnap(c.plan),
    execution: safeExecutionSnap(c.execution),
    contradictions: Array.isArray(c.contradictions)
      ? c.contradictions.slice(0, 5).map((x) => ({ kind: x.kind, why: trunc(x.why || "", 240), likelyLayer: x.likelyLayer }))
      : [],
    affectedServices: Array.isArray(c.affectedServices) ? c.affectedServices.slice(0, 20) : [],
    affectedHosts: Array.isArray(c.affectedHosts) ? c.affectedHosts.slice(0, 20) : [],
    affectedCpIds: Array.isArray(c.affectedCpIds) ? c.affectedCpIds.slice(0, 20) : [],
  };
}

/* ---------- Confidence / freshness signals (computed by us, not AI) ---------- */

function computeFlags(snap) {
  const conf = snap?.rootCause?.confidence
    ?? snap?.trace?.confidence
    ?? snap?.plan?.confidence
    ?? null;
  const collectedAt = snap?.deepEvidence?.collectedAt || null;
  let stale = false;
  if (collectedAt) {
    const ms = Date.parse(collectedAt);
    if (!Number.isNaN(ms)) stale = (Date.now() - ms) > 15 * 60 * 1000;
  }
  return {
    lowConfidence: typeof conf === "number" ? conf < 85 : false,
    confidenceValue: typeof conf === "number" ? conf : null,
    staleEvidence: stale,
    mockEvidence: !!(snap?.deepEvidence?.mock || snap?.plan?.mockEvidence),
  };
}

function buildWarnings(flags) {
  const out = { confidenceWarning: "", safetyWarning: "" };
  if (flags.mockEvidence) {
    out.safetyWarning = "This is mock evidence. Do not execute real remediation.";
  } else if (flags.staleEvidence) {
    out.safetyWarning = "Evidence is stale. Re-collect before remediation.";
  } else {
    out.safetyWarning = DISCLAIMER;
  }
  if (flags.lowConfidence) {
    out.confidenceWarning = `Confidence ${flags.confidenceValue ?? "?"} is not high enough to treat this as confirmed without more evidence.`;
  }
  return out;
}

/* ---------- Prompts per mode ---------- */

const SYSTEM_PROMPT = `You are the AI Evidence Commander for the Austco/Tacera Site Doctor.
You sit BESIDE the technician like a senior engineer. You are NOT the pilot.

You MUST:
- Only summarize, explain, challenge, and draft wording from the provided snapshot.
- Never invent commands, hosts, IPs, log lines, services, CP IDs, or numbers not in the snapshot.
- Never propose, modify, or generate shell commands.
- Never change root cause, confidence, risk, approval, or execution decisions.
- Never override deterministic playbooks.
- Plain text only. No markdown. No code fences. No backticks.
- Keep each field concise (2-5 sentences max unless noted).
- If a field is not applicable to the current mode/snapshot, return an empty string for it (the engine will fill in defaults).

Return ONLY a JSON object via the provided tool.`;

const MODE_INSTRUCTIONS = {
  explain_on_site:
    "Mode: Explain Like I'm On Site. Plain English for a field tech. Focus on what is happening, what was proven, and the next safest diagnostic step. No jargon dumps.",
  evidence_challenge:
    "Mode: Evidence Challenge. Find weak spots in the conclusion. Call out what evidence is MISSING, what could be misleading, what was assumed, what still needs verification. Be a careful skeptic, but only based on the snapshot.",
  escalation_writer:
    "Mode: Escalation Writer. Produce three crisp summaries: customer-safe (no jargon, no IPs), internal technical, developer/debug. Plus a short next-step checklist phrased as recommendedNextStep.",
  root_cause_defender:
    "Mode: Root Cause Defender. Explain why THIS root cause was chosen over other plausible causes shown in ruledOut. Reference the contradictions and evidence layers that tipped the conclusion.",
  fix_plan_explainer:
    "Mode: Fix Plan Explainer. Explain what will happen if approved, what each action does at a high level, the expected before/after, what could go wrong, and rollback/manual recovery notes. Do NOT restate or generate commands.",
  post_fix_analyst:
    "Mode: Post-Fix Analyst. Explain what changed, whether verification proved the fix, what still needs monitoring, and whether escalation can be closed. Reference before/verify pass-fail signals from the execution snapshot.",
};

function buildUserPrompt(mode, snapshot, flags) {
  const modeNote = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.explain_on_site;
  return `${modeNote}

CONTEXT_SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

FLAGS:
${JSON.stringify(flags)}

Required output fields (all strings unless otherwise stated, plain text, no markdown):
- executiveSummary: 1-2 sentences a manager can read.
- technicianExplanation: 3-5 sentences a field tech can act on.
- evidenceThatMatters: array of 1-6 short bullets (each <= 160 chars). Reference only fields shown in the snapshot.
- contradictions: array of 0-5 short bullets (each <= 160 chars) describing the contradictions found in the snapshot. Empty array if none.
- ruledOutCauses: array of 0-5 short bullets describing causes ruled out (use snapshot.rootCause.ruledOut and snapshot.trace.ruledOutFailures only).
- riskExplanation: 2-3 sentences explaining current risk in practice. Do not change the risk level.
- recommendedNextStep: 1-2 sentences. The single safest next diagnostic step. Never a remediation command.
- customerSafeSummary: 1-2 sentences for the customer/site owner. No jargon, no IPs, no CP IDs.
- internalTechnicalSummary: 3-5 sentences for an internal Austco engineer.
- developerDebugSummary: 3-5 sentences for a developer debugging the engine. May reference layers, contradictions, and evidence sources.`;
}

const TOOL = [{
  type: "function",
  function: {
    name: "emit_commander_response",
    description: "Return the structured AI Evidence Commander response.",
    parameters: {
      type: "object",
      properties: {
        executiveSummary: { type: "string" },
        technicianExplanation: { type: "string" },
        evidenceThatMatters: { type: "array", items: { type: "string" } },
        contradictions: { type: "array", items: { type: "string" } },
        ruledOutCauses: { type: "array", items: { type: "string" } },
        riskExplanation: { type: "string" },
        recommendedNextStep: { type: "string" },
        customerSafeSummary: { type: "string" },
        internalTechnicalSummary: { type: "string" },
        developerDebugSummary: { type: "string" },
      },
      required: [
        "executiveSummary", "technicianExplanation", "evidenceThatMatters",
        "contradictions", "ruledOutCauses", "riskExplanation",
        "recommendedNextStep", "customerSafeSummary",
        "internalTechnicalSummary", "developerDebugSummary",
      ],
    },
  },
}];

/* ---------- Ollama call ---------- */

function safeStr(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function extractJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function parseOllama(json) {
  const msg = json?.message || {};
  const tc = Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
  if (tc?.function?.arguments) {
    const a = tc.function.arguments;
    if (typeof a === "string") return extractJson(a);
    if (typeof a === "object") return a;
  }
  return extractJson(safeStr(msg.content));
}

async function callOllama({ endpoint, model, timeoutMs, systemPrompt, userPrompt }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false, format: "json",
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: TOOL,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "ai_timeout" : "ai_unavailable",
      message: aborted
        ? "AI Commander timed out. Deterministic engine still active."
        : `AI Commander unavailable. Deterministic engine still active. (${err?.message || String(err)})`,
    };
  }
  clearTimeout(t);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, reason: "ai_http_error", message: `AI HTTP ${res.status}. ${txt.slice(0, 200)}` };
  }
  let data;
  try { data = await res.json(); }
  catch (err) { return { ok: false, reason: "ai_bad_json", message: `AI returned non-JSON: ${err?.message || err}` }; }
  const parsed = parseOllama(data);
  if (!parsed) return { ok: false, reason: "ai_no_structured_output", message: "AI did not return a parseable JSON object." };
  return { ok: true, data: parsed };
}

/* ---------- Validation + sanitization ---------- */

function stripCommandSuggestions(text) {
  if (!text) return "";
  return String(text)
    .replace(/```[\s\S]*?```/g, "[command output omitted]")
    .replace(/`[^`]*`/g, "")
    .trim();
}

function asStringArray(v, max = 6, lineMax = 160) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max)
    .map((x) => stripCommandSuggestions(safeStr(x)))
    .filter(Boolean)
    .map((s) => s.length > lineMax ? s.slice(0, lineMax) + "…" : s);
}

function validateShape(ai) {
  if (!ai || typeof ai !== "object") return null;
  // All required string fields must exist (string or convertible).
  const requiredStrings = [
    "executiveSummary", "technicianExplanation", "riskExplanation",
    "recommendedNextStep", "customerSafeSummary",
    "internalTechnicalSummary", "developerDebugSummary",
  ];
  for (const k of requiredStrings) {
    if (typeof ai[k] !== "string") return null;
  }
  if (!Array.isArray(ai.evidenceThatMatters)) return null;
  if (!Array.isArray(ai.contradictions)) return null;
  if (!Array.isArray(ai.ruledOutCauses)) return null;
  return ai;
}

function sanitize(ai, mode, flags, warnings) {
  return {
    mode,
    executiveSummary: stripCommandSuggestions(safeStr(ai.executiveSummary)),
    technicianExplanation: stripCommandSuggestions(safeStr(ai.technicianExplanation)),
    evidenceThatMatters: asStringArray(ai.evidenceThatMatters, 6, 200),
    contradictions: asStringArray(ai.contradictions, 5, 200),
    ruledOutCauses: asStringArray(ai.ruledOutCauses, 5, 200),
    riskExplanation: stripCommandSuggestions(safeStr(ai.riskExplanation)),
    recommendedNextStep: stripCommandSuggestions(safeStr(ai.recommendedNextStep)),
    customerSafeSummary: stripCommandSuggestions(safeStr(ai.customerSafeSummary)),
    internalTechnicalSummary: stripCommandSuggestions(safeStr(ai.internalTechnicalSummary)),
    developerDebugSummary: stripCommandSuggestions(safeStr(ai.developerDebugSummary)),
    confidenceWarning: warnings.confidenceWarning,
    safetyWarning: warnings.safetyWarning,
    flags,
  };
}

export function buildFallbackResponse(mode, flags, warnings, reason) {
  return {
    mode: mode || "explain_on_site",
    executiveSummary: "AI Commander response invalid.",
    technicianExplanation: "",
    evidenceThatMatters: [],
    contradictions: [],
    ruledOutCauses: [],
    riskExplanation: "",
    recommendedNextStep: "Retry AI analysis.",
    customerSafeSummary: "",
    internalTechnicalSummary: "",
    developerDebugSummary: "",
    confidenceWarning: warnings?.confidenceWarning || "AI output validation failed.",
    safetyWarning: warnings?.safetyWarning || "Deterministic engine remains active.",
    flags: flags || {},
    fallbackReason: reason || "ai_unknown_failure",
  };
}

/* ---------- Public API ---------- */

export async function runCommander({
  mode,
  context,
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeMode = COMMANDER_MODES.includes(mode) ? mode : "explain_on_site";
  const snapshot = safeContextSnap(context);
  const flags = computeFlags(snapshot);
  const warnings = buildWarnings(flags);

  // Reject empty context up front — better fallback than calling AI with nothing.
  const hasAny = snapshot.rootCause || snapshot.trace || snapshot.deepEvidence ||
    snapshot.plan || snapshot.execution ||
    (snapshot.contradictions && snapshot.contradictions.length);
  if (!hasAny) {
    return {
      ok: false,
      reason: "no_context",
      message: "No deterministic evidence to analyze yet. Run diagnosis or collect Deep Evidence first.",
      response: buildFallbackResponse(safeMode, flags, warnings, "no_context"),
      snapshot,
    };
  }

  const r = await callOllama({
    endpoint, model, timeoutMs,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(safeMode, snapshot, flags),
  });

  if (!r.ok) {
    return {
      ok: false,
      reason: r.reason,
      message: r.message,
      response: buildFallbackResponse(safeMode, flags, warnings, r.reason),
      snapshot,
    };
  }

  const validated = validateShape(r.data);
  if (!validated) {
    return {
      ok: false,
      reason: "ai_invalid_shape",
      message: "AI Commander response did not match required shape.",
      response: buildFallbackResponse(safeMode, flags, warnings, "ai_invalid_shape"),
      snapshot,
    };
  }

  const response = sanitize(validated, safeMode, flags, warnings);
  return {
    ok: true,
    mode: safeMode,
    endpoint, model,
    response,
    snapshot,
    notice: DISCLAIMER,
  };
}