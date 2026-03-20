// api/gemini.js — Proxy sicuro per Gemini API
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(500).json({ error: 'Chiave API Gemini non configurata sul server. Aggiungi GEMINI_KEY nelle variabili d\'ambiente Vercel.' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || `Errore Gemini: ${response.status}`
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: `Errore interno: ${err.message}` });
  }
};
