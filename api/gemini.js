// api/gemini.js — Proxy con fallback a cascata + body parsing
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  // Parsa il body manualmente se non è già parsato
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'Body JSON non valido' }); }
  }
  if (!body) return res.status(400).json({ error: 'Body mancante' });

  const caller = body._caller || 'fluxy';
  const isGenerator = caller === 'generator';

  if (isGenerator) {
    return handleGenerator(body, res);
  } else {
    return handleFluxy(body, res);
  }
};

// ── FLUXY: Gemini → Groq fallback ─────────────────────────
async function handleFluxy(body, res) {
  const geminiKey = process.env.GEMINI_KEY_FLUXY || process.env.GEMINI_KEY;

  if (geminiKey) {
    try {
      const cleanBody = { ...body };
      delete cleanBody._caller;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanBody) }
      );
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
        if (text) return res.status(200).json(data);
      }
    } catch(e) {
      console.error('Gemini fallito:', e.message);
    }
  }

  // Fallback: Groq
  const groqKey = process.env.GROQ_KEY;
  if (groqKey) {
    try {
      const result = await callGroq(body, groqKey);
      if (result) return res.status(200).json(result);
    } catch(e) {
      console.error('Groq fallito:', e.message);
    }
  }

  return res.status(503).json({ error: 'Servizi AI temporaneamente non disponibili. Riprova tra qualche minuto.' });
}

// ── GENERATORE: OpenRouter → Gemini fallback ───────────────
async function handleGenerator(body, res) {
  const orKey = process.env.OPENROUTER_KEY;
  if (orKey) {
    try {
      const result = await callOpenRouter(body, orKey);
      if (result) return res.status(200).json(result);
    } catch(e) {
      console.error('OpenRouter fallito:', e.message);
    }
  }

  // Fallback: Gemini
  const geminiKey = process.env.GEMINI_KEY_FLUXY || process.env.GEMINI_KEY;
  if (geminiKey) {
    try {
      const cleanBody = { ...body };
      delete cleanBody._caller;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanBody) }
      );
      if (response.ok) {
        const data = await response.json();
        return res.status(200).json(data);
      }
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `Errore ${response.status}` });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(503).json({ error: 'Nessuna chiave API configurata. Aggiungi GEMINI_KEY su Vercel.' });
}

// ── Groq ───────────────────────────────────────────────────
async function callGroq(body, key) {
  const { system_instruction, contents, generationConfig } = body;
  const systemText = system_instruction?.parts?.map(p => p.text).join('\n') || '';
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const c of (contents || [])) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const text = (c.parts || []).filter(p => p.text).map(p => p.text).join('\n');
    if (text) messages.push({ role, content: text });
  }
  if (!messages.length) return null;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: generationConfig?.maxOutputTokens || 1200,
      temperature: generationConfig?.temperature || 0.9
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ── OpenRouter ─────────────────────────────────────────────
async function callOpenRouter(body, key) {
  const { system_instruction, contents, generationConfig } = body;
  const systemText = system_instruction?.parts?.map(p => p.text).join('\n') || '';
  const messages = [];
  if (systemText) messages.push({ role: 'system', content: systemText });
  for (const c of (contents || [])) {
    const role = c.role === 'model' ? 'assistant' : 'user';
    const textParts = (c.parts || []).filter(p => p.text).map(p => p.text).join('\n');
    const imageParts = (c.parts || []).filter(p => p.inlineData);
    if (imageParts.length > 0) {
      const content = [];
      if (textParts) content.push({ type: 'text', text: textParts });
      for (const img of imageParts) {
        content.push({ type: 'image_url', image_url: { url: `data:${img.inlineData.mimeType};base64,${img.inlineData.data}` } });
      }
      messages.push({ role, content });
    } else if (textParts) {
      messages.push({ role, content: textParts });
    }
  }
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
      max_tokens: generationConfig?.maxOutputTokens || 16384,
      temperature: generationConfig?.temperature || 0.7
    })
  });

  if (!response.ok) return null;
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) return null;
  return { candidates: [{ content: { parts: [{ text }] } }] };
}
