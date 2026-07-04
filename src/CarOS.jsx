import React, { useState, useEffect, useRef, createContext, useContext } from "react";

/* ============================================================
   FAMILY CAR OS
   A code-based, family-first car research & planning app.
   - Enter a family code + tap your name (no login)
   - Each member chats with an AI that updates their profile
   - A live family plan re-generates from everyone's data
   - Full budget math (pooled + personal)

   NOTE ON STORAGE: This demo uses in-memory React state so it
   runs in the artifact sandbox. The data model below (Family,
   Member, Car) maps 1:1 to a Supabase schema for production.
   Swap `store` for Supabase calls and it works unchanged.
   ============================================================ */

/* ---------- design tokens (instrument-cluster identity) ---------- */
const T = {
  bg: "#0A0C0E",
  panel: "#12151A",
  panel2: "#191E24",
  line: "#262D35",
  text: "#ECEFF1",
  dim: "#8B959E",
  redline: "#E8402A",   // tachometer redline — the signature accent
  amber: "#F5A623",     // gauge-glow amber, used only for data readouts
  cool: "#5BB8C4",
  green: "#58C287",
  display: "'Instrument Serif', Georgia, serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
};

/* Fonts, keyframes, focus states, reduced motion — injected once. */
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;600;700&display=swap');
      @keyframes ignition {
        0%   { transform: rotate(-120deg); }
        55%  { transform: rotate(120deg); }
        100% { transform: rotate(45deg); }
      }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: none; }
      }
      .ignition { animation: ignition 1.3s cubic-bezier(.45,0,.2,1) 1; }
      .fade-up  { animation: fadeUp .45s ease both; }
      button:focus-visible, input:focus, select:focus {
        outline: 2px solid ${"#E8402A"}66; outline-offset: 2px;
      }
      ::selection { background: ${"#E8402A"}44; }
      @media (prefers-reduced-motion: reduce) {
        * { animation: none !important; transition: none !important; }
      }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .member-grid { display: grid; grid-template-columns: 1fr 300px; gap: 18px; align-items: start; }
      .sticky-side { position: sticky; top: 90px; }
      @media (max-width: 720px) {
        .grid-2 { grid-template-columns: 1fr; }
        .member-grid { grid-template-columns: 1fr; }
        .sticky-side { position: static; }
      }
    `}</style>
  );
}

/* ---------- seed data ---------- */
const SEED = {
  code: "TORQUE",
  name: "The Demo Family",
  combinedBudgetMonthly: 1400,
  members: [
    {
      id: "m1", name: "Dad", age: 49, role: "parent", canDrive: "yes",
      commuteMilesWeek: 120, leaseVsBuy: "lease", insuranceTier: "clean",
      priorities: ["comfort", "tech", "efficiency"],
      preferences: "Wants to go EV. Considering a Lucid or a 7-seater SUV.",
      personalBudgetMonthly: 800, matched: [], chat: [],
    },
    {
      id: "m2", name: "Mom", age: 47, role: "parent", canDrive: "yes",
      commuteMilesWeek: 40, leaseVsBuy: "buy", insuranceTier: "clean",
      priorities: ["safety", "reliability", "cost"],
      preferences: "Practical. Current 2009 Honda Fit may be sold.",
      personalBudgetMonthly: 300, matched: [], chat: [],
    },
    {
      id: "m3", name: "Tommy", age: 17, role: "teen", canDrive: "yes",
      commuteMilesWeek: 150, leaseVsBuy: "lease", insuranceTier: "young-point",
      priorities: ["performance", "tech", "cost"],
      preferences: "Loves German/Italian sports cars. Drives a 2018 Chevy Volt (high miles, front damage). Eyeing a Tesla Model 3 Performance.",
      personalBudgetMonthly: 320, matched: [], chat: [],
    },
  ],
  cars: [
    { id: "c1", make: "Chevrolet", model: "Volt", year: 2018, driver: "Tommy", mileage: 95000, condition: "high miles, front-end damage", status: "owned", notes: "Battery still holds range. Front bumper needs replacement before any sale." },
    { id: "c2", make: "Honda", model: "Fit", year: 2009, driver: "Mom", mileage: 130000, condition: "running, possible sale", status: "owned", notes: "Timing chain serviced 2024. Could fetch ~$4k private sale." },
  ],
  plan: null,
  apiKey: "",
};

/* ============================================================
   STORAGE LAYER
   One async interface, two backends. Flip USE_SUPABASE to true
   once your keys are in env. localStorage works today with no setup.

   PRODUCTION (Supabase) — install + env:
     npm install @supabase/supabase-js
     VITE_SUPABASE_URL=...        (Project Settings → API)
     VITE_SUPABASE_ANON_KEY=...

   Then create the tables (run in Supabase SQL editor):
     -- families(code text pk, name text, combined_budget_monthly int,
     --          plan jsonb, created_at timestamptz default now())
     -- members(id uuid pk default gen_random_uuid(), family_code text,
     --          name, age, role, can_drive, commute_miles_week,
     --          lease_vs_buy, insurance_tier, priorities jsonb,
     --          preferences text, personal_budget_monthly int,
     --          matched jsonb default '[]', chat jsonb default '[]')
     -- cars(id uuid pk default gen_random_uuid(), family_code text,
     --       make, model, year, driver, mileage, condition, status)

   SECURITY: enable Row Level Security and scope by family code.
   Full SQL (tables + RLS) is in the companion file supabase_setup.sql.
   The app sends the active family code via a request header
   (x-family-code) so policies can restrict rows to that family.
   ============================================================ */
const USE_SUPABASE = true; // Supabase in production. Set false only for local no-DB testing.

/* Env bridge: the artifact runtime can't parse import.meta, so this file
   reads keys from globalThis.CAROS_ENV instead. In the Vite project,
   src/env.js populates that global from import.meta.env before App loads. */
const ENV = (typeof globalThis !== "undefined" && globalThis.CAROS_ENV) || {};

/* --- Supabase client (lazy; recreated when the active family changes
   so the x-family-code header used by RLS policies stays correct) --- */
let _sb = null;
let _sbCode = null;
let _activeCode = "";
function setActiveCode(code) { _activeCode = (code || "").toUpperCase(); }
async function sb() {
  if (_sb && _sbCode === _activeCode) return _sb;
  const { createClient } = await import("@supabase/supabase-js");
  _sb = createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_ANON_KEY,
    { global: { headers: { "x-family-code": _activeCode } } }
  );
  _sbCode = _activeCode;
  return _sb;
}

/* --- snake_case <-> camelCase mappers (DB columns vs JS fields) --- */
const toRowMember = (m, code) => ({
  id: m.id, family_code: code, name: m.name, age: m.age, role: m.role,
  can_drive: m.canDrive, commute_miles_week: m.commuteMilesWeek,
  lease_vs_buy: m.leaseVsBuy, insurance_tier: m.insuranceTier,
  priorities: m.priorities, preferences: m.preferences,
  personal_budget_monthly: m.personalBudgetMonthly, matched: m.matched, chat: m.chat,
  costs: m.costs || {}, want_monthly: m.wantMonthly ?? null, quiz: m.quiz || null,
});
const fromRowMember = (r) => ({
  id: r.id, name: r.name, age: r.age, role: r.role, canDrive: r.can_drive,
  commuteMilesWeek: r.commute_miles_week, leaseVsBuy: r.lease_vs_buy,
  insuranceTier: r.insurance_tier, priorities: r.priorities || [],
  preferences: r.preferences || "", personalBudgetMonthly: r.personal_budget_monthly,
  matched: r.matched || [], chat: r.chat || [],
  costs: r.costs || {}, wantMonthly: r.want_monthly ?? 0, quiz: r.quiz || null,
});

/* --- localStorage backend (works today, single device) --- */
const lsKey = (code) => `caros:${code}`;
const localBackend = {
  async getFamily(code) {
    const raw = localStorage.getItem(lsKey(code));
    return raw ? JSON.parse(raw) : null;
  },
  async saveFamily(family) {
    localStorage.setItem(lsKey(family.code), JSON.stringify(family));
    return family;
  },
};

/* --- Supabase backend (cross-device) --- */
const supaBackend = {
  async getFamily(code) {
    const c = await sb();
    const { data: fam } = await c.from("families").select("*").eq("code", code).single();
    if (!fam) return null;
    const { data: members } = await c.from("members").select("*").eq("family_code", code);
    const { data: cars } = await c.from("cars").select("*").eq("family_code", code);
    return {
      code: fam.code, name: fam.name,
      combinedBudgetMonthly: fam.combined_budget_monthly,
      plan: fam.plan,
      apiKey: fam.api_key || "",
      members: (members || []).map(fromRowMember),
      cars: cars || [],
    };
  },
  async saveFamily(family) {
    const c = await sb();
    await c.from("families").upsert({
      code: family.code, name: family.name,
      combined_budget_monthly: family.combinedBudgetMonthly, plan: family.plan,
      api_key: family.apiKey || null,
    });
    // upsert current rows
    if (family.members.length)
      await c.from("members").upsert(family.members.map((m) => toRowMember(m, family.code)));
    if (family.cars.length)
      await c.from("cars").upsert(family.cars.map((car) => ({ ...car, family_code: family.code })));
    // reconcile deletions: remove DB rows no longer present in the arrays
    const memberIds = family.members.map((m) => m.id);
    const carIds = family.cars.map((c2) => c2.id);
    let mq = c.from("members").delete().eq("family_code", family.code);
    if (memberIds.length) mq = mq.not("id", "in", `(${memberIds.join(",")})`);
    await mq;
    let cq = c.from("cars").delete().eq("family_code", family.code);
    if (carIds.length) cq = cq.not("id", "in", `(${carIds.join(",")})`);
    await cq;
    return family;
  },
};

const backend = USE_SUPABASE ? supaBackend : localBackend;

/* --- the hook the app uses: identical interface either way --- */
function useStore() {
  const [family, setFamily] = useState(null); // null until a family is loaded/created
  const [loading, setLoading] = useState(false);

  // Functional persist: always merge onto the LATEST state (prev), never a
  // stale closure copy. This prevents concurrent writes (e.g. quiz save +
  // auto-matcher) from overwriting each other. Save the computed next to DB.
  const mutate = (fn) => {
    setFamily((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      backend.saveFamily(next);
      return next;
    });
  };
  const persist = (next) => { setFamily(next); backend.saveFamily(next); };

  const api = {
    family, loading,
    async loadFamily(code) {
      setLoading(true);
      setActiveCode(code);
      const f = await backend.getFamily(code.toUpperCase());
      setFamilyKey(f?.apiKey);
      setFamily(f); setLoading(false);
      return f;
    },
    async createFamily(data) {           // called by the setup wizard
      setActiveCode(data.code);
      setFamilyKey(data.apiKey);
      const f = await backend.saveFamily(data);
      setFamily(f);
      return f;
    },
    seedDemo() { setActiveCode(SEED.code); setFamilyKey(""); persist(SEED); },
    setApiKey(k) { setFamilyKey(k); mutate((f) => ({ ...f, apiKey: (k || "").trim() })); },
    clear() { setFamily(null); },
    updateMember(id, patch) {
      mutate((f) => ({ ...f, members: f.members.map((m) =>
        m.id === id ? { ...m, ...patch } : m) }));
    },
    appendChat(id, msg) {
      mutate((f) => ({ ...f, members: f.members.map((m) =>
        m.id === id ? { ...m, chat: [...m.chat, msg] } : m) }));
    },
    setPlan(plan) { mutate((f) => ({ ...f, plan })); },
    addMember(member) { mutate((f) => ({ ...f, members: [...f.members, member] })); },
    removeMember(id) { mutate((f) => ({ ...f, members: f.members.filter((m) => m.id !== id) })); },
    addCar(car) { mutate((f) => ({ ...f, cars: [...f.cars, car] })); },
    updateCar(id, patch) {
      mutate((f) => ({ ...f, cars: f.cars.map((c) =>
        c.id === id ? { ...c, ...patch } : c) }));
    },
    removeCar(id) { mutate((f) => ({ ...f, cars: f.cars.filter((c) => c.id !== id) })); },
    setCombinedBudget(v) { mutate((f) => ({ ...f, combinedBudgetMonthly: v })); },
  };
  return api;
}

const StoreCtx = createContext(null);
const useApp = () => useContext(StoreCtx);

/* ---------- helpers ---------- */
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]).join("");
}
/* ---------- budget helpers ---------- */
// Monthly running cost for a member: their explicit costs, defaulting sensibly.
function memberMonthly(m) {
  const c = m.costs || {};
  return (c.payment || 0) + (c.insurance || 0) + (c.fuel || 0) + (c.upkeep || 0);
}
function familyTotals(members) {
  const spend = members.reduce((s, m) => s + memberMonthly(m), 0);
  const want = members.reduce((s, m) => s + (m.wantMonthly || 0), 0);
  return { spend, want };
}

const uid = () => Math.random().toString(36).slice(2, 10);

/* ============================================================
   DRIVER DNA QUIZ
   Ten premade questions. Each answer adds hidden weight to eight
   dimensions; the normalized result is the member's Driver DNA,
   which feeds the matcher, the chat agent, and the family plan.
   ============================================================ */
const DIMS = ["performance", "comfort", "efficiency", "reliability",
  "character", "practicality", "image", "value"];

/* 22 questions in 4 sections. Each option weights DIMS; every question also
   accepts a custom free-text answer (scored as a note, not numerically). */
const QUIZ = [
  // --- LIFESTYLE ---
  { sec: "Lifestyle", q: "Saturday, no plans, full tank. The car:", options: [
    { t: "Stays parked, I'm being lazy", w: { value: 2, practicality: 1 } },
    { t: "Errand duty, obviously", w: { practicality: 2, efficiency: 1 } },
    { t: "I go find a good road", w: { performance: 2, character: 2 } },
    { t: "Point it somewhere far and just drive", w: { comfort: 2, character: 1 } },
  ]},
  { sec: "Lifestyle", q: "Your daily drive is basically:", options: [
    { t: "Bumper-to-bumper purgatory", w: { comfort: 2, efficiency: 1 } },
    { t: "Wide-open highway", w: { comfort: 2, performance: 1 } },
    { t: "A few stoplights and I'm home", w: { efficiency: 1, practicality: 1 } },
    { t: "What drive, I barely leave the house", w: { value: 2 } },
  ]},
  { sec: "Lifestyle", q: "Who's riding with you this week:", options: [
    { t: "Nobody, it's my time", w: { performance: 1, character: 1 } },
    { t: "One regular co-pilot", w: { comfort: 1 } },
    { t: "The whole circus", w: { practicality: 3, comfort: 1 } },
    { t: "More dogs and gear than humans", w: { practicality: 3 } },
  ]},
  { sec: "Lifestyle", q: "Three hours behind the wheel:", options: [
    { t: "My back files a formal complaint", w: { comfort: 3 } },
    { t: "Fine if the seat's good", w: { comfort: 2 } },
    { t: "Bring it on if the road's fun", w: { performance: 2, character: 1 } },
    { t: "Genuinely my happy place", w: { character: 2, comfort: 1 } },
  ]},
  { sec: "Lifestyle", q: "What's the climate where you drive? (snow, heat, rain, mild, all of it)",
    custom: true, options: [] },
  { sec: "Lifestyle", q: "How far off the map do you get:", options: [
    { t: "Never far from a coffee shop", w: { comfort: 1, value: 1 } },
    { t: "The odd back road", w: { character: 1 } },
    { t: "Trailheads and gravel", w: { practicality: 2 } },
    { t: "Where the pavement ends", w: { practicality: 3 } },
  ]},
  // --- MONEY ---
  { sec: "Money", q: "Surprise $1,500 repair bill. You:", options: [
    { t: "Spiral", w: { value: 3, reliability: 1 } },
    { t: "Grumble and pay it", w: { value: 1 } },
    { t: "Shrug, it's the cost of something great", w: { character: 3 } },
    { t: "This is why I bought new with a warranty", w: { reliability: 2, comfort: 1 } },
  ]},
  { sec: "Money", q: "Pick one, forever:", options: [
    { t: "Cheap to buy", w: { value: 3 } },
    { t: "Cheap to run", w: { efficiency: 3 } },
    { t: "Holds its value", w: { value: 2, reliability: 1 } },
    { t: "Who cares, I'm in love", w: { character: 3 } },
  ]},
  { sec: "Money", q: "Depreciation is:", options: [
    { t: "Money set on fire", w: { value: 3 } },
    { t: "A fact of life", w: { value: 1 } },
    { t: "Worth it for the right car", w: { character: 2 } },
    { t: "Not something I track", w: { image: 1, character: 1 } },
  ]},
  { sec: "Money", q: "How long do you keep a car:", options: [
    { t: "Till the wheels fall off", w: { reliability: 2, value: 2 } },
    { t: "A solid 8–10 years", w: { reliability: 2, value: 1 } },
    { t: "3–4 then something new", w: { image: 2, comfort: 1 } },
    { t: "Exactly as long as the deal makes sense", w: { value: 3 } },
  ]},
  { sec: "Money", q: "Monthly payment philosophy:", options: [
    { t: "Pay cash and own it", w: { value: 2, reliability: 1 } },
    { t: "Low monthly keeps me happy", w: { value: 2 } },
    { t: "Lease it and swap often", w: { image: 2, comfort: 1 } },
    { t: "Whatever's cheapest in the end", w: { value: 3 } },
  ]},
  // --- TASTE ---
  { sec: "Taste", q: "First thing you notice on a car:", options: [
    { t: "The way it looks", w: { image: 2, character: 1 } },
    { t: "The way it sounds", w: { character: 2, performance: 1 } },
    { t: "The price tag", w: { value: 3 } },
    { t: "How solid it feels", w: { reliability: 2, comfort: 1 } },
  ]},
  { sec: "Taste", q: "Money's no object tonight, you drive home:", options: [
    { t: "Something electric and instant", w: { efficiency: 2, performance: 1, image: 1 } },
    { t: "Something German and surgical", w: { performance: 2, comfort: 2 } },
    { t: "Something Italian and loud", w: { character: 3, image: 1 } },
    { t: "Something that'll run for 20 years", w: { reliability: 3, value: 1 } },
  ]},
  { sec: "Taste", q: "The right amount of stranger attention:", options: [
    { t: "None, keep me invisible", w: { practicality: 2, value: 1 } },
    { t: "A knowing nod from people who get it", w: { character: 3 } },
    { t: "Heads should turn", w: { image: 3 } },
    { t: "I genuinely don't notice", w: { reliability: 1, value: 1 } },
  ]},
  { sec: "Taste", q: "Your ideal soundtrack:", options: [
    { t: "Silent EV whoosh", w: { efficiency: 2, comfort: 1 } },
    { t: "A quiet, expensive hum", w: { comfort: 3 } },
    { t: "A proper engine note", w: { performance: 2, character: 2 } },
    { t: "Whatever's on the radio", w: { practicality: 1 } },
  ]},
  { sec: "Taste", q: "You'd rather have:", options: [
    { t: "One car that thrills you", w: { character: 2, performance: 1 } },
    { t: "Two that just work", w: { practicality: 2, value: 1 } },
    { t: "The newest tech on the road", w: { image: 2, comfort: 1 } },
    { t: "The safest thing out there", w: { reliability: 2, comfort: 1 } },
  ]},
  { sec: "Taste", q: "Badge on the hood:", options: [
    { t: "Means nothing to me", w: { value: 2, reliability: 1 } },
    { t: "Nice if the car earns it", w: { character: 1 } },
    { t: "Yeah, it matters", w: { image: 3 } },
    { t: "I'd rather it be a sleeper", w: { performance: 2, character: 1 } },
  ]},
  // --- PRACTICAL ---
  { sec: "Practical", q: "Cargo reality check:", options: [
    { t: "A backpack and vibes", w: { performance: 1, character: 1 } },
    { t: "Groceries and passengers", w: { practicality: 2, comfort: 1 } },
    { t: "Gear, dogs, projects", w: { practicality: 3 } },
    { t: "Occasionally everything at once", w: { practicality: 2, value: 1 } },
  ]},
  { sec: "Practical", q: "Reliability vs. excitement:", options: [
    { t: "Never leave me stranded", w: { reliability: 3 } },
    { t: "Mostly dependable is fine", w: { reliability: 2 } },
    { t: "Worth some risk", w: { character: 2, performance: 1 } },
    { t: "Give me the thrill, I'll deal", w: { performance: 3, character: 1 } },
  ]},
  { sec: "Practical", q: "Tech you actually want:", options: [
    { t: "Just CarPlay and go", w: { practicality: 1, value: 1 } },
    { t: "Solid safety aids", w: { reliability: 1, comfort: 1 } },
    { t: "Full self-driving please", w: { image: 2, comfort: 1, efficiency: 1 } },
    { t: "Keep it simple, almost analog", w: { character: 2, performance: 1 } },
  ]},
  { sec: "Practical", q: "Fast vs. efficient, when you must choose:", options: [
    { t: "Save the fuel", w: { efficiency: 3 } },
    { t: "A healthy balance", w: { efficiency: 1, performance: 1 } },
    { t: "Lean toward quick", w: { performance: 2 } },
    { t: "Fast, every time", w: { performance: 3 } },
  ]},
  { sec: "Practical", q: "In five years, this car should:", options: [
    { t: "Still run flawlessly", w: { reliability: 3 } },
    { t: "Have given me great memories", w: { character: 3 } },
    { t: "Hold its resale value", w: { value: 3 } },
    { t: "Already be long gone", w: { image: 2 } },
  ]},
];

function scoreQuiz(answers) {
  const raw = {};
  QUIZ.forEach((qq, i) => {
    const o = qq.options[answers[i]];
    if (o) Object.entries(o.w).forEach(([k, v]) => { raw[k] = (raw[k] || 0) + v; });
  });
  const max = Math.max(1, ...Object.values(raw));
  const dims = {};
  DIMS.forEach((d) => { dims[d] = Math.round(((raw[d] || 0) / max) * 100); });
  return dims;
}
const topDims = (dims, n = 3) =>
  Object.entries(dims || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

/* ---------- family API key (BYOK) ---------- */
let _familyKey = "";
function setFamilyKey(k) { _familyKey = (k || "").trim(); }

/* ---------- Anthropic API helper ----------
   In the artifact runtime, calls go straight to api.anthropic.com (key
   injected automatically; the family key is sent when present). In
   production, ENV.API_ENDPOINT points to /api/claude — a proxy that
   uses the family's key from the x-family-key header. */
async function callClaude(messages, system, maxTokens = 1500) {
  const endpoint = ENV.API_ENDPOINT || "https://api.anthropic.com/v1/messages";
  const usingProxy = !!ENV.API_ENDPOINT;
  // Headers: in the artifact runtime (no key, no proxy) send ONLY Content-Type —
  // the exact documented shape. Extra headers/fields are what broke the planner.
  const headers = { "Content-Type": "application/json" };
  if (_familyKey) {
    if (usingProxy) headers["x-family-key"] = _familyKey;
    else {
      headers["x-api-key"] = _familyKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
  }
  // No top-level `system` param — fold instructions into the message turns,
  // preserving the conversation structure for multi-turn chat.
  const msgs = system
    ? [{ role: "user", content: "Instructions for this conversation: " + system },
       { role: "assistant", content: "Understood." },
       ...messages]
    : messages;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: msgs }),
  });
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || "API error");
  if (!Array.isArray(data?.content)) throw new Error("Unexpected API response");
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/* ============================================================
   ROUTER (hash-based, keeps it single-file multi-page)
   ============================================================ */
function useRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (r) => { window.location.hash = r; };
  return [route, go];
}

/* ============================================================
   SHARED UI
   ============================================================ */
function Shell({ children, go, route, hasFamily }) {
  const tabs = [
    ["#/hub", "Hub"],
    ["#/plan", "Family Plan"],
    ["#/budget", "Budget"],
  ];
  const showNav = route !== "#/" && !route.startsWith("#/setup") && hasFamily;
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {showNav && (
        <header style={{ borderBottom: `1px solid ${T.line}`, padding: "16px 22px",
          display: "flex", alignItems: "center", gap: 24,
          position: "sticky", top: 0, background: T.bg, zIndex: 10 }}>
          <button onClick={() => go("#/hub")} style={{ all: "unset", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10 }}>
            <Gauge size={22} sweep />
            <span style={{ fontFamily: T.display, fontSize: 19 }}>
              Car<span style={{ color: T.redline, fontStyle: "italic" }}>OS</span></span>
          </button>
          <nav style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {tabs.map(([href, label]) => {
              const active = route.startsWith(href);
              return (
                <button key={href} onClick={() => go(href)} style={{
                  all: "unset", cursor: "pointer", padding: "7px 14px", borderRadius: 7,
                  fontSize: 13.5, color: active ? T.text : T.dim,
                  background: active ? T.panel2 : "transparent",
                  fontWeight: active ? 600 : 400 }}>{label}</button>
              );
            })}
          </nav>
        </header>
      )}
      <main className="fade-up" key={route} style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 22px 80px" }}>
        {children}
      </main>
    </div>
  );
}

function Gauge({ size = 20, sweep = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={T.line} strokeWidth="2" />
      {[...Array(7)].map((_, i) => {
        const a = (-210 + i * 40) * (Math.PI / 180);
        return <circle key={i} cx={12 + 7 * Math.cos(a)} cy={12 + 7 * Math.sin(a)}
          r="0.7" fill={i >= 5 ? T.redline : T.dim} />;
      })}
      <g className={sweep ? "ignition" : undefined}
        style={{ transformOrigin: "12px 12px", transform: "rotate(45deg)" }}>
        <line x1="12" y1="12" x2="12" y2="5.5" stroke={T.redline}
          strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="12" cy="12" r="1.6" fill={T.redline} />
    </svg>
  );
}

/* Fit-score tachometer: needle position = how well a car fits.
   Redline zone (top ticks) = 85+. */
function FitGauge({ score = 75, size = 56 }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const angle = -120 + (s / 100) * 240; // needle rotation, 12 o'clock = 0deg
  return (
    <svg width={size} height={size} viewBox="0 0 60 62">
      {[...Array(13)].map((_, i) => {
        const a = (-210 + i * 20) * (Math.PI / 180);
        const red = i >= 10; // ≈ score 84+
        return <line key={i}
          x1={30 + 22 * Math.cos(a)} y1={30 + 22 * Math.sin(a)}
          x2={30 + 26 * Math.cos(a)} y2={30 + 26 * Math.sin(a)}
          stroke={red ? T.redline : T.line} strokeWidth="2" strokeLinecap="round" />;
      })}
      <g style={{ transformOrigin: "30px 30px", transform: `rotate(${angle}deg)`,
        transition: "transform 1s cubic-bezier(.3,0,.2,1)" }}>
        <line x1="30" y1="30" x2="30" y2="10" stroke={T.amber}
          strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx="30" cy="30" r="2.4" fill={T.amber} />
      <text x="30" y="56" textAnchor="middle" fill={s >= 85 ? T.redline : T.text}
        fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight="700">{s}</text>
    </svg>
  );
}

/* Tachometer tick-strip: the recurring divider motif. */
function TickStrip({ n = 24, width = 200 }) {
  return (
    <svg width={width} height={10} style={{ display: "block" }}>
      {[...Array(n)].map((_, i) => (
        <line key={i} x1={(i / (n - 1)) * (width - 2) + 1} y1={i % 4 === 0 ? 0 : 3}
          x2={(i / (n - 1)) * (width - 2) + 1} y2={10}
          stroke={i >= n - 4 ? T.redline : T.line} strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function Card({ children, style, onClick, className }) {
  return (
    <div onClick={onClick} className={className} style={{ background: T.panel, border: `1px solid ${T.line}`,
      borderRadius: 12, padding: 18, ...(onClick ? { cursor: "pointer" } : {}), ...style }}>
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2,
    color: T.dim, textTransform: "uppercase", marginBottom: 8 }}>{children}</div>;
}

/* ============================================================
   PAGE: LANDING (enter code)
   ============================================================ */
function Landing({ go }) {
  const { loadFamily, seedDemo, loading } = useApp();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  const enter = async () => {
    setErr("");
    const f = await loadFamily(code);
    if (f) go("#/hub");
    else setErr(`No family found with code ${code.toUpperCase()}.`);
  };
  const tryDemo = () => { seedDemo(); go("#/hub"); };

  return (
    <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Gauge size={54} sweep />
      <h1 style={{ fontFamily: T.display, fontSize: 52, fontWeight: 400,
        margin: "22px 0 4px", letterSpacing: .5 }}>
        Car<span style={{ color: T.redline, fontStyle: "italic" }}>OS</span>
      </h1>
      <div style={{ margin: "6px 0 18px" }}><TickStrip width={230} /></div>
      <p style={{ color: T.dim, maxWidth: 430, lineHeight: 1.55, marginBottom: 30, fontSize: 15 }}>
        The operating system for your family's cars. One code. Everyone's
        preferences. A live plan that always knows what to drive next.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="FAMILY CODE"
          onKeyDown={(e) => e.key === "Enter" && enter()}
          style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text,
            padding: "13px 16px", borderRadius: 9, fontFamily: T.mono, letterSpacing: 3,
            fontSize: 15, width: 200, textAlign: "center", textTransform: "uppercase" }} />
        <button onClick={enter} disabled={loading} style={{ all: "unset", cursor: "pointer",
          background: T.redline, color: "#fff", padding: "13px 22px", borderRadius: 9,
          fontWeight: 600, fontSize: 14, opacity: loading ? .6 : 1 }}>
          {loading ? "…" : "Enter"}</button>
      </div>
      {err && <p style={{ color: T.redline, fontSize: 13, marginTop: 12 }}>{err}</p>}

      <div style={{ marginTop: 26, display: "flex", gap: 18, alignItems: "center" }}>
        <button onClick={() => go("#/setup")} style={{ all: "unset", cursor: "pointer",
          color: T.text, fontSize: 14, fontWeight: 600, borderBottom: `1px solid ${T.redline}`,
          paddingBottom: 2 }}>Set up a new family →</button>
        <button onClick={tryDemo} style={{ all: "unset", cursor: "pointer",
          color: T.dim, fontSize: 13.5 }}>or try the demo</button>
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: SETUP WIZARD (guided: family → members → cars → budget)
   ============================================================ */
function Setup({ go }) {
  const { createFamily } = useApp();
  const [step, setStep] = useState(0);
  const [code] = useState(genCode);
  const [name, setName] = useState("");
  const [members, setMembers] = useState([]);
  const [cars, setCars] = useState([]);
  const [budget, setBudget] = useState(1200);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const steps = ["Family", "Members", "Cars", "Budget", "AI key", "Done"];

  const addMember = () => setMembers((ms) => [...ms, {
    id: uid(), name: "", age: 30, role: "parent", canDrive: "yes",
    commuteMilesWeek: 40, leaseVsBuy: "buy", insuranceTier: "clean",
    priorities: ["reliability", "cost"], preferences: "",
    personalBudgetMonthly: 300, matched: [], chat: [],
  }]);
  const setMember = (id, patch) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const rmMember = (id) => setMembers((ms) => ms.filter((m) => m.id !== id));

  const addCar = () => setCars((cs) => [...cs, {
    id: uid(), make: "", model: "", year: 2020, driver: "",
    mileage: 0, condition: "", status: "owned",
  }]);
  const setCar = (id, patch) =>
    setCars((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const rmCar = (id) => setCars((cs) => cs.filter((c) => c.id !== id));

  const finish = async () => {
    setSaving(true);
    await createFamily({
      code, name: name || "Our Family",
      combinedBudgetMonthly: budget, plan: null, members, cars,
      apiKey: apiKey.trim(),
    });
    setSaving(false);
    setStep(5);
  };

  const canNext = step === 0 ? name.trim()
    : step === 1 ? members.length > 0 && members.every((m) => m.name.trim())
    : step === 4 ? apiKey.trim().length > 10
    : true;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <button onClick={() => go("#/")} style={{ all: "unset", cursor: "pointer",
        color: T.dim, fontSize: 13, marginBottom: 14 }}>← Back</button>

      {/* progress */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 2,
              background: i <= step ? T.redline : T.line }} />
            <div style={{ fontSize: 10.5, fontFamily: T.mono, color: i <= step ? T.text : T.dim,
              marginTop: 6, letterSpacing: .5 }}>{s.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* STEP 0 — family */}
      {step === 0 && (
        <Card>
          <Eyebrow>Step 1 · Your family</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 24, margin: "0 0 14px" }}>Name your family</h2>
          <Input label="Family name" value={name} onChange={setName}
            placeholder="e.g. The Rossi Family" />
          <div style={{ marginTop: 18, padding: 14, background: T.panel2, borderRadius: 9 }}>
            <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 4 }}>Your family code (auto-generated)</div>
            <div style={{ fontFamily: T.mono, fontSize: 26, letterSpacing: 5, color: T.amber }}>{code}</div>
            <div style={{ color: T.dim, fontSize: 12, marginTop: 6 }}>
              Everyone uses this code to join. You can share it after setup.
            </div>
          </div>
        </Card>
      )}

      {/* STEP 1 — members */}
      {step === 1 && (
        <Card>
          <Eyebrow>Step 2 · Members</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 24, margin: "0 0 4px" }}>Who's in the family?</h2>
          <p style={{ color: T.dim, fontSize: 13.5, marginBottom: 16 }}>
            Add everyone — drivers, learners, and future drivers.
          </p>
          {members.map((m) => (
            <div key={m.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10,
              padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input value={m.name} onChange={(e) => setMember(m.id, { name: e.target.value })}
                  placeholder="Name" style={inputStyle} />
                <input type="number" value={m.age}
                  onChange={(e) => setMember(m.id, { age: +e.target.value })}
                  style={{ ...inputStyle, width: 70 }} />
                <button onClick={() => rmMember(m.id)} style={{ all: "unset", cursor: "pointer",
                  color: T.dim, padding: "0 6px" }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Select value={m.role} onChange={(v) => setMember(m.id, { role: v })}
                  options={["parent", "teen", "young adult", "other"]} />
                <Select value={m.canDrive} onChange={(v) => setMember(m.id, { canDrive: v })}
                  options={["yes", "learning", "no"]} prefix="drives: " />
                <Select value={m.leaseVsBuy} onChange={(v) => setMember(m.id, { leaseVsBuy: v })}
                  options={["buy", "lease"]} />
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: T.dim, marginBottom: 5 }}>Priorities (pick a few)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {PRIORITY_OPTS.map((p) => {
                    const on = m.priorities.includes(p);
                    return (
                      <button key={p} onClick={() => setMember(m.id, {
                        priorities: on ? m.priorities.filter((x) => x !== p) : [...m.priorities, p] })}
                        style={{ all: "unset", cursor: "pointer", fontFamily: T.mono, fontSize: 11,
                          padding: "3px 9px", borderRadius: 20,
                          border: `1px solid ${on ? T.redline : T.line}`,
                          color: on ? T.text : T.dim,
                          background: on ? "rgba(225,66,47,.12)" : "transparent" }}>{p}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <button onClick={addMember} style={dashedBtn}>+ Add member</button>
        </Card>
      )}

      {/* STEP 2 — cars */}
      {step === 2 && (
        <Card>
          <Eyebrow>Step 3 · Current cars</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 24, margin: "0 0 4px" }}>What do you drive now?</h2>
          <p style={{ color: T.dim, fontSize: 13.5, marginBottom: 16 }}>
            Add cars the family already owns. Skip if starting fresh.
          </p>
          {cars.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10,
              padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={c.make} onChange={(e) => setCar(c.id, { make: e.target.value })}
                  placeholder="Make" style={inputStyle} />
                <input value={c.model} onChange={(e) => setCar(c.id, { model: e.target.value })}
                  placeholder="Model" style={inputStyle} />
                <input type="number" value={c.year}
                  onChange={(e) => setCar(c.id, { year: +e.target.value })}
                  style={{ ...inputStyle, width: 80 }} />
                <button onClick={() => rmCar(c.id)} style={{ all: "unset", cursor: "pointer",
                  color: T.dim, padding: "0 6px" }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Select value={c.driver || ""} onChange={(v) => setCar(c.id, { driver: v })}
                  options={["", ...members.map((m) => m.name).filter(Boolean)]} prefix="driver: " />
                <input value={c.condition} onChange={(e) => setCar(c.id, { condition: e.target.value })}
                  placeholder="Condition / notes" style={inputStyle} />
              </div>
            </div>
          ))}
          <button onClick={addCar} style={dashedBtn}>+ Add car</button>
        </Card>
      )}

      {/* STEP 3 — budget */}
      {step === 3 && (
        <Card>
          <Eyebrow>Step 4 · Budget</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 24, margin: "0 0 14px" }}>Combined monthly budget</h2>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: T.dim, fontSize: 13.5 }}>All cars, all-in, per month</span>
            <span style={{ fontFamily: T.mono, fontSize: 20, color: T.amber }}>${budget.toLocaleString()}</span>
          </div>
          <input type="range" min={0} max={4000} step={50} value={budget}
            onChange={(e) => setBudget(+e.target.value)}
            style={{ width: "100%", accentColor: T.redline }} />
          <div style={{ color: T.dim, fontSize: 12.5, marginTop: 8 }}>
            You can fine-tune each person's personal budget later in their profile.
          </div>
        </Card>
      )}

      {/* STEP 4 — AI key (required to access the agent) */}
      {step === 4 && (
        <Card>
          <Eyebrow>Step 5 · AI access</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 24, margin: "0 0 4px" }}>Your AI key</h2>
          <p style={{ color: T.dim, fontSize: 13.5, marginBottom: 14, lineHeight: 1.5 }}>
            The chat agent, Driver DNA matching, and the family plan run on your own
            Anthropic API key. Get one at console.anthropic.com, and set a monthly
            spend limit there — this key is shared with everyone who has your family code.
          </p>
          <Input label="Anthropic API key (required)" value={apiKey} onChange={setApiKey}
            placeholder="sk-ant-…" />
          {apiKey && !apiKey.startsWith("sk-ant-") && (
            <div style={{ color: T.amber, fontSize: 12.5, marginTop: 8 }}>
              Heads up: Anthropic keys usually start with sk-ant-
            </div>
          )}
        </Card>
      )}

      {/* STEP 5 — done */}
      {step === 5 && (
        <Card style={{ textAlign: "center", padding: 36 }}>
          <Gauge size={40} />
          <h2 style={{ fontFamily: T.display, fontSize: 26, margin: "16px 0 6px" }}>You're set up.</h2>
          <p style={{ color: T.dim, marginBottom: 18 }}>Share this code with your family:</p>
          <div style={{ fontFamily: T.mono, fontSize: 34, letterSpacing: 7, color: T.amber,
            marginBottom: 24 }}>{code}</div>
          <button onClick={() => go("#/hub")} style={primaryBtn}>Go to the hub →</button>
        </Card>
      )}

      {/* nav */}
      {step < 5 && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
          <button onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0} style={{ all: "unset", cursor: step === 0 ? "default" : "pointer",
              color: T.dim, padding: "10px 0", opacity: step === 0 ? .4 : 1 }}>← Back</button>
          {step < 4 ? (
            <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}
              style={{ ...primaryBtn, opacity: canNext ? 1 : .5,
                cursor: canNext ? "pointer" : "default" }}>Next →</button>
          ) : (
            <button onClick={() => canNext && finish()} disabled={saving || !canNext}
              style={{ ...primaryBtn, opacity: saving || !canNext ? .6 : 1 }}>
              {saving ? "Saving…" : "Finish setup"}</button>
          )}
        </div>
      )}
    </div>
  );
}

/* setup-only small components & styles */
const inputStyle = {
  flex: 1, background: T.panel2, border: `1px solid ${T.line}`, color: T.text,
  padding: "9px 11px", borderRadius: 8, fontSize: 13.5, minWidth: 0,
};
const primaryBtn = {
  all: "unset", cursor: "pointer", background: T.redline, color: "#fff",
  padding: "11px 22px", borderRadius: 9, fontWeight: 600, fontSize: 14,
};
const dashedBtn = {
  all: "unset", cursor: "pointer", display: "block", width: "100%", textAlign: "center",
  border: `1px dashed ${T.line}`, color: T.dim, padding: "11px 0", borderRadius: 9, fontSize: 13.5,
};
function Input({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: T.dim, marginBottom: 6 }}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}
function Select({ value, onChange, options, prefix = "" }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: T.panel2, border: `1px solid ${T.line}`, color: T.text,
        padding: "8px 10px", borderRadius: 8, fontSize: 13, fontFamily: T.mono }}>
      {options.map((o) => <option key={o} value={o}>{prefix}{o || "—"}</option>)}
    </select>
  );
}

/* ============================================================
   PAGE: FAMILY HUB
   ============================================================ */
function Hub({ go }) {
  const { family, addMember, removeMember, addCar, removeCar, setApiKey, updateCar } = useApp();
  const [modal, setModal] = useState(null); // 'member' | 'car' | null
  const [noteEdit, setNoteEdit] = useState(null);
  const [copied, setCopied] = useState(false);
  const overUnder = family.cars.filter((c) => c.status === "owned").length
    - family.members.filter((m) => m.canDrive === "yes").length;

  const copyCode = () => {
    navigator.clipboard?.writeText(family.code);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Eyebrow>Family · {family.name}</Eyebrow>
          <h2 style={{ fontFamily: T.display, fontSize: 36, fontWeight: 400, margin: "0 0 6px" }}>{family.name}</h2>
          <TickStrip width={190} />
        </div>
        <button onClick={copyCode} style={{ all: "unset", cursor: "pointer", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>{copied ? "COPIED" : "TAP TO SHARE"}</div>
          <div style={{ fontFamily: T.mono, fontSize: 20, letterSpacing: 4, color: T.amber }}>{family.code}</div>
        </button>
      </div>
      <p style={{ color: T.dim, marginBottom: 24 }}>
        Tap your name to chat with the AI and update your profile.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
        gap: 14, marginBottom: 30 }}>
        {family.members.map((m) => (
          <Card key={m.id} style={{ position: "relative", transition: "border .15s" }}>
            <button onClick={() => { if (confirm(`Remove ${m.name}?`)) removeMember(m.id); }}
              style={{ all: "unset", cursor: "pointer", position: "absolute", top: 12, right: 12,
                color: T.dim, fontSize: 13 }}>✕</button>
            <div onClick={() => go(`#/member/${m.id}`)} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                paddingRight: 18 }}>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{m.name}</span>
                <Tag>{m.role}</Tag>
              </div>
              <div style={{ color: T.dim, fontSize: 13, marginTop: 8 }}>
                {m.canDrive === "yes" ? "Driver" : m.canDrive === "learning" ? "Learning" : "Non-driver"}
                {" · "}{m.priorities.slice(0, 2).join(", ")}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.amber, marginTop: 12,
                display: "flex", justifyContent: "space-between" }}>
                <span>${m.personalBudgetMonthly}/mo</span>
                <span style={{ color: m.quiz ? T.green : T.dim }}>
                  {m.quiz ? "DNA ✓" : "no quiz"}</span>
              </div>
            </div>
          </Card>
        ))}
        <button onClick={() => setModal("member")} style={{ ...dashedBtn, height: "auto",
          minHeight: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
          + Add member
        </button>
      </div>

      <div className="grid-2">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>Current Fleet</Eyebrow>
            <button onClick={() => setModal("car")} style={{ all: "unset", cursor: "pointer",
              color: T.redline, fontSize: 12.5, fontWeight: 600 }}>+ Add car</button>
          </div>
          {family.cars.length === 0 && (
            <div style={{ color: T.dim, fontSize: 13, padding: "8px 0" }}>No cars yet.</div>
          )}
          {family.cars.map((c) => (
            <div key={c.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{c.year} {c.make} {c.model}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: T.dim, fontSize: 13 }}>{c.driver}</span>
                  <button onClick={() => setNoteEdit(noteEdit === c.id ? null : c.id)}
                    style={{ all: "unset", cursor: "pointer", color: T.cool, fontSize: 12 }}>✎</button>
                  <button onClick={() => { if (confirm("Remove this car?")) removeCar(c.id); }}
                    style={{ all: "unset", cursor: "pointer", color: T.dim, fontSize: 12 }}>✕</button>
                </span>
              </div>
              {noteEdit === c.id ? (
                <textarea autoFocus defaultValue={c.notes || ""} rows={2}
                  onBlur={(e) => { updateCar(c.id, { notes: e.target.value }); setNoteEdit(null); }}
                  placeholder="Notes about this car…"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box",
                    marginTop: 8, resize: "vertical", fontFamily: "inherit" }} />
              ) : c.notes ? (
                <div onClick={() => setNoteEdit(c.id)} style={{ color: T.dim, fontSize: 12.5,
                  marginTop: 5, lineHeight: 1.45, cursor: "pointer" }}>{c.notes}</div>
              ) : null}
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 13, color: overUnder < 0 ? T.amber : T.green }}>
            {overUnder < 0
              ? `${Math.abs(overUnder)} more driver(s) than cars — a gap to plan for.`
              : "Fleet covers all drivers."}
          </div>
        </Card>
        <Card>
          <Eyebrow>Status</Eyebrow>
          <Stat label="Drivers" value={family.members.filter((m) => m.canDrive === "yes").length} />
          <Stat label="Cars owned" value={family.cars.filter((c) => c.status === "owned").length} />
          <Stat label="Combined budget" value={`$${family.combinedBudgetMonthly}/mo`} accent />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0",
            alignItems: "center" }}>
            <span style={{ color: T.dim, fontSize: 13.5 }}>AI key</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: T.mono, fontSize: 12 }}>
                {family.apiKey ? `…${family.apiKey.slice(-4)}` : "none"}</span>
              <button onClick={() => {
                const k = window.prompt("Anthropic API key for this family:", "");
                if (k !== null) setApiKey(k);
              }} style={{ all: "unset", cursor: "pointer", color: T.cool, fontSize: 12 }}>
                change</button>
            </span>
          </div>
          <button onClick={() => go("#/plan")} style={{ all: "unset", cursor: "pointer",
            marginTop: 14, color: T.redline, fontWeight: 600, fontSize: 14 }}>
            View the family plan →
          </button>
        </Card>
      </div>

      {modal === "member" && (
        <AddMemberModal onClose={() => setModal(null)}
          onAdd={(m) => { addMember(m); setModal(null); }} />
      )}
      {modal === "car" && (
        <AddCarModal members={family.members} onClose={() => setModal(null)}
          onAdd={(c) => { addCar(c); setModal(null); }} />
      )}
    </>
  );
}

