const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

function cleanLines(lines = []) {
  return lines
    .map(x => typeof x === "string" ? x : (x?.line || x?.rawMessage || x?.message || JSON.stringify(x)))
    .filter(Boolean)
    .slice(-800)
    .map(x => x.slice(0, 1000));
}

function buildEvidencePack({ problem, devices, lines }) {
  const joined = lines.join("\n");

  const signals = {
    hasCodeBlue: /code blue/i.test(joined),
    hasCodeWhite: /code white/i.test(joined),
    hasStaffAssist: /staff assist/i.test(joined),
    hasReadRegister: /READ_REGISTER|READW_REGISTER/i.test(joined),
    hasBadMessage: /\bBAD\b|bad message/i.test(joined),
    hasSecondAlarmFlush: /second alarm|first appear|missed earlier|stuck/i.test(joined),
    hasCctRestart: /CCT.*restart|reset itself|watchdog|lock up|locked up/i.test(joined),
    hasConnectionIssue: /not connected|connecting|disconnect|timeout|connection refused/i.test(joined),
    hasMqttEvidence: /mqtt|broker/i.test(joined),
  };

  const cctIds = [...new Set([...joined.matchAll(/\b(\d{3,5})\.\d+\.\d+\.\d+\b/g)].map(m => m[1]))];
  const sbusDevs = [...new Set([...joined.matchAll(/Polling to dev\s+(\d+)/gi)].map(m => m[1]))];

  return {
    problem,
    devices,
    signals,
    cctIds,
    sbusDevs,
    counts: {
      lines: lines.length,
      cctIds: cctIds.length,
      sbusDevs: sbusDevs.length,
    },
    rawEvidence: lines,
  };
}

export async function investigateRootCauseWithAI({ problem, devices = [], lines = [] }) {
  const safeLines = cleanLines(lines);
  const evidencePack = buildEvidencePack({ problem, devices, lines: safeLines });

  const deterministicGuardrails = {
    rules: [
      "Do not mention MQTT/event broker unless direct evidence exists.",
      "Separate proven evidence from assumptions.",
      "If multiple ODL/ZTS activations hit the same CCT and delayed/stuck/missed alarm behavior appears, consider CCT overload / duplicate zone activation flood.",
      "If first alarm appears only after second alarm, consider queue delay/flush behavior.",
      "If Webmin/SSH works, that proves admin access only, not application health.",
      "Do not claim root cause unless evidence supports it.",
      "Always give exact next steps and exact proof needed for engineering.",
    ],
    expectedOutput: {
      rootCause: "string",
      confidence: "0-100",
      brokenLayer: "string",
      whatFailedFirst: "string",
      plainEnglish: "string",
      whyThisMakesSense: "string",
      evidenceThatMatters: ["string"],
      evidenceMissing: ["string"],
      ruledOut: ["string"],
      nextActions: ["string"],
      testPlan: ["string"],
      developerEscalation: "string",
      customerSafeSummary: "string"
    }
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      mode: "missing_ai_key",
      message: "ANTHROPIC_API_KEY is not set. AI Investigator cannot run.",
      evidencePack,
    };
  }

  const prompt = {
    role: "Senior Austco/Tacera root-cause investigator",
    task:
      "Analyze the live incident evidence and determine the most likely root cause. Translate it so a normal technician understands exactly what is broken and how to prove/fix it.",
    knownTaceraContext: [
      "IP-PST2 can generate alarms.",
      "IP-CCT controls ODL/ZTS zone devices.",
      "Display Assignment can target ODL/ZTS devices.",
      "Assigning multiple devices on the same CCT may generate duplicate zone activation messages.",
      "Duplicate or excessive zone activation events can overwhelm a controller.",
      "Symptoms include missed first alarm, delayed ODL activation, stuck ODL, short ZTS beep, or CCT reset.",
      "A second alarm causing the first alarm to appear suggests queued/delayed processing, not a missing assignment alone.",
      "Use CCP/IPConnect assignment truth, PST logs, CCT logs, and InGa logs together."
    ],
    deterministicGuardrails,
    evidencePack,
    outputRequirement:
      "Return JSON only. No markdown. No generic monitoring language. No MQTT unless proven."
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3500,
      temperature: 0.1,
      messages: [{ role: "user", content: JSON.stringify(prompt) }]
    })
  });

  const text = response.ok
    ? (await response.json())?.content?.[0]?.text || ""
    : await response.text();

  let ai;
  try {
    ai = JSON.parse(text);
  } catch {
    ai = { raw: text };
  }

  return {
    ok: response.ok,
    mode: "ai_investigator",
    status: response.status,
    evidencePack,
    ai
  };
}
