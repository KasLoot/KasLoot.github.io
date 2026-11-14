// RoboBrain "Try now" core, shared by the browser (bring-your-own-key mode) and the
// Cloudflare Worker (site-key mode). No DOM APIs here.
//
// This is a JavaScript port of the parts of RoboBrain (github.com/KasLoot/RoboBrain)
// needed for the website replay:
//   task_builder.py  -> buildGenerationMessages, validateDraft, generateDraft
//   monitor.py       -> specialistRequest, parseSpecialist, decide
//   progress.py      -> progressPrompt, progressRequest, parseProgress, ProgressTracker
// Differences from the real system are listed in REPLAY_NOTES.

import { BUILDER_PROMPT, DRAFT_SCHEMA, CLIPS } from "./rb-data.js";
export { BUILDER_PROMPT, DRAFT_SCHEMA, CLIPS };

export const DEFAULT_MODEL = "gpt-6.1-terra";
export const VERDICTS = ["POSITIVE", "NEGATIVE", "UNCERTAIN"];
export const SOURCE_ID = "camera1";
export const MAX_TASK_CHARS = 1500;

export const REPLAY_NOTES = [
  "Model: GPT-6.1 Terra for both task generation and monitoring. RoboBrain itself defaults to Kimi K3 for the builder and Gemma 4 26B A4B for monitoring.",
  "Sampling: a fixed set of keyframes, not the 10–15 Hz live stream.",
  "Verification rounds are off (RoboBrain's evidence-horizon-0 mode): each keyframe decides SUCCESS, FAIL or ON_GOING directly. Progress still needs two matching keyframes to confirm.",
  "The grey rectangles hide the original run's burned-in status text, so the model can't read the answer.",
];

const CAMERA_NOTE =
  "(Website replay: a flat grey rectangle covers a burned-in recording overlay. It is not part of the scene; ignore it.)";

// ---------- inputs ----------

export function inventory(clip) {
  const c = CLIPS[clip];
  if (!c) throw new Error("Unknown clip");
  return {
    sources: [{ id: SOURCE_ID, name: "Camera 1", enabled: true, device: "0", video: c.video.split("/").pop(),
                width: 848, height: 480, fps: 30 }],
    images: [{ asset: c.scene_asset, label: c.scene_label, reference: true }],
  };
}

export function cleanTask(text) {
  const t = String(text ?? "").replace(/\s+\n/g, "\n").trim();
  if (!t) throw new Error("Describe the task first.");
  if (t.length > MAX_TASK_CHARS) throw new Error(`Keep the description under ${MAX_TASK_CHARS} characters.`);
  return t;
}

// Port of TaskBuilder.messages(action="generate") plus the generation instruction.
export function buildGenerationMessages(clip, taskText, sceneUrl) {
  const c = CLIPS[clip];
  const system = BUILDER_PROMPT + "\n\nCurrent allowed inputs:\n" + JSON.stringify(inventory(clip)) +
    "\n\nCurrent mode: GENERATION. Return task JSON matching the schema in the final instruction.";
  return [
    { role: "system", content: system },
    { role: "user", content: [
      { type: "text", text: cleanTask(taskText) + "\nAttached image: " + c.scene_label + " (asset: " + c.scene_asset + ")" },
      { type: "image_url", image_url: { url: sceneUrl } },
    ] },
    { role: "user", content: "Generate the task draft now. Return only JSON matching this schema:\n" + JSON.stringify(DRAFT_SCHEMA) },
  ];
}

// ---------- draft validation (port of the pydantic models + TaskBuilder.compile) ----------

class DraftError extends Error {}
const isIdent = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function str(v, path, min, max) {
  if (typeof v !== "string") throw new DraftError(`${path}: Input should be a valid string`);
  const s = v.trim();
  if (s.length < min) throw new DraftError(`${path}: String should have at least ${min} character${min === 1 ? "" : "s"}`);
  if (s.length > max) throw new DraftError(`${path}: String should have at most ${max} characters`);
  return s;
}
function strList(v, path, min, max) {
  if (!Array.isArray(v)) throw new DraftError(`${path}: Input should be a valid list`);
  if (v.length < min) throw new DraftError(`${path}: List should have at least ${min} item${min === 1 ? "" : "s"}`);
  if (v.length > max) throw new DraftError(`${path}: List should have at most ${max} items`);
  return v.map((x, i) => str(x, `${path}.${i}`, 0, 1000));
}
function intOrNull(v, path, ge) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v)) throw new DraftError(`${path}: Input should be a valid integer`);
  if (v < ge) throw new DraftError(`${path}: Input should be greater than or equal to ${ge}`);
  return v;
}
function onlyKeys(o, allowed, path) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new DraftError(`${path}.${k}: Extra inputs are not permitted`);
}

