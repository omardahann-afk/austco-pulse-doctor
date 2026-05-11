import { buildHumanDiagnosisFromLines, TACERA_KNOWLEDGE_BASE } from "./taceraKnowledgeBase.js";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";

function capLines(lines = [], max = 300) {
  return lines.slice(-max).map(x => String(x).slice(0, 700));
}

export async function runClaudeDiagnosis({ lines = [], context = {} } = {}) {
  const deterministic = buildHumanDiagnosisFromLines(lines);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: true,
      mode: "deterministic_only",
      warning: "ANTHROPIC_API_KEY not set. Claude skipped.",
      deterministic,
      ai: null,
    };
  }

  const safePayload = {
    instructions: `
You are a senior Austco/Tacera diagnostic assistant.

You MUST follow these rules:
1. Deterministic evidence is source of truth.
2. Do not invent facts.
3. Do not mention MQTT unless direct evidence says MQTT/broker.
4. Translate complex logs into field-tech language.
5. Keep developer proof available.
6. Separate root cause from downstream symptoms.
7. Suppress known ignorable Tacera messages using the knowledge base.
8. Output JSON only.

Required output:
{
  "fieldTechSummary": "...",
  "rootCause": "...",
  "why": "...",
  "whatHappenedFirst": "...",
  "downstreamSymptoms": [],
  "ignoredNoise": [],
  "nextSteps": [],
  "doNotDo": [],
  "developerProofSummary": "...",
  "customerSafeSummary": "...",
  "confidenceExplanation": "..."
}
`,
    context,
    deterministic,
    taceraKnowledgeBase: TACERA_KNOWLEDGE_BASE,
    logLines: capLines(lines),
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2200,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
    }),
  });

  if (!r.ok) {
    return {
      ok: false,
      mode: "claude_failed",
      status: r.status,
      error: await r.text(),
      deterministic,
      ai: null,
    };
  }

  const data = await r.json();
  const text = data?.content?.[0]?.text || "";

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return {
    ok: true,
    mode: "claude_plus_deterministic",
    deterministic,
    ai: parsed,
  };
}