/* ---------- modal shell ---------- */
function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel,
        border: `1px solid ${T.line}`, borderRadius: 14, padding: 22, width: "100%",
        maxWidth: 460, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 16 }}>
          <h3 style={{ fontFamily: T.display, fontSize: 21, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ all: "unset", cursor: "pointer", color: T.dim }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const PRIORITY_OPTS = ["performance", "safety", "reliability", "efficiency",
  "comfort", "tech", "cargo", "cost"];

function AddMemberModal({ onAdd, onClose }) {
  const [m, setM] = useState({
    name: "", age: 30, role: "parent", canDrive: "yes", commuteMilesWeek: 40,
    leaseVsBuy: "buy", insuranceTier: "clean", priorities: ["reliability"],
    preferences: "", personalBudgetMonthly: 300,
  });
  const set = (patch) => setM((x) => ({ ...x, ...patch }));
  const submit = () => {
    if (!m.name.trim()) return;
    onAdd({ ...m, id: uid(), matched: [], chat: [] });
  };
  return (
    <Modal title="Add member" onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={m.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="Name" style={inputStyle} autoFocus />
        <input type="number" value={m.age} onChange={(e) => set({ age: +e.target.value })}
          style={{ ...inputStyle, width: 72 }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Select value={m.role} onChange={(v) => set({ role: v })}
          options={["parent", "teen", "young adult", "other"]} />
        <Select value={m.canDrive} onChange={(v) => set({ canDrive: v })}
          options={["yes", "learning", "no"]} prefix="drives: " />
        <Select value={m.leaseVsBuy} onChange={(v) => set({ leaseVsBuy: v })}
          options={["buy", "lease"]} />
        <Select value={m.insuranceTier} onChange={(v) => set({ insuranceTier: v })}
          options={["clean", "young-point", "young-clean", "multiple-points"]} prefix="ins: " />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.dim, marginBottom: 5 }}>Priorities</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {PRIORITY_OPTS.map((p) => {
            const on = m.priorities.includes(p);
            return (
              <button key={p} onClick={() => set({
                priorities: on ? m.priorities.filter((x) => x !== p) : [...m.priorities, p] })}
                style={{ all: "unset", cursor: "pointer", fontFamily: T.mono, fontSize: 11,
                  padding: "3px 9px", borderRadius: 20,
                  border: `1px solid ${on ? T.redline : T.line}`, color: on ? T.text : T.dim,
                  background: on ? "rgba(225,66,47,.12)" : "transparent" }}>{p}</button>
            );
          })}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 12.5, color: T.dim }}>Personal budget</span>
          <span style={{ fontFamily: T.mono, fontSize: 13, color: T.amber }}>${m.personalBudgetMonthly}/mo</span>
        </div>
        <input type="range" min={0} max={1500} step={25} value={m.personalBudgetMonthly}
          onChange={(e) => set({ personalBudgetMonthly: +e.target.value })}
          style={{ width: "100%", accentColor: T.redline }} />
      </div>
      <button onClick={submit} style={{ ...primaryBtn, width: "100%", textAlign: "center",
        boxSizing: "border-box" }}>Add member</button>
    </Modal>
  );
}

