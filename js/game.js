import FIREBASE_CONFIG from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import { getDatabase, ref, update, onValue }
  from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js';

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

const params  = new URLSearchParams(location.search);
const ROOM_ID = params.get('room')   || sessionStorage.getItem('trio_room');
const MY_ID   = params.get('player') || sessionStorage.getItem('trio_player');

const LOG_TTL    = 10_000;   // ms until log entry fades out
const CARD_FLIP_TTL = 10_000; // ms until face-up center card flips back
const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#F5C518','#A29BFE','#FD79A8','#55EFC4'];

let room     = null;
let myPlayer = null;
let isMyTurn = false;
let flipBackLock = false; // prevent concurrent flip-back writes

// ── Config helper (with defaults for legacy rooms) ────────────────────────────
function cfg() {
  return {
    matchCount:  3,
    maxCard:     12,
    winsNeeded:  3,
    handSize:    null,
    centerCards: null,
    ...(room?.config || {})
  };
}
function matchLabel(n) { return n === 4 ? 'Quartet' : n === 3 ? 'Trio' : `${n}er-Set`; }

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function isLight(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000 > 128;
}
function getPlayers() {
  return Object.values(room?.players || {}).sort((a,b)=>(a.order??0)-(b.order??0));
}
function pColor(p) { return p?.color || PLAYER_COLORS[(p?.order||0)%PLAYER_COLORS.length]; }

// ── Render ────────────────────────────────────────────────────────────────────
function render(data) {
  room     = data;
  myPlayer = room.players?.[MY_ID];
  isMyTurn = room.currentPlayer === MY_ID;

  renderHeader();
  renderOpponents();
  renderCenterPile();
  renderMyHand();
  renderHint();
  renderLog();
  renderStats();
  if (room.phase === 'ended') showWin();
}

function renderHeader() {
  $('header-room-code').textContent = ROOM_ID;
  const mode = room.mode || 'simple';
  $('header-mode').textContent = mode === 'spicy' ? '🌶 Spicy' : '✨ Simple';
  $('header-mode').className   = `mode-badge ${mode}`;
  const cur = room.players?.[room.currentPlayer];
  $('turn-indicator-name').textContent = isMyTurn ? 'Dein Zug!' : (cur ? `${esc(cur.name)}s Zug` : '…');
}

function renderOpponents() {
  const el = $('opponents-container');
  el.innerHTML = '';
  const asked = room.askedThisTurn || [];

  getPlayers().filter(p => p.id !== MY_ID).forEach(p => {
    const col  = pColor(p);
    const tCol = isLight(col) ? '#2d1b69' : '#fff';
    const isAct = room.currentPlayer === p.id;
    const trios = p.trios || [];
    const lastAsked = [...asked].reverse().find(a => a.playerId === p.id);
    const disabled = (!isMyTurn || isAct) ? 'disabled' : '';

    const div = document.createElement('div');
    div.className = `opponent-panel${isAct ? ' active-turn' : ''}`;
    div.innerHTML = `
      <div class="opponent-header">
        <div class="opp-avatar" style="background:${col};color:${tCol}">${esc(p.name[0].toUpperCase())}</div>
        <span class="opp-name">${esc(p.name)}</span>
        <span class="opp-card-count">${(p.hand||[]).length} Ktn.</span>
      </div>
      ${trios.length ? `<div class="opp-trios">${trios.map(t=>`<span class="trio-badge${t.value===7?' golden':''}">${t.value}${t.value===7?'⭐':''}</span>`).join('')}</div>` : ''}
      ${lastAsked ? `<div style="padding:.3rem 0;font-size:.85rem;color:var(--gold)">Aufgedeckt: <strong>${lastAsked.value}</strong></div>` : ''}
      <div class="ask-buttons">
        <button class="ask-btn lowest" data-pid="${p.id}" ${disabled}>↓ Niedrigste</button>
        <button class="ask-btn highest" data-pid="${p.id}" ${disabled}>↑ Höchste</button>
      </div>`;
    el.appendChild(div);
  });

  el.querySelectorAll('.ask-btn').forEach(b =>
    b.addEventListener('click', () => askPlayer(b.dataset.pid, b.classList.contains('lowest') ? 'lowest' : 'highest'))
  );
}

