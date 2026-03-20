export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { prompt, currentCode } = req.body;
  const apiKey = process.env.GEMINI_API_KEY; // La prenderemo dalle impostazioni di Vercel

  const systemInstruction = `Sei Nextly AI, un esperto Senior Web Developer. 
  Genera SOLO codice HTML/JS/CSS moderno. Usa Tailwind CSS. 
  Non aggiungere spiegazioni, solo il codice pulito.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `${systemInstruction}\n\nRichiesta: ${prompt}\n\nCodice attuale:\n${currentCode}` }]
        }]
      })
    });

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;

    // Tua logica di pulizia codice originale
    const codeMatch = aiText.match(/```html([\s\S]*?)```/) || aiText.match(/```([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : aiText;
    const explanation = aiText.replace(/```[\s\S]*?```/g, "").trim();

    res.status(200).json({ code, explanation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
