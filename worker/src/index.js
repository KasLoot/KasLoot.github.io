// RoboBrain "Try now" proxy for Yuxin Liu's website.
//
// The OpenAI key lives only here, as an encrypted Worker secret. The Worker is not a
// general-purpose OpenAI proxy: it accepts a task description for one of two demo clips,
// builds RoboBrain's fixed Task Builder request itself, and only ever sends the masked
// keyframes bundled in frames.js to the monitoring model.
//
// Endpoints
//   GET  /health   -> { ok, model, limits }
//   POST /generate -> { draft, ticket } | { clarification }          (counts against quotas)
//   POST /observe  -> one keyframe's specialist + progress results    (needs a valid ticket)

import { CLIPS, DEFAULT_MODEL, chatCompletion, generateDraft, observeKeyframe, cleanTask } from "../../assets/js/rb-core.js";
import { FRAMES } from "./frames.js";

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sha256 = async (text) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
const intEnv = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const today = () => new Date().toISOString().slice(0, 10);

function cors(env, request) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      "access-control-allow-origin": ok ? origin : allowed[0] || "null",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "origin",
    },
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

async function readJSON(request, maxBytes) {
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("Request too large."), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("Send a JSON body."), { status: 400 }); }
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET); form.append("response", token); if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return (await res.json()).success === true;
}

// Daily quotas in KV (optional binding QUOTA). Without KV, only the OpenAI spend limit protects you.
async function takeQuota(env, ip) {
  if (!env.QUOTA) return { ok: true };
  const day = today(), perIp = intEnv(env.RUNS_PER_IP_PER_DAY, 3), perDay = intEnv(env.RUNS_PER_DAY, 40);
  const ipKey = `gen:${day}:${ip}`, allKey = `gen:${day}:all`;
  const [mine, all] = await Promise.all([env.QUOTA.get(ipKey), env.QUOTA.get(allKey)]);
  if (+mine >= perIp) return { ok: false, message: `You've used today's ${perIp} demo runs. Come back tomorrow, or use your own OpenAI key.` };
  if (+all >= perDay) return { ok: false, message: "The demo has reached today's run limit. Come back tomorrow, or use your own OpenAI key." };
  await Promise.all([
    env.QUOTA.put(ipKey, String(+mine + 1), { expirationTtl: 172800 }),
    env.QUOTA.put(allKey, String(+all + 1), { expirationTtl: 172800 }),
  ]);
  return { ok: true, remaining: perIp - (+mine + 1) };
}

function openai(env) {
  const endpoint = env.OPENAI_BASE || "https://api.openai.com/v1";
  return (body) => chatCompletion(fetch, endpoint, env.OPENAI_API_KEY, body);
}

async function handleGenerate(request, env, ip, headers) {
  const body = await readJSON(request, 8000);
  const clip = String(body.clip || "");
  if (!CLIPS[clip]) return json({ error: "Choose one of the demo clips." }, 400, headers);
  let task;
  try { task = cleanTask(body.task); } catch (e) { return json({ error: e.message }, 400, headers); }
  if (!(await verifyTurnstile(env, body.turnstile, ip))) return json({ error: "Complete the bot check and try again." }, 403, headers);
  const quota = await takeQuota(env, ip);
  if (!quota.ok) return json({ error: quota.message, quota: true }, 429, headers);
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  const result = await generateDraft(openai(env), {
    clip, task, sceneUrl: FRAMES[clip].scene, model,
    reasoning: env.BUILDER_REASONING ?? "medium", maxTokens: intEnv(env.BUILDER_MAX_TOKENS, 16000),
  });
  if (!result.draft) return json({ clarification: result.clarification, remaining: quota.remaining ?? null }, 200, headers);
  const exp = Date.now() + intEnv(env.TICKET_MINUTES, 20) * 60000;
  const payload = b64url(enc.encode(JSON.stringify({ c: clip, h: await sha256(JSON.stringify(result.draft)), e: exp, n: crypto.randomUUID() })));
  const ticket = payload + "." + (await hmac(env.TICKET_SECRET, payload));
  return json({ draft: result.draft, ticket, model, remaining: quota.remaining ?? null }, 200, headers);
}

async function handleObserve(request, env, headers) {
  const body = await readJSON(request, 120000);
  const [payload, sig] = String(body.ticket || "").split(".");
  if (!payload || !sig || sig !== (await hmac(env.TICKET_SECRET, payload)))
    return json({ error: "This replay session isn't valid. Generate the monitor again." }, 403, headers);
  const t = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (Date.now() > t.e) return json({ error: "This replay session expired. Generate the monitor again." }, 403, headers);
  if (t.c !== body.clip || t.h !== (await sha256(JSON.stringify(body.draft))))
    return json({ error: "The monitor was changed after it was generated. Generate it again." }, 403, headers);
  const k = Number(body.k);
  if (!FRAMES[t.c].frames[String(k)]) return json({ error: "Unknown keyframe." }, 400, headers);

  // Each (ticket, keyframe) is evaluated at most once; repeats are served from KV.
  const cacheKey = `obs:${t.n}:${k}`;
  if (env.QUOTA) {
    const hit = await env.QUOTA.get(cacheKey);
    if (hit) return new Response(hit, { status: 200, headers: { "content-type": "application/json", ...headers } });
  }
  const result = await observeKeyframe(openai(env), body.draft, {
    clip: t.c, k, frameUrl: (kk) => FRAMES[t.c].frames[String(kk)], sceneUrl: FRAMES[t.c].scene,
    model: env.OPENAI_MODEL || DEFAULT_MODEL, reasoning: env.MONITOR_REASONING ?? "low",
  });
  const out = JSON.stringify(result);
  if (env.QUOTA) await env.QUOTA.put(cacheKey, out, { expirationTtl: 3600 });
  return new Response(out, { status: 200, headers: { "content-type": "application/json", ...headers } });
}

export default {
  async fetch(request, env) {
    const { ok, headers } = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers });
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({ ok: true, model: env.OPENAI_MODEL || DEFAULT_MODEL, turnstile: !!env.TURNSTILE_SECRET,
                    limits: { runs_per_ip_per_day: intEnv(env.RUNS_PER_IP_PER_DAY, 3), runs_per_day: intEnv(env.RUNS_PER_DAY, 40), kv: !!env.QUOTA } }, 200, headers);
    if (!ok) return json({ error: "This origin isn't allowed to use the demo." }, 403, headers);
    if (request.method !== "POST") return json({ error: "Not found." }, 404, headers);
    if (!env.OPENAI_API_KEY || !env.TICKET_SECRET) return json({ error: "The demo isn't configured yet." }, 503, headers);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    try {
      if (url.pathname === "/generate") return await handleGenerate(request, env, ip, headers);
      if (url.pathname === "/observe") return await handleObserve(request, env, headers);
      return json({ error: "Not found." }, 404, headers);
    } catch (e) {
      const status = e.status && e.status < 500 && e.status !== 401 ? e.status : 502;
      const message = e.status === 401 ? "The demo's OpenAI key isn't working. Use your own key for now." : e.message || "Something went wrong.";
      return json({ error: message }, status, headers);
    }
  },
};
