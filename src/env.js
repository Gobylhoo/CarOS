// Populates the env bridge that src/CarOS.jsx reads.
// Keeping import.meta here (a real ES module compiled by Vite) lets the
// same CarOS.jsx also run in environments that can't parse import.meta.
globalThis.CAROS_ENV = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  // In production, AI calls route through the serverless proxy so the
  // Anthropic key stays server-side (see api/claude.js).
  API_ENDPOINT: "/api/claude",
};
