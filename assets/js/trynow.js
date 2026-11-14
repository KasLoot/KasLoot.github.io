// RoboBrain "Try now": generate a monitor from a description, then replay a clip against it.
import {
  CLIPS, REPLAY_NOTES, MAX_TASK_CHARS, chatCompletion, generateDraft, observeKeyframe,
  decide, ProgressTracker, progressText,
} from "./rb-core.js";
import { L, tr } from "./trynow-i18n.js";

const cfg = Object.assign({ workerUrl: "", turnstileSiteKey: "", model: "gpt-6.1-terra", openaiBase: "https://api.openai.com/v1" }, window.SITE_CONFIG || {});
cfg.workerUrl = (cfg.workerUrl || "").replace(/\/$/, "");
const ROOT = new URL("../../", import.meta.url);
const asset = (p) => new URL(p, ROOT).href;
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
};

const S = { clip: "plug", mode: "own", demoReady: false, edited: false, draft: null, draftClip: null, ticket: null, run: 0, tsWidget: null };

// ---------- setup ----------
function init() {
  $("tn-model").textContent = cfg.model;
  for (const input of document.querySelectorAll('input[name="tn-clip"]')) {
    input.addEventListener("change", () => selectClip(input.value));
  }
  $("tn-task").addEventListener("input", () => { S.edited = true; count(); });
  for (const r of document.querySelectorAll('input[name="tn-mode"]')) r.addEventListener("change", () => setMode(r.value));
  $("tn-generate").addEventListener("click", onGenerate);
  $("tn-run").addEventListener("click", onRun);
  $("tn-view-mine").addEventListener("click", () => setView(false));
  $("tn-view-orig").addEventListener("click", () => setView(true));
  $("tn-replay-btn").addEventListener("click", () => { const v = $("tn-video"); v.currentTime = 0; v.play().catch(() => {}); });
  $("tn-notes").replaceChildren(...L.notes.map((t) => el("li", { text: t })));
  selectClip(S.clip, true);
  renderPlaceholder();
  checkDemo();
}

function selectClip(clip, initial = false) {
  S.clip = clip;
  if (!S.edited || initial) { $("tn-task").value = L.defaultTask(clip); S.edited = false; }
  count();
  if (S.draft && S.draftClip !== clip) {
    S.draft = null; S.ticket = null; $("tn-run").disabled = true;
    renderPlaceholder();
    info(L.clipChanged);
  }
}
function count() { const n = $("tn-task").value.length; $("tn-count").textContent = L.chars(n, MAX_TASK_CHARS); }

async function checkDemo() {
  const demo = document.querySelector('input[name="tn-mode"][value="demo"]');
  if (!cfg.workerUrl) {
    demo.disabled = true; $("tn-demo-note").textContent = L.demoOff;
    setMode("own"); return;
  }
  try {
    const r = await fetch(cfg.workerUrl + "/health");
    const h = await r.json();
    if (!r.ok || !h.ok) throw new Error();
    S.demoReady = true; demo.disabled = false;
    $("tn-demo-note").textContent = L.demoLimits(h.limits.runs_per_ip_per_day);
    if (h.model) $("tn-model").textContent = h.model;
    demo.checked = true; setMode("demo");
    if (cfg.turnstileSiteKey) loadTurnstile();
  } catch {
    demo.disabled = true; $("tn-demo-note").textContent = L.demoDown;
    setMode("own");
  }
}
function setMode(mode) {
  S.mode = mode;
  document.querySelector(`input[name="tn-mode"][value="${mode}"]`).checked = true;
  $("tn-key-wrap").hidden = mode !== "own";
  $("tn-turnstile").hidden = mode !== "demo";
}

