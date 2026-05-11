export async function explainDeepEvidenceWithClaude(payload = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "ANTHROPIC_API_KEY not set"
    };
  }

  const safe = JSON.stringify(payload).slice(0, 60000);

  const prompt = `
You are a senior Austco/Tacera escalation engineer.

Translate the following machine/deep-evidence result for a less experienced technician.

Rules:
- Do not invent facts.
- Do not mention MQTT/event broker unless direct evidence exists.
- Port 10000 is Webmin/admin.
- Port 8080 is irrelevant unless explicitly configured.
- Webmin reachable proves admin access only, not Tacera app health.
- Separate proof from assumptions.
- Give exact next steps and what not to touch.
- Output JSON only.

Required JSON:
{
  "whatIsBroken": "...",
  "why": "...",
  "whatIsProven": [],
  "whatIsNotProven": [],
  "nextSteps": [],
  "exactCommands": [],
  "doNotTouch": [],
  "fieldTechExplanation": "...",
  "seniorTechExplanation": "...",
  "developerProofSummary": "...",
  "customerSafeSummary": "..."
}

Evidence:
${safe}
`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 2500,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() };
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";

  try {
    return { ok: true, ai: JSON.parse(text) };
  } catch {
    return { ok: true, ai: { raw: text } };
  }
}
