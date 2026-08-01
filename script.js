'use strict';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NAMES = ['あなた', 'ロボット1', 'ロボット2', 'ロボット3'];

let state = null;
let locked = false; // true while an animation / AI turn is resolving

// ---------------------------------------------------------------------
// Deck helpers
// ---------------------------------------------------------------------

function createDeck() {
  const deck = [];
  COLORS.forEach(color => {
    deck.push({ color, type: 'number', value: 0 });
    for (let v = 1; v <= 9; v++) {
      deck.push({ color, type: 'number', value: v });
      deck.push({ color, type: 'number', value: v });
    }
    ['skip', 'reverse', 'draw2'].forEach(type => {
      deck.push({ color, type });
      deck.push({ color, type });
    });
  });
  for (let i = 0; i < 4; i++) deck.push({ color: 'wild', type: 'wild' });
  for (let i = 0; i < 4; i++) deck.push({ color: 'wild', type: 'wild4' });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardLabel(card) {
  if (card.type === 'number') return String(card.value);
  if (card.type === 'skip') return '⊘';
  if (card.type === 'reverse') return '⇄';
  if (card.type === 'draw2') return '+2';
  if (card.type === 'wild') return 'W';
  if (card.type === 'wild4') return '+4';
  return '?';
}

// ---------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------

function initGame(opponentCount) {
  const playerCount = opponentCount + 1;
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: i,
      name: NAMES[i],
      isHuman: i === 0,
      hand: [],
      pendingUnoCheck: false // human forgot to call uno, penalty due on next turn
    });
  }

  let deck = shuffle(createDeck());

  for (let r = 0; r < 7; r++) {
    players.forEach(p => p.hand.push(deck.pop()));
  }

  state = {
    players,
    deck,
    discard: [],
    currentColor: null,
    currentPlayerIndex: 0,
    direction: 1,
    gameOver: false,
    messages: [],
    unoArmed: false, // human clicked "UNO!" in advance of their last play
    pendingDrawnCard: null // card the human just drew and may choose to play
  };

  // Flip starting card, respecting standard first-card rules.
  let starter = deck.pop();
  while (starter.type === 'wild4') {
    deck.unshift(starter);
    shuffle(deck);
    starter = deck.pop();
  }
  state.discard.push(starter);
  state.currentColor = starter.color === 'wild' ? randomColor() : starter.color;

  log(`ゲームスタート！ さいしょのカードは ${describeCard(starter)}だよ`);

  applyStartingCardEffect(starter);

  render();
  maybeRunAiTurn();
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function applyStartingCardEffect(card) {
  if (card.type === 'wild') {
    // player 0 chooses color to start; if it's an NPC-less setup we just randomized above.
    if (state.players[0].isHuman) {
      // Human gets to pick via first-turn handling would be complex; keep it simple with random color.
    }
  } else if (card.type === 'skip') {
    log(`${state.players[0].name}は さいしょから 1かい おやすみだよ`);
    state.currentPlayerIndex = mod(1, state.players.length);
  } else if (card.type === 'reverse') {
    state.direction = -1;
    state.currentPlayerIndex = mod(state.players.length - 1, state.players.length);
  } else if (card.type === 'draw2') {
    const target = state.players[0];
    drawCards(target, 2);
    log(`${target.name}は カードを2まい ひいて 1かい おやすみだよ`);
    state.currentPlayerIndex = mod(1, state.players.length);
  }
}

// ---------------------------------------------------------------------
// Core rules
// ---------------------------------------------------------------------

function mod(n, m) {
  return ((n % m) + m) % m;
}

function topDiscard() {
  return state.discard[state.discard.length - 1];
}

function matches(card, top, currentColor) {
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.type !== 'number' && card.type === top.type) return true;
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
  return false;
}

function canPlayWild4(hand, currentColor) {
  return !hand.some(c => c.color === currentColor);
}

function isPlayable(card, player) {
  const top = topDiscard();
  if (card.type === 'wild4') {
    return canPlayWild4(player.hand, state.currentColor);
  }
  return matches(card, top, state.currentColor);
}

function getPlayableCards(player) {
  return player.hand.filter(c => isPlayable(c, player));
}

