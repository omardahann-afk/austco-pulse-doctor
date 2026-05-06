/**
 * Autopilot AI Copilot.
 * Explains deterministic Autopilot plans and execution reports in plain language.
 *
 * AI is COPILOT only:
 *  - never generates or modifies commands
 *  - never changes risk, root cause, confidence
 *  - never executes anything
 *  - only consumes a SAFE snapshot (no passwords, tokens, raw creds)
 *
 * Uses local Ollama. If Ollama is unavailable, returns ok:false with a
 * clear reason — Autopilot continues to work without AI.
 */

const DEFAULT_ENDPOINT = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "llama3.2:3b";
const DEFAULT_TIMEOUT_MS = 45_000;

const MAX_LINE = 280;
const MAX_EVIDENCE = 25;
const MAX_ACTIONS = 10;
const MAX_OUTPUTS = 10;

function trunc(s, n = MAX_LINE) {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…[truncated]" : str;
}

/* ---------- Safe snapshots (NEVER include passwords, tokens, keys) ---------- */

const SECRET_KEYS = new Set(["password", "passwd", "pass", "token", "apiKey", "api_key", "privateKey", "private_key", "secret", "authorization", "ssh_password"]);

function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = typeof v === "object" ? stripSecrets(v) : v;
  }
  return out;
}

function safePlanSnapshot(plan) {
  if (!plan || typeof plan !== "object") return null;
  return stripSecrets({
    planId: plan.planId,
    serviceName: plan.serviceName,
    role: plan.role,
    host: plan.host,
    issueType: plan.issueType,
    rootCause: trunc(plan.rootCause, 500),
    confidence: typeof plan.confidence === "number" ? plan.confidence : 0,
    riskLevel: plan.riskLevel,
    summary: trunc(plan.summary, 500),
    evidence: (Array.isArray(plan.evidence) ? plan.evidence.slice(0, MAX_EVIDENCE) : []).map((e) => trunc(e)),
    manualNotes: (Array.isArray(plan.manualNotes) ? plan.manualNotes.slice(0, 10) : []).map((n) => trunc(n)),
    verification: plan.verification,
    actions: (Array.isArray(plan.actions) ? plan.actions.slice(0, MAX_ACTIONS) : []).map((a) => ({
      id: a.id,
      label: a.label,
      risk: a.risk,
      requiresSudo: !!a.requiresSudo,
      blocked: !!a.blocked,
      blockReason: a.blockReason || null,
      command: trunc(a.command || "", 400),
      verifyCommand: trunc(a.verifyCommand || "", 300),
      verifyExpect: trunc(a.verifyExpect || "", 100),
      explanation: trunc(a.explanation || "", 400),
    })),
    deepEvidenceUsed: !!plan.deepEvidenceUsed,
    evidenceScore: typeof plan.evidenceScore === "number" ? plan.evidenceScore : 0,
    deepEvidenceSummary: plan.deepEvidenceSummary
      ? {
          collectedAt: plan.deepEvidenceSummary.collectedAt,
          network: plan.deepEvidenceSummary.network,
          process: plan.deepEvidenceSummary.process,
          port: plan.deepEvidenceSummary.port,
          contradictions: (plan.deepEvidenceSummary.contradictions || []).slice(0, 5).map((c) => ({
            kind: c.kind,
            why: trunc(c.why || "", 240),
            likelyLayer: c.likelyLayer,
            confidence: c.confidence,
            sourceA: { layer: c.sourceA?.layer, said: trunc(c.sourceA?.said || "", 200) },
            sourceB: { layer: c.sourceB?.layer, said: trunc(c.sourceB?.said || "", 200) },
            target: c.target || null,
          })),
        }
      : null,
  });
}

function safeReportSnapshot(report, plan) {
  if (!report || typeof report !== "object") return null;
  return stripSecrets({
    executionId: report.executionId,
    planId: report.planId,
    success: !!report.success,
    fixVerified: !!report.fixVerified,
    actionsRun: report.actionsRun,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    serviceName: plan?.serviceName,
    role: plan?.role,
    host: plan?.host,
    issueType: plan?.issueType,
    rootCause: trunc(plan?.rootCause || "", 400),
    riskLevel: plan?.riskLevel,
    commandOutputs: (Array.isArray(report.commandOutputs) ? report.commandOutputs.slice(0, MAX_OUTPUTS) : []).map((r) => ({
      actionId: r.actionId,
      label: r.label,
      risk: r.risk,
      ok: !!r.ok,
      reason: r.reason || null,
      exitCode: typeof r.exitCode === "number" ? r.exitCode : null,
      durationMs: r.durationMs ?? null,
      stdout: trunc(r.stdout || "", 600),
      stderr: trunc(r.stderr || "", 600),
      verifyCommand: trunc(r.verifyCommand || "", 300),
      verifyExpect: trunc(r.verifyExpect || "", 100),
      before: r.before ? { ok: !!r.before.ok, matched: r.before.matched ?? null, stdout: trunc(r.before.stdout || "", 300), stderr: trunc(r.before.stderr || "", 200) } : null,
      verify: r.verify ? { ok: !!r.verify.ok, matched: r.verify.matched ?? null, stdout: trunc(r.verify.stdout || "", 300), stderr: trunc(r.verify.stderr || "", 200) } : null,
    })),
    nextSteps: Array.isArray(report.nextSteps) ? report.nextSteps.slice(0, 10).map((n) => trunc(n)) : [],
  });
}

