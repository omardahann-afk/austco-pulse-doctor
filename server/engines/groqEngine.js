/**
 * groqEngine.js
 * 
 * Uses Groq API to explain findings in plain English and generate fix plans.
 * Groq is fast (sub-second) and free tier is generous.
 * 
 * AI only EXPLAINS. Deterministic engine controls ALL execution.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_KEY = process.env.GROQ_API_KEY;

const SYSTEM_PROMPT = `You are an expert Austco/Tacera nurse call system engineer.
You explain system failures in plain English for field technicians.
You know these systems deeply:
- IP-Connect (XmlBlaster) - the core nurse call engine
- Integration Gateway (INGA) - WebSocket bridge
- Pulse Gateway - Nginx reverse proxy
- License Service (LMX) - LM-X license server
- Pulse Manage - configuration API
- IP-PST2 - bedside station with TCP transport
- IP-CCT - floor controller

Rules:
- Be direct and brief. Max 3 sentences per section.
- No jargon the technician wouldn't know.
- Always give ONE clear next action.
- Never say "it appears" or "it seems". State facts.
- If license failure: always mention checking dmidecode UUID vs .lic file.
- If TCP socket failure: always mention checking the IPC target IP and port.`;

/**
 * Ask Groq to explain a root cause finding.
 * Returns plain English explanation + recommended action.
 */
export async function groqExplain({ rootCauseType, rootCauseLabel, cascade, events, role, ip }) {
  if (!GROQ_KEY) return null;

  const topEvents = (events || []).slice(0, 5).map(e => e.raw).join('\n');
  const cascadeText = (cascade || []).filter(c => c.confirmed).map(c => c.label).join(' → ');

  const userMessage = `
Appliance: ${ip} (${role})
Root cause detected: ${rootCauseLabel}
Cascade: ${cascadeText || 'none confirmed'}
Top log evidence:
${topEvents}

Explain in plain English:
1. WHAT HAPPENED (1 sentence)
2. WHY IT MATTERS for the nurse call system (1 sentence)  
3. EXACT NEXT STEP for the technician (1 sentence)
4. WHAT TO CHECK AFTER fixing it (1 sentence)

Keep it under 100 words total.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[groq] API error:', res.status, err.slice(0, 200));
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[groq] fetch error:', err.message);
    return null;
  }
}

/**
 * Ask Groq to generate a simple repair checklist.
 */
export async function groqRepairPlan({ rootCauseType, rootCauseLabel, ip, role }) {
  if (!GROQ_KEY) return null;

  const userMessage = `
Appliance ${ip} (${role}) has this issue: ${rootCauseLabel}

Give me a numbered repair checklist, max 5 steps.
Each step must be one action a field technician can do right now.
Be specific to Austco/Tacera systems.
No fluff. Just the steps.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[groq] repair plan error:', err.message);
    return null;
  }
}

/**
 * Try Ollama as fallback if Groq fails.
 */
export async function ollamaExplain({ rootCauseLabel, cascade, ip }) {
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

  const cascadeText = (cascade || []).filter(c => c.confirmed).map(c => c.label).join(' → ');

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Explain in plain English (max 80 words): ${ip} has ${rootCauseLabel}. Cascade: ${cascadeText}. What happened, why it matters, what to do next.` },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.message?.content?.trim() || null;
  } catch (err) {
    return null;
  }
}

/**
 * Get AI explanation — tries Groq first, falls back to Ollama.
 */
export async function getAiExplanation(context) {
  const groqResult = await groqExplain(context);
  if (groqResult) return { text: groqResult, source: 'groq' };

  const ollamaResult = await ollamaExplain(context);
  if (ollamaResult) return { text: ollamaResult, source: 'ollama' };

  return null;
}