export function parseModelJSON(text) {
  let t = String(text ?? "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1];
  try { return JSON.parse(t); } catch { throw new DraftError("Invalid JSON: the reply is not a single JSON object"); }
}

export function validateDraft(raw, clip) {
  if (!isObj(raw)) throw new DraftError("Input should be an object");
  onlyKeys(raw, ["name", "summary", "specialists", "progress"], "draft");
  for (const k of ["name", "summary", "specialists"]) if (!(k in raw)) throw new DraftError(`${k}: Field required`);
  const draft = {
    name: str(raw.name, "name", 1, 120),
    summary: str(raw.summary, "summary", 1, 3000),
    specialists: [],
    progress: null,
  };
  if (!Array.isArray(raw.specialists)) throw new DraftError("specialists: Input should be a valid list");
  if (raw.specialists.length > 32) throw new DraftError("specialists: List should have at most 32 items");
  const inv = inventory(clip);
  const sources = new Set(inv.sources.filter((s) => s.enabled).map((s) => s.id));
  const refs = new Set(inv.images.filter((a) => a.reference).map((a) => a.asset));
  const checkInputs = (cams, assets) => {
    if (new Set(cams).size !== cams.length || !cams.every((c) => sources.has(c)) ||
        new Set(assets).size !== assets.length || !assets.every((a) => refs.has(a)))
      throw new DraftError("Use unique enabled source IDs and only images approved as specialist references");
  };
  raw.specialists.forEach((s, i) => {
    const p = `specialists.${i}`;
    if (!isObj(s)) throw new DraftError(`${p}: Input should be an object`);
    onlyKeys(s, ["name", "prompt", "failure_type", "camera_sources", "reference_assets"], p);
    if (!("failure_type" in s)) throw new DraftError(`${p}.failure_type: Field required`);
    let ft = s.failure_type;
    if (ft !== null) {
      ft = str(ft, `${p}.failure_type`, 0, 100);
      if (!isIdent(ft) || ft !== ft.toUpperCase()) throw new DraftError(`${p}.failure_type: Failure type must be null or an uppercase identifier`);
    }
    const spec = {
      name: str(s.name, `${p}.name`, 1, 120),
      prompt: str(s.prompt, `${p}.prompt`, 40, 20000),
      failure_type: ft,
      camera_sources: strList(s.camera_sources, `${p}.camera_sources`, 1, 2),
      reference_assets: s.reference_assets === undefined ? [] : strList(s.reference_assets, `${p}.reference_assets`, 0, 24),
    };
    checkInputs(spec.camera_sources, spec.reference_assets);
    draft.specialists.push(spec);
  });
  if (raw.progress !== null && raw.progress !== undefined) {
    const r = raw.progress, p = "progress";
    if (!isObj(r)) throw new DraftError(`${p}: Input should be an object`);
    onlyKeys(r, ["prompt", "nodes", "camera_sources", "reference_assets", "unit_label", "history_frames"], p);
    if (!Array.isArray(r.nodes) || r.nodes.length < 1 || r.nodes.length > 64)
      throw new DraftError(`${p}.nodes: List should have between 1 and 64 items`);
    const nodes = r.nodes.map((n, i) => {
      const q = `${p}.nodes.${i}`;
      if (!isObj(n)) throw new DraftError(`${q}: Input should be an object`);
      onlyKeys(n, ["id", "label", "criteria", "completed", "total"], q);
      const id = str(n.id, `${q}.id`, 1, 200);
      if (!isIdent(id) || id.toUpperCase() === "UNKNOWN") throw new DraftError(`${q}.id: Node ID must be an identifier; UNKNOWN is reserved`);
      const node = { id, label: str(n.label, `${q}.label`, 1, 120), criteria: str(n.criteria, `${q}.criteria`, 1, 6000),
                     completed: intOrNull(n.completed, `${q}.completed`, 0), total: intOrNull(n.total, `${q}.total`, 1) };
      if ((node.completed === null) !== (node.total === null) || (node.total !== null && node.completed > node.total))
        throw new DraftError(`${q}: Supply both completed and total, with 0 <= completed <= total`);
      return node;
    });
    if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new DraftError("Progress node IDs must be unique");
    const totals = new Set(nodes.filter((n) => n.total !== null).map((n) => n.total));
    if (totals.size > 1 || (totals.size && nodes.some((n) => n.total === null)))
      throw new DraftError("Count nodes must all use the same total; otherwise leave counts empty for every node");
    const hf = r.history_frames === undefined ? 1 : r.history_frames;
    if (!Number.isInteger(hf) || hf < 1 || hf > 3) throw new DraftError(`${p}.history_frames: Input should be an integer from 1 to 3`);
    draft.progress = {
      prompt: str(r.prompt, `${p}.prompt`, 1, 20000),
      nodes,
      camera_sources: strList(r.camera_sources, `${p}.camera_sources`, 1, 2),
      reference_assets: r.reference_assets === undefined ? [] : strList(r.reference_assets, `${p}.reference_assets`, 0, 24),
      unit_label: r.unit_label === undefined ? "items" : str(r.unit_label, `${p}.unit_label`, 1, 40),
      history_frames: hf,
    };
    checkInputs(draft.progress.camera_sources, draft.progress.reference_assets);
  }
  // TaskBuilder.compile() rules
  if (draft.specialists.length) {
    if (draft.specialists.filter((s) => s.failure_type === null).length > 1)
      throw new DraftError("Combine all completion conditions into one success specialist");
    if (new Set(draft.specialists.map((s) => s.name.toLowerCase())).size !== draft.specialists.length)
      throw new DraftError("Specialists must have distinct names");
  }
  return draft;
}

// ---------- OpenAI transport ----------

function friendlyError(status, body) {
  const code = body?.error?.code || "";
  if (/spend_limit|insufficient_quota|credit_balance/.test(code))
    return "This OpenAI account has reached its spending limit or has run out of credit.";
  if (status === 401) return "OpenAI rejected the API key. Check the key and try again.";
  if (status === 429) return "OpenAI is rate-limiting requests right now. Wait a minute and try again.";
  if (status === 404) return "This OpenAI account can't use the selected model.";
  return "OpenAI returned HTTP " + status + (body?.error?.message ? ": " + String(body.error.message).slice(0, 240) : "");
}

// POST a chat completion. Retries once without optional parameters the model rejects.
export async function chatCompletion(fetchFn, endpoint, apiKey, body) {
  let b = { ...body };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchFn(endpoint.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify(b),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (res.ok) {
      const choice = json?.choices?.[0];
      return { content: choice?.message?.content ?? "", finish: choice?.finish_reason, usage: json?.usage ?? null };
    }
    const hint = `${json?.error?.param ?? ""} ${json?.error?.message ?? ""}`;
    if (res.status === 400 && "reasoning_effort" in b && /reasoning/i.test(hint)) { delete b.reasoning_effort; continue; }
    if (res.status === 400 && b.response_format?.type === "json_schema" && /response_format|json_schema|schema/i.test(hint)) {
      b.response_format = { type: "json_object" }; continue;
    }
    const err = new Error(friendlyError(res.status, json));
    err.status = res.status; err.code = json?.error?.code ?? null;
    throw err;
  }
  throw new Error("OpenAI rejected the request parameters.");
}

// Port of TaskBuilder.run("generate"): one generation, one repair attempt on validation failure.
export async function generateDraft(call, { clip, task, sceneUrl, model = DEFAULT_MODEL, reasoning = "medium", maxTokens = 16000 }) {
  const messages = buildGenerationMessages(clip, task, sceneUrl);
  const usage = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { model, messages, max_completion_tokens: maxTokens, response_format: { type: "json_object" } };
    if (reasoning) body.reasoning_effort = reasoning;
    const reply = await call(body);
    usage.push(reply.usage);
    if (reply.finish === "length") throw new Error("The model reached its output limit before finishing the draft. Shorten the description and retry.");
    if (!reply.content.trim()) throw new Error("The builder response was incomplete. Retry the request.");
    messages.push({ role: "assistant", content: reply.content });
    try {
      const draft = validateDraft(parseModelJSON(reply.content), clip);
      if (!draft.specialists.length) return { draft: null, clarification: draft.summary, usage };
      return { draft, clarification: null, usage };
    } catch (e) {
      if (!(e instanceof DraftError)) throw e;
      if (attempt) throw new Error("The generated draft is invalid: " + e.message.slice(0, 1500));
      messages.push({ role: "user", content: "Correct the JSON draft using this validation error. Return the full corrected JSON only:\n" + e.message.slice(0, 4000) });
    }
  }
}

