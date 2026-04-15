import FIREBASE_CONFIG from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import {
  getDatabase, ref, get, update, onValue, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js';

// ── Firebase init ────────────────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── Session ──────────────────────────────────────────────────────────────────
const params     = new URLSearchParams(location.search);
const ROOM_ID    = params.get('room')   || sessionStorage.getItem('trio_room');
const MY_ID      = params.get('player') || sessionStorage.getItem('trio_player');

// ── Game state (local mirror) ────────────────────────────────────────────────
let room        = null;
let myPlayer    = null;
let isMyTurn    = false;
let revealedThisTurn = [];   // cards revealed during current turn for trio check

const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#F5C518','#A29BFE','#FD79A8','#55EFC4'];
const WIN_TRIOS_SIMPLE = 3;
const WIN_TRIOS_SPICY  = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 128;
}

function playerColor(p) {
  return p.color || PLAYER_COLORS[p.order % PLAYER_COLORS.length];
}

function getPlayers() {
  if (!room?.players) return [];
  return Object.values(room.players).sort((a,b) => (a.order??0)-(b.order??0));
}

// ── Card element builders ─────────────────────────────────────────────────────
function makeFaceUpCard(value, extra = '') {
  return `<div class="game-card face-up ${extra}" data-value="${value}">
    <span class="corner tl">${value}</span>
    ${value}
    <span class="corner br">${value}</span>
  </div>`;
}

function makeFaceDownCard(idx) {
  return `<div class="game-card face-down" data-idx="${idx}"></div>`;
}

// ── Render functions ──────────────────────────────────────────────────────────
function render(data) {
  room = data;
  if (!room) return;
  myPlayer = room.players?.[MY_ID];
  isMyTurn = room.currentPlayer === MY_ID;

  renderHeader();
  renderOpponents();
  renderCenterPile();
  renderMyHand();
  renderActionHint();
  renderLog();
  checkForWin();
}

function renderHeader() {
  $('header-room-code').textContent = ROOM_ID;
  $('header-mode').textContent = room.mode === 'spicy' ? '🌶 Spicy' : '✨ Simple';
  $('header-mode').className = `mode-badge ${room.mode}`;

  const current = room.players?.[room.currentPlayer];
  $('turn-indicator-name').textContent = isMyTurn
    ? 'Dein Zug!'
    : (current ? `${escapeHtml(current.name)}s Zug` : '');
  $('turn-indicator').className = isMyTurn ? 'turn-indicator my-turn' : 'turn-indicator';
}

function renderOpponents() {
  const container = $('opponents-container');
  container.innerHTML = '';
  const players = getPlayers().filter(p => p.id !== MY_ID);

  players.forEach(p => {
    const color = playerColor(p);
    const textColor = isLight(color) ? '#2d1b69' : '#fff';
    const isActive = room.currentPlayer === p.id;
    const trios = p.trios || [];

    const trioBadges = trios.map(t =>
      `<span class="trio-badge ${t.value === 7 ? 'golden' : ''}">${t.value}${t.value===7?'⭐':''}</span>`
    ).join('');

    const askDisabled = !isMyTurn || isActive ? 'disabled' : '';

    const el = document.createElement('div');
    el.className = `opponent-panel ${isActive ? 'active-turn' : ''}`;
    el.dataset.pid = p.id;
    el.innerHTML = `
      <div class="opponent-header">
        <div class="opp-avatar" style="background:${color};color:${textColor}">
          ${escapeHtml(p.name[0].toUpperCase())}
        </div>
        <span class="opp-name">${escapeHtml(p.name)}</span>
        <span class="opp-card-count">${(p.hand||[]).length} Karten</span>
      </div>
      ${trios.length ? `<div class="opp-trios">${trioBadges}</div>` : ''}
      <div class="ask-buttons">
        <button class="ask-btn lowest" data-pid="${p.id}" ${askDisabled}>⬇ Niedrigste</button>
        <button class="ask-btn highest" data-pid="${p.id}" ${askDisabled}>⬆ Höchste</button>
      </div>
    `;
    container.appendChild(el);
  });

  // Event listeners for ask buttons
  container.querySelectorAll('.ask-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid  = btn.dataset.pid;
      const type = btn.classList.contains('lowest') ? 'lowest' : 'highest';
      askPlayer(pid, type);
    });
  });
}