function renderCenterPile() {
  const el = $('center-pile-grid');
  el.innerHTML = '';
  let faceDown = 0;
  const now = Date.now();

  (room.centerPile || []).forEach((card, idx) => {
    const div = document.createElement('div');
    if (card.faceDown) {
      faceDown++;
      div.className = 'game-card face-down';
      if (isMyTurn) div.addEventListener('click', () => flipCenterCard(idx));
    } else {
      div.className = 'game-card face-up';
      div.innerHTML = `<span class="corner tl">${card.value}</span>${card.value}<span class="corner br">${card.value}</span>`;
      // Show countdown ring if card will flip back
      if (card.flippedAt) {
        const remaining = Math.max(0, CARD_FLIP_TTL - (now - card.flippedAt));
        const pct = remaining / CARD_FLIP_TTL;
        div.style.setProperty('--flip-progress', pct);
        div.classList.add('has-timer');
      }
    }
    el.appendChild(div);
  });

  $('center-pile-count').textContent = faceDown;
}

function renderMyHand() {
  if (!myPlayer) return;
  const hand  = [...(myPlayer.hand  || [])].sort((a,b) => a-b);
  const trios = myPlayer.trios || [];
  const col   = pColor(myPlayer);

  $('my-cards').innerHTML = hand.map(v =>
    `<div class="game-card face-up"><span class="corner tl">${v}</span>${v}<span class="corner br">${v}</span></div>`
  ).join('');

  $('my-name').textContent        = myPlayer.name || '';
  $('my-trio-count').textContent  = trios.length;
  $('my-avatar').style.background = col;
  $('my-avatar').style.color      = isLight(col) ? '#2d1b69' : '#fff';
  $('my-avatar').textContent      = (myPlayer.name||'?')[0].toUpperCase();

  if (trios.length) {
    $('my-trios-section').classList.remove('hidden');
    $('my-trios').innerHTML = trios.map(t =>
      `<div class="trio-group">${[0,1,2].map(()=>`<div class="game-card face-up"><span class="corner tl">${t.value}</span>${t.value}<span class="corner br">${t.value}</span></div>`).join('')}</div>`
    ).join('');
  } else {
    $('my-trios-section').classList.add('hidden');
  }
}

function renderHint() {
  const el = $('action-hint');
  const target = room.turnTarget ?? null;
  if (isMyTurn) {
    el.innerHTML = target !== null
      ? `Ziel: <span class="hint-highlight">${target}</span> — weiter fragen oder aufdecken!`
      : '<span class="hint-highlight">Dein Zug:</span> Mitspieler befragen oder Karte aufdecken.';
  } else {
    const cur = room.players?.[room.currentPlayer];
    el.innerHTML = target !== null && cur
      ? `${esc(cur.name)} sucht eine <span class="hint-highlight">${target}</span>…`
      : (cur ? `Warte auf <span class="hint-highlight">${esc(cur.name)}</span>…` : '');
  }
}

// ── Log: entries fade out after LOG_TTL ───────────────────────────────────────
function renderLog() {
  const el  = $('action-log');
  const now = Date.now();
  const FADE_START = LOG_TTL * 0.7; // start fading at 70% of TTL

  const entries = Object.values(room.log || {})
    .sort((a,b) => (a.ts||0) - (b.ts||0))
    .filter(e => !e.ts || (now - e.ts) < LOG_TTL); // hide entries older than TTL

  el.innerHTML = '<div class="log-title">Spielverlauf</div>' +
    entries.reverse().map(e => {
      const age = now - (e.ts || 0);
      let opacity = 1;
      if (age > FADE_START) {
        opacity = Math.max(0, 1 - (age - FADE_START) / (LOG_TTL - FADE_START));
      }
      return `<div class="log-entry" style="opacity:${opacity.toFixed(3)}">${e.text}</div>`;
    }).join('');
}