// ---------- monitoring requests ----------

export const SPECIALIST_SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: VERDICTS }, reason: { type: "string" } },
  required: ["verdict", "reason"],
  additionalProperties: false,
};

function referenceContent(assets, clip, sceneUrl) {
  const c = CLIPS[clip];
  const out = [];
  for (const a of assets) if (a === c.scene_asset)
    out.push({ type: "text", text: c.scene_label }, { type: "image_url", image_url: { url: sceneUrl } });
  return out;
}
const cameraBlock = (url) => [
  { type: "text", text: "Current view: Camera 1\n" + CAMERA_NOTE },
  { type: "image_url", image_url: { url } },
];

// Port of Backend.complete (OpenAI-compatible path) for a UI-built specialist.
export function specialistRequest(spec, { clip, frameUrl, sceneUrl, model = DEFAULT_MODEL, reasoning = "low" }) {
  const body = {
    model,
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: spec.prompt },
      { role: "user", content: [...referenceContent(spec.reference_assets, clip, sceneUrl), ...cameraBlock(frameUrl)] },
    ],
    response_format: { type: "json_schema", json_schema: { name: "visual_observation", strict: true, schema: SPECIALIST_SCHEMA } },
  };
  if (reasoning) body.reasoning_effort = reasoning;
  return body;
}