function renderCenterPile() {
  const container = $('center-pile-grid');
  container.innerHTML = '';
  const pile = room.centerPile || [];

  pile.forEach((card, idx) => {
    const el = document.createElement('div');
    if (card.faceDown) {
      el.className = 'game-card face-down';
      el.dataset.idx = idx;
      if (isMyTurn) {
        el.addEventListener('click', () => flipCenterCard(idx));
      }
    } else {
      el.className = 'game-card face-up';
      el.dataset.value = card.value;
      el.innerHTML = `
        <span class="corner tl">${card.value}</span>
        ${card.value}
        <span class="corner br">${card.value}</span>
      `;
    }
    container.appendChild(el);
  });

  $('center-pile-count').textContent = pile.filter(c=>c.faceDown).length;
}

function renderMyHand() {
  const hand   = myPlayer?.hand || [];
  const trios  = myPlayer?.trios || [];
  const cards  = $('my-cards');
  const trioEl = $('my-trios');
  const color  = playerColor(myPlayer || { color: PLAYER_COLORS[0] });

  cards.innerHTML = hand.map(v => makeFaceUpCard(v)).join('');

  if (trios.length) {
    $('my-trios-section').classList.remove('hidden');
    trioEl.innerHTML = trios.map(t => `
      <div class="trio-group">
        ${makeFaceUpCard(t.value)}
        ${makeFaceUpCard(t.value)}
        ${makeFaceUpCard(t.value)}
      </div>
    `).join('');
  } else {
    $('my-trios-section').classList.add('hidden');
  }

  $('my-name').textContent = myPlayer?.name || '';
  $('my-trio-count').textContent = trios.length;
  $('my-avatar').style.background = color;
  $('my-avatar').style.color = isLight(color) ? '#2d1b69' : '#fff';
  $('my-avatar').textContent = (myPlayer?.name || '?')[0].toUpperCase();
}

function renderActionHint() {
  const hint = $('action-hint');
  if (isMyTurn) {
    hint.innerHTML = '<span class="hint-highlight">Dein Zug:</span> Karte aufdecken oder Mitspieler befragen.';
  } else {
    const current = room.players?.[room.currentPlayer];
    hint.innerHTML = current
      ? `Warte auf <span class="hint-highlight">${escapeHtml(current.name)}</span>…`
      : '';
  }
}

function renderLog() {
  const container = $('action-log');
  const entries = Object.values(room.log || {}).sort((a,b) => (a.ts||0)-(b.ts||0)).slice(-20);
  container.innerHTML = entries.reverse().map(e =>
    `<div class="log-entry">${e.text}</div>`
  ).join('');
}

// ── Game Actions ──────────────────────────────────────────────────────────────

async function askPlayer(targetId, type) {
  if (!isMyTurn) return;
  const target = room.players?.[targetId];
  if (!target || !(target.hand?.length)) {
    showToast('Dieser Spieler hat keine Karten.', 'error');
    return;
  }

  const hand = [...target.hand].sort((a,b) => a-b);
  const card = type === 'lowest' ? hand[0] : hand[hand.length - 1];

  // Add to revealed pile for trio check
  revealedThisTurn.push({ value: card, source: 'opponent', ownerId: targetId });

  // Show the revealed card temporarily
  appendLog(`<span class="actor">${escapeHtml(myPlayer.name)}</span> fragt ${escapeHtml(target.name)} nach der ${type === 'lowest' ? 'niedrigsten' : 'höchsten'} Karte → <span class="highlight">${card}</span>`);

  // Check if trio is formed
  const trio = checkTrio(card);
  if (trio) {
    await claimTrio(trio, card, targetId);
  } else {
    // No trio — end turn
    await endTurn(false);
  }
}

async function flipCenterCard(idx) {
  if (!isMyTurn) return;
  const pile = [...(room.centerPile || [])];
  if (!pile[idx] || !pile[idx].faceDown) return;

  const value = pile[idx].value;
  pile[idx] = { value, faceDown: false };

  revealedThisTurn.push({ value, source: 'center', idx });

  appendLog(`<span class="actor">${escapeHtml(myPlayer.name)}</span> deckt eine Karte auf → <span class="highlight">${value}</span>`);

  // Update the center pile in Firebase
  await update(ref(db), {
    [`rooms/${ROOM_ID}/centerPile`]: pile
  });

  const trio = checkTrio(value);
  if (trio) {
    await claimTrio(trio, value, null);
  } else {
    await endTurn(false);
  }
}

