// api/gemini.js — Nextly v5.0
// Generatore: 5 chiavi OpenRouter con rotazione automatica
// Fluxy: 3 chiavi (Groq + Cerebras + Mistral) con rotazione automatica
// Feedback: GEMINI_KEY_FLUXY

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  // Parsa body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Body JSON non valido' }); }
  }
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const caller = body._caller || 'fluxy';

  if (caller === 'generator') return handleGenerator(body, res);
  if (caller === 'feedback') return handleFeedback(body, res);
  return handleFluxy(body, res);
};

// ═══════════════════════════════════════════════════════════
// GENERATORE — 5 chiavi OpenRouter con rotazione
// ═══════════════════════════════════════════════════════════
async function handleGenerator(body, res) {
  const keys = [
    process.env.OPENROUTER_KEY,
    process.env.OPENROUTER_KEY_2,
    process.env.OPENROUTER_KEY_3,
    process.env.OPENROUTER_KEY_4,
    process.env.OPENROUTER_KEY_5,
  ].filter(Boolean);

  if (keys.length === 0) {
    return res.status(503).json({ error: 'Nessuna chiave generatore configurata.' });
  }

  // Prova ogni chiave in ordine finché una funziona
  let lastError = '';
  for (const key of keys) {
    try {
      const result = await callOpenRouter(body, key);
      if (result) {
        // Indica quale chiave ha funzionato (indice) per il client
        result._keyIndex = keys.indexOf(key);
        return res.status(200).json(result);
      }
    } catch(e) {
      lastError = e.message;
      // Se è quota esaurita (429) prova la prossima chiave
      if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('rate')) {
        continue;
      }
      // Altri errori: prova comunque la prossima
      continue;
    }
  }

  // Tutte le OpenRouter esaurite — fallback Gemini se disponibile
  const geminiKey = process.env.GEMINI_KEY_FLUXY;
  if (geminiKey) {
    try {
      const result = await callGemini(body, geminiKey, 'gemini-2.0-flash');
      if (result) return res.status(200).json(result);
    } catch(e) {}
  }

  return res.status(429).json({ error: 'Tutte le chiavi generatore sono temporaneamente esaurite. Riprova tra qualche minuto.' });
}

// ═══════════════════════════════════════════════════════════
// FLUXY — 3 chiavi con rotazione (Groq + Cerebras + Mistral)
// ═══════════════════════════════════════════════════════════
async function handleFluxy(body, res) {
  const keys = [
    { key: process.env.GROQ_KEY, type: 'groq' },
    { key: process.env.GROQ_KEY_2, type: 'cerebras' },
    { key: process.env.GROQ_KEY_3, type: 'mistral' },
  ].filter(k => k.key);

  if (keys.length === 0) {
    return res.status(503).json({ error: 'Nessuna chiave Fluxy configurata.' });
  }

  let lastError = '';
  for (const { key, type } of keys) {
    try {
      let result = null;
      if (type === 'groq') result = await callGroq(body, key);
      else if (type === 'cerebras') result = await callCerebras(body, key);
      else if (type === 'mistral') result = await callMistral(body, key);

      if (result) {
        result._aiType = type;
        return res.status(200).json(result);
      }
    } catch(e) {
      lastError = e.message;
      if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('rate')) {
        continue;
      }
      continue;
    }
  }

  return res.status(429).json({ error: 'Servizi AI temporaneamente al limite. Riprova tra qualche minuto.' });
}

// ═══════════════════════════════════════════════════════════
// FEEDBACK — usa GEMINI_KEY_FLUXY
// ═══════════════════════════════════════════════════════════
async function handleFeedback(body, res) {
  const key = process.env.GEMINI_KEY_FLUXY;
  if (!key) return res.status(503).json({ error: 'Chiave feedback non configurata.' });

  try {
    const result = await callGemini(body, key, 'gemini-2.0-flash-lite');
    if (result) return res.status(200).json(result);
    return res.status(500).json({ error: 'Risposta vuota dal modello feedback.' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════
// OPENROUTER — Qwen3 Coder (generatore)
// ═══════════════════════════════════════════════════════════
async function callOpenRouter(body, key) {
  const messages = convertToOpenAIMessages(body);
  if (!messages.length) return null;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://neura-flux.vercel.app',
      'X-Title': 'Nextly App Builder'
    },
    body: JSON.stringify({
      model: 'qwen/qwen3-coder:free',
      messages,
      max_tokens: body.generationConfig?.maxOutputTokens || 16384,
      temperature: body.generationConfig?.temperature || 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenRouter ${response.status}: ${err.error?.message || 'errore'}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ═══════════════════════════════════════════════════════════
// GROQ — Llama 3.3 70B (Fluxy primaria)
// ═══════════════════════════════════════════════════════════
async function callGroq(body, key) {
  const messages = convertToOpenAIMessages(body);
  if (!messages.length) return null;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: body.generationConfig?.maxOutputTokens || 1200,
      temperature: body.generationConfig?.temperature || 0.9
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Groq ${response.status}: ${err.error?.message || 'errore'}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ═══════════════════════════════════════════════════════════
// CEREBRAS — Llama 3.3 70B (Fluxy secondaria)
// ═══════════════════════════════════════════════════════════
async function callCerebras(body, key) {
  const messages = convertToOpenAIMessages(body);
  if (!messages.length) return null;

  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages,
      max_tokens: body.generationConfig?.maxOutputTokens || 1200,
      temperature: body.generationConfig?.temperature || 0.9
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Cerebras ${response.status}: ${err.error?.message || 'errore'}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ═══════════════════════════════════════════════════════════
// MISTRAL — Mistral Small (Fluxy terziaria)
// ═══════════════════════════════════════════════════════════
async function callMistral(body, key) {
  const messages = convertToOpenAIMessages(body);
  if (!messages.length) return null;

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
      max_tokens: body.generationConfig?.maxOutputTokens || 1200,
      temperature: body.generationConfig?.temperature || 0.9
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Mistral ${response.status}: ${err.error?.message || 'errore'}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ═══════════════════════════════════════════════════════════
// GEMINI — fallback e feedback
// ═══════════════════════════════════════════════════════════
async function callGemini(body, key, model) {
  const cleanBody = { ...body };
  delete cleanBody._caller;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanBody)
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini ${response.status}: ${err.error?.message || 'errore'}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) return null;
  return data;
}

// ═══════════════════════════════════════════════════════════
// HELPER — converte formato Gemini → OpenAI
// ═══════════════════════════════════════════════════════════
function convertToOpenAIMessages(body) {
  const { system_instruction, contents } = body;
  const messages = [];

  // System prompt
  const systemText = system_instruction?.parts?.map(p => p.text).join('\n') || '';
  if (systemText) messages.push({ role: 'system', content: systemText });

  // Messaggi conversazione
  for (const c of (contents || [])) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const textParts = (c.parts || []).filter(p => p.text).map(p => p.text).join('\n');
    const imageParts = (c.parts || []).filter(p => p.inlineData);

    if (imageParts.length > 0) {
      const content = [];
      if (textParts) content.push({ type: 'text', text: textParts });
      for (const img of imageParts) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` }
        });
      }
      messages.push({ role, content });
    } else if (textParts) {
      messages.push({ role, content: textParts });
    }
  }

  return messages;
}
