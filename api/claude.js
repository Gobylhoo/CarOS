// Vercel serverless function: /api/claude
// Forwards requests to Anthropic with the real key, which lives ONLY in
// a server-side env var (Vercel → Project Settings → Environment Variables:
// ANTHROPIC_API_KEY). The key never reaches the browser or the database.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "POST only" } });
    return;
  }
  // Prefer the family's own key (sent by the app); fall back to a server-wide key.
  const key = req.headers["x-family-key"] || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(401).json({ error: { message: "No AI key: set one for your family in Setup, or configure ANTHROPIC_API_KEY on the server" } });
    return;
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: { message: "Upstream error: " + e.message } });
  }
}
