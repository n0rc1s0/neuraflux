// api/deploy.js — Deploy app utenti su Vercel
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });

  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Nome e codice sono obbligatori' });

  const VERCEL_TOKEN = process.env.VERCEL_DEPLOY_TOKEN;

  // Se non c'è token Vercel, usa simulazione locale
  if (!VERCEL_TOKEN) {
    const fakeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return res.status(200).json({
      url: `https://${fakeName}.vercel.app`,
      deploymentId: 'demo_' + Date.now(),
      note: 'Demo mode: aggiungi VERCEL_DEPLOY_TOKEN per deploy reali'
    });
  }

  try {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 50);

    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `nextly-${cleanName}`,
        files: [
          {
            file: 'index.html',
            data: code
          }
        ],
        projectSettings: {
          framework: null
        }
      })
    });

    const deployData = await deployResponse.json();

    if (!deployResponse.ok) {
      throw new Error(deployData.error?.message || 'Deploy fallito');
    }

    // Aspetta che il deploy sia pronto (polling)
    let attempts = 0;
    let deployUrl = deployData.url;

    while (attempts < 15 && deployData.readyState !== 'READY') {
      await new Promise(r => setTimeout(r, 2000));
      const check = await fetch(`https://api.vercel.com/v13/deployments/${deployData.id}`, {
        headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
      });
      const checkData = await check.json();
      if (checkData.readyState === 'READY') {
        deployUrl = checkData.url;
        break;
      }
      attempts++;
    }

    return res.status(200).json({
      url: `https://${deployUrl}`,
      deploymentId: deployData.id
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