function reshuffleIfNeeded() {
  if (state.deck.length === 0) {
    const top = state.discard.pop();
    state.deck = shuffle(state.discard);
    state.discard = [top];
    log('カードの やまが なくなったから もういっかい まぜたよ');
  }
}

function drawCards(player, n) {
  for (let i = 0; i < n; i++) {
    reshuffleIfNeeded();
    if (state.deck.length === 0) break;
    player.hand.push(state.deck.pop());
  }
}

function describeCard(card) {
  const colorNames = { red: 'あか', yellow: 'きいろ', green: 'みどり', blue: 'あお', wild: 'ワイルド' };
  if (card.type === 'number') return `${colorNames[card.color]}の${card.value}`;
  if (card.type === 'skip') return `${colorNames[card.color]}の スキップ`;
  if (card.type === 'reverse') return `${colorNames[card.color]}の リバース`;
  if (card.type === 'draw2') return `${colorNames[card.color]}の ドロー2`;
  if (card.type === 'wild') return 'ワイルド';
  if (card.type === 'wild4') return 'ワイルドドロー4';
}

function log(msg) {
  state.messages.push(msg);
  if (state.messages.length > 60) state.messages.shift();
}

// Applies a card play for `player`; chosenColor required for wild cards.
function playCard(playerIndex, card, chosenColor) {
  const player = state.players[playerIndex];
  const idx = player.hand.indexOf(card);
  player.hand.splice(idx, 1);
  state.discard.push(card);

  state.currentColor = card.color === 'wild' ? chosenColor : card.color;

  log(`${player.name}が ${describeCard(card)}を だしたよ！${card.color === 'wild' ? `（いろは ${colorNameJp(chosenColor)}）` : ''}`);

  // UNO penalty check: if player now has exactly 1 card, they must have called UNO.
  if (player.hand.length === 1) {
    if (player.isHuman) {
      if (!state.unoArmed) {
        player.pendingUnoCheck = true;
      }
    } else {
      log(`${player.name}が 「UNO！」と いったよ`);
    }
  }
  state.unoArmed = false;

  if (player.hand.length === 0) {
    state.gameOver = true;
    render();
    showResult(`${player.name}の かちだよ！`);
    return;
  }

  let steps = 1;
  const n = state.players.length;

  if (card.type === 'skip') {
    steps = 2;
  } else if (card.type === 'reverse') {
    state.direction *= -1;
    steps = n === 2 ? 2 : 1;
  } else if (card.type === 'draw2') {
    const targetIdx = mod(playerIndex + state.direction * 1, n);
    const target = state.players[targetIdx];
    drawCards(target, 2);
    log(`${target.name}は カードを2まい ひいて 1かい おやすみだよ`);
    steps = 2;
  } else if (card.type === 'wild4') {
    const targetIdx = mod(playerIndex + state.direction * 1, n);
    const target = state.players[targetIdx];
    drawCards(target, 4);
    log(`${target.name}は カードを4まい ひいて 1かい おやすみだよ`);
    steps = 2;
  }

  state.currentPlayerIndex = mod(playerIndex + state.direction * steps, n);

  render();
  maybeRunAiTurn();
}

function colorNameJp(color) {
  return { red: 'あか', yellow: 'きいろ', green: 'みどり', blue: 'あお' }[color] || color;
}

// A player draws one card on their turn because they have no playable card
// (or chooses to draw). Returns the drawn card.
function drawOneForTurn(playerIndex) {
  const player = state.players[playerIndex];
  reshuffleIfNeeded();
  if (state.deck.length === 0) {
    log('カードの やまが ないよ');
    return null;
  }
  const card = state.deck.pop();
  player.hand.push(card);
  log(`${player.name}は カードを1まい ひいたよ`);
  return card;
}

function passTurn(playerIndex) {
  const n = state.players.length;
  state.currentPlayerIndex = mod(playerIndex + state.direction * 1, n);
  render();
  maybeRunAiTurn();
}

// ---------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------

function aiPickColor(hand) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  hand.forEach(c => { if (counts[c.color] !== undefined) counts[c.color]++; });
  let best = COLORS[0];
  COLORS.forEach(c => { if (counts[c] > counts[best]) best = c; });
  if (counts[best] === 0) return randomColor();
  return best;
}