// ── Statistics panel ──────────────────────────────────────────────────────────
function renderStats() {
  const el = $('stats-container');
  if (!el) return;
  const stats    = room.stats || {};
  const c        = cfg();
  const winGoal  = room.mode === 'spicy' ? 2 : c.winsNeeded;
  const rounds   = stats.rounds || 0;
  const players  = getPlayers();

  el.innerHTML = players.map(p => {
    const wins  = stats[p.id]?.wins || 0;
    const trios = (p.trios || []).length;
    const col   = pColor(p);
    const tCol  = isLight(col) ? '#2d1b69' : '#fff';
    const isAct = room.currentPlayer === p.id;
    const dots  = Array.from({length: winGoal}, (_,i) =>
      `<span class="stat-dot${i < trios ? ' filled' : ''}"></span>`
    ).join('');

    return `
      <div class="stat-row${isAct ? ' active' : ''}">
        <div class="stat-avatar" style="background:${col};color:${tCol}">${esc(p.name[0].toUpperCase())}</div>
        <div class="stat-info">
          <div class="stat-name">${esc(p.name)}${p.id === MY_ID ? ' <span class="stat-you">(du)</span>' : ''}</div>
          <div class="stat-wins">🏆 ${wins} Sieg${wins!==1?'e':''}</div>
        </div>
        <div class="stat-progress">${dots}</div>
      </div>`;
  }).join('');

  $('stat-rounds').textContent = rounds ? `Runde ${rounds}` : 'Runde 1';
}

// ── Count all visible cards of a given value ─────────────────────────────────
function countVisible(value, myHand, askedThisTurn, centerPile) {
  let n = 0;
  (myHand       ||[]).forEach(v => { if (v === value) n++; });
  (askedThisTurn||[]).forEach(a => { if (a.value === value) n++; });
  (centerPile   ||[]).forEach(c => { if (!c.faceDown && c.value === value) n++; });
  return n;
}

// ── Action: Ask a player ──────────────────────────────────────────────────────
async function askPlayer(targetId, type) {
  if (!isMyTurn) return;
  const target = room.players?.[targetId];
  if (!target?.hand?.length) { toast('Keine Karten.', 'error'); return; }

  const sorted = [...target.hand].sort((a,b) => a-b);
  const card   = type === 'lowest' ? sorted[0] : sorted[sorted.length-1];
  const curTarget = room.turnTarget ?? null;

  if (curTarget !== null && card !== curTarget) {
    await log(`<span class="actor">${esc(myPlayer.name)}</span> fragt ${esc(target.name)} → <span class="highlight">${card}</span> — Kein Match! Zug endet.`);
    await endTurn();
    return;
  }

  const newTarget = card;
  const newAsked  = [...(room.askedThisTurn || []), { value: card, playerId: targetId }];

  await update(ref(db), {
    [`rooms/${ROOM_ID}/turnTarget`]:    newTarget,
    [`rooms/${ROOM_ID}/askedThisTurn`]: newAsked
  });

  await log(`<span class="actor">${esc(myPlayer.name)}</span> fragt ${esc(target.name)} (${type==='lowest'?'↓ niedrigste':'↑ höchste'}) → <span class="highlight">${card}</span>`);

  const n = countVisible(newTarget, myPlayer.hand||[], newAsked, room.centerPile||[]);
  if (n >= cfg().matchCount) await claimTrio(newTarget, newAsked, null);
}

// ── Action: Flip a center card ────────────────────────────────────────────────
async function flipCenterCard(idx) {
  if (!isMyTurn) return;
  const pile = [...(room.centerPile || [])];
  if (!pile[idx]?.faceDown) return;

  const value     = pile[idx].value;
  pile[idx]       = { value, faceDown: false, flippedAt: Date.now() };
  const curTarget = room.turnTarget ?? null;
  const asked     = room.askedThisTurn || [];

  if (curTarget !== null && value !== curTarget) {
    await update(ref(db), { [`rooms/${ROOM_ID}/centerPile`]: pile });
    await log(`<span class="actor">${esc(myPlayer.name)}</span> deckt auf → <span class="highlight">${value}</span> — Kein Match! Zug endet.`);
    await endTurn();
    return;
  }

  await update(ref(db), {
    [`rooms/${ROOM_ID}/centerPile`]: pile,
    [`rooms/${ROOM_ID}/turnTarget`]: value
  });

  await log(`<span class="actor">${esc(myPlayer.name)}</span> deckt Karte auf → <span class="highlight">${value}</span>`);

  const n = countVisible(value, myPlayer.hand||[], asked, pile);
  if (n >= cfg().matchCount) await claimTrio(value, asked, pile);
}

