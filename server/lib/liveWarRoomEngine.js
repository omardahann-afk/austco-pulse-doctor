import { collectAllRootSentinels } from "./rootSentinelCollector.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";

async function callGroq(payload) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": \`Bearer \${process.env.GROQ_API_KEY}\`
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [{
        role: "user",
        content: JSON.stringify(payload)
      }],
      temperature: 0.1
    })
  });

  const data = await r.json();

  return {
    ok: r.ok,
    provider: "groq",
    text: data?.choices?.[0]?.message?.content || JSON.stringify(data)
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
    provider: "ollama",
    text: data?.message?.content || data?.response || ""
  };
}

export async function runLiveWarRoom() {
  const collected = await collectAllRootSentinels();

  const payload = {
    role: "Senior Austco/Tacera root cause investigator",
    objective: "Find the REAL root cause across all appliances.",
    rules: [
      "Explain in plain English.",
      "Do not mention MQTT unless direct evidence exists.",
      "Identify what failed FIRST.",
      "Differentiate symptom vs root cause.",
      "Explain exact next fix."
    ],
    evidence: collected
  };

  const [groq, ollama] = await Promise.allSettled([
    callGroq(payload),
    callOllama(payload)
  ]);

  return {
    ok: true,
    collected,
    groq:
      groq.status === "fulfilled"
        ? groq.value
        : { ok:false,error:String(groq.reason) },

    ollama:
      ollama.status === "fulfilled"
        ? ollama.value
        : { ok:false,error:String(ollama.reason) },
  };
}
