import { executeInvestigationPlan } from "./aiToolRouter.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";

async function callClaude(payload) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      model: "claude",
      error: "Missing ANTHROPIC_API_KEY"
    };
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 3000,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: JSON.stringify(payload)
      }]
    })
  });

  const txt = r.ok
    ? (await r.json())?.content?.[0]?.text || ""
    : await r.text();

  return {
    ok: r.ok,
    model: "claude",
    text: txt
  };
}

async function callOllama(payload) {
  const r = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3.2:3b",
      stream: false,
      messages: [{
        role: "user",
        content: JSON.stringify(payload)
      }]
    })
  });

  const data = await r.json();

  return {
    ok: r.ok,
    model: "ollama",
    text: data?.message?.content || data?.response || ""
  };
}

export async function runLiveWarRoom(input = {}) {
  const hosts = input.hosts || [];

  const collected = await executeInvestigationPlan({
    hosts
  });

  const payload = {
    role:
      "Senior Austco/Tacera root cause investigator",

    objective:
      "Determine EXACTLY why the signal path failed.",

    requiredQuestions: [
      "Did PST generate the alarm?",
      "Did IPConnect receive it?",
      "Did Integration Gateway process it?",
      "Did CCT receive it?",
      "Did ODL/ZTS activate?",
      "Was there delayed queue flush?",
      "Was there controller overload?",
      "Were duplicate activation floods present?",
      "Was first alarm delayed until second alarm?",
      "What failed FIRST?"
    ],

    importantRules: [
      "Do not mention MQTT unless direct evidence proves MQTT involvement.",
      "Explain in plain English.",
      "Separate proof from assumptions.",
      "Explain exactly how to reproduce and verify.",
      "Explain exact fix path."
    ],

    evidence:
      collected
  };

  const [claude, ollama] = await Promise.allSettled([
    callClaude(payload),
    callOllama(payload)
  ]);

  return {
    ok: true,
    collected,
    claude:
      claude.status === "fulfilled"
        ? claude.value
        : { ok:false,error:String(claude.reason) },

    ollama:
      ollama.status === "fulfilled"
        ? ollama.value
        : { ok:false,error:String(ollama.reason) },
  };
}
