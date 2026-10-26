// Term Rush — rapid retrieval arcade (Stage 6). Falling equivalents, lives, combos.
// Speed is graded separately from knowledge: a splat is pressure evidence, and the
// engine finally has a way to tell "doesn't know" from "knows too slowly."
import * as core from "./engine/engine-core/index.js";
import { EngineClient } from "./engine/engine-client/engine-client.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let engine, concepts = [], targetLang = "es";
let run = null, dropTimer = null, raf = null, promptQueue = [];

function hubHref() { const p = new URLSearchParams(location.search); return `https://entrevoces.github.io/apps/hub/?domain=${encodeURIComponent(engine?.domainId || p.get("domain") || "oregon-medical")}&learner=${encodeURIComponent(engine?.learnerId || p.get("learner") || "")}&engine=${encodeURIComponent(engine?.engineUrl || p.get("engine") || "")}`; }
function show(id) { cancel(); document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === id)); }
function cancel() { if (dropTimer) clearInterval(dropTimer); if (raf) cancelAnimationFrame(raf); dropTimer = raf = null; }
function tgt(c) { return c.terms[targetLang]?.term || c.terms.es?.term || c.terms.en.term; }
function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function dailyMark(gameId, score) { try { const k = `ev:daily:${gameId}`; const today = new Date().toDateString(); let d = {}; try { d = JSON.parse(localStorage.getItem(k) || "{}"); } catch {} const yest = new Date(Date.now() - 86400000).toDateString(); d.streak = d.lastDay === today ? (d.streak || 1) : d.lastDay === yest ? (d.streak || 0) + 1 : 1; d.lastDay = today; d.best = Math.max(d.best || 0, score || 0); d.plays = (d.plays || 0) + 1; localStorage.setItem(k, JSON.stringify(d)); return d; } catch { return { streak: 1, best: score || 0 }; } }
function syncBadge() { const st = engine.status(); const b = $("#syncBadge"); b.textContent = st.online ? `Synced · ${st.pending} pending` : `Local-only · ${st.pending} queued`; b.className = `pill ${st.online ? "pill-on" : "pill-local"}`; $("#hubLink").href = hubHref(); $("#endHubLink").href = hubHref(); }

async function boot() {
  const p = new URLSearchParams(location.search);
  const customTitle = p.get("title"); if (customTitle) { const h = document.querySelector("h1"); if (h) h.textContent = customTitle; document.title = `${customTitle} · ENTRE VOCES`; }
  targetLang = p.get("lang") || localStorage.getItem("ev:targetLang") || "es";
  let fb = core.CONCEPTS; try { const r = await fetch("concepts-subset.json"); if (r.ok) fb = await r.json(); } catch {}
  const domainId = p.get("domain") || localStorage.getItem("ev:domainId") || "oregon-medical";
  engine = new EngineClient({ engineUrl: p.get("engine") || localStorage.getItem("ev:engineUrl") || "http://127.0.0.1:8787", learnerId: p.get("learner") || "", domainId, core, fallbackDomain: core.SEED_DOMAINS.find((d) => d.domainId === domainId) || core.OREGON_MEDICAL, fallbackConcepts: fb });
  await engine.init();
  concepts = await engine.listConcepts(engine.domainId);
  if (!concepts.length) concepts = fb.filter((c) => c.domainId === engine.domainId);
  try { const st = await engine.getState(engine.domainId, concepts); const due = (st.dueForReview || []).map((d) => concepts.find((c) => c.conceptId === d.conceptId)).filter(Boolean); promptQueue = shuffle([...due, ...shuffle(concepts)]); } catch { promptQueue = shuffle(concepts); }
  syncBadge();
  const dom = await engine.getDomain(engine.domainId);
  $("#titleContext").textContent = `${dom?.label.en || engine.domainId} · ${concepts.length} terms in the rain · English → ${targetLang === "zh" ? "中文" : "Español"}.`;
  $("#startBtn").addEventListener("click", startRun);
  $("#againBtn").addEventListener("click", startRun);
  $("#quitBtn").addEventListener("click", endRun);
}