function AddCarModal({ members, onAdd, onClose }) {
  const [c, setC] = useState({
    make: "", model: "", year: 2020, driver: "", mileage: 0, condition: "", status: "owned", notes: "",
  });
  const set = (patch) => setC((x) => ({ ...x, ...patch }));
  const submit = () => {
    if (!c.make.trim() || !c.model.trim()) return;
    onAdd({ ...c, id: uid() });
  };
  return (
    <Modal title="Add car" onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={c.make} onChange={(e) => set({ make: e.target.value })}
          placeholder="Make" style={inputStyle} autoFocus />
        <input value={c.model} onChange={(e) => set({ model: e.target.value })}
          placeholder="Model" style={inputStyle} />
        <input type="number" value={c.year} onChange={(e) => set({ year: +e.target.value })}
          style={{ ...inputStyle, width: 82 }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Select value={c.driver} onChange={(v) => set({ driver: v })}
          options={["", ...members.map((m) => m.name).filter(Boolean)]} prefix="driver: " />
        <Select value={c.status} onChange={(v) => set({ status: v })}
          options={["owned", "leased", "considering"]} />
        <input type="number" value={c.mileage || ""} onChange={(e) => set({ mileage: +e.target.value })}
          onFocus={(e) => e.target.select()}
          placeholder="Miles" style={{ ...inputStyle, width: 90 }} />
      </div>
      <input value={c.condition} onChange={(e) => set({ condition: e.target.value })}
        placeholder="Condition" style={{ ...inputStyle, width: "100%",
          boxSizing: "border-box", marginBottom: 10 }} />
      <textarea value={c.notes} onChange={(e) => set({ notes: e.target.value })}
        placeholder="Notes — anything worth remembering about this car" rows={2}
        style={{ ...inputStyle, width: "100%", boxSizing: "border-box",
          marginBottom: 14, resize: "vertical", fontFamily: "inherit" }} />
      <button onClick={submit} style={{ ...primaryBtn, width: "100%", textAlign: "center",
        boxSizing: "border-box" }}>Add car</button>
    </Modal>
  );
}

function Tag({ children }) {
  return <span style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: 1,
    color: T.dim, border: `1px solid ${T.line}`, padding: "2px 7px", borderRadius: 20,
    textTransform: "uppercase" }}>{children}</span>;
}
function Stat({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ color: T.dim, fontSize: 13.5 }}>{label}</span>
      <span style={{ fontFamily: T.mono, fontWeight: 600, color: accent ? T.amber : T.text }}>{value}</span>
    </div>
  );
}