export function parseSpecialist(content) {
  const v = parseModelJSON(content);
  if (!isObj(v) || Object.keys(v).sort().join() !== "reason,verdict" || typeof v.reason !== "string" || !VERDICTS.includes(v.verdict))
    throw new Error("Invalid specialist response fields");
  return { verdict: v.verdict, reason: v.reason };
}

// Port of ProgressObserver's prompt.
export function progressPrompt(progress) {
  return [
    "You track task progress by selecting one predefined node. You do not decide SUCCESS or FAIL.",
    progress.prompt.trim(),
    "Progress nodes and their observable criteria:\n" + JSON.stringify(progress.nodes.map((n) => ({ id: n.id, label: n.label, criteria: n.criteria }))),
    "Select a node only when ALL its criteria are supported by the current visual evidence. " +
    "Compare every node: an unfinished task can match a partially completed node; " +
    "it does not automatically match the initial node. " +
    "Use UNKNOWN when visibility is insufficient, no node fits, or multiple incompatible nodes fit. " +
    "Do not force forward progression: nodes can be skipped, repeated, or revisited. " +
    "Reference images are examples, never current evidence. Timestamped observations are oldest to newest; " +
    "classify the newest view and use older views only to interpret motion. " +
    "Return exactly reason and node_id as JSON. First give one short sentence of visible evidence in reason, " +
    "then the node_id whose criteria match that evidence. No reasoning steps.",
  ].join("\n\n");
}

export function progressSchema(progress) {
  return {
    type: "object",
    properties: { reason: { type: "string" }, node_id: { type: "string", enum: [...progress.nodes.map((n) => n.id), "UNKNOWN"] } },
    required: ["reason", "node_id"],
    additionalProperties: false,
  };
}

// history: [{t, url}] oldest to newest (newest = current keyframe)
export function progressRequest(progress, { clip, history, sceneUrl, model = DEFAULT_MODEL, reasoning = "low" }) {
  const content = [...referenceContent(progress.reference_assets, clip, sceneUrl)];
  for (const h of history) {
    content.push({ type: "text", text: `Observation at ${h.t.toFixed(3)} seconds (newest observation determines current progress):` });
    content.push(...cameraBlock(h.url));
  }
  const body = {
    model,
    max_completion_tokens: 1200,
    messages: [{ role: "system", content: progressPrompt(progress) }, { role: "user", content }],
    response_format: { type: "json_schema", json_schema: { name: "progress_observation", strict: true, schema: progressSchema(progress) } },
  };
  if (reasoning) body.reasoning_effort = reasoning;
  return body;
}

export function parseProgress(content, progress) {
  const v = parseModelJSON(content);
  const ids = [...progress.nodes.map((n) => n.id), "UNKNOWN"];
  if (!isObj(v) || Object.keys(v).sort().join() !== "node_id,reason" || typeof v.reason !== "string" || !ids.includes(v.node_id))
    throw new Error("Progress response must contain a configured node_id (or UNKNOWN) and reason");
  return { node_id: v.node_id, reason: v.reason };
}

