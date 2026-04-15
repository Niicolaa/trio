import FIREBASE_CONFIG from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import { getDatabase, ref, update, onValue }
  from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js';

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

const params  = new URLSearchParams(location.search);
const ROOM_ID = params.get('room')   || sessionStorage.getItem('trio_room');
const MY_ID   = params.get('player') || sessionStorage.getItem('trio_player');

const WIN_SIMPLE = 3;
const WIN_SPICY  = 2;
const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#F5C518','#A29BFE','#FD79A8','#55EFC4'];

let room     = null;
let myPlayer = null;
let isMyTurn = false;

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
  if (room.phase === 'ended') showWin();
}

function renderHeader() {
  $('header-room-code').textContent = ROOM_ID;
  const mode = room.mode || 'simple';
  $('header-mode').textContent  = mode === 'spicy' ? '🌶 Spicy' : '✨ Simple';
  $('header-mode').className    = `mode-badge ${mode}`;
  const cur = room.players?.[room.currentPlayer];
  $('turn-indicator-name').textContent = isMyTurn ? 'Dein Zug!' : (cur ? `${esc(cur.name)}s Zug` : '…');
}

function renderOpponents() {
  const el  = $('opponents-container');
  el.innerHTML = '';
  const asked = room.askedThisTurn || [];

  getPlayers().filter(p => p.id !== MY_ID).forEach(p => {
    const col   = pColor(p);
    const tCol  = isLight(col) ? '#2d1b69' : '#fff';
    const isAct = room.currentPlayer === p.id;
    const trios = p.trios || [];

    // Last asked card from this player (shown to all)
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
  const el   = $('center-pile-grid');
  el.innerHTML = '';
  let faceDown = 0;
  (room.centerPile || []).forEach((card, idx) => {
    const div = document.createElement('div');
    if (card.faceDown) {
      faceDown++;
      div.className = 'game-card face-down';
      if (isMyTurn) div.addEventListener('click', () => flipCenterCard(idx));
    } else {
      div.className = 'game-card face-up';
      div.innerHTML = `<span class="corner tl">${card.value}</span>${card.value}<span class="corner br">${card.value}</span>`;
    }
    el.appendChild(div);
  });
  $('center-pile-count').textContent = faceDown;
}

function renderMyHand() {
  if (!myPlayer) return;
  const hand  = myPlayer.hand  || [];
  const trios = myPlayer.trios || [];
  const col   = pColor(myPlayer);

  $('my-cards').innerHTML = hand.map(v =>
    `<div class="game-card face-up"><span class="corner tl">${v}</span>${v}<span class="corner br">${v}</span></div>`
  ).join('');

  $('my-name').textContent       = myPlayer.name || '';
  $('my-trio-count').textContent = trios.length;
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
  const el     = $('action-hint');
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

function renderLog() {
  const el = $('action-log');
  const entries = Object.values(room.log || {}).sort((a,b)=>(a.ts||0)-(b.ts||0)).slice(-30);
  el.innerHTML = '<div class="log-title">Spielverlauf</div>' +
    entries.reverse().map(e=>`<div class="log-entry">${e.text}</div>`).join('');
}

// ── Count all visible cards of a given value ─────────────────────────────────
// Visible = my hand + asked-this-turn cards + face-up center cards
function countVisible(value, myHand, askedThisTurn, centerPile) {
  let n = 0;
  (myHand       || []).forEach(v => { if (v === value) n++; });
  (askedThisTurn|| []).forEach(a => { if (a.value === value) n++; });
  (centerPile   || []).forEach(c => { if (!c.faceDown && c.value === value) n++; });
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

  // ── Mismatch: revealed card ≠ current target → turn ends immediately
  if (curTarget !== null && card !== curTarget) {
    await log(`<span class="actor">${esc(myPlayer.name)}</span> fragt ${esc(target.name)} → <span class="highlight">${card}</span> — Kein Match! Zug endet.`);
    await endTurn();
    return;
  }

  // ── Match (or first reveal of turn): set/keep target
  const newTarget = card;
  const newAsked  = [...(room.askedThisTurn || []), { value: card, playerId: targetId }];

  await update(ref(db), {
    [`rooms/${ROOM_ID}/turnTarget`]:    newTarget,
    [`rooms/${ROOM_ID}/askedThisTurn`]: newAsked
  });

  await log(`<span class="actor">${esc(myPlayer.name)}</span> fragt ${esc(target.name)} (${type==='lowest'?'↓ niedrigste':'↑ höchste'}) → <span class="highlight">${card}</span>`);

  // Check if 3 matching cards are now visible
  const n = countVisible(newTarget, myPlayer.hand||[], newAsked, room.centerPile||[]);
  if (n >= 3) await claimTrio(newTarget, newAsked, null);
  // Else: turn stays active — player can ask/flip again
}

// ── Action: Flip a center card ────────────────────────────────────────────────
async function flipCenterCard(idx) {
  if (!isMyTurn) return;
  const pile = [...(room.centerPile || [])];
  if (!pile[idx]?.faceDown) return;

  const value     = pile[idx].value;
  pile[idx]       = { value, faceDown: false };
  const curTarget = room.turnTarget ?? null;
  const asked     = room.askedThisTurn || [];

  // ── Mismatch
  if (curTarget !== null && value !== curTarget) {
    await update(ref(db), { [`rooms/${ROOM_ID}/centerPile`]: pile });
    await log(`<span class="actor">${esc(myPlayer.name)}</span> deckt auf → <span class="highlight">${value}</span> — Kein Match! Zug endet.`);
    await endTurn();
    return;
  }

  // ── Match or first reveal
  await update(ref(db), {
    [`rooms/${ROOM_ID}/centerPile`]:  pile,
    [`rooms/${ROOM_ID}/turnTarget`]:  value
  });

  await log(`<span class="actor">${esc(myPlayer.name)}</span> deckt Karte auf → <span class="highlight">${value}</span>`);

  // Count using the locally updated pile (Firebase update may not have propagated yet)
  const n = countVisible(value, myPlayer.hand||[], asked, pile);
  if (n >= 3) await claimTrio(value, asked, pile);
  // Else: turn stays active
}

// ── Claim trio ────────────────────────────────────────────────────────────────
async function claimTrio(value, askedThisTurn, updatedPile) {
  const updates  = {};
  let toRemove   = 3;

  // 1. Remove from asked players' hands (they gave us their card)
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

  // 2. Remove from face-up center cards
  const pile = updatedPile ? [...updatedPile] : [...(room.centerPile||[])];
  for (let i = 0; i < pile.length && toRemove > 0; i++) {
    if (!pile[i].faceDown && pile[i].value === value) { pile.splice(i,1); i--; toRemove--; }
  }
  updates[`rooms/${ROOM_ID}/centerPile`] = pile;

  // 3. Remove remaining from my hand
  const myHand = [...(myPlayer.hand||[])];
  for (let i = 0; i < myHand.length && toRemove > 0; i++) {
    if (myHand[i] === value) { myHand.splice(i,1); i--; toRemove--; }
  }
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/hand`] = myHand;

  // 4. Score the trio
  const myTrios = [...(myPlayer.trios||[]), { value }];
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/trios`] = myTrios;

  // 5. Reset turn target — player continues their turn fresh
  updates[`rooms/${ROOM_ID}/turnTarget`]    = null;
  updates[`rooms/${ROOM_ID}/askedThisTurn`] = [];

  // 6. Win check
  const isGolden  = value === 7;
  const wonSimple = room.mode !== 'spicy' && myTrios.length >= WIN_SIMPLE;
  const wonSpicy  = room.mode === 'spicy'  && hasConnectedTrios(myTrios);
  if (isGolden || wonSimple || wonSpicy) {
    updates[`rooms/${ROOM_ID}/phase`]  = 'ended';
    updates[`rooms/${ROOM_ID}/winner`] = MY_ID;
  }

  await update(ref(db), updates);
  await log(`<span class="success">✓ Trio!</span> <span class="actor">${esc(myPlayer.name)}</span> sammelt drei <span class="highlight">${value}${value===7?' ⭐':''}</span>`);
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
  const { center, hands } = dealCards(players.length);
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
  await update(ref(db), updates);
  $('win-overlay').classList.remove('visible');
}

function dealCards(n) {
  let deck = [];
  for (let i=1; i<=12; i++) deck.push(i,i,i);
  for (let i=deck.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  const size  = ({2:7,3:6,4:5,5:5,6:4})[n] ?? 5;
  const hands = Array.from({length:n}, () => deck.splice(0,size));
  return { center: deck.map(v=>({value:v,faceDown:true})), hands };
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

  $('btn-new-game')?.addEventListener('click', newGame);
  $('btn-back-lobby')?.addEventListener('click', () => location.href = 'index.html');
  $('btn-leave')?.addEventListener('click', () => location.href = 'index.html');
});
