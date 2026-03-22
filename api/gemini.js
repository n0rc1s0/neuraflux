// api/gemini.js v5.1 — Rotazione chiavi + modelli diversi
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Body non valido' }); }
  }
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const caller = body._caller || 'fluxy';
  if (caller === 'generator') return handleGenerator(body, res);
  if (caller === 'feedback') return handleFeedback(body, res);
  return handleFluxy(body, res);
};

// ── GENERATORE: 5 chiavi OpenRouter su modelli DIVERSI + Gemini fallback ──────
async function handleGenerator(body, res) {
  // Ogni chiave usa un modello diverso — se uno è esaurito, l'altro no
  const keys = [
    { key: process.env.OPENROUTER_KEY,   model: 'qwen/qwen3-coder:free' },
    { key: process.env.OPENROUTER_KEY_2, model: 'deepseek/deepseek-r1-0528:free' },
    { key: process.env.OPENROUTER_KEY_3, model: 'google/gemini-2.0-flash-exp:free' },
    { key: process.env.OPENROUTER_KEY_4, model: 'meta-llama/llama-4-maverick:free' },
    { key: process.env.OPENROUTER_KEY_5, model: 'qwen/qwen3-coder:free' },
  ].filter(k => k.key);

  for (const { key, model } of keys) {
    try {
      const result = await callOpenRouter(body, key, model);
      if (result) return res.status(200).json(result);
    } catch(e) {
      if (e.message.includes('429') || e.message.includes('rate') || e.message.includes('quota')) continue;
      continue;
    }
  }

  // Fallback: Gemini con GEMINI_KEY_FLUXY
  const geminiKey = process.env.GEMINI_KEY_FLUXY;
  if (geminiKey) {
    try {
      const cleanBody = { ...body };
      delete cleanBody._caller;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanBody) }
      );
      if (r.ok) return res.status(200).json(await r.json());
    } catch(e) {}
  }

  return res.status(429).json({ error: 'Tutti i generatori sono temporaneamente al limite. Aggiungi la tua chiave personale nelle impostazioni o riprova tra qualche minuto.' });
}

// ── FLUXY: 3 chiavi (Groq → Cerebras → Mistral) ───────────────────────────────
async function handleFluxy(body, res) {
  const keys = [
    { key: process.env.GROQ_KEY,   type: 'groq' },
    { key: process.env.GROQ_KEY_2, type: 'cerebras' },
    { key: process.env.GROQ_KEY_3, type: 'mistral' },
  ].filter(k => k.key);

  for (const { key, type } of keys) {
    try {
      let result = null;
      if (type === 'groq')     result = await callGroq(body, key);
      if (type === 'cerebras') result = await callCerebras(body, key);
      if (type === 'mistral')  result = await callMistral(body, key);
      if (result) {
        result._aiType = type;
        return res.status(200).json(result);
      }
    } catch(e) {
      if (e.message.includes('429') || e.message.includes('rate')) continue;
      continue;
    }
  }

  return res.status(429).json({ error: 'Servizi AI temporaneamente al limite. Riprova tra qualche minuto.' });
}

// ── FEEDBACK: GEMINI_KEY_FLUXY ─────────────────────────────────────────────────
async function handleFeedback(body, res) {
  const key = process.env.GEMINI_KEY_FLUXY;
  if (!key) return res.status(503).json({ error: 'Chiave feedback non configurata.' });
  try {
    const cleanBody = { ...body };
    delete cleanBody._caller;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanBody) }
    );
    if (!r.ok) return res.status(r.status).json({ error: `Gemini ${r.status}` });
    return res.status(200).json(await r.json());
  } catch(e) { return res.status(500).json({ error: e.message }); }
}

// ── OpenRouter ─────────────────────────────────────────────────────────────────
async function callOpenRouter(body, key, model) {
  const messages = toOpenAI(body);
  if (!messages.length) return null;

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://neura-flux.vercel.app',
      'X-Title': 'Nextly'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: body.generationConfig?.maxOutputTokens || 16384,
      temperature: body.generationConfig?.temperature || 0.7
    })
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`OpenRouter ${r.status}: ${err.error?.message || 'errore'}`);
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── Groq ───────────────────────────────────────────────────────────────────────
async function callGroq(body, key) {
  const messages = toOpenAI(body);
  if (!messages.length) return null;
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 1200, temperature: 0.9 })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(`Groq ${r.status}: ${e.error?.message||''}`); }
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── Cerebras ───────────────────────────────────────────────────────────────────
async function callCerebras(body, key) {
  const messages = toOpenAI(body);
  if (!messages.length) return null;
  const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama-3.3-70b', messages, max_tokens: 1200, temperature: 0.9 })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(`Cerebras ${r.status}: ${e.error?.message||''}`); }
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── Mistral ────────────────────────────────────────────────────────────────────
async function callMistral(body, key) {
  const messages = toOpenAI(body);
  if (!messages.length) return null;
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mistral-small-latest', messages, max_tokens: 1200, temperature: 0.9 })
  });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(`Mistral ${r.status}: ${e.error?.message||''}`); }
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── Helper: Gemini → OpenAI format ────────────────────────────────────────────
function toOpenAI(body) {
  const { system_instruction, contents } = body;
  const messages = [];
  const sys = system_instruction?.parts?.map(p => p.text).join('\n') || '';
  if (sys) messages.push({ role: 'system', content: sys });
  for (const c of (contents || [])) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const textParts = (c.parts || []).filter(p => p.text).map(p => p.text).join('\n');
    const imgParts = (c.parts || []).filter(p => p.inlineData);
    if (imgParts.length > 0) {
      const content = [];
      if (textParts) content.push({ type: 'text', text: textParts });
      for (const img of imgParts) {
        content.push({ type: 'image_url', image_url: { url: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` } });
      }
      messages.push({ role, content });
    } else if (textParts) {
      messages.push({ role, content: textParts });
    }
  }
  return messages;
}