/* ============================================================
   PAGE: MEMBER (chat that updates the profile)
   ============================================================ */
function Member({ go, id }) {
  const { family, appendChat, updateMember } = useApp();
  const m = family.members.find((x) => x.id === id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef();

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [m?.chat.length, busy]);

  if (!m) return <p>Member not found. <a href="#/hub" style={{ color: T.redline }}>Back</a></p>;

  const [matching, setMatching] = useState(false);
  const [matchErr, setMatchErr] = useState("");
  const [quizOpen, setQuizOpen] = useState(false);

  const finishQuiz = (answers) => {
    const dims = scoreQuiz(answers);
    const customs = Object.entries(answers)
      .filter(([, v]) => v && typeof v === "object" && v.custom)
      .map(([i, v]) => `Q${+i + 1} "${QUIZ[i].q}" → ${v.custom}`);
    updateMember(id, { quiz: { answers, dims, customs, at: new Date().toISOString() } });
    setQuizOpen(false);
    // Auto-run the matcher with fresh DNA. Longer delay so the quiz write
    // settles first, and the matcher merges onto the latest member (not a
    // stale copy) so it can't overwrite the just-saved quiz.
    setTimeout(() => getMatchesWith(dims, customs), 400);
  };

  const getMatches = () => getMatchesWith(m.quiz?.dims, m.quiz?.customs);

  const getMatchesWith = async (dims, customs) => {
    if (matching) return;
    setMatching(true); setMatchErr("");
    const sysMatch =
      "You are the matching engine of a family Car OS. Given a driver profile, " +
      "return ONLY a raw JSON array — no prose, no markdown fences — of the 3 " +
      "best-fit real cars: [{\"car\":\"year make model (trim)\",\"why\":\"one specific " +
      "sentence tied to their profile\",\"monthly\":all-in monthly cost estimate as a " +
      "number,\"fit\":integer 0-100}]. Be realistic about their budget and about " +
      "insurance cost for their age and record. Sort by fit descending. " +
      "TASTE: when two cars fit equally, pick the more interesting one — avoid the " +
      "obvious appliance answer; every list should include at least one characterful, " +
      "slightly left-field pick that still genuinely fits. " +
      "HONESTY: never inflate fit scores. If their wants don't match their budget or " +
      "insurance reality, let the scores be honestly low and say why in the why field. " +
      "If their current car already covers their needs, the top why should say so.";
    const useCustoms = customs || m.quiz?.customs;
    const profile =
      `Driver: ${m.name}, age ${m.age}, ${m.role}. ` +
      `Priorities: ${m.priorities.join(", ")}. Prefers to ${m.leaseVsBuy}. ` +
      `Insurance tier: ${m.insuranceTier}. Budget: $${m.personalBudgetMonthly}/mo all-in. ` +
      `Commute: ${m.commuteMilesWeek} miles/week. Notes: ${m.preferences || "none"}. ` +
      (dims ? `Driver DNA from their quiz (0-100 per dimension, higher = matters more): ` +
        `${Object.entries(dims).map(([k, v]) => `${k} ${v}`).join(", ")}. ` +
        `Weight the top dimensions heavily. ` : "") +
      (useCustoms?.length ? `Their own words on the quiz — weight these heavily: ` +
        `${useCustoms.join("; ")}. ` : "") +
      `Recent conversation excerpts: ${m.chat.slice(-6).map((c) => c.content).join(" | ") || "none"}`;
    try {
      const raw = await callClaude([{ role: "user", content: profile }], sysMatch);
      const clean = raw.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(clean.slice(clean.indexOf("[")));
      if (!Array.isArray(arr) || !arr.length) throw new Error("empty");
      updateMember(id, { matched: arr });
    } catch {
      setMatchErr("Couldn't generate matches — try again.");
    }
    setMatching(false);
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    const userMsg = { role: "user", content: input };
    appendChat(id, userMsg);
    setInput("");
    setBusy(true);

    const system =
      `You are the AI inside a family Car OS, talking to ${m.name} (age ${m.age}, role ${m.role}). ` +
      `Their current profile: priorities ${m.priorities.join("/")}, ` +
      `${m.leaseVsBuy} preference, insurance tier ${m.insuranceTier}, ` +
      `budget $${m.personalBudgetMonthly}/mo, notes: "${m.preferences}". ` +
      (m.quiz ? `Their Driver DNA quiz results (0-100, higher = matters more): ` +
        `${Object.entries(m.quiz.dims).map(([k, v]) => `${k} ${v}`).join(", ")} — ` +
        `their top dimensions are ${topDims(m.quiz.dims).join(", ")}; let these shape your suggestions. ` +
        (m.quiz.customs?.length ? `They also wrote free-form answers worth weighting: ${m.quiz.customs.join("; ")}. ` : "") : "") +
      `Be concise, knowledgeable about cars, and helpful. Keep replies under 120 words ` +
      `so they never get cut off. When the user reveals a new ` +
      `preference, constraint, or life event (budget change, lease ending, new ticket, ` +
      `EV interest, etc.), acknowledge it naturally. ` +
      `PERSONALITY — two rules that define you: ` +
      `(1) Taste. Listen first and respect what they actually need, but when options ` +
      `are otherwise close, lean toward the more interesting, characterful car — the ` +
      `enthusiast pick, the left-field choice with a story — over the default appliance. ` +
      `Every suggestion you make should have something a little unique about it. ` +
      `Never force this against their real constraints. ` +
      `(2) Honesty. If what they want doesn't fit — budget math doesn't work, insurance ` +
      `reality for their age kills it, or it contradicts their own stated priorities — ` +
      `say so plainly and explain why. If their current car already suits them, tell them ` +
      `they don't need anything new. Never agree just to please; a clear "that doesn't ` +
      `fit, here's why, here's what does" is the most useful thing you can say. ` +
      `At the very END of your reply, output a single line of JSON on its own, prefixed ` +
      `with <<UPDATE>> containing ONLY changed fields among: ` +
      `{"personalBudgetMonthly":num,"leaseVsBuy":str,"insuranceTier":str,` +
      `"priorities":[...],"preferences":str,"matched":[{"car":str,"why":str,"monthly":num}]}. ` +
      `If nothing changed, output <<UPDATE>>{}.`;

    try {
      const history = [...m.chat, userMsg].map((c) => ({ role: c.role, content: c.content }));
      const raw = await callClaude(history, system, 1200);
      let visible = raw, patch = {};
      const idx = raw.indexOf("<<UPDATE>>");
      if (idx !== -1) {
        visible = raw.slice(0, idx).trim();
        try { patch = JSON.parse(raw.slice(idx + 10).trim()); } catch {}
      }
      // Guard: if the marker got truncated away or parsing left nothing,
      // still show whatever text arrived rather than a blank bubble.
      if (!visible) visible = raw.trim() || "(no response — try again)";
      appendChat(id, { role: "assistant", content: visible });
      if (patch && Object.keys(patch).length) {
        if (patch.matched) patch.matched = [...(m.matched || []), ...patch.matched];
        updateMember(id, patch);
      }
    } catch (e) {
      appendChat(id, { role: "assistant", content: "Connection hiccup — " + (e.message || "try again") });
    }
    setBusy(false);
  };

  return (
    <div className="member-grid">
      {/* chat column */}
      <div>
        <button onClick={() => go("#/hub")} style={{ all: "unset", cursor: "pointer",
          color: T.dim, fontSize: 13, marginBottom: 10 }}>← Hub</button>
        <h2 style={{ fontFamily: T.display, fontSize: 26, margin: "0 0 4px" }}>{m.name}'s profile</h2>
        <p style={{ color: T.dim, fontSize: 13.5, marginBottom: 16 }}>
          Tell the AI anything about your driving, budget, or what you want. It updates your profile live.
        </p>

        {!m.quiz && (
          <Card style={{ marginBottom: 14, display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 12, borderColor: T.redline }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>Take the Driver DNA quiz</div>
              <div style={{ color: T.dim, fontSize: 12.5, marginTop: 3 }}>
                10 quick questions. Your matches generate the moment you finish.
              </div>
            </div>
            <button onClick={() => setQuizOpen(true)} style={{ ...primaryBtn, whiteSpace: "nowrap" }}>
              Start →</button>
          </Card>
        )}
        <div ref={scrollRef} style={{ background: T.panel, border: `1px solid ${T.line}`,
          borderRadius: 12, padding: 16, height: 380, overflowY: "auto", marginBottom: 12 }}>
          {m.chat.length === 0 && (
            <div style={{ color: T.dim, fontSize: 13.5, lineHeight: 1.6 }}>
              <p style={{ marginTop: 0 }}>Try saying:</p>
              {["I'm thinking of going EV", "My budget is really $450/month now",
                "I got a speeding ticket last month", "I want something fast but practical"].map((s) => (
                <button key={s} onClick={() => setInput(s)} style={{ all: "unset", cursor: "pointer",
                  display: "block", color: T.cool, padding: "4px 0" }}>"{s}"</button>
              ))}
            </div>
          )}
          {m.chat.map((c, i) => (
            <div key={i} style={{ display: "flex",
              justifyContent: c.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
              <div style={{ maxWidth: "82%", padding: "10px 13px", borderRadius: 11,
                fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
                background: c.role === "user" ? T.redline : T.panel2,
                color: c.role === "user" ? "#fff" : T.text }}>{c.content}</div>
            </div>
          ))}
          {busy && <div style={{ color: T.dim, fontSize: 13, fontFamily: T.mono }}>thinking…</div>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Tell the AI about your car situation…"
            style={{ flex: 1, background: T.panel, border: `1px solid ${T.line}`, color: T.text,
              padding: "12px 14px", borderRadius: 9, fontSize: 14 }} />
          <button onClick={send} disabled={busy} style={{ all: "unset",
            cursor: busy ? "default" : "pointer", background: T.redline, color: "#fff",
            padding: "12px 20px", borderRadius: 9, fontWeight: 600, opacity: busy ? .6 : 1 }}>Send</button>
        </div>
      </div>

      {/* live profile sidebar */}
      <Card style={{}} className="sticky-side">
        <Eyebrow>Live Profile</Eyebrow>
        <Stat label="Age" value={m.age} />
        <Stat label="Drives" value={m.canDrive} />
        <Stat label="Lease/Buy" value={m.leaseVsBuy} />
        <Stat label="Insurance" value={m.insuranceTier} />
        <Stat label="Budget" value={`$${m.personalBudgetMonthly}/mo`} accent />
        <div style={{ marginTop: 10 }}>
          <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 5 }}>Priorities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {m.priorities.map((p) => <Tag key={p}>{p}</Tag>)}
          </div>
        </div>
        {m.quiz && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ color: T.dim, fontSize: 12.5 }}>Driver DNA</div>
              <button onClick={() => setQuizOpen(true)} style={{ all: "unset", cursor: "pointer",
                color: T.cool, fontSize: 11.5 }}>retake</button>
            </div>
            {Object.entries(m.quiz.dims).sort((a, b) => b[1] - a[1]).map(([k, v], i) => (
              <div key={k} style={{ margin: "7px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5,
                  fontFamily: T.mono, marginBottom: 3 }}>
                  <span style={{ color: i === 0 ? T.redline : T.dim }}>{k}</span>
                  <span style={{ color: T.text }}>{v}</span>
                </div>
                <div style={{ height: 4, background: T.line, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${v}%`, borderRadius: 2,
                    background: i === 0 ? T.redline : T.amber,
                    transition: "width .8s cubic-bezier(.3,0,.2,1)" }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <button onClick={getMatches} disabled={matching}
          style={{ ...primaryBtn, width: "100%", textAlign: "center",
            boxSizing: "border-box", marginTop: 16, opacity: matching ? .6 : 1 }}>
          {matching ? "Matching…" : m.matched?.length ? "Refresh my matches" : "Get my matches"}
        </button>
        {matchErr && <div style={{ color: T.redline, fontSize: 12.5, marginTop: 8 }}>{matchErr}</div>}
        {m.matched?.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 8 }}>Matches</div>
            {m.matched.map((x, i) => (
              <div key={i} className="fade-up" style={{ display: "flex", gap: 10,
                alignItems: "flex-start", padding: "10px 0",
                borderTop: `1px solid ${T.line}` }}>
                {typeof x.fit === "number" && <FitGauge score={x.fit} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{x.car}</div>
                  <div style={{ fontSize: 12, color: T.dim, lineHeight: 1.45 }}>{x.why}</div>
                  {x.monthly != null && <div style={{ fontFamily: T.mono, fontSize: 12,
                    color: T.amber, marginTop: 3 }}>~${x.monthly}/mo</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {quizOpen && <QuizFlow name={m.name} initial={m.quiz?.answers}
        onClose={() => setQuizOpen(false)} onFinish={finishQuiz} />}
    </div>
  );
}

/* ============================================================
   QUIZ FLOW — one question at a time, tap to answer
   ============================================================ */
function QuizFlow({ name, initial, onClose, onFinish }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(initial || {});
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const q = QUIZ[step];
  const advance = (next) => {
    setAnswers(next);
    setCustomOpen(false); setCustomText("");
    if (step < QUIZ.length - 1) setTimeout(() => setStep(step + 1), 160);
    else onFinish(next);
  };
  const pick = (i) => advance({ ...answers, [step]: i });
  const submitCustom = () => {
    if (!customText.trim()) return;
    // store as {custom: text} — scoreQuiz skips non-index answers, and the
    // matcher/chat receive it as a note, so it still shapes recommendations.
    advance({ ...answers, [step]: { custom: customText.trim() } });
  };
  const curr = answers[step];
  const isCustom = curr && typeof curr === "object";
  const customOnly = !q.options || q.options.length === 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(6,8,10,.93)",
      zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20 }}>
      <div className="fade-up" key={step} style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 18 }}>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, letterSpacing: 1 }}>
            {(q.sec || "DRIVER DNA").toUpperCase()} · {name.toUpperCase()} · {step + 1}/{QUIZ.length}</span>
          <button onClick={onClose} style={{ all: "unset", cursor: "pointer",
            color: T.dim, fontSize: 15, padding: 4 }}>✕</button>
        </div>
        {/* progress: tach ticks fill as you go */}
        <div style={{ display: "flex", gap: 3, marginBottom: 26 }}>
          {QUIZ.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2,
              background: i < step ? T.amber : i === step ? T.redline : T.line,
              transition: "background .25s" }} />
          ))}
        </div>
        <h3 style={{ fontFamily: T.display, fontSize: 27, fontWeight: 400,
          margin: "0 0 22px", lineHeight: 1.25 }}>{q.q}</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {(q.options || []).map((o, i) => (
            <button key={i} onClick={() => pick(i)} style={{ all: "unset", cursor: "pointer",
              background: curr === i ? "rgba(232,64,42,.14)" : T.panel,
              border: `1px solid ${curr === i ? T.redline : T.line}`,
              borderRadius: 11, padding: "15px 17px", fontSize: 15, lineHeight: 1.4,
              transition: "border .15s, background .15s" }}>
              {o.t}
            </button>
          ))}
          {/* custom answer — always available; the only input on custom-only questions */}
          {customOnly || customOpen ? (
            <div style={{ border: `1px solid ${T.redline}`, borderRadius: 11, padding: 12 }}>
              <textarea autoFocus
                value={customText || (isCustom ? curr.custom : "")}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={customOnly ? "Type your answer…" : "In your own words…"} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitCustom(); } }}
                style={{ width: "100%", boxSizing: "border-box", background: T.panel2,
                  border: `1px solid ${T.line}`, color: T.text, borderRadius: 8, padding: "10px 12px",
                  fontSize: 14.5, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={submitCustom} style={{ ...primaryBtn, padding: "9px 16px" }}>
                  {step < QUIZ.length - 1 ? "Next →" : "Finish"}</button>
                {!customOnly && (
                  <button onClick={() => { setCustomOpen(false); setCustomText(""); }}
                    style={{ all: "unset", cursor: "pointer", color: T.dim, fontSize: 13.5,
                      padding: "9px 6px" }}>Cancel</button>
                )}
              </div>
            </div>
          ) : (
            <button onClick={() => setCustomOpen(true)} style={{ all: "unset", cursor: "pointer",
              background: isCustom ? "rgba(232,64,42,.14)" : "transparent",
              border: `1px dashed ${isCustom ? T.redline : T.line}`,
              borderRadius: 11, padding: "15px 17px", fontSize: 15, color: isCustom ? T.text : T.dim,
              lineHeight: 1.4 }}>
              {isCustom ? `“${curr.custom}” — edit` : "Something else…"}
            </button>
          )}
        </div>
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} style={{ all: "unset", cursor: "pointer",
            color: T.dim, fontSize: 13.5, marginTop: 20, padding: "6px 0" }}>← Back</button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PAGE: FAMILY PLAN (AI synthesizes everyone)
   ============================================================ */
function Plan() {
  const { family, setPlan } = useApp();
  const [busy, setBusy] = useState(false);
  const [planErr, setPlanErr] = useState("");

  const generate = async () => {
    setBusy(true);
    const sysPlan =
      "You are the planning engine of a family Car OS. Produce a COMPLETE family car " +
      "plan from the data given. Structure it with these plain-text sections: " +
      "1) CURRENT FLEET — each car, condition/notes, and who it serves. " +
      "2) GAPS & TIMING — who needs what and when. " +
      "3) PER-PERSON RECOMMENDATION — a specific car for each member who needs one, " +
      "with estimated all-in monthly cost (payment + insurance for their age/record + " +
      "fuel or charging). Use their matched cars, fit scores, and driverDNA when present. " +
      "4) THE BUDGET — line per person: name, allocation $/mo; then TOTAL vs the " +
      "family's combined monthly budget, stating headroom or overage in dollars. " +
      "If over budget, say what to cut or defer. " +
      "5) NEXT STEPS — 3-4 actions in order. " +
      "Reconcile conflicts between members explicitly. Be specific, realistic, and " +
      "honest about anything that doesn't fit. Keep the whole plan under 400 words.";
    const payload = {
      combinedBudgetMonthly: family.combinedBudgetMonthly,
      members: family.members.map((m) => ({
        name: m.name, age: m.age, role: m.role, canDrive: m.canDrive,
        priorities: m.priorities, leaseVsBuy: m.leaseVsBuy,
        insuranceTier: m.insuranceTier, budget: m.personalBudgetMonthly,
        notes: m.preferences, matched: m.matched,
        driverDNA: m.quiz?.dims || null,
        monthlyRunningCost: memberMonthly(m),
        wantsToSpend: m.wantMonthly || null,
      })),
      cars: family.cars,
    };
    try {
      const text = await callClaude(
        [{ role: "user", content: "Here is the family data:\n" + JSON.stringify(payload, null, 2) +
          "\n\nGenerate the family car plan." }], sysPlan);
      setPlan({ text, at: new Date().toLocaleString() });
      setPlanErr("");
    } catch (e) {
      setPlanErr(`Planner error: ${e.message}. Tap Regenerate to retry.`);
    }
    setBusy(false);
  };

  return (
    <>
      <Eyebrow>Synthesis</Eyebrow>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <h2 style={{ fontFamily: T.display, fontSize: 36, fontWeight: 400, margin: "0 0 6px" }}>The Family Plan</h2>
        <button onClick={generate} disabled={busy} style={{ all: "unset",
          cursor: busy ? "default" : "pointer", background: T.redline, color: "#fff",
          padding: "11px 18px", borderRadius: 9, fontWeight: 600, opacity: busy ? .6 : 1 }}>
          {busy ? "Generating…" : family.plan ? "Regenerate" : "Generate plan"}
        </button>
      </div>
      <p style={{ color: T.dim, marginBottom: 22 }}>
        The AI reads every member's profile and the current fleet, then builds a combined plan.
      </p>

      {planErr && (
        <Card style={{ borderColor: T.redline, marginBottom: 14 }}>
          <div style={{ color: T.redline, fontSize: 13.5 }}>{planErr}</div>
        </Card>
      )}
      {!family.plan && !busy && (
        <Card style={{ textAlign: "center", padding: 40, color: T.dim }}>
          No plan yet. Hit <span style={{ color: T.redline }}>Generate plan</span> to synthesize everyone's profiles.
        </Card>
      )}
      {family.plan && (
        <Card>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 14.5 }}>{family.plan.text}</div>
          {family.plan.at && <div style={{ color: T.dim, fontSize: 11.5, marginTop: 16,
            fontFamily: T.mono }}>Generated {family.plan.at}</div>}
        </Card>
      )}
    </>
  );
}

/* ============================================================
   PAGE: BUDGET (full financing math)
   ============================================================ */
function Budget() {
  const { family, updateMember } = useApp();
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [err, setErr] = useState("");

  const carFor = (name) => family.cars.find((c) => c.driver === name);
  const { spend, want } = familyTotals(family.members);
  const budget = family.combinedBudgetMonthly || 0;

  const setCost = (id, key, val) => {
    const m = family.members.find((x) => x.id === id);
    // Keep empty as undefined (not 0) so the field can truly clear; strip leading zeros.
    const clean = val === "" ? undefined : Number(String(val).replace(/^0+(?=\d)/, ""));
    updateMember(id, { costs: { ...(m.costs || {}), [key]: clean } });
  };

  // AI fills any blank cost fields (and can adjust want-to-spend) from car + profile.
  const aiEstimate = async () => {
    setBusy(true); setErr(""); setAiNote("");
    const payload = family.members.map((m) => ({
      id: m.id, name: m.name, age: m.age, insuranceTier: m.insuranceTier,
      commuteMilesWeek: m.commuteMilesWeek, leaseVsBuy: m.leaseVsBuy,
      car: carFor(m.name) ? `${carFor(m.name).year} ${carFor(m.name).make} ${carFor(m.name).model}` : "none",
      carNotes: carFor(m.name)?.notes || "",
      currentCosts: m.costs || {}, wantMonthly: m.wantMonthly || null,
      dna: m.quiz?.dims || null, quizNotes: m.quiz?.customs || [],
    }));
    const sys =
      "You are the budget engine of a family Car OS. For each member, estimate any " +
      "MISSING monthly cost fields (payment, insurance, fuel, upkeep) from their car, " +
      "age, insurance tier, and commute — keep any values they already entered. Also " +
      "suggest a realistic 'wantMonthly' (what they should budget for their next car) " +
      "informed by their Driver DNA and quiz notes. Return ONLY a raw JSON array: " +
      "[{\"id\":\"...\",\"costs\":{\"payment\":n,\"insurance\":n,\"fuel\":n,\"upkeep\":n}," +
      "\"wantMonthly\":n,\"note\":\"one short reason\"}]. Numbers only, no prose outside JSON.";
    try {
      const raw = await callClaude([{ role: "user", content: JSON.stringify(payload) }], sys);
      const clean = raw.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(clean.slice(clean.indexOf("[")));
      const notes = [];
      arr.forEach((u) => {
        const m = family.members.find((x) => x.id === u.id);
        if (!m) return;
        updateMember(u.id, {
          costs: { ...(m.costs || {}), ...u.costs },
          wantMonthly: u.wantMonthly ?? m.wantMonthly,
        });
        if (u.note) notes.push(`${m.name}: ${u.note}`);
      });
      setAiNote(notes.join(" · "));
    } catch (e) {
      setErr("AI estimate failed: " + e.message);
    }
    setBusy(false);
  };

  return (
    <>
      <Eyebrow>Money</Eyebrow>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: T.display, fontSize: 36, fontWeight: 400, margin: "0 0 6px" }}>
            Family Budget</h2>
        </div>
        <button onClick={aiEstimate} disabled={busy} style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>
          {busy ? "Estimating…" : "AI: fill & suggest"}</button>
      </div>
      <p style={{ color: T.dim, marginBottom: 20 }}>
        Each person's real running costs, their car beside them, and what they want to spend next.
        The AI fills blanks and suggests targets from the quiz and chats.
      </p>

      {err && <Card style={{ borderColor: T.redline, marginBottom: 14 }}>
        <div style={{ color: T.redline, fontSize: 13.5 }}>{err}</div></Card>}
      {aiNote && <Card style={{ borderColor: T.cool, marginBottom: 14 }}>
        <Eyebrow>What the AI changed</Eyebrow>
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{aiNote}</div></Card>}

      {/* per-person rows */}
      <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
        {family.members.map((m) => {
          const car = carFor(m.name);
          const mo = memberMonthly(m);
          return (
            <Card key={m.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                marginBottom: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{m.name}</span>
                <span style={{ fontFamily: T.mono, fontSize: 15, color: T.amber }}>
                  ${mo}/mo</span>
              </div>
              <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 12 }}>
                {car ? `${car.year} ${car.make} ${car.model}` : "no car assigned"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))",
                gap: 10 }}>
                {["payment", "insurance", "fuel", "upkeep"].map((k) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, color: T.dim, marginBottom: 4,
                      textTransform: "capitalize", fontFamily: T.mono }}>{k}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ color: T.dim, fontSize: 13 }}>$</span>
                      <input type="number" value={(m.costs?.[k]) || ""}
                        onChange={(e) => setCost(m.id, k, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="0"
                        style={{ ...inputStyle, padding: "7px 8px", width: "100%" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8,
                borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
                <span style={{ fontSize: 12.5, color: T.dim }}>Wants to spend next:</span>
                <span style={{ color: T.dim, fontSize: 13 }}>$</span>
                <input type="number" value={m.wantMonthly || ""}
                  onChange={(e) => updateMember(m.id, { wantMonthly: e.target.value === "" ? undefined : Number(String(e.target.value).replace(/^0+(?=\d)/, "")) })}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                  style={{ ...inputStyle, padding: "7px 8px", width: 90 }} />
                <span style={{ fontSize: 12.5, color: T.dim }}>/mo</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* family totals */}
      <div className="grid-2">
        <Card>
          <Eyebrow>Right now</Eyebrow>
          <BigStat label="Total running cost" value={`$${spend}/mo`} accent />
          <Stat label="Combined budget" value={`$${budget}/mo`} />
          <div style={{ marginTop: 10, fontSize: 13.5,
            color: spend <= budget ? T.green : T.redline }}>
            {spend <= budget
              ? `Under budget — $${budget - spend}/mo free.`
              : `Over by $${spend - budget}/mo right now.`}
          </div>
        </Card>
        <Card>
          <Eyebrow>What everyone wants next</Eyebrow>
          <BigStat label="Combined target" value={`$${want}/mo`} accent />
          <Stat label="Combined budget" value={`$${budget}/mo`} />
          <div style={{ marginTop: 10, fontSize: 13.5,
            color: want <= budget ? T.green : T.redline }}>
            {want === 0 ? "No targets set yet — try AI: fill & suggest."
              : want <= budget
              ? `Fits the budget with $${budget - want}/mo to spare.`
              : `Wishlist is $${want - budget}/mo over budget — the plan will flag trade-offs.`}
          </div>
        </Card>
      </div>
    </>
  );
}
function BigStat({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0" }}>
      <span style={{ color: T.dim, fontSize: 13.5 }}>{label}</span>
      <span style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 700,
        color: accent ? T.amber : T.text }}>{value}</span>
    </div>
  );
}

/* ============================================================
   ROOT
   ============================================================ */
export default function App() {
  const store = useStore();
  const [route, go] = useRoute();

  const needsFamily = ["#/hub", "#/member", "#/plan", "#/budget"].some((p) => route.startsWith(p));

  let page;
  if (route.startsWith("#/setup")) page = <Setup go={go} />;
  else if (needsFamily && !store.family) {
    // landed on an inner page with no family loaded (e.g. refresh) → bounce home
    page = <NoFamily go={go} />;
  }
  else if (route.startsWith("#/hub")) page = <Hub go={go} />;
  else if (route.startsWith("#/member/")) page = <Member go={go} id={route.split("/")[2]} />;
  else if (route.startsWith("#/plan")) page = <Plan />;
  else if (route.startsWith("#/budget")) page = <Budget />;
  else page = <Landing go={go} />;

  return (
    <StoreCtx.Provider value={store}>
      <GlobalStyle />
      <Shell go={go} route={route} hasFamily={!!store.family}>{page}</Shell>
    </StoreCtx.Provider>
  );
}

function NoFamily({ go }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <p style={{ color: T.dim, marginBottom: 16 }}>No family loaded — enter your code to continue.</p>
      <button onClick={() => go("#/")} style={primaryBtn}>Go to start</button>
    </div>
  );
}