// ── Timer: flip face-up center cards back after CARD_FLIP_TTL ────────────────
async function checkCardFlipBack() {
  if (!room || room.phase !== 'playing' || flipBackLock) return;
  const pile = room.centerPile || [];
  const now  = Date.now();
  let changed = false;

  const newPile = pile.map(c => {
    if (!c.faceDown && c.flippedAt && (now - c.flippedAt) >= CARD_FLIP_TTL) {
      changed = true;
      return { value: c.value, faceDown: true }; // flip back, drop flippedAt
    }
    return c;
  });

  if (changed) {
    flipBackLock = true;
    try {
      await update(ref(db), { [`rooms/${ROOM_ID}/centerPile`]: newPile });
      await log('Aufgedeckte Karten wurden wieder umgedreht.');
    } finally {
      flipBackLock = false;
    }
  }
}

// ── Claim trio ────────────────────────────────────────────────────────────────
async function claimTrio(value, askedThisTurn, updatedPile) {
  const updates = {};
  let toRemove  = 3;

  // Remove from asked players' hands
  const handsCopy = {};
  getPlayers().filter(p => p.id !== MY_ID).forEach(p => { handsCopy[p.id] = [...(p.hand||[])]; });
  for (const a of (askedThisTurn||[])) {
    if (a.value === value && toRemove > 0) {
      const h = handsCopy[a.playerId];
      if (h) { const i = h.indexOf(value); if (i !== -1) { h.splice(i,1); toRemove--; } }
    }
  }
  Object.entries(handsCopy).forEach(([pid,h]) => {
    updates[`rooms/${ROOM_ID}/players/${pid}/hand`] = h;
  });

  // Remove from face-up center cards
  const pile = updatedPile ? [...updatedPile] : [...(room.centerPile||[])];
  for (let i = 0; i < pile.length && toRemove > 0; i++) {
    if (!pile[i].faceDown && pile[i].value === value) { pile.splice(i,1); i--; toRemove--; }
  }
  updates[`rooms/${ROOM_ID}/centerPile`] = pile;

  // Remove remaining from my hand
  const myHand = [...(myPlayer.hand||[])];
  for (let i = 0; i < myHand.length && toRemove > 0; i++) {
    if (myHand[i] === value) { myHand.splice(i,1); i--; toRemove--; }
  }
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/hand`] = myHand;

  // Score the trio
  const myTrios = [...(myPlayer.trios||[]), { value }];
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/trios`] = myTrios;

  // Reset turn state — player continues their turn
  updates[`rooms/${ROOM_ID}/turnTarget`]    = null;
  updates[`rooms/${ROOM_ID}/askedThisTurn`] = [];

  // Win check
  const c         = cfg();
  const label     = matchLabel(c.matchCount);
  const isGolden  = value === 7;
  const wonSimple = room.mode !== 'spicy' && myTrios.length >= c.winsNeeded;
  const wonSpicy  = room.mode === 'spicy'  && hasConnectedTrios(myTrios);
  if (isGolden || wonSimple || wonSpicy) {
    updates[`rooms/${ROOM_ID}/phase`]  = 'ended';
    updates[`rooms/${ROOM_ID}/winner`] = MY_ID;
    const currentWins = (room.stats?.[MY_ID]?.wins || 0);
    updates[`rooms/${ROOM_ID}/stats/${MY_ID}/wins`] = currentWins + 1;
  }

  await update(ref(db), updates);
  await log(`<span class="success">✓ ${label}!</span> <span class="actor">${esc(myPlayer.name)}</span> sammelt ${c.matchCount}× <span class="highlight">${value}${value===7?' ⭐':''}</span>`);
}

// ── End turn ──────────────────────────────────────────────────────────────────
async function endTurn() {
  const players = getPlayers();
  const idx     = players.findIndex(p => p.id === room.currentPlayer);
  const next    = players[(idx+1) % players.length];
  await update(ref(db), {
    [`rooms/${ROOM_ID}/currentPlayer`]: next.id,
    [`rooms/${ROOM_ID}/turnTarget`]:    null,
    [`rooms/${ROOM_ID}/askedThisTurn`]: []
  });
}