function startRun() {
  run = { score: 0, combo: 1, best: 1, lives: 3, caught: 0, missed: 0, speed: 0.55, current: null, drops: [] };
  $("#rainField").innerHTML = ""; show("screen-play"); hud();
  nextPrompt(); dropTimer = setInterval(tick, 900); loop();
}
function hud() { $("#hudScore").textContent = `Score ${run.score}`; $("#hudCombo").textContent = `Combo ×${run.combo}`; $("#hudLives").textContent = `Lives ${"●".repeat(run.lives)}${"○".repeat(3 - run.lives)}`; $("#hudSpeed").textContent = `Rain ${run.speed.toFixed(2)}×`; }
function nextPrompt() {
  run.current = promptQueue.length ? promptQueue[(run.promptIdx = ((run.promptIdx || 0) + 1) % promptQueue.length)] : concepts[Math.floor(Math.random() * concepts.length)];
  run.meaningWave = (run.caught + run.missed) % 4 === 3;
  $("#hudPrompt").textContent = run.meaningWave ? `“${run.current.definition.en}” → catch its word` : `${run.current.terms.en.term} → ?`;
  const wrongs = shuffle(concepts.filter((c) => c.conceptId !== run.current.conceptId).sort((a, b) => (b.areaIds[0] === run.current.areaIds[0]) - (a.areaIds[0] === run.current.areaIds[0]))).slice(0, 3).map(tgt);
  const labels = shuffle([tgt(run.current), ...wrongs]);
  labels.forEach((label, i) => spawn(label, label === tgt(run.current), i));
}
function spawn(label, gold, i) {
  const el = document.createElement("button");
  el.type = "button"; el.className = "drop"; el.textContent = label;
  el.style.left = `${14 + i * 24 + Math.random() * 6}%`; el.style.top = "-70px";
  el.addEventListener("click", () => catchDrop(el, gold));
  $("#rainField").appendChild(el);
  run.drops.push({ el, y: -70, gold, done: false });
}
function tick() {
  if (!run) return;
  run.speed = Math.min(1.6, run.speed + 0.03); hud();
}
function loop() {
  if (!run) return;
  for (const d of run.drops) {
    if (d.done) continue;
    d.y += run.speed * 2.1; d.el.style.top = `${d.y}px`;
    if (d.y > 430) { d.done = true; d.el.remove(); if (d.gold) miss("The true equivalent hit the floor. Knowing slowly is its own diagnosis — the engine separates it from not knowing."); }
  }
  run.drops = run.drops.filter((d) => !d.done);
  if (run && $("#screen-play").classList.contains("is-active")) raf = requestAnimationFrame(loop);
}
function catchDrop(el, gold) {
  if (!run) return;
  const d = run.drops.find((x) => x.el === el); if (!d || d.done) return;
  d.done = true; el.remove();
  const c = run.current;
  if (gold) {
    run.caught++; run.score += 100 * run.combo; run.combo = Math.min(8, run.combo + 1); run.best = Math.max(run.best, run.combo);
    $("#feedback").textContent = run.meaningWave ? "Meaning caught — you knew what it was, not just its name." : ["Caught clean.", "Clean hands, fast heart.", "The rain respects you."][run.caught % 3]; $("#feedback").className = "feedback good";
    engine.recordEvidence({ conceptId: c.conceptId, areaId: c.areaIds[0], gameId: "term-rush", activityType: run.meaningWave ? "conceptual" : "retrieval", ...(run.meaningWave ? { stage: 3 } : { stage: 6 }), languageDirection: `en->${targetLang}`, correct: true, score: 1, responseSummary: run.meaningWave ? "Rush meaning-wave catch (definition -> term)" : `Rush catch at combo ×${run.combo}` });
    run.drops.forEach((x) => { x.done = true; x.el.remove(); }); run.drops = [];
    hud(); setTimeout(nextPrompt, 350);
  } else {
    engine.recordEvidence({ conceptId: c.conceptId, areaId: c.areaIds[0], gameId: "term-rush", activityType: "retrieval", stage: 6, languageDirection: `en->${targetLang}`, correct: false, score: 0, responseSummary: "Rush wrong catch" });
    miss(`That was a neighbor, not “${tgt(c)}”.`);
  }
  syncBadge(); hud();
}
function miss(msg) {
  if (!run) return;
  run.missed++; run.combo = 1; run.lives--;
  $("#feedback").textContent = msg; $("#feedback").className = "feedback bad";
  if (run.lives <= 0) { endRun(); return; }
  run.drops.forEach((x) => { x.done = true; x.el.remove(); }); run.drops = [];
  hud(); setTimeout(nextPrompt, 650);
}
async function endRun() {
  const done = run; cancel(); const was = run; run = null;
  await engine.sync().catch(() => {});
  const next = await engine.getNext(engine.domainId).catch(() => null);
  $("#endTitle").textContent = (was?.caught || 0) >= 10 ? "The room asks for you when it gets fast." : "The rain taught your hands something.";
  const dm = dailyMark("term-rush", was?.score || 0); $("#endStats").innerHTML = `<p style="font-size:19px;">Day streak <strong>${dm.streak}</strong> · Best score <strong>${dm.best}</strong> · Caught <strong>${was?.caught || 0}</strong> · Missed <strong>${was?.missed || 0}</strong> · Best combo <strong>×${was?.best || 1}</strong> · Score <strong>${was?.score || 0}</strong></p>`;
  $("#endExplain").innerHTML = `<strong>Engine next:</strong> ${esc(next?.rationale || "Keep raining.")}<br><span class="hint">Stage-6 evidence only lives here and in Echo — slow mastery cannot fake it.</span>`;
  show("screen-end"); syncBadge();
}
boot().catch((e) => { $("#titleContext").textContent = `Rain failed (${e.message}). Reload.`; $("#startBtn").disabled = true; });
