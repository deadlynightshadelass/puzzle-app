'use strict';

/* ==================================================================
   1. CONFIG  -  the only part you normally need to edit.
   Put your pictures in the images/ folder, then list them here.
   ================================================================== */

const IMAGES = [
  { file: 'images/atomic-blonde.jpg',       title: 'Atomic Blonde' },
  { file: 'images/anna.jpg',                title: 'Anna' },
  { file: 'images/dragon-tattoo.jpg',       title: 'The Girl with the Dragon Tattoo' },
  { file: 'images/long-kiss-goodnight.jpg', title: 'The Long Kiss Goodnight' },
  { file: 'images/black-widow.jpg',         title: 'Black Widow' },
  { file: 'images/basic-instinct.jpg',      title: 'Basic Instinct' },
  { file: 'images/mr-and-mrs-smith.jpg',    title: 'Mr. & Mrs. Smith' },
  { file: 'images/salt.jpg',                title: 'Salt' },
];

const DIFFICULTIES = [
  { name: 'Easy',      target: 9   },
  { name: 'Medium',    target: 16  },
  { name: 'Hard',      target: 36  },
  { name: 'Expert',    target: 64  },
  { name: 'Nightmare', target: 100 },
];


/* ==================================================================
   2. STATE  -  everything the game needs to remember
   ================================================================== */

const state = {
  imageIndex: 0,
  diffIndex: 1,
  players: 1,

  aspect: 2 / 3,      // width / height of the chosen picture
  cols: 0, rows: 0,
  hEdges: [],         // horizontal cuts: hEdges[row][col], value -1 / 0 / +1
  vEdges: [],         // vertical cuts:   vEdges[row][col]
  pieces: [],         // { home, slot, el }
  picked: null,       // index of the currently selected piece

  moves: 0,
  startedAt: 0,
  timerId: null,
  solved: false,
  turn: 0,            // 0 = player 1, 1 = player 2
  scores: [0, 0],
};