// Run every specialist (and the progress observer) on one keyframe, in parallel.
// frameUrl(k) returns the image URL for keyframe k.
export async function observeKeyframe(call, draft, { clip, k, frameUrl, sceneUrl, model, reasoning }) {
  const frames = CLIPS[clip].frames;
  const idx = frames.findIndex((f) => f.k === k);
  if (idx < 0) throw new Error("Unknown keyframe");
  const tasks = draft.specialists.map(async (spec) => {
    const base = { name: spec.name, failure_type: spec.failure_type };
    try {
      const reply = await call(specialistRequest(spec, { clip, frameUrl: frameUrl(k), sceneUrl, model, reasoning }));
      return { ...base, ...parseSpecialist(reply.content) };
    } catch (e) {
      if (e.status === 401 || /spending limit|run out of credit/.test(e.message)) throw e;
      return { ...base, verdict: "UNCERTAIN", reason: "Request unavailable", error: String(e.message).slice(0, 300) };
    }
  });
  let progress = null;
  if (draft.progress) {
    const history = frames.slice(Math.max(0, idx - draft.progress.history_frames + 1), idx + 1)
      .map((f) => ({ t: f.t, url: frameUrl(f.k) }));
    progress = call(progressRequest(draft.progress, { clip, history, sceneUrl, model, reasoning }))
      .then((r) => parseProgress(r.content, draft.progress))
      .catch((e) => {
        if (e.status === 401 || /spending limit|run out of credit/.test(e.message)) throw e;
        return { node_id: "UNKNOWN", reason: "Progress request unavailable", error: String(e.message).slice(0, 300) };
      });
  }
  const [observations, prog] = await Promise.all([Promise.all(tasks), progress]);
  return { k, t: frames[idx].t, observations, progress: prog };
}

// ---------- decisions ----------

// Port of monitor.decide() with evidence_horizon = 0: a positive specialist in this batch is confirmed.
export function decide(observations) {
  const positive = observations.filter((o) => o.verdict === "POSITIVE");
  const successes = positive.filter((o) => o.failure_type === null);
  const failures = positive.filter((o) => o.failure_type !== null);
  const status = successes.length && !failures.length ? "SUCCESS" : failures.length && !successes.length ? "FAIL" : "ON_GOING";
  return {
    status,
    failure_type: status === "FAIL" ? failures[0].failure_type : null,
    failure_types: status === "FAIL" ? failures.map((f) => f.failure_type) : [],
    description: status === "FAIL" ? failures[0].reason : status === "SUCCESS" ? successes[0].reason : null,
  };
}

// Port of ProgressTracker: a node is confirmed after `confirmations` consecutive matching keyframes.
export class ProgressTracker {
  constructor(progress, confirmations = 2) {
    this.nodes = Object.fromEntries(progress.nodes.map((n) => [n.id, n]));
    this.unit = progress.unit_label;
    this.confirmations = confirmations;
    this.candidate = null; this.matches = 0;
    this.state = { node_id: "UNKNOWN", label: "Not observed", completed: null, total: null, quality: "unknown", reason: "Waiting for progress evidence", confirmed: false };
  }
  observe(obs) {
    if (!obs || obs.node_id === "UNKNOWN") {
      this.candidate = null; this.matches = 0;
      this.state = { ...this.state, quality: "unknown", reason: obs?.reason ?? "" };
    } else {
      this.matches = this.candidate === obs.node_id ? this.matches + 1 : 1;
      this.candidate = obs.node_id;
      const quality = this.matches >= this.confirmations ? "confirmed" : "pending";
      if (quality === "confirmed") {
        const n = this.nodes[obs.node_id];
        Object.assign(this.state, { node_id: n.id, label: n.label, completed: n.completed, total: n.total, confirmed: true });
      }
      this.state = { ...this.state, quality, reason: obs.reason, candidate: obs.node_id };
    }
    return { ...this.state, unit: this.unit };
  }
}

export function progressText(p) {
  if (!p || !p.confirmed) return p && p.quality === "pending" ? "Pending first confirmation" : "Not observed";
  const count = p.total !== null ? ` (${p.completed}/${p.total} ${p.unit})` : "";
  return (p.quality === "confirmed" ? "" : "Last known: ") + p.label + count;
}