/* ---------- Prompts ---------- */

const SYSTEM_PROMPT = `You are the AI Copilot for the Austco/Tacera Site Doctor Autopilot.
You are a COPILOT only. The deterministic engine is the PILOT.

You MUST:
- Only summarize and explain the input snapshot.
- Never invent commands, hosts, IPs, log lines, services, or numbers.
- Never modify, propose, or generate shell commands. The command list is fixed.
- Never change root cause, confidence, risk level, or evidence.
- Never approve, recommend bypassing, or skip verification.
- Never suggest unsafe manual actions (rm, reboot, sed, chmod, config edits, DB writes, cert replacement).
- If a high-risk action is blocked, explain that it must be done manually by a qualified technician.
- Always include the disclaimer text in approvalGuidance: "AI explanation only. Fix decision and safety are controlled by the deterministic engine."
- Keep each field concise. Plain text only. No markdown.

Return ONLY a JSON object via the provided tool.`;

function buildPlanPrompt(snapshot) {
  return `Explain this Autopilot remediation plan to a field technician.

PLAN_SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

Required output fields (all strings, plain text):
- plainEnglishSummary: 2-3 sentences a non-technical reader can follow.
- whyThisMatched: 2-3 sentences explaining why this playbook matched the evidence.
- riskExplanation: 2-3 sentences explaining the risk level and what it means in practice.
- whatWillHappen: 2-4 sentences walking through the actions the engine will execute, in order. Refer to existing commands; do not invent new ones.
- whatCouldGoWrong: 2-4 sentences listing realistic failure modes and what the verification step will catch.
- approvalGuidance: 1-2 sentences on whether the technician should approve. MUST end with the disclaimer: "AI explanation only. Fix decision and safety are controlled by the deterministic engine."
- escalationDraft: 3-5 sentence draft suitable for an escalation ticket. Include service, host, root cause, planned action, risk level. No ticket numbers, no IDs you do not see in the snapshot.
- whyDeepEvidenceChangedConclusion: 2-4 sentences. If deepEvidenceSummary or contradictions are present in the snapshot, explain in plain English why the evidence below the logs (network/process/port/MQTT/config) supports or refines this conclusion — reference only fields shown in the snapshot. If no deep evidence is present, return exactly: "No Deep Evidence collected — explanation based on logs and service checks only."`;
}

function buildExecutionPrompt(snapshot) {
  return `Explain this Autopilot execution report to a field technician.

EXECUTION_SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

Required output fields (all strings, plain text):
- resultSummary: 2-3 sentences. State whether the fix succeeded and whether verification confirmed it.
- whatChanged: 2-4 sentences describing what the executed actions actually did, based on stdout/stderr and exit codes only.
- verificationExplanation: 2-3 sentences. Compare before vs after for each verified action. If fixVerified is false, say so explicitly.
- remainingRisk: 2-3 sentences on what could still be wrong or recur. If there is no obvious risk, say so.
- nextSteps: 2-4 sentences of concrete follow-up. Do not propose new commands. Refer the technician to deterministic checks (re-run verify, scan again, escalate).
- escalationUpdateDraft: 3-5 sentence draft for updating an existing escalation ticket. Plain text only.`;
}

/* ---------- Ollama call ---------- */

const TOOL_PLAN = [{
  type: "function",
  function: {
    name: "emit_plan_explanation",
    description: "Return the structured explanation of an Autopilot plan.",
    parameters: {
      type: "object",
      properties: {
        plainEnglishSummary: { type: "string" },
        whyThisMatched: { type: "string" },
        riskExplanation: { type: "string" },
        whatWillHappen: { type: "string" },
        whatCouldGoWrong: { type: "string" },
        approvalGuidance: { type: "string" },
        escalationDraft: { type: "string" },
      },
      required: ["plainEnglishSummary", "whyThisMatched", "riskExplanation", "whatWillHappen", "whatCouldGoWrong", "approvalGuidance", "escalationDraft"],
    },
  },
}];

const TOOL_EXEC = [{
  type: "function",
  function: {
    name: "emit_execution_explanation",
    description: "Return the structured explanation of an Autopilot execution report.",
    parameters: {
      type: "object",
      properties: {
        resultSummary: { type: "string" },
        whatChanged: { type: "string" },
        verificationExplanation: { type: "string" },
        remainingRisk: { type: "string" },
        nextSteps: { type: "string" },
        escalationUpdateDraft: { type: "string" },
      },
      required: ["resultSummary", "whatChanged", "verificationExplanation", "remainingRisk", "nextSteps", "escalationUpdateDraft"],
    },
  },
}];

