// api/config.js — Espone configurazione sicura al client
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  return res.status(200).json({
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    hasGeminiKey: !!(process.env.GEMINI_KEY_FLUXY || process.env.GEMINI_KEY),
    version: '4.4'
  });
};