/* ==================================================================
   3. TINY HELPERS
   ================================================================== */

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function mmss(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* Work out a grid whose cells are as close to square as possible,
   given how many pieces we want and how tall/wide the picture is. */
function gridFor(target, aspect) {
  const cols = clamp(Math.round(Math.sqrt(target * aspect)), 2, 40);
  const rows = clamp(Math.round(cols / aspect), 2, 40);
  return { cols, rows };
}


/* ==================================================================
   4. THE JIGSAW EDGE
   Every cut between two pieces is one curve. We build that curve ONCE,
   always left-to-right (or top-to-bottom), and the two pieces that share
   it both use it: one forwards, one backwards. That is why a tab always
   fits its neighbour's hole exactly.
   ================================================================== */

/* How far a tab sticks out of its piece, as a fraction of the edge length.
   Bigger = chunkier knobs. Keep it under ~0.30 or pieces get silly. */
const TAB_DEPTH = 0.24;

/* Returns a list of segments: { s, c1, c2, e }.
   c1 and c2 are the bezier handles, or null for a straight line. */
function edgeSegments(p, q, tab) {
  if (!tab) return [{ s: p, c1: null, c2: null, e: q }];

  const dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;   // direction along the edge
  const nx = uy, ny = -ux;              // direction at right angles to it

  // a = how far along the edge (0..1), b = how far out of it (0..1)
  const at = (a, b) => ({
    x: p.x + ux * a * len + nx * b * TAB_DEPTH * len * tab,
    y: p.y + uy * a * len + ny * b * TAB_DEPTH * len * tab,
  });

  // narrow neck at 0.42..0.58, then a round knob spanning 0.28..0.72
  const k = [
    at(0.42, 0.00), at(0.42, 0.26), at(0.28, 0.36), at(0.30, 0.68),
    at(0.31, 1.02), at(0.69, 1.02), at(0.70, 0.68),
    at(0.72, 0.36), at(0.58, 0.26), at(0.58, 0.00),
  ];

  return [
    { s: p,    c1: null, c2: null, e: k[0] },
    { s: k[0], c1: k[1], c2: k[2],  e: k[3] },
    { s: k[3], c1: k[4], c2: k[5],  e: k[6] },
    { s: k[6], c1: k[7], c2: k[8],  e: k[9] },
    { s: k[9], c1: null, c2: null,  e: q    },
  ];
}

const reverseSegments = (segs) =>
  segs.slice().reverse().map((g) => ({ s: g.e, c1: g.c2, c2: g.c1, e: g.s }));

function segmentsToPath(start, segs) {
  let d = 'M ' + start.x + ' ' + start.y;
  for (const g of segs) {
    d += g.c1
      ? ' C ' + g.c1.x + ' ' + g.c1.y + ', ' + g.c2.x + ' ' + g.c2.y + ', ' + g.e.x + ' ' + g.e.y
      : ' L ' + g.e.x + ' ' + g.e.y;
  }
  return d + ' Z';
}

/* Decide, at random, which way every tab points. 0 on the outside border. */
function buildEdges(cols, rows) {
  const coin = () => (Math.random() < 0.5 ? -1 : 1);

  const hEdges = [];
  for (let r = 0; r <= rows; r++) {
    hEdges.push(Array.from({ length: cols }, () => (r === 0 || r === rows ? 0 : coin())));
  }
  const vEdges = [];
  for (let r = 0; r < rows; r++) {
    vEdges.push(Array.from({ length: cols + 1 }, (_, c) => (c === 0 || c === cols ? 0 : coin())));
  }
  return { hEdges, vEdges };
}

/* The outline of one piece, drawn clockwise, in that piece element's own
   coordinates. `m` is the margin the tabs are allowed to stick out into. */
function piecePath(row, col, cw, ch, m) {
  const tl = { x: m,      y: m      };
  const tr = { x: m + cw, y: m      };
  const br = { x: m + cw, y: m + ch };
  const bl = { x: m,      y: m + ch };

  const top    = edgeSegments(tl, tr, state.hEdges[row][col]);
  const right  = edgeSegments(tr, br, state.vEdges[row][col + 1]);
  const bottom = reverseSegments(edgeSegments(bl, br, state.hEdges[row + 1][col]));
  const left   = reverseSegments(edgeSegments(tl, bl, state.vEdges[row][col]));

  return segmentsToPath(tl, top.concat(right, bottom, left));
}


/* ==================================================================
   5. BUILDING AND DRAWING THE BOARD
   ================================================================== */

const board = $('board');
const boardWrap = $('boardWrap');

/* How big can the board be? Tabs stick out past the board on every side, so
   the space a puzzle really occupies is bigger than the picture itself. That
   overhang is 2 * m, and m is 0.28 of a cell, so the picture has to shrink by
   0.56/rows vertically and 0.56/cols horizontally to leave room for it. */
function boardSize() {
  const rows = state.rows || 3, cols = state.cols || 2;
  const availW = (boardWrap.clientWidth || window.innerWidth) - 20;

  // on a wide screen the buttons sit beside the board, so only a small
  // bottom gap is needed; stacked underneath they need much more
  const wide = window.innerWidth >= 860;
  const below = wide ? 26 : 86;
  const availH = Math.max(window.innerHeight - boardWrap.getBoundingClientRect().top - below, 420);

  // m is 0.28 of the LONGER cell side, and both cell sides scale with h,
  // so the overhang is 0.28 * h * k on each side. That makes the total space
  // used h * (1 + 0.56k) tall and h * (aspect + 0.56k) wide.
  const k = Math.max(state.aspect / cols, 1 / rows);
  const h = clamp(Math.min(availH / (1 + 0.56 * k),
                           availW / (state.aspect + 0.56 * k)), 240, 4000);
  return { w: h * state.aspect, h };
}

/* Size, position and clip every piece. Called on start, on every move,
   and whenever the window changes size. */
function layout(animate) {
  const size = boardSize();
  board.style.width = size.w + 'px';
  board.style.height = size.h + 'px';

  const cw = size.w / state.cols;
  const ch = size.h / state.rows;
  const m = 0.28 * Math.max(cw, ch);   // room for the tabs to stick out

  // reserve that room around the board, so tabs never land on the buttons
  board.style.margin = m + 'px';

  for (const p of state.pieces) {
    const homeR = Math.floor(p.home / state.cols), homeC = p.home % state.cols;
    const slotR = Math.floor(p.slot / state.cols), slotC = p.slot % state.cols;
    const el = p.el;

    if (!animate) el.classList.add('no-anim');

    el.style.width  = (cw + 2 * m) + 'px';
    el.style.height = (ch + 2 * m) + 'px';
    el.style.left   = (slotC * cw - m) + 'px';
    el.style.top    = (slotR * ch - m) + 'px';

    el.style.backgroundImage = 'url("' + IMAGES[state.imageIndex].file + '")';
    el.style.backgroundSize = size.w + 'px ' + size.h + 'px';
    el.style.backgroundPosition = (m - homeC * cw) + 'px ' + (m - homeR * ch) + 'px';
    el.style.clipPath = "path('" + piecePath(homeR, homeC, cw, ch, m) + "')";

    if (!animate) { void el.offsetWidth; el.classList.remove('no-anim'); }
  }

  // keep the peek overlay exactly on top of the board
  $('peekImg').style.width = size.w + 'px';
  $('peekImg').style.height = size.h + 'px';

  markHomes();
}

/* A shuffle where no piece accidentally starts in the right place. */
function shuffledSlots(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let tries = 0; tries < 40; tries++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    if (a.every((v, i) => v !== i)) return a;
  }
  return a;
}