function safeStr(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
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

async function callOllama({ endpoint, model, timeoutMs, systemPrompt, userPrompt, tools }) {
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
        tools,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "ollama_timeout" : "ollama_unavailable",
      message: aborted
        ? "Local AI timed out — Autopilot still works without AI explanation."
        : `Local AI unavailable — Autopilot still works without AI explanation. (${err?.message || String(err)})`,
      endpoint, model,
    };
  }
  clearTimeout(t);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: "ollama_http_error", message: `Ollama HTTP ${res.status}. ${text.slice(0, 200)}`, endpoint, model };
  }
  let data;
  try { data = await res.json(); }
  catch (err) { return { ok: false, reason: "ollama_bad_json", message: `Ollama returned non-JSON: ${err?.message || err}`, endpoint, model }; }
  const parsed = parseOllama(data);
  if (!parsed) return { ok: false, reason: "ollama_no_structured_output", message: "Ollama did not return a parseable JSON object.", endpoint, model };
  return { ok: true, data: parsed };
}

/* ---------- Sanitizers (force disclaimer, never let AI invent commands) ---------- */

const DISCLAIMER = "AI explanation only. Fix decision and safety are controlled by the deterministic engine.";

// Strip anything that looks like a shell command suggestion
function stripCommandSuggestions(text) {
  if (!text) return "";
  // Remove fenced code blocks and inline backticks
  return String(text)
    .replace(/```[\s\S]*?```/g, "[command output omitted]")
    .replace(/`[^`]*`/g, "")
    .trim();
}

function sanitizePlanAi(ai) {
  const out = {
    plainEnglishSummary: stripCommandSuggestions(safeStr(ai?.plainEnglishSummary)),
    whyThisMatched: stripCommandSuggestions(safeStr(ai?.whyThisMatched)),
    riskExplanation: stripCommandSuggestions(safeStr(ai?.riskExplanation)),
    whatWillHappen: stripCommandSuggestions(safeStr(ai?.whatWillHappen)),
    whatCouldGoWrong: stripCommandSuggestions(safeStr(ai?.whatCouldGoWrong)),
    approvalGuidance: stripCommandSuggestions(safeStr(ai?.approvalGuidance)),
    escalationDraft: stripCommandSuggestions(safeStr(ai?.escalationDraft)),
  };
  if (!out.approvalGuidance.includes(DISCLAIMER)) {
    out.approvalGuidance = (out.approvalGuidance ? out.approvalGuidance.replace(/\.?\s*$/, ". ") : "") + DISCLAIMER;
  }
  return out;
}

function sanitizeExecAi(ai) {
  return {
    resultSummary: stripCommandSuggestions(safeStr(ai?.resultSummary)),
    whatChanged: stripCommandSuggestions(safeStr(ai?.whatChanged)),
    verificationExplanation: stripCommandSuggestions(safeStr(ai?.verificationExplanation)),
    remainingRisk: stripCommandSuggestions(safeStr(ai?.remainingRisk)),
    nextSteps: stripCommandSuggestions(safeStr(ai?.nextSteps)),
    escalationUpdateDraft: stripCommandSuggestions(safeStr(ai?.escalationUpdateDraft)),
  };
}

/* ---------- Public API ---------- */

export async function explainPlan({ plan, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const snapshot = safePlanSnapshot(plan);
  if (!snapshot) return { ok: false, reason: "invalid_plan", message: "No plan provided to explain." };

  const r = await callOllama({
    endpoint, model, timeoutMs,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPlanPrompt(snapshot),
    tools: TOOL_PLAN,
  });
  if (!r.ok) return { ...r, snapshot };

  const ai = sanitizePlanAi(r.data);
  return {
    ok: true,
    mode: "LOCAL_OLLAMA",
    endpoint, model,
    ai,
    snapshot,
    notice: "AI explanation only. Fix decision and safety are controlled by the deterministic engine.",
  };
}

export async function explainExecution({ report, plan, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const snapshot = safeReportSnapshot(report, plan);
  if (!snapshot) return { ok: false, reason: "invalid_report", message: "No execution report provided to explain." };

  const r = await callOllama({
    endpoint, model, timeoutMs,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildExecutionPrompt(snapshot),
    tools: TOOL_EXEC,
  });
  if (!r.ok) return { ...r, snapshot };

  const ai = sanitizeExecAi(r.data);
  return {
    ok: true,
    mode: "LOCAL_OLLAMA",
    endpoint, model,
    ai,
    snapshot,
    notice: "AI explanation only. Fix decision and safety are controlled by the deterministic engine.",
  };
}