function runAiTurn(playerIndex) {
  const player = state.players[playerIndex];

  // Apply pending UNO penalty is only relevant to humans; AI never forgets.

  const playable = getPlayableCards(player);

  if (playable.length === 0) {
    const drawn = drawOneForTurn(playerIndex);
    render();
    if (drawn && isPlayable(drawn, player)) {
      setTimeout(() => {
        const chosenColor = drawn.color === 'wild' ? aiPickColor(player.hand) : undefined;
        playCard(playerIndex, drawn, chosenColor);
      }, 700);
    } else {
      setTimeout(() => passTurn(playerIndex), 700);
    }
    return;
  }

  // Prefer non-wild cards to conserve wilds for later.
  const nonWild = playable.filter(c => c.color !== 'wild');
  const choice = (nonWild.length > 0 ? nonWild : playable)[Math.floor(Math.random() * (nonWild.length > 0 ? nonWild.length : playable.length))];

  const chosenColor = choice.color === 'wild' ? aiPickColor(player.hand.filter(c => c !== choice)) : undefined;

  setTimeout(() => playCard(playerIndex, choice, chosenColor), 700);
}

function maybeRunAiTurn() {
  if (state.gameOver) return;
  const player = state.players[state.currentPlayerIndex];
  updateTurnIndicator();
  if (!player.isHuman) {
    locked = true;
    setTimeout(() => runAiTurn(state.currentPlayerIndex), 500);
  } else {
    locked = false;
    // Apply forgotten-UNO penalty right as the human's turn begins.
    if (player.pendingUnoCheck) {
      player.pendingUnoCheck = false;
      drawCards(player, 2);
      log('「UNO」を いうのを わすれたから カードを2まい ひいたよ');
    }
    render();
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

function render() {
  if (!state) return;
  renderOpponents();
  renderCenter();
  renderPlayerHand();
  updateTurnIndicator();
  renderLog();
}

function renderOpponents() {
  const area = el('opponents-area');
  area.innerHTML = '';
  state.players.forEach((p, i) => {
    if (p.isHuman) return;
    const div = document.createElement('div');
    div.className = 'opponent' + (state.currentPlayerIndex === i && !state.gameOver ? ' active-turn' : '');

    const name = document.createElement('div');
    name.className = 'opponent-name';
    name.textContent = p.name;
    div.appendChild(name);

    if (p.hand.length === 1) {
      const badge = document.createElement('div');
      badge.className = 'opponent-uno';
      badge.textContent = 'UNO';
      div.appendChild(badge);
    }

    const handDiv = document.createElement('div');
    handDiv.className = 'opponent-hand';
    const shown = Math.min(p.hand.length, 7);
    for (let k = 0; k < shown; k++) {
      const c = document.createElement('div');
      c.className = 'card card-back';
      handDiv.appendChild(c);
    }
    div.appendChild(handDiv);

    const count = document.createElement('div');
    count.className = 'opponent-count';
    count.textContent = `${p.hand.length}まい`;
    div.appendChild(count);

    area.appendChild(div);
  });
}

function renderCenter() {
  el('draw-count').textContent = state.deck.length;

  const top = topDiscard();
  const ring = el('current-color-ring');
  ring.style.background = colorHex(state.currentColor);
  ring.innerHTML = '';
  const cardDiv = buildCardElement(top, false);
  cardDiv.classList.add(top.color === 'wild' ? state.currentColor : top.color);
  if (top.color === 'wild') cardDiv.classList.remove('wild');
  ring.appendChild(cardDiv);
}

function colorHex(color) {
  return { red: '#ed4b3d', yellow: '#f7c928', green: '#3fae4a', blue: '#1f7fd6' }[color] || '#333';
}

function buildCardElement(card, interactive) {
  const div = document.createElement('div');
  div.className = 'card ' + card.color;
  div.textContent = cardLabel(card);
  if (!interactive) div.style.cursor = 'default';
  return div;
}

function renderPlayerHand() {
  const human = state.players[0];
  const handDiv = el('player-hand');
  handDiv.innerHTML = '';

  const isHumanTurn = state.currentPlayerIndex === 0 && !state.gameOver;

  human.hand.forEach(card => {
    let playable;
    if (state.pendingDrawnCard) {
      playable = isHumanTurn && card === state.pendingDrawnCard;
    } else {
      playable = isHumanTurn && isPlayable(card, human);
    }
    const div = buildCardElement(card, true);
    if (!playable) div.classList.add('disabled');
    div.addEventListener('click', () => onHumanCardClick(card));
    handDiv.appendChild(div);
  });

  const unoBtn = el('uno-btn');
  const eligible = isHumanTurn && human.hand.length === 2 && !state.unoArmed;
  unoBtn.classList.toggle('hidden', !eligible);

  const drawBtn = el('draw-btn');
  drawBtn.disabled = !isHumanTurn || !!state.pendingDrawnCard;

  const passBtn = el('pass-btn');
  passBtn.classList.toggle('hidden', !state.pendingDrawnCard);
}

function updateTurnIndicator() {
  const ind = el('turn-indicator');
  if (state.gameOver) { ind.textContent = ''; return; }
  const p = state.players[state.currentPlayerIndex];
  ind.textContent = p.isHuman ? 'あなたの ばんだよ' : `${p.name}の ばんだよ…`;
}

function renderLog() {
  const box = el('log-box');
  box.innerHTML = state.messages.slice(-40).map(m => `<div>${escapeHtml(m)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Human interaction
// ---------------------------------------------------------------------

function onHumanCardClick(card) {
  if (locked || state.gameOver) return;
  const human = state.players[0];
  if (state.currentPlayerIndex !== 0) return;

  if (state.pendingDrawnCard) {
    if (card !== state.pendingDrawnCard) return;
    state.pendingDrawnCard = null;
  } else if (!isPlayable(card, human)) {
    return;
  }

  if (card.color === 'wild') {
    openColorModal(chosen => playCard(0, card, chosen));
  } else {
    playCard(0, card, undefined);
  }
}

function openColorModal(callback) {
  const modal = el('color-modal');
  modal.classList.remove('hidden');
  const handler = e => {
    const color = e.currentTarget.dataset.color;
    modal.classList.add('hidden');
    modal.querySelectorAll('.color-btn').forEach(b => b.removeEventListener('click', handler));
    callback(color);
  };
  modal.querySelectorAll('.color-btn').forEach(b => b.addEventListener('click', handler));
}

function onDrawClick() {
  if (locked || state.gameOver) return;
  if (state.currentPlayerIndex !== 0) return;
  if (state.pendingDrawnCard) return;

  const human = state.players[0];
  const drawn = drawOneForTurn(0);
  if (!drawn) { render(); return; }

  if (isPlayable(drawn, human)) {
    state.pendingDrawnCard = drawn;
    render();
  } else {
    render();
    setTimeout(() => passTurn(0), 500);
  }
}

function onPassClick() {
  if (!state.pendingDrawnCard) return;
  state.pendingDrawnCard = null;
  passTurn(0);
}

function onUnoClick() {
  if (state.currentPlayerIndex !== 0) return;
  state.unoArmed = true;
  log('あなたは 「UNO！」と いったよ');
  render();
}

// ---------------------------------------------------------------------
// Result / reset
// ---------------------------------------------------------------------

function showResult(text) {
  locked = true;
  el('result-text').textContent = text;
  el('result-modal').classList.remove('hidden');
}

function resetToSetup() {
  state = null;
  locked = false;
  el('result-modal').classList.add('hidden');
  el('color-modal').classList.add('hidden');
  el('game-screen').classList.add('hidden');
  el('setup-screen').classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  let opponentCount = 3;

  document.querySelectorAll('#opponent-select .opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#opponent-select .opt-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      opponentCount = parseInt(btn.dataset.count, 10);
    });
  });

  el('start-btn').addEventListener('click', () => {
    el('setup-screen').classList.add('hidden');
    el('game-screen').classList.remove('hidden');
    initGame(opponentCount);
  });

  el('draw-btn').addEventListener('click', onDrawClick);
  el('pass-btn').addEventListener('click', onPassClick);
  el('uno-btn').addEventListener('click', onUnoClick);
  el('newgame-btn').addEventListener('click', () => {
    if (confirm('さいしょから やりなおす？')) resetToSetup();
  });
  el('result-newgame-btn').addEventListener('click', resetToSetup);
});
