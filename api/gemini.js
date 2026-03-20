// api/gemini.js — Nextly AI Router
// Gestisce Fluxy (chat) e il Generatore (codice) su chiavi e modelli separati
// Ottimizzato per massimo numero di utenti con budget zero

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Metodo non consentito' });

  // ── Chi sta chiamando? ──────────────────────────────────────
  // _caller viene aggiunto dal client prima di inviare la richiesta
  const caller = req.body._caller || 'fluxy';
  const body   = { ...req.body };
  delete body._caller; // Rimuove il campo tecnico prima di mandarlo a Gemini

  // ── Scelta modello e chiave in base al caller ───────────────
  let model, key;

  if (caller === 'generator') {
    // GENERATORE: usa modello potente + chiave dedicata
    model = 'gemini-2.5-flash';
    key   = process.env.GEMINI_KEY_GENERATOR
         || process.env.GEMINI_KEY_1
         || process.env.GEMINI_KEY;
  } else {
    // FLUXY: usa modello leggero + chiave dedicata
    // gemini-2.0-flash-lite è 3x più veloce e consuma meno quota
    model = 'gemini-2.0-flash-lite';
    key   = process.env.GEMINI_KEY_FLUXY
         || process.env.GEMINI_KEY_2
         || process.env.GEMINI_KEY;
  }

  if (!key) {
    return res.status(500).json({
      error: 'Chiave API non configurata. Aggiungila nelle variabili d\'ambiente su Vercel.'
    });
  }

  // ── Forza max tokens ottimali se non già impostati ──────────
  if (body.generationConfig) {
    if (caller === 'generator') {
      // Generatore: max 16384 token (era 65536 — spreco enorme)
      body.generationConfig.maxOutputTokens = Math.min(
        body.generationConfig.maxOutputTokens || 16384,
        16384
      );
    } else {
      // Fluxy: max 800 token (chat breve, non serve di più)
      body.generationConfig.maxOutputTokens = Math.min(
        body.generationConfig.maxOutputTokens || 800,
        800
      );
    }
  }

  // ── Endpoint Gemini con modello corretto ────────────────────
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  // ── Chiamata con retry automatico su 429 ────────────────────
  const doFetch = () => fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  try {
    let response = await doFetch();

    // Rate limit → aspetta 2 secondi e riprova una volta
    if (response.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      response = await doFetch();
    }

    // Se ancora 429 dopo il retry → risposta chiara per l'utente
    if (response.status === 429) {
      return res.status(429).json({
        error: 'RATE_LIMIT',
        message: 'Il motore AI è momentaneamente occupato. Riprova tra qualche secondo!'
      });
    }

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    console.error('[gemini.js] Errore:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
