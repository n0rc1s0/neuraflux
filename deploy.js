// api/deploy.js — Vercel Serverless Function
// Gestisce il deploy delle app generate su Vercel tramite API
// Viene chiamata da index.html quando l'utente clicca "Deploy Vercel"

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, code } = req.body;

  // Validazione base
  if (!name || typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
    return res.status(400).json({ error: 'Nome sottodominio non valido. Usa solo lettere minuscole, numeri e trattini.' });
  }
  if (!code || typeof code !== 'string' || code.length < 50) {
    return res.status(400).json({ error: 'Codice HTML mancante o troppo corto.' });
  }

  // Token Vercel (salvato come variabile d'ambiente su Vercel dashboard)
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || null; // opzionale

  if (!VERCEL_TOKEN) {
    return res.status(503).json({
      error: 'Token Vercel non configurato. Aggiungi VERCEL_TOKEN nelle variabili d\'ambiente.'
    });
  }

  try {
    // Prepara il payload per Vercel Deployments API v13
    const deployPayload = {
      name: `neuraflux-${name}`,
      files: [
        {
          file: 'index.html',
          data: code,
          encoding: 'utf-8'
        }
      ],
      projectSettings: {
        framework: null,  // Static HTML, nessun framework
        buildCommand: null,
        outputDirectory: null
      },
      target: 'production'
    };

    if (VERCEL_TEAM_ID) deployPayload.teamId = VERCEL_TEAM_ID;

    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(deployPayload)
    });

    const deployData = await deployRes.json();

    if (!deployRes.ok) {
      const msg = deployData?.error?.message || 'Errore Vercel API';
      return res.status(deployRes.status).json({ error: msg });
    }

    // Risposta di successo
    return res.status(200).json({
      ok: true,
      url: `https://${name}.vercel.app`,
      deploymentId: deployData.id,
      readyState: deployData.readyState
    });

  } catch (err) {
    console.error('[api/deploy] Errore:', err);
    return res.status(500).json({ error: 'Errore interno del server. Riprova tra poco.' });
  }
}
