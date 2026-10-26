// Term Rush — Catch the Rain (canvas regen, game-spec-kit).
// A catcher slides along a night-market street; word-drops fall. Catch the
// true equivalent, dodge neighbours, survive the meaning drops. Stage 6 (+3).
import * as core from "./engine/engine-core/index.js";
import { EngineClient } from "./engine/engine-client/engine-client.js";
import { Juice } from "./engine/game-kit/juice.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cv = $("#game"), ctx = cv.getContext("2d");
const W = 960, H = 540;
let engine, concepts = [], targetLang = "es", promptQueue = [], momentConceptId = null;
let R = null, raf = null, keys = {}, pointerX = null;
const juice = new Juice(cv);
function hubHref() { const p = new URLSearchParams(location.search); return `https://entrevoces.github.io/apps/hub/?domain=${encodeURIComponent(engine?.domainId || p.get("domain") || "oregon-medical")}&learner=${encodeURIComponent(engine?.learnerId || p.get("learner") || "")}&engine=${encodeURIComponent(engine?.engineUrl || p.get("engine") || "")}`; }
function show(id) { if (raf) cancelAnimationFrame(raf); raf = null; document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("is-active", s.id === id)); }
function tgt(c) { return c.terms[targetLang]?.term || c.terms.es?.term || c.terms.en.term; }
function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
function dailyMark(gameId, score) { try { const k = `ev:daily:${gameId}`; const today = new Date().toDateString(); let d = {}; try { d = JSON.parse(localStorage.getItem(k) || "{}"); } catch {} const yest = new Date(Date.now() - 86400000).toDateString(); d.streak = d.lastDay === today ? (d.streak || 1) : d.lastDay === yest ? (d.streak || 0) + 1 : 1; d.lastDay = today; d.best = Math.max(d.best || 0, score || 0); localStorage.setItem(k, JSON.stringify(d)); return d; } catch { return { streak: 1, best: score || 0 }; } }
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
  try { const areas = JSON.parse(localStorage.getItem("ev:interestAreas") || "[]"); if (areas.length) { const f = concepts.filter((c) => c.areaIds.some((a) => areas.includes(a))); if (f.length >= 4) concepts = f; } } catch {}
  try { const nx = await engine.getNext(engine.domainId, { modeId: (JSON.parse(localStorage.getItem("ev:modes") || "[]")[0] || null) }); if (nx?.conceptId) momentConceptId = nx.conceptId; } catch {}
  syncBadge();
  const dom = await engine.getDomain(engine.domainId);
  $("#titleContext").textContent = `${dom?.label.en || engine.domainId} · English → ${targetLang === "zh" ? "中文" : "Español"} · the storm starts with your thinnest words.`;
  $("#startBtn").addEventListener("click", startRun);
  $("#againBtn").addEventListener("click", startRun);
  $("#quitBtn").addEventListener("click", () => endRun());
  window.addEventListener("keydown", (e) => { keys[e.code] = true; });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  cv.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); pointerX = (e.clientX - r.left) * (W / r.width); });
  cv.addEventListener("pointerdown", (e) => { const r = cv.getBoundingClientRect(); pointerX = (e.clientX - r.left) * (W / r.width); });
}
function hud() { $("#hudScore").textContent = `Score ${R.score}`; $("#hudCombo").textContent = `Combo ×${R.combo}`; $("#hudLives").textContent = `Lives ${"●".repeat(Math.max(0, R.lives))}${"○".repeat(Math.max(0, 3 - R.lives))}`; $("#hudSpeed").textContent = `Rain ${R.speed.toFixed(2)}×`; $("#hudPrompt").textContent = R.meaningWave ? `“${R.current.definition.en}”` : `${R.current.terms.en.term} → catch it`; }
function startRun() {
  R = { x: W / 2, drops: [], score: 0, combo: 1, best: 0, lives: 3, caught: 0, missed: 0, speed: 1, current: null, meaningWave: false, spawnIn: 0, t: 0, over: false, promptIdx: 0 };
  show("screen-play"); nextPrompt(); loop();
}
function nextPrompt() {
  const momentC = R.caught === 0 && R.missed === 0 && momentConceptId && concepts.find((c) => c.conceptId === momentConceptId);
  R.current = momentC || (promptQueue.length ? promptQueue[(R.promptIdx = (R.promptIdx + 1) % promptQueue.length)] : concepts[Math.floor(Math.random() * concepts.length)]);
  R.meaningWave = (R.caught + R.missed) % 4 === 3;
  R.drops = [];
  const neighbours = shuffle(concepts.filter((c) => c.conceptId !== R.current.conceptId).sort((a, b) => (b.areaIds[0] === R.current.areaIds[0]) - (a.areaIds[0] === R.current.areaIds[0]))).slice(0, 3);
  const defs = shuffle([{ c: R.current, gold: true }, ...neighbours.map((c) => ({ c, gold: false }))]);
  R.spawnDefs = defs.map((d, i) => ({ ...d, at: 25 + i * 34 }));
  R.spawnIn = 0;
  hud();
}
function catchDrop(d) {
  const c = R.current;
  if (d.gold) {
    const gain = 10 * R.combo; R.score += gain; R.caught++; R.best = Math.max(R.best, R.combo); R.combo = Math.min(9, R.combo + 1); R.speed = Math.min(2.4, R.speed + 0.045);
    juice.burst(d.x, 452, "#7fe3c8", 18); juice.floatText(d.x, 420, `+${gain}`, "#7fe3c8"); Juice.good();
    $("#feedback").textContent = R.meaningWave ? "Meaning caught — you knew what it was, not just its name." : ["Caught clean.", "Clean hands, fast heart.", "The rain respects you."][R.caught % 3]; $("#feedback").className = "feedback good";
    engine.recordEvidence({ conceptId: c.conceptId, areaId: c.areaIds[0], gameId: "term-rush", activityType: R.meaningWave ? "conceptual" : "retrieval", ...(R.meaningWave ? { stage: 3 } : { stage: 6 }), languageDirection: `en->${targetLang}`, correct: true, score: 1, responseSummary: R.meaningWave ? "Rush meaning-wave catch" : `Rush canvas catch ×${R.combo}` });
    syncBadge(); setTimeout(() => { if (R && !R.over) nextPrompt(); }, 260);
  } else {
    R.lives--; R.combo = 1; R.missed++; juice.shake(8); Juice.bad(); juice.burst(d.x, 452, "#ff8a75", 16);
    $("#feedback").textContent = `Splash — that was “${tgt(d.c)}”, a neighbour. “${tgt(c)}” is the keeper.`; $("#feedback").className = "feedback bad";
    engine.recordEvidence({ conceptId: c.conceptId, areaId: c.areaIds[0], gameId: "term-rush", activityType: "retrieval", stage: 6, languageDirection: `en->${targetLang}`, correct: false, score: 0, misconceptionTag: c.misconceptions?.[0]?.tag, responseSummary: `Rush caught neighbour ${tgt(d.c)}` });
    syncBadge();
    if (R.lives <= 0) { endRun(); return; }
    hud();
  }
}
function missGold(d) {
  const c = R.current; R.combo = 1; R.missed++; R.lives--;
  juice.burst(d.x, 492, "#ffd166", 10);
  $("#feedback").textContent = `“${tgt(c)}” hit the street. The true drop is the one that costs you.`; $("#feedback").className = "feedback bad";
  engine.recordEvidence({ conceptId: c.conceptId, areaId: c.areaIds[0], gameId: "term-rush", activityType: "retrieval", stage: 6, languageDirection: `en->${targetLang}`, correct: false, score: 0.15, responseSummary: "Rush missed the true drop" });
  syncBadge();
  if (R.lives <= 0) { endRun(); return; }
  setTimeout(() => { if (R && !R.over) nextPrompt(); }, 260);
}
function loop() {
  if (!R || R.over) return;
  R.t++;
  if (keys.ArrowLeft || keys.KeyA) R.x -= 7;
  if (keys.ArrowRight || keys.KeyD) R.x += 7;
  if (pointerX != null) R.x += (pointerX - R.x) * 0.22;
  R.x = Math.max(52, Math.min(W - 52, R.x));
  // spawn staggered drops for this prompt
  if (R.spawnDefs?.length && R.t >= R.spawnDefs[0].at) { const d = R.spawnDefs.shift(); R.drops.push({ x: 110 + Math.random() * (W - 220), y: -30, vy: (1.6 + Math.random() * 0.7) * R.speed, label: tgt(d.c), gold: d.gold, c: d.c, wob: Math.random() * 6 }); }
  for (const d of R.drops) {
    d.y += d.vy; d.x += Math.sin(R.t * 0.03 + d.wob) * 0.5;
    if (!d.done && d.y >= 440 && d.y <= 478 && Math.abs(d.x - R.x) < 74) { d.done = true; if (d.gold) { catchDrop(d); R.drops = []; } else catchDrop(d); }
    else if (!d.done && d.y > 505) { d.done = true; if (d.gold) { missGold(d); R.drops = []; } }
  }
  R.drops = R.drops.filter((d) => !d.done);
  draw();
  juice.update();
  if (R && !R.over) raf = requestAnimationFrame(loop);
}
function draw() {
  const { x: sx, y: sy } = juice.shakeOffset();
  ctx.save(); ctx.translate(sx, sy);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0e241b"); sky.addColorStop(0.65, "#173627"); sky.addColorStop(1, "#0a140f");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // shopfronts + awnings
  const shops = [["#20392c", "#d84f35"], ["#1a2f3d", "#e9a13b"], ["#2c2135", "#0e7a68"], ["#20392c", "#c9a227"]];
  shops.forEach(([wall, awn], i) => {
    const x = i * 240;
    ctx.fillStyle = wall; ctx.fillRect(x + 8, 120, 224, 340);
    ctx.fillStyle = "rgba(255,214,130,.85)"; ctx.fillRect(x + 34, 190, 52, 66); ctx.fillRect(x + 150, 190, 52, 66);
    ctx.fillStyle = awn; ctx.beginPath(); ctx.moveTo(x + 2, 132); ctx.lineTo(x + 238, 132); ctx.lineTo(x + 218, 162); ctx.lineTo(x + 22, 162); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.75)"; for (let s = 0; s < 5; s++) ctx.fillRect(x + 26 + s * 42, 132, 20, 30);
  });
  // rain streaks
  ctx.strokeStyle = "rgba(160,220,255,.28)"; ctx.lineWidth = 2;
  for (let i = 0; i < 42; i++) { const x = (i * 173 + R.t * 3) % W, y = (i * 97 + R.t * 9) % H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 17); ctx.stroke(); }
  // street
  ctx.fillStyle = "#0d1f16"; ctx.fillRect(0, 492, W, 48);
  ctx.fillStyle = "rgba(255,214,130,.12)"; ctx.fillRect(0, 492, W, 5);
  // drops
  for (const d of R.drops) {
    ctx.save(); ctx.translate(d.x, d.y);
    const grad = ctx.createRadialGradient(-5, -8, 3, 0, 0, 26);
    if (d.gold) { grad.addColorStop(0, "#d8fff4"); grad.addColorStop(1, "#159a7c"); } else { grad.addColorStop(0, "#e8f4ff"); grad.addColorStop(1, "#4a6a8a"); }
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(17, 4, 12, 14); ctx.quadraticCurveTo(6, 24, 0, 24); ctx.quadraticCurveTo(-6, 24, -12, 14); ctx.quadraticCurveTo(-17, 4, 0, -24); ctx.fill();
    ctx.restore();
    label(d.x, d.y + 42, d.label);
  }
  // catcher: interpreter with basket + umbrella hat
  const x = R.x, bob = Math.sin(R.t * 0.12) * 2;
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(x, 502, 42, 9, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#123b34"; ctx.fillRect(x - 13, 448 + bob, 26, 34);
  ctx.fillStyle = "#f2c29b"; ctx.beginPath(); ctx.arc(x, 438 + bob, 11, 0, 7); ctx.fill();
  ctx.fillStyle = "#d84f35"; ctx.beginPath(); ctx.moveTo(x - 30, 430 + bob); ctx.quadraticCurveTo(x, 408 + bob, x + 30, 430 + bob); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#5a3418"; ctx.beginPath(); ctx.moveTo(x - 38, 462 + bob); ctx.lineTo(x + 38, 462 + bob); ctx.lineTo(x + 28, 486 + bob); ctx.lineTo(x - 28, 486 + bob); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#e9a13b"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 38, 462 + bob); ctx.lineTo(x + 38, 462 + bob); ctx.stroke();
  if (R.combo >= 3) { ctx.fillStyle = `rgba(255,150,60,${0.5 + Math.sin(R.t * 0.3) * 0.2})`; ctx.beginPath(); ctx.arc(x, 420 + bob, 8 + R.combo, 0, 7); ctx.fill(); }
  juice.draw();
  ctx.restore();
}
function label(x, y, text) {
  ctx.font = "700 14px 'Public Sans', sans-serif";
  const w = Math.min(220, ctx.measureText(text).width + 18);
  ctx.fillStyle = "rgba(8,18,14,.88)"; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 13, w, 25, 7); ctx.fill();
  ctx.strokeStyle = "#7fe3c8"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = "#f4fffc"; ctx.textAlign = "center"; ctx.fillText(text.length > 24 ? text.slice(0, 23) + "…" : text, x, y + 4, w - 8);
}
async function endRun() {
  if (!R) return;
  const r = R; R.over = true; const dm = dailyMark("term-rush", r.score);
  await engine.sync().catch(() => {});
  const next = await engine.getNext(engine.domainId).catch(() => null);
  $("#endTitle").textContent = r.score >= 220 ? "The market will talk about this basket." : "Damp, wiser, and ready for the next storm.";
  $("#endStats").innerHTML = `<p style="font-size:19px;">Day streak <strong>${dm.streak}</strong> · Best score <strong>${dm.best}</strong> · Caught <strong>${r.caught}</strong> · Best combo <strong>×${r.best}</strong> · Score <strong>${r.score}</strong></p>`;
  $("#endExplain").innerHTML = `<strong>Engine next:</strong> ${esc(next?.rationale || "Run again.")}<br><span class="hint">Retrieval at storm speed — with meaning drops mixed in.</span>`;
  show("screen-end"); R = null; syncBadge();
}
boot().catch((e) => { $("#titleContext").textContent = `Storm failed (${e.message}). Reload.`; $("#startBtn").disabled = true; });