function newGame() {
  const g = gridFor(DIFFICULTIES[state.diffIndex].target, state.aspect);
  const edges = buildEdges(g.cols, g.rows);

  state.cols = g.cols;
  state.rows = g.rows;
  state.hEdges = edges.hEdges;
  state.vEdges = edges.vEdges;
  state.picked = null;
  state.moves = 0;
  state.solved = false;
  state.turn = 0;
  state.scores = [0, 0];

  const n = g.cols * g.rows;
  board.innerHTML = '';
  state.pieces = [];

  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.addEventListener('click', function () { onPieceClick(i); });
    board.appendChild(el);
    state.pieces.push({ home: i, slot: i, el: el });
  }

  $('winBanner').hidden = true;
  $('peekImg').hidden = true;
  $('peekBtn').classList.remove('is-on');

  // Show it whole for a beat, then visibly scramble it.
  layout(false);
  setTimeout(function () {
    const order = shuffledSlots(n);
    state.pieces.forEach(function (p, i) { p.slot = order[i]; });
    layout(true);
    setTimeout(startClock, 550);
  }, 450);

  refreshHud();
}


/* ==================================================================
   6. PLAYING
   ================================================================== */

function onPieceClick(i) {
  if (state.solved || !state.startedAt) return;
  const piece = state.pieces[i];

  if (state.picked === null) {
    state.picked = i;
    piece.el.classList.add('is-picked');
    return;
  }
  if (state.picked === i) {
    state.picked = null;
    piece.el.classList.remove('is-picked');
    return;
  }

  const other = state.pieces[state.picked];
  const before = (other.slot === other.home ? 1 : 0) + (piece.slot === piece.home ? 1 : 0);

  const t = other.slot; other.slot = piece.slot; piece.slot = t;

  const after = (other.slot === other.home ? 1 : 0) + (piece.slot === piece.home ? 1 : 0);

  other.el.classList.remove('is-picked');
  state.picked = null;
  state.moves++;

  if (state.players === 2) {
    state.scores[state.turn] += after - before;
    state.turn = 1 - state.turn;
  }

  layout(true);
  refreshHud();

  if (state.pieces.every(function (p) { return p.slot === p.home; })) win();
}

function markHomes() {
  for (const p of state.pieces) p.el.classList.toggle('is-home', p.slot === p.home);
}

function startClock() {
  if (state.solved) return;
  state.startedAt = Date.now();
  state.timerId = setInterval(refreshHud, 200);
}

function bestKey() {
  return 'jigsaw-best:' + IMAGES[state.imageIndex].file + ':' + state.cols + 'x' + state.rows;
}

function readBest() {
  try { return Number(localStorage.getItem(bestKey())) || 0; } catch (e) { return 0; }
}

function win() {
  state.solved = true;
  clearInterval(state.timerId);
  const took = Date.now() - state.startedAt;
  $('statTime').textContent = mmss(took);
  let line;

  if (state.players === 2) {
    const a = state.scores[0], b = state.scores[1];
    line = a === b ? 'A draw!' : 'Player ' + (a > b ? 1 : 2) + ' wins, ' + a + ' to ' + b;
  } else {
    line = 'Solved in ' + mmss(took) + ', ' + state.moves + ' moves';
    const best = readBest();
    if (!best || took < best) {
      try { localStorage.setItem(bestKey(), String(took)); } catch (e) {}
      line += '. New best time!';
    }
  }

  $('winBanner').innerHTML = '<b>Complete</b><span>' + line + '</span>';
  $('winBanner').hidden = false;
  refreshHud();
}