// ── Trio detection ─────────────────────────────────────────────────────────────
function checkTrio(value) {
  // Collect all currently visible cards with this value
  // Sources: my hand, opponent hands (if revealed this turn), center (face-up)
  const allSources = [];

  // My hand
  const myHand = myPlayer?.hand || [];
  myHand.forEach(v => { if (v === value) allSources.push({ value, source: 'my_hand' }); });

  // Already revealed this turn
  revealedThisTurn.forEach(c => { if (c.value === value) allSources.push(c); });

  // Center pile (face-up cards)
  (room.centerPile || []).forEach((c, idx) => {
    if (!c.faceDown && c.value === value) allSources.push({ value, source: 'center', idx });
  });

  // Deduplicate by source+idx/ownerId
  const unique = [];
  const seen   = new Set();
  allSources.forEach(s => {
    const key = `${s.source}_${s.idx ?? s.ownerId ?? 'mine'}`;
    if (!seen.has(key)) { seen.add(key); unique.push(s); }
  });

  return unique.length >= 3 ? unique.slice(0, 3) : null;
}

// ── Claim a trio ──────────────────────────────────────────────────────────────
async function claimTrio(sources, value, opponentId) {
  const updates = {};

  // Remove 3 cards from their respective locations
  let myHandCopy       = [...(myPlayer.hand || [])];
  const centerCopy     = [...(room.centerPile || [])];
  const playersCopy    = {};
  getPlayers().forEach(p => { playersCopy[p.id] = [...(p.hand || [])]; });

  let removed = 0;
  for (const src of sources) {
    if (removed >= 3) break;
    if (src.source === 'my_hand') {
      const i = myHandCopy.indexOf(value);
      if (i !== -1) { myHandCopy.splice(i, 1); removed++; }
    } else if (src.source === 'center') {
      if (centerCopy[src.idx] && !centerCopy[src.idx].faceDown) {
        centerCopy.splice(src.idx, 1);
        removed++;
      }
    } else if (src.source === 'opponent' && src.ownerId) {
      const opHand = playersCopy[src.ownerId];
      if (opHand) {
        const i = opHand.indexOf(value);
        if (i !== -1) { opHand.splice(i, 1); removed++; }
      }
    }
  }

  // Apply hand updates
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/hand`] = myHandCopy;
  updates[`rooms/${ROOM_ID}/centerPile`] = centerCopy;
  getPlayers().forEach(p => {
    if (p.id !== MY_ID && playersCopy[p.id]) {
      updates[`rooms/${ROOM_ID}/players/${p.id}/hand`] = playersCopy[p.id];
    }
  });

  // Add trio to my scored trios
  const myTrios = [...(myPlayer.trios || []), { value }];
  updates[`rooms/${ROOM_ID}/players/${MY_ID}/trios`] = myTrios;

  const isGolden = value === 7;
  appendLog(`<span class="success">✓ Trio!</span> <span class="actor">${escapeHtml(myPlayer.name)}</span> hat drei <span class="highlight">${value}${isGolden ? '⭐' : ''}</span> gesammelt!`);

  // Check win condition
  const wonSimple = room.mode !== 'spicy' && myTrios.length >= WIN_TRIOS_SIMPLE;
  const wonSpicy  = room.mode === 'spicy'  && checkConnectedTrios(myTrios);
  const goldenWin = isGolden;

  if (wonSimple || wonSpicy || goldenWin) {
    updates[`rooms/${ROOM_ID}/phase`]  = 'ended';
    updates[`rooms/${ROOM_ID}/winner`] = MY_ID;
    appendLog(`🏆 <span class="actor">${escapeHtml(myPlayer.name)}</span> gewinnt das Spiel!`);
  } else {
    // Player may continue their turn after claiming a trio
    revealedThisTurn = [];
  }

  await update(ref(db), updates);
  if (room.log) {
    // Push log entries
    const logUpdates = {};
    // handled via appendLog below
  }
}

// ── Spicy mode: connected trios check ────────────────────────────────────────
function checkConnectedTrios(trios) {
  if (trios.length < 2) return false;
  const values = trios.map(t => t.value).sort((a,b) => a-b);
  // Connected = any two trios whose values are adjacent (differ by 1)
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i+1] - values[i] === 1) return true;
  }
  return false;
}

// ── End turn ──────────────────────────────────────────────────────────────────
async function endTurn(claimed) {
  const players = getPlayers();
  const idx     = players.findIndex(p => p.id === room.currentPlayer);
  const next    = players[(idx + 1) % players.length];

  revealedThisTurn = [];

  await update(ref(db), {
    [`rooms/${ROOM_ID}/currentPlayer`]: next.id
  });
}

// ── Append to log ─────────────────────────────────────────────────────────────
async function appendLog(text) {
  const ts  = Date.now();
  const key = `e_${ts}_${Math.random().toString(36).slice(2,6)}`;
  await update(ref(db), {
    [`rooms/${ROOM_ID}/log/${key}`]: { text, ts }
  });
}

// ── Win overlay ───────────────────────────────────────────────────────────────
function checkForWin() {
  if (room.phase !== 'ended' || !room.winner) return;
  const winner = room.players?.[room.winner];
  if (!winner) return;

  const overlay   = $('win-overlay');
  const winnerEl  = $('win-winner-name');
  const subtitleEl = $('win-subtitle');
  const myWin      = room.winner === MY_ID;

  overlay.classList.add('visible');
  winnerEl.textContent = winner.name;
  $('win-emoji').textContent = myWin ? '🏆' : '🎉';
  subtitleEl.textContent = myWin
    ? 'Du hast gewonnen! Glückwunsch!'
    : `${winner.name} hat das Spiel gewonnen!`;

  if (myWin) launchConfetti();
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#F5C518','#FF6B6B','#4ECDC4','#A29BFE','#FD79A8'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `
        left: ${Math.random()*100}%;
        background: ${colors[Math.floor(Math.random()*colors.length)]};
        width: ${6+Math.random()*8}px;
        height: ${6+Math.random()*8}px;
        border-radius: ${Math.random()>0.5?'50%':'2px'};
        animation-duration: ${2+Math.random()*2}s;
        animation-delay: 0s;
      `;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }, i * 40);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── New game ──────────────────────────────────────────────────────────────────
async function newGame() {
  if (!room) return;
  const players = getPlayers();
  const { deck, center, hands } = dealCards(players.length);

  const updates = {};
  players.forEach((p, i) => {
    updates[`rooms/${ROOM_ID}/players/${p.id}/hand`]  = hands[i];
    updates[`rooms/${ROOM_ID}/players/${p.id}/trios`] = [];
  });
  updates[`rooms/${ROOM_ID}/centerPile`]    = center;
  updates[`rooms/${ROOM_ID}/phase`]         = 'playing';
  updates[`rooms/${ROOM_ID}/winner`]        = null;
  updates[`rooms/${ROOM_ID}/currentPlayer`] = players[0].id;
  updates[`rooms/${ROOM_ID}/log`]           = {
    e0: { text: 'Neue Runde gestartet!', ts: Date.now() }
  };

  await update(ref(db), updates);
  $('win-overlay').classList.remove('visible');
  revealedThisTurn = [];
}

function dealCards(playerCount) {
  let deck = [];
  for (let n = 1; n <= 12; n++) deck.push(n, n, n);
  for (let i = deck.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]] = [deck[j],deck[i]];
  }
  const handSizes = {2:7, 3:6, 4:5, 5:5, 6:4};
  const handSize  = handSizes[playerCount] ?? 5;
  const hands = [];
  for (let i = 0; i < playerCount; i++) hands.push(deck.splice(0, handSize));
  const center = deck.map(n => ({ value: n, faceDown: true }));
  return { deck, center, hands };
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!ROOM_ID || !MY_ID) {
    window.location.href = 'index.html';
    return;
  }

  // Listen for room updates
  onValue(ref(db, `rooms/${ROOM_ID}`), snapshot => {
    if (!snapshot.exists()) {
      showToast('Raum nicht gefunden.', 'error');
      return;
    }
    render(snapshot.val());
  });

  // Buttons
  $('btn-new-game')?.addEventListener('click', newGame);
  $('btn-back-lobby')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  $('btn-leave')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
});