function loadTurnstile() {
  window.onTurnstileLoad = () => { S.tsWidget = window.turnstile.render("#tn-turnstile", { sitekey: cfg.turnstileSiteKey, size: "flexible" }); };
  document.head.append(el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit", async: "" }));
}
const tsToken = () => (S.tsWidget !== null && window.turnstile ? window.turnstile.getResponse(S.tsWidget) : undefined);
const tsReset = () => { if (S.tsWidget !== null && window.turnstile) window.turnstile.reset(S.tsWidget); };

// ---------- messages ----------
function msg(text, kind) { $("tn-gen-msg").replaceChildren(text ? el("div", { class: "msg " + kind, role: kind === "error" ? "alert" : "status", text }) : ""); }
const info = (t) => msg(t, "info");
const fail = (t) => msg(tr(t), "error");
function busy(on, text = "") {
  $("tn-generate").disabled = on;
  $("tn-gen-status").replaceChildren(on ? el("span", { class: "busy", text }) : "");
}

// ---------- OpenAI access ----------
function ownKey() {
  const key = $("tn-key").value.trim();
  if (!/^sk-[\w-]{10,}/.test(key)) throw new Error(L.needKey);
  return key;
}
const directCall = (key) => (body) => chatCompletion(fetch.bind(window), cfg.openaiBase, key, body);

const dataUrls = new Map();
async function dataUrl(path) {
  if (dataUrls.has(path)) return dataUrls.get(path);
  const p = fetch(asset(path)).then((r) => r.blob()).then((b) => new Promise((ok, no) => {
    const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b);
  }));
  dataUrls.set(path, p);
  return p;
}

