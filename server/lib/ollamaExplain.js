/**
 * Local Ollama explanation layer.
 * Summarizes the rule-engine diagnosis in plain language.
 * NEVER overrides root cause, confidence, or evidence — strips/ignores any
 * AI fields that conflict with the rule-engine output.
 */

const DEFAULT_ENDPOINT = "http://localhost:11434/api/chat";
const DEFAULT_MODEL = "llama3.2:3b";

const SYSTEM_PROMPT = `You are an explanation assistant for the Tacera/Austco Site Doctor.
You receive a deterministic rule-based diagnosis with evidence already gathered.
You MUST:
- Only summarize and explain what is in the input.
- Never invent IP addresses, hostnames, devices, log lines, services, or numbers.
- Never change the root cause, the confidence score, or the evidence.
- Always include the phrase "based on available evidence".
- If the evidence list is empty or breakFoundAt is "No confirmed break", state explicitly that the evidence is insufficient and recommend pulling more logs.
- Keep each field concise. No marketing language.

Return ONLY a JSON object via the provided tool. No prose outside the tool call.`;

function buildPayload(diagnosis) {
  // Only forward the safe fields
  return {
    breakFoundAt: diagnosis?.breakFoundAt || "No confirmed break",
    primaryCause: diagnosis?.primaryCause || "",
    confidence: typeof diagnosis?.confidence === "number" ? diagnosis.confidence : 0,
    confidenceReasons: Array.isArray(diagnosis?.confidenceReasons) ? diagnosis.confidenceReasons.slice(0, 10) : [],
    evidence: Array.isArray(diagnosis?.evidence) ? diagnosis.evidence.slice(0, 30) : [],
    fixActions: Array.isArray(diagnosis?.fixActions) ? diagnosis.fixActions.slice(0, 10) : [],
    affectedServices: Array.isArray(diagnosis?.affectedServices) ? diagnosis.affectedServices.slice(0, 20) : [],
  };
}

function buildUserPrompt(payload) {
  return `Here is the rule-based diagnosis. Summarize it in five short sections.

DIAGNOSIS_INPUT:
${JSON.stringify(payload, null, 2)}

Required output fields (all strings, plain text):
- plainEnglishSummary: 2-3 sentences a non-technical reader can follow.
- technicianExplanation: 3-5 sentences a field technician can act on.
- escalationSummary: 1-2 sentences suitable to paste into an escalation ticket.
- customerFriendlySummary: 1-2 sentences for the customer/site owner. No jargon. No IPs.
- safetyNotes: any cautions before restarting services or changing configs. If none, say "None.".

Constraints:
- Do not invent details not present in DIAGNOSIS_INPUT.
- Include the phrase "based on available evidence" in plainEnglishSummary.
- If breakFoundAt is "No confirmed break" or evidence is empty, say evidence is insufficient and recommend collecting more logs.`;
}

function safeStr(v) { return typeof v === "string" ? v : (v == null ? "" : String(v)); }

function extractJson(text) {
  if (!text) return null;
  // Find the first { ... } block
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function parseOllamaResponse(json) {
  // /api/chat non-streaming returns { message: { role, content, tool_calls? }, ... }
  const msg = json?.message || {};
  // Tool call path
  const tc = Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
  if (tc?.function?.arguments) {
    const a = tc.function.arguments;
    if (typeof a === "string") {
      const parsed = extractJson(a);
      if (parsed) return parsed;
    } else if (typeof a === "object") return a;
  }
  // Plain content path — try JSON
  return extractJson(safeStr(msg.content));
}

function sanitizeAi(ai, diagnosis) {
  const out = {
    plainEnglishSummary: safeStr(ai?.plainEnglishSummary).trim(),
    technicianExplanation: safeStr(ai?.technicianExplanation).trim(),
    escalationSummary: safeStr(ai?.escalationSummary).trim(),
    customerFriendlySummary: safeStr(ai?.customerFriendlySummary).trim(),
    safetyNotes: safeStr(ai?.safetyNotes).trim() || "None.",
  };
  // Force the disclaimer
  if (!/based on available evidence/i.test(out.plainEnglishSummary)) {
    out.plainEnglishSummary = (out.plainEnglishSummary
      ? out.plainEnglishSummary.replace(/\.?$/, ".")
      : "") + " Based on available evidence.";
    out.plainEnglishSummary = out.plainEnglishSummary.trim();
  }
  // If insufficient evidence, force the message
  const insufficient =
    (diagnosis?.breakFoundAt === "No confirmed break") ||
    !Array.isArray(diagnosis?.evidence) || diagnosis.evidence.length === 0;
  if (insufficient) {
    out.plainEnglishSummary = "Based on available evidence, the evidence is insufficient to confirm a root cause. Pull additional logs (enable more services or add log paths) and re-run diagnosis.";
    out.escalationSummary = out.escalationSummary || "Insufficient evidence collected — request additional log paths or reproduce the issue and re-capture.";
  }
  return out;
}

export async function explainWithOllama({
  diagnosis,
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  timeoutMs = 30_000,
} = {}) {
  if (!diagnosis || typeof diagnosis !== "object") {
    return { ok: false, reason: "no_diagnosis", message: "No diagnosis to explain." };
  }
  const payload = buildPayload(diagnosis);
  const userPrompt = buildUserPrompt(payload);

  const tools = [{
    type: "function",
    function: {
      name: "emit_explanation",
      description: "Return the structured explanation of the diagnosis.",
      parameters: {
        type: "object",
        properties: {
          plainEnglishSummary: { type: "string" },
          technicianExplanation: { type: "string" },
          escalationSummary: { type: "string" },
          customerFriendlySummary: { type: "string" },
          safetyNotes: { type: "string" },
        },
        required: [
          "plainEnglishSummary", "technicianExplanation",
          "escalationSummary", "customerFriendlySummary", "safetyNotes",
        ],
      },
    },
  }];

  const body = {
    model,
    stream: false,
    format: "json",
    options: { temperature: 0.2 },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    tools,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    return {
      ok: false,
      reason: "ollama_unavailable",
      message: `Local AI unavailable — showing rule-based diagnosis only. (${err?.message || String(err)})`,
      endpoint, model,
    };
  }
  clearTimeout(t);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "ollama_http_error",
      message: `Ollama HTTP ${res.status}. ${text.slice(0, 200)}`,
      endpoint, model,
    };
  }

  let data;
  try { data = await res.json(); }
  catch (err) {
    return { ok: false, reason: "ollama_bad_json", message: `Ollama returned non-JSON: ${err?.message || err}`, endpoint, model };
  }

  const parsed = parseOllamaResponse(data);
  if (!parsed) {
    return { ok: false, reason: "ollama_no_structured_output", message: "Ollama did not return a parseable JSON object.", endpoint, model };
  }

  const ai = sanitizeAi(parsed, diagnosis);
  return {
    ok: true,
    mode: "LOCAL_OLLAMA",
    endpoint, model,
    ai,
    notice: "AI explanation based only on real backend evidence. Root cause and confidence come from the rule engine, not AI.",
  };
}