/* ==================================================================
   7. THE SCREEN: hud, menu, buttons
   ================================================================== */

function refreshHud() {
  const placed = state.pieces.filter(function (p) { return p.slot === p.home; }).length;

  if (state.startedAt && !state.solved) {
    $('statTime').textContent = mmss(Date.now() - state.startedAt);
  } else if (!state.startedAt) {
    $('statTime').textContent = '0:00';
  }

  $('statMoves').textContent = state.moves;
  $('statPlaced').textContent = placed + '/' + state.pieces.length;

  const best = readBest();
  $('statBest').textContent = best ? mmss(best) : '—';
  $('statBestWrap').hidden = state.players === 2;

  $('scoreboard').hidden = state.players !== 2;
  $('p1').classList.toggle('is-turn', state.turn === 0 && !state.solved);
  $('p2').classList.toggle('is-turn', state.turn === 1 && !state.solved);
  $('p1').querySelector('.p-score').textContent = state.scores[0];
  $('p2').querySelector('.p-score').textContent = state.scores[1];
}

function buildMenu() {
  $('imageList').innerHTML = IMAGES.map(function (img, i) {
    return '<button class="thumb ' + (i === state.imageIndex ? 'is-on' : '') + '" data-image="' + i + '">' +
           '<img src="' + img.file + '" alt="' + img.title + '">' +
           '<span class="thumb-name">' + img.title + '</span></button>';
  }).join('');

  $('imageList').querySelectorAll('[data-image]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.imageIndex = Number(el.dataset.image);
      measureImage().then(buildMenu);
    });
  });

  $('difficultyList').innerHTML = DIFFICULTIES.map(function (d, i) {
    const g = gridFor(d.target, state.aspect);
    return '<button class="chip ' + (i === state.diffIndex ? 'is-on' : '') + '" data-diff="' + i + '">' +
           d.name + ' <small>' + (g.cols * g.rows) + ' pcs</small></button>';
  }).join('');

  $('difficultyList').querySelectorAll('[data-diff]').forEach(function (el) {
    el.addEventListener('click', function () {
      state.diffIndex = Number(el.dataset.diff);
      buildMenu();
    });
  });
}

/* Load the picture just to find out how wide and tall it really is. */
function measureImage() {
  return new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () { state.aspect = img.naturalWidth / img.naturalHeight; resolve(); };
    img.onerror = function () { state.aspect = 2 / 3; resolve(); };
    img.src = IMAGES[state.imageIndex].file;
  });
}

function showScreen(which) {
  $('menu').hidden = which !== 'menu';
  $('game').hidden = which !== 'game';
}

/* ---- wiring up the buttons ---- */

$('playerList').querySelectorAll('[data-players]').forEach(function (el) {
  el.addEventListener('click', function () {
    state.players = Number(el.dataset.players);
    $('playerList').querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-on'); });
    el.classList.add('is-on');
  });
});

$('startBtn').addEventListener('click', function () {
  measureImage().then(function () {
    showScreen('game');
    $('hudThumb').src = IMAGES[state.imageIndex].file;
    $('peekImg').src = IMAGES[state.imageIndex].file;
    clearInterval(state.timerId);
    state.startedAt = 0;
    newGame();
  });
});

$('restartBtn').addEventListener('click', function () {
  clearInterval(state.timerId);
  state.startedAt = 0;
  newGame();
});

$('menuBtn').addEventListener('click', function () {
  clearInterval(state.timerId);
  showScreen('menu');
  buildMenu();
});

$('peekBtn').addEventListener('click', function () {
  const turningOn = $('peekImg').hidden;
  $('peekImg').hidden = !turningOn;
  $('peekBtn').classList.toggle('is-on', turningOn);
});

$('themeBtn').addEventListener('click', function () {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('jigsaw-theme', next); } catch (e) {}
});

let resizeId;
window.addEventListener('resize', function () {
  clearTimeout(resizeId);
  resizeId = setTimeout(function () { if (state.pieces.length) layout(false); }, 150);
});

/* ---- start up ---- */
try {
  const saved = localStorage.getItem('jigsaw-theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch (e) {}

measureImage().then(function () { buildMenu(); showScreen('menu'); });
