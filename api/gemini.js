// api/gemini.js — Proxy unificato Gemini + OpenRouter
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  const caller = req.body._caller || 'fluxy';
  const isGenerator = caller === 'generator';

  if (isGenerator) {
    const orKey = process.env.OPENROUTER_KEY;
    if (!orKey) return callGemini(req, res);

    const { system_instruction, contents, generationConfig } = req.body;
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
      } else {
        messages.push({ role, content: textParts });
      }
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orKey}`,
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

      const data = await response.json();
      if (!response.ok) return callGemini(req, res);
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) return callGemini(req, res);

      return res.status(200).json({
        candidates: [{ content: { parts: [{ text }] } }]
      });
    } catch (err) {
      return callGemini(req, res);
    }
  }

  return callGemini(req, res);
};

async function callGemini(req, res) {
  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: 'Chiave GEMINI_KEY non configurata su Vercel.' });
  const body = { ...req.body };
  delete body._caller;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || `Errore Gemini ${response.status}` });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: `Errore interno: ${err.message}` });
  }
}
