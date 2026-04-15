import FIREBASE_CONFIG from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js';
import { getDatabase, ref, set, get, onValue, update, remove }
  from 'https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js';

// ── Firebase init ────────────────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── State ────────────────────────────────────────────────────────────────────
let currentRoomId  = null;
let currentPlayerId = null;
let isHost         = false;
let unsubscribe    = null;   // Firebase listener cleanup

const PLAYER_COLORS = ['#FF6B6B','#4ECDC4','#F5C518','#A29BFE','#FD79A8','#55EFC4'];

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.lobby-tab').forEach(t => t.classList.remove('active'));
  $(`tab-${name}`).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
}

function showSection(name) {
  document.querySelectorAll('.lobby-view').forEach(v => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
}

function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Generate room code ───────────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Generate player id ───────────────────────────────────────────────────────
function generatePlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

// ── Create room ──────────────────────────────────────────────────────────────
async function createRoom() {
  const nameInput = $('create-name');
  const modeSelect = $('create-mode');
  const name = nameInput.value.trim();

  if (!name) { showToast('Bitte gib deinen Namen ein.', 'error'); return; }

  const roomId   = generateCode();
  currentPlayerId = generatePlayerId();
  isHost = true;

  const player = {
    id:     currentPlayerId,
    name,
    color:  PLAYER_COLORS[0],
    isHost: true,
    hand:   [],
    trios:  [],
    order:  0
  };

  await set(ref(db, `rooms/${roomId}`), {
    id:            roomId,
    mode:          modeSelect.value,
    phase:         'lobby',
    host:          currentPlayerId,
    currentPlayer: null,
    winner:        null,
    centerPile:    [],
    log:           [],
    players:       { [currentPlayerId]: player },
    createdAt:     Date.now()
  });

  currentRoomId = roomId;
  saveSession(roomId, currentPlayerId);
  enterWaitingRoom(roomId);
}

// ── Join room ────────────────────────────────────────────────────────────────
async function joinRoom() {
  const nameInput = $('join-name');
  const codeInput = $('join-code');
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();

  if (!name) { showToast('Bitte gib deinen Namen ein.', 'error'); return; }
  if (code.length !== 6) { showToast('Bitte gib einen 6-stelligen Raumcode ein.', 'error'); return; }

  const roomSnap = await get(ref(db, `rooms/${code}`));
  if (!roomSnap.exists()) { showToast('Raum nicht gefunden.', 'error'); return; }

  const room = roomSnap.val();
  if (room.phase !== 'lobby') { showToast('Das Spiel hat bereits begonnen.', 'error'); return; }

  const playerCount = Object.keys(room.players || {}).length;
  if (playerCount >= 6) { showToast('Der Raum ist voll (max. 6 Spieler).', 'error'); return; }

  currentPlayerId = generatePlayerId();
  isHost = false;

  const player = {
    id:     currentPlayerId,
    name,
    color:  PLAYER_COLORS[playerCount % PLAYER_COLORS.length],
    isHost: false,
    hand:   [],
    trios:  [],
    order:  playerCount
  };

  await update(ref(db, `rooms/${code}/players`), { [currentPlayerId]: player });

  currentRoomId = code;
  saveSession(code, currentPlayerId);
  enterWaitingRoom(code);
}

// ── Enter waiting room ───────────────────────────────────────────────────────
function enterWaitingRoom(roomId) {
  showSection('waiting');
  $('waiting-room-code').textContent = roomId;

  // Start listening for room changes
  if (unsubscribe) unsubscribe();
  const roomRef = ref(db, `rooms/${roomId}`);
  unsubscribe = onValue(roomRef, snapshot => {
    if (!snapshot.exists()) return;
    const room = snapshot.val();
    renderPlayerList(room.players || {});
    updateStartButton(room);
    if (room.phase === 'playing') {
      redirectToGame(roomId);
    }
  });
}

// ── Render player list ───────────────────────────────────────────────────────
function renderPlayerList(players) {
  const list = $('waiting-player-list');
  list.innerHTML = '';
  Object.values(players).sort((a, b) => a.order - b.order).forEach(p => {
    const el = document.createElement('div');
    el.className = 'player-item';
    el.innerHTML = `
      <div class="player-avatar" style="background:${p.color};color:${isLight(p.color)?'#2d1b69':'#fff'}">
        ${p.name[0].toUpperCase()}
      </div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="player-badge">Host</span>' : ''}
    `;
    list.appendChild(el);
  });
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

// ── Start button visibility ──────────────────────────────────────────────────
function updateStartButton(room) {
  const btn = $('start-game-btn');
  const count = Object.keys(room.players || {}).length;
  if (isHost) {
    btn.classList.remove('hidden');
    btn.disabled = count < 2;
    btn.textContent = count < 2 ? `Warten auf Spieler… (${count}/2 min.)` : `Spiel starten (${count} Spieler)`;
  } else {
    btn.classList.add('hidden');
  }
}

// ── Start game (host only) ───────────────────────────────────────────────────
async function startGame() {
  const roomSnap = await get(ref(db, `rooms/${currentRoomId}`));
  if (!roomSnap.exists()) return;
  const room = roomSnap.val();

  const players = Object.values(room.players || {}).sort((a,b) => a.order - b.order);
  const { deck, center, hands } = dealCards(players.length);

  const updates = {};
  players.forEach((p, i) => {
    updates[`rooms/${currentRoomId}/players/${p.id}/hand`] = hands[i];
  });
  updates[`rooms/${currentRoomId}/centerPile`]    = center;
  updates[`rooms/${currentRoomId}/phase`]         = 'playing';
  updates[`rooms/${currentRoomId}/currentPlayer`] = players[0].id;
  updates[`rooms/${currentRoomId}/log`]           = [
    { text: 'Das Spiel beginnt!', ts: Date.now() }
  ];

  await update(ref(db), updates);
}

// ── Deal cards ───────────────────────────────────────────────────────────────
function dealCards(playerCount) {
  // Build deck: numbers 1–12, 3 of each = 36 cards
  let deck = [];
  for (let n = 1; n <= 12; n++) {
    deck.push(n, n, n);
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // Determine hand size and center pile size based on player count
  // Player count: 2→7 cards each, 3→6, 4→5, 5→5, 6→4
  const handSizes = { 2: 7, 3: 6, 4: 5, 5: 5, 6: 4 };
  const handSize  = handSizes[playerCount] ?? 5;

  const hands = [];
  for (let i = 0; i < playerCount; i++) {
    hands.push(deck.splice(0, handSize));
  }
  // Rest goes face-down in center
  const center = deck.map(n => ({ value: n, faceDown: true }));

  return { deck, center, hands };
}

// ── Redirect to game ─────────────────────────────────────────────────────────
function redirectToGame(roomId) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  window.location.href = `game.html?room=${roomId}&player=${currentPlayerId}`;
}

// ── Session persistence ──────────────────────────────────────────────────────
function saveSession(roomId, playerId) {
  sessionStorage.setItem('trio_room',   roomId);
  sessionStorage.setItem('trio_player', playerId);
}

function loadSession() {
  return {
    roomId:   sessionStorage.getItem('trio_room'),
    playerId: sessionStorage.getItem('trio_player')
  };
}

// ── Copy room code ───────────────────────────────────────────────────────────
function copyRoomCode() {
  const code = $('waiting-room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Raumcode kopiert!', 'success');
  });
}

// ── Escape HTML ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Check if Firebase is configured ─────────────────────────────────────────
function isFirebaseConfigured() {
  return FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Firebase config check
  if (!isFirebaseConfigured()) {
    const banner = $('firebase-banner');
    if (banner) banner.classList.remove('hidden');
  }

  // Tab switching
  document.querySelectorAll('.lobby-tab').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Create room
  $('create-room-btn')?.addEventListener('click', createRoom);
  $('create-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });

  // Join room
  $('join-room-btn')?.addEventListener('click', joinRoom);
  $('join-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('join-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

  // Auto-uppercase room code input
  $('join-code')?.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Start game
  $('start-game-btn')?.addEventListener('click', startGame);

  // Copy code
  $('copy-code-btn')?.addEventListener('click', copyRoomCode);

  // Scroll animations on landing page
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.15 });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
});
