// api/generate.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Solo POST ammesso');

  const { prompt, currentCode } = req.body;
  const apiKey = process.env.GEMINI_KEY; // Usa il nome che hai dato tu

  const systemInstruction = `Sei Nextly AI, un esperto Senior Web Developer. 
  Genera SOLO codice HTML/JS/CSS moderno. Usa Tailwind CSS. 
  Non aggiungere spiegazioni, solo il codice pulito tra tag \`\`\`html.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `${systemInstruction}\n\nRichiesta utente: ${prompt}\n\nCodice attuale:\n${currentCode}` }]
        }]
      })
    });

    const data = await response.json();
    const aiText = data.candidates[0].content.parts[0].text;

    // Logica di estrazione codice (dal tuo codhtml.txt)
    const codeMatch = aiText.match(/```html([\s\S]*?)```/) || aiText.match(/```([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : aiText;
    const explanation = aiText.replace(/```[\s\S]*?```/g, "").trim();

    res.status(200).json({ code, explanation });
  } catch (error) {
    res.status(500).json({ error: "Errore generazione AI" });
  }
}