function hasConnectedTrios(trios) {
  if (trios.length < 2) return false;
  const vals = trios.map(t=>t.value).sort((a,b)=>a-b);
  for (let i=0; i<vals.length-1; i++) if (vals[i+1]-vals[i]===1) return true;
  return false;
}

// ── Win overlay ───────────────────────────────────────────────────────────────
function showWin() {
  const overlay = $('win-overlay');
  if (overlay.classList.contains('visible')) return;
  const winner = room.players?.[room.winner];
  if (!winner) return;
  overlay.classList.add('visible');
  const mine = room.winner === MY_ID;
  $('win-emoji').textContent       = mine ? '🏆' : '🎉';
  $('win-winner-name').textContent = winner.name;
  $('win-subtitle').textContent    = mine ? 'Du hast gewonnen! Glückwunsch!' : `${winner.name} hat das Spiel gewonnen!`;
  if (mine) confetti();
}

// ── New game ──────────────────────────────────────────────────────────────────
async function newGame() {
  if (!room) return;
  const players = getPlayers();
  const { center, hands } = dealCards(players.length, room.config || {});
  const updates = {};
  players.forEach((p,i) => {
    updates[`rooms/${ROOM_ID}/players/${p.id}/hand`]  = hands[i];
    updates[`rooms/${ROOM_ID}/players/${p.id}/trios`] = [];
  });
  updates[`rooms/${ROOM_ID}/centerPile`]    = center;
  updates[`rooms/${ROOM_ID}/phase`]         = 'playing';
  updates[`rooms/${ROOM_ID}/winner`]        = null;
  updates[`rooms/${ROOM_ID}/currentPlayer`] = players[0].id;
  updates[`rooms/${ROOM_ID}/turnTarget`]    = null;
  updates[`rooms/${ROOM_ID}/askedThisTurn`] = [];
  updates[`rooms/${ROOM_ID}/log`]           = { e0: { text: 'Neue Runde gestartet!', ts: Date.now() } };
  // Increment round counter but keep player win stats
  const currentRounds = room.stats?.rounds || 0;
  updates[`rooms/${ROOM_ID}/stats/rounds`]  = currentRounds + 1;
  await update(ref(db), updates);
  $('win-overlay').classList.remove('visible');
}

function dealCards(n, config = {}) {
  const maxCard    = Math.max(4, config.maxCard    || 12);
  const matchCount = Math.max(2, config.matchCount || 3);
  let deck = [];
  for (let i=1; i<=maxCard; i++) for (let c=0; c<matchCount; c++) deck.push(i);
  for (let i=deck.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  const autoSize = ({2:7,3:6,4:5,5:5,6:4})[n] ?? 5;
  const size = (config.handSize && config.handSize >= 2) ? config.handSize : autoSize;
  const hands = Array.from({length:n}, () => deck.splice(0, Math.min(size, deck.length)));
  const center = config.centerCards != null
    ? deck.splice(0, config.centerCards).map(v=>({value:v,faceDown:true}))
    : deck.map(v=>({value:v,faceDown:true}));
  return { center, hands };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function confetti() {
  const cols = ['#F5C518','#FF6B6B','#4ECDC4','#A29BFE','#FD79A8'];
  for (let i=0; i<80; i++) setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `left:${Math.random()*100}%;background:${cols[Math.floor(Math.random()*cols.length)]};width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${2+Math.random()*2}s;`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),4000);
  }, i*40);
}

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

async function log(text) {
  const key = `e_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await update(ref(db), { [`rooms/${ROOM_ID}/log/${key}`]: { text, ts: Date.now() } });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!ROOM_ID || !MY_ID) { location.href = 'index.html'; return; }

  onValue(ref(db, `rooms/${ROOM_ID}`), snap => {
    if (!snap.exists()) { toast('Raum nicht gefunden.', 'error'); return; }
    render(snap.val());
  });

  // Re-render log every second for fade effect + check card flip-back
  setInterval(() => {
    if (room) {
      renderLog();
      renderCenterPile(); // update timer rings
      checkCardFlipBack();
    }
  }, 1000);

  $('btn-new-game')?.addEventListener('click', newGame);
  $('btn-back-lobby')?.addEventListener('click', () => location.href = 'index.html');
  $('btn-leave')?.addEventListener('click', () => location.href = 'index.html');
});