async function worker(path, body) {
  const r = await fetch(cfg.workerUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(j.error || L.serverHttp(r.status));
  return j;
}

// ---------- generate ----------
async function onGenerate() {
  msg("");
  const clip = S.clip, task = $("tn-task").value.trim();
  if (!task) { fail(L.needTask); return; }
  busy(true, L.generating);
  $("tn-run").disabled = true; S.draft = null; S.ticket = null;
  renderPlaceholder(true);
  try {
    let res;
    if (S.mode === "demo") {
      res = await worker("/generate", { clip, task, turnstile: tsToken() });
      if (res.remaining !== null && res.remaining !== undefined)
        $("tn-demo-note").textContent = L.demoLeft(res.remaining);
    } else {
      const key = ownKey();
      res = await generateDraft(directCall(key), { clip, task, sceneUrl: await dataUrl(CLIPS[clip].scene), model: cfg.model });
    }
    if (!res.draft) { renderPlaceholder(); info(L.needMore(res.clarification)); return; }
    S.draft = res.draft; S.draftClip = clip; S.ticket = res.ticket || null;
    renderDraft(res.draft);
    $("tn-run").disabled = false;
    $("tn-run-note").textContent = L.runNote(CLIPS[clip].frames.length, clip);
  } catch (e) {
    renderPlaceholder();
    fail(e.message || L.genFailed);
  } finally { busy(false); tsReset(); }
}

function renderPlaceholder(working = false) {
  $("tn-draft-badge").textContent = L.draft;
  $("tn-preview-body").replaceChildren(el("div", { class: "placeholder" },
    el("div", { class: "spark", "aria-hidden": "true", text: "✦" }),
    el("h4", { text: working ? L.phWorkingTitle : L.phTitle }),
    el("p", { text: working ? L.phWorking : L.ph })));
}

function renderDraft(d) {
  $("tn-draft-badge").textContent = L.badge(d.specialists.length, !!d.progress);
  const body = [el("h4", { class: "sans", style: "font-family:var(--sans);font-size:17px;font-weight:650;margin:0 0 4px", text: d.name }), el("p", { style: "margin:0 0 6px;font-size:14px", text: d.summary })];
  for (const s of d.specialists) {
    body.push(el("div", { class: "spec" },
      el("div", { class: "spec-top" }, el("strong", { text: s.name }),
        el("span", { class: "tag " + (s.failure_type ? "failure" : "success"), text: s.failure_type || L.success })),
      el("details", {}, el("summary", { text: L.prompt }), el("pre", { text: s.prompt }))));
  }
  if (d.progress) {
    const p = d.progress;
    const rows = p.nodes.map((n) => el("tr", {}, el("td", { text: n.id }), el("td", { text: n.label }),
      el("td", { text: n.total !== null ? `${n.completed}/${n.total}` : "–" })));
    body.push(el("div", { class: "spec" },
      el("div", { class: "spec-top" }, el("strong", { text: L.progressObserver }), el("span", { class: "tag progress", text: L.nodes(p.nodes.length) })),
      el("table", { class: "nodes" }, el("thead", {}, el("tr", {}, el("th", { text: L.node }), el("th", { text: L.label }), el("th", { text: p.unit_label }))), el("tbody", {}, ...rows)),
      el("details", {}, el("summary", { text: L.promptCriteria }),
        el("pre", { text: p.prompt + "\n\n" + p.nodes.map((n) => `${n.id}: ${n.criteria}`).join("\n\n") }))));
  }
  body.push(el("details", { style: "margin-top:10px;font-size:13px" }, el("summary", { text: L.draftJson }),
    el("pre", { style: "white-space:pre-wrap;font-size:12px;max-height:260px;overflow:auto", text: JSON.stringify(d, null, 2) })));
  $("tn-preview-body").replaceChildren(...body);
}

// ---------- replay ----------
function setView(original) {
  $("tn-stage").classList.toggle("original", original);
  $("tn-view-mine").setAttribute("aria-pressed", String(!original));
  $("tn-view-orig").setAttribute("aria-pressed", String(original));
  $("tn-orig-note").hidden = !original;
  if (original) { hideWait(); $("tn-video").play().catch(() => {}); } else { R && R.sync(); }
}
function hideWait() { const w = $("tn-stage").querySelector(".wait"); if (w) w.remove(); }

let R = null; // current replay controller

async function onRun() {
  const runId = ++S.run;
  const clip = S.draftClip, c = CLIPS[clip], draft = S.draft, ticket = S.ticket, mode = S.mode;
  let key = null;
  try { if (mode === "own") key = ownKey(); } catch (e) { fail(e.message); return; }
  msg("");
  $("tn-replay").hidden = false;
  $("tn-run").disabled = true;
  $("tn-orig-note").textContent = L.original(clip);

  // stage: video + covers over the burned-in overlay + our overlay panel
  const stage = $("tn-stage"), video = $("tn-video");
  stage.querySelectorAll(".cover,.ov,.tl,.wait").forEach((n) => n.remove());
  video.pause(); video.src = asset(c.video); video.poster = asset(c.poster); video.currentTime = 0;
  const pos = (m) => `left:${m[0] * 100}%;top:${m[1] * 100}%;width:${(m[2] - m[0]) * 100}%;height:${(m[3] - m[1]) * 100}%`;
  const ov = el("div", { class: "ov", style: pos(c.masks[0]), "aria-hidden": "true" });
  stage.append(ov);
  for (const m of c.masks.slice(1)) stage.append(el("div", { class: "tl", style: pos(m), "aria-hidden": "true", text: "Replay" }));
  setView(false);

  // keyframe strip
  const strip = $("tn-strip"); strip.replaceChildren();
  const chips = new Map();
  for (const f of c.frames) {
    const lab = el("span", { class: "lab" }, el("b", { text: L.waiting }), `${f.t.toFixed(1)} s`);
    const b = el("button", { type: "button", "aria-label": L.keyframeAria(f.k, f.t.toFixed(1)) }, el("img", { src: asset(f.src), alt: "" }), lab);
    b.addEventListener("click", () => { video.currentTime = f.t; video.play().catch(() => {}); });
    strip.append(b); chips.set(f.k, b);
  }
  const tbody = $("tn-obs"); tbody.replaceChildren(); $("tn-obs-count").textContent = "";
  const tracker = draft.progress ? new ProgressTracker(draft.progress) : null;
  const history = [];
  renderProgress(null, draft, history);

  const results = new Map(), timeline = [];
  let next = 0, waiting = false, error = null;

  const overlayAt = (t) => {
    let e = null;
    for (const x of timeline) if (x.t <= t + 0.05) e = x;
    return e;
  };
  const paint = () => {
    const t = video.currentTime, e = overlayAt(t);
    const d = e ? e.decision : { status: "ON_GOING", failure_type: null, description: null };
    const lines = [el("span", { class: "h", text: e ? `Operating Status (keyframe ${e.k}, ${e.t.toFixed(1)} s)` : "Operating Status: waiting…" }),
      el("span", { text: "Status: " + d.status }), el("span", { text: "Failure type: " + (d.failure_type || "NONE") })];
    if (draft.progress) {
      lines.push(el("span", { text: "Progress: " + progressText(e && e.prog) }));
      lines.push(el("span", { text: "Evidence: " + (e && e.prog ? e.prog.quality : "waiting") }));
    } else lines.push(el("span", { text: "Failure: " + (d.status === "FAIL" ? d.description : "none") }));
    ov.replaceChildren(...lines);
    $("tn-status").textContent = d.status; $("tn-status").dataset.status = d.status;
    $("tn-failure").textContent = L.failureType(d.failure_types && d.failure_types.length ? d.failure_types.join(", ") : "NONE");
    $("tn-detail").textContent = e ? (d.description || L.noDecision) : L.waitFirst;
    chips.forEach((b, k) => b.classList.toggle("now", !!e && e.k === k));
    if (e) renderProgress(e.prog, draft, history);
  };
  const gate = () => {
    if ($("tn-stage").classList.contains("original")) return;
    const pending = c.frames[next];
    if (pending && video.currentTime >= pending.t - 0.02 && !error) {
      if (!waiting) { waiting = true; video.pause(); }
      hideWait();
      stage.append(el("div", { class: "wait", role: "status", text: L.evaluating(pending.k, c.frames.length) }));
    } else if (waiting) {
      waiting = false; hideWait(); video.play().catch(() => {});
    }
  };
  R = { sync: () => { gate(); paint(); } };
  video.ontimeupdate = () => { if (runId !== S.run) return; gate(); paint(); };
  video.onended = () => { if (runId === S.run) paint(); };

  const commit = () => {
    while (next < c.frames.length && results.has(c.frames[next].k)) {
      const r = results.get(c.frames[next].k);
      const decision = decide(r.observations);
      const prog = tracker ? tracker.observe(r.progress) : null;
      if (prog && prog.quality === "confirmed" && (!history.length || history[history.length - 1].id !== prog.node_id))
        history.push({ id: prog.node_id, label: prog.label, t: r.t });
      timeline.push({ ...r, decision, prog });
      const chip = chips.get(r.k);
      chip.classList.add("done", decision.status);
      chip.querySelector("b").textContent = decision.status;
      for (const o of r.observations) {
        tbody.append(el("tr", {}, el("td", { text: `${r.k}  (${r.t.toFixed(1)} s)` }), el("td", { text: o.name + (o.failure_type ? ` (${o.failure_type})` : "") }),
          el("td", { class: "v-" + o.verdict, text: o.verdict }), el("td", { text: o.error ? `${o.reason}: ${o.error}` : o.reason })));
      }
      if (r.progress) tbody.append(el("tr", {}, el("td", { text: `${r.k}  (${r.t.toFixed(1)} s)` }), el("td", { text: L.progressObserver }),
        el("td", { text: r.progress.node_id }), el("td", { text: r.progress.error ? `${r.progress.reason}: ${r.progress.error}` : r.progress.reason })));
      next++;
    }
    $("tn-obs-count").textContent = L.answers(tbody.children.length, next, c.frames.length);
    if (runId === S.run) { gate(); paint(); }
  };

  // start paused at 0 and wait for keyframe 1
  gate(); paint();

  let frameUrl = null, sceneUrl = null;
  try {
    if (mode === "own") {
      const urls = await Promise.all(c.frames.map((f) => dataUrl(f.src)));
      const map = new Map(c.frames.map((f, i) => [f.k, urls[i]]));
      frameUrl = (k) => map.get(k); sceneUrl = await dataUrl(c.scene);
    }
  } catch { fail(L.framesFailed); return; }

  const fetchFrame = (k) => mode === "demo"
    ? worker("/observe", { clip, k, draft, ticket })
    : observeKeyframe(directCall(key), draft, { clip, k, frameUrl, sceneUrl, model: cfg.model });

  let cursor = 0;
  const lane = async () => {
    while (cursor < c.frames.length && runId === S.run && !error) {
      const f = c.frames[cursor++];
      try {
        const r = await fetchFrame(f.k);
        if (runId !== S.run) return;
        results.set(f.k, r); commit();
      } catch (e) {
        if (runId !== S.run) return;
        error = e; hideWait(); waiting = false;
        msg(tr(e.message) + L.stopped, "error");
      }
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  if (runId === S.run) $("tn-run").disabled = false;
}

function renderProgress(p, draft, history) {
  const box = $("tn-prog");
  if (!draft.progress) {
    box.replaceChildren(el("h3", { text: L.taskProgress }), el("p", { text: L.noProgress }));
    return;
  }
  const total = p && p.confirmed && p.total !== null ? p.total : null;
  const kids = [el("h3", { text: L.taskProgress }),
    el("div", { class: "count", text: L.progress(p) })];
  if (total !== null && p.quality === "confirmed") kids.push(el("progress", { max: String(total), value: String(p.completed) }));
  kids.push(el("p", { text: p ? L.evidence(L.quality(p.quality), p.reason) : L.waitingProgress }));
  if (history.length) {
    kids.push(el("details", { style: "margin-top:10px;font-size:13.5px" }, el("summary", { text: L.transitions }),
      el("ol", { style: "padding-left:20px;margin:8px 0 0" }, ...history.map((h) => el("li", { text: `${h.t.toFixed(1)} s  ${h.label}` })))));
  }
  box.replaceChildren(...kids);
}

init();
