const N = 1;
const E = 2;
const S = 4;
const W = 8;

const delta = {
  [N]: [-1, 0],
  [E]: [0, 1],
  [S]: [1, 0],
  [W]: [0, -1]
};
const opposite = { [N]: S, [E]: W, [S]: N, [W]: E };
const templates = { straight: [W, E], corner: [N, E] };
const boardEl = document.querySelector('#board');
const messageEl = document.querySelector('#message');
const winMessageEl = document.querySelector('#win-message');
const celebrationEl = document.querySelector('#celebration');
const roundScoreEl = document.querySelector('#round-score');
const scoreEl = document.querySelector('#score');
const timerEl = document.querySelector('#timer');
const levelEl = document.querySelector('#level');
const pauseEl = document.querySelector('#pause');
const continueEl = document.querySelector('#continue');

let grid = [];
let score = 0;
let level = 1;
let seconds = 60;
let ticking = null;
let flowTimeout = null;
let flowing = false;
let paused = false;
let pausedMessage = '';
let flowCallback = null;
let flowDelay = 0;
let flowScheduledAt = 0;

function rotateDirection(direction, rotations) {
  for (let i = 0; i < rotations; i++) {
    direction = direction === N ? E : direction === E ? S : direction === S ? W : N;
  }
  return direction;
}

function openings(type, rotations) {
  return templates[type].map(direction => rotateDirection(direction, rotations));
}

function pipeSvg(type) {
  const parts = type === 'straight'
    ? '<line class="edge" x1="0" y1="50" x2="100" y2="50"/><line x1="0" y1="50" x2="100" y2="50"/><line class="waterEdge" x1="0" y1="50" x2="100" y2="50"/><line class="water" x1="0" y1="50" x2="100" y2="50"/>'
    : '<path class="edge" d="M50 0 V50 H100"/><path d="M50 0 V50 H100"/><path class="waterEdge" d="M50 0 V50 H100"/><path class="water" d="M50 0 V50 H100"/>';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${parts}</svg>`;
}

function buildSolution() {
  const path = [[0, 0]];
  let row = 0;
  let column = 0;

  while (row < 8 || column < 7) {
    const choices = [];
    if (column < 7) choices.push([row, column + 1]);
    if (row < 8) choices.push([row + 1, column]);
    [row, column] = choices[Math.floor(Math.random() * choices.length)];
    path.push([row, column]);
  }

  const detours = Math.min(12, Math.floor((level - 1) / 2) * 2);
  for (let detour = 0; detour < detours; detour++) {
    const occupied = new Set(path.map(([pathRow, pathColumn]) => `${pathRow},${pathColumn}`));
    const candidates = [];

    for (let index = 0; index < path.length - 1; index++) {
      const [fromRow, fromColumn] = path[index];
      const [toRow, toColumn] = path[index + 1];
      const perpendiculars = fromRow === toRow
        ? [[-1, 0], [1, 0]]
        : [[0, -1], [0, 1]];

      for (const [rowOffset, columnOffset] of perpendiculars) {
        const first = [fromRow + rowOffset, fromColumn + columnOffset];
        const second = [toRow + rowOffset, toColumn + columnOffset];
        const inBounds = ([candidateRow, candidateColumn]) =>
          candidateRow >= 0 && candidateRow < 9 && candidateColumn >= 0 && candidateColumn < 8;

        if (inBounds(first) && inBounds(second) &&
            !occupied.has(`${first[0]},${first[1]}`) &&
            !occupied.has(`${second[0]},${second[1]}`)) {
          candidates.push({ index, first, second });
        }
      }
    }

    if (candidates.length === 0) break;
    const { index, first, second } = candidates[Math.floor(Math.random() * candidates.length)];
    path.splice(index + 1, 0, first, second);
  }

  return path;
}

function neededFor(path, index) {
  const directions = [];
  const [row, column] = path[index];

  for (const neighborIndex of [index - 1, index + 1]) {
    const neighbor = path[neighborIndex];
    if (!neighbor) continue;

    const [neighborRow, neighborColumn] = neighbor;
    if (neighborRow < row) directions.push(N);
    else if (neighborRow > row) directions.push(S);
    else if (neighborColumn < column) directions.push(W);
    else directions.push(E);
  }

  if (index === 0) directions.push(W);
  if (index === path.length - 1) directions.push(S);
  return directions;
}

function typeAndRotationFor(directions) {
  for (const type of Object.keys(templates)) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const pipeDirections = openings(type, rotation);
      if (directions.every(direction => pipeDirections.includes(direction)) &&
          pipeDirections.every(direction => directions.includes(direction))) {
        return [type, rotation];
      }
    }
  }
  return ['corner', 0];
}

function clearFlowTimeout() {
  clearTimeout(flowTimeout);
  flowTimeout = null;
  flowCallback = null;
}

function scheduleFlow(callback, delay) {
  flowCallback = callback;
  flowDelay = delay;
  flowScheduledAt = Date.now();
  flowTimeout = setTimeout(() => {
    flowTimeout = null;
    flowCallback = null;
    callback();
  }, delay);
}

function startTimer() {
  ticking = setInterval(() => {
    seconds--;
    timerEl.textContent = formatTime(seconds);
    if (seconds <= 0) {
      clearInterval(ticking);
      ticking = null;
      clearFlowTimeout();
      flowing = false;
      pauseEl.disabled = true;
      messageEl.textContent = 'Time’s up. Restart to try again.';
    }
  }, 1000);
}

function newGame() {
  clearInterval(ticking);
  clearFlowTimeout();
  celebrationEl.replaceChildren();
  messageEl.hidden = false;
  winMessageEl.hidden = true;
  paused = false;
  pauseEl.textContent = 'Pause';
  pauseEl.setAttribute('aria-pressed', 'false');
  pauseEl.disabled = false;
  seconds = Math.max(35, 60 - (level - 1) * 4);
  flowing = false;

  const path = buildSolution();
  const pathCells = new Map(path.map(([row, column], index) => [`${row},${column}`, index]));
  grid = Array.from({ length: 9 }, () => Array(8));

  for (let row = 0; row < 9; row++) {
    for (let column = 0; column < 8; column++) {
      const key = `${row},${column}`;
      let type = Math.random() < 0.48 ? 'straight' : 'corner';
      let rotation = Math.floor(Math.random() * 4);
      if (pathCells.has(key)) {
        const [pathType, solutionRotation] = typeAndRotationFor(neededFor(path, pathCells.get(key)));
        type = pathType;
        const scramble = type === 'straight'
          ? (Math.random() < 0.5 ? 1 : 3)
          : 1 + Math.floor(Math.random() * 3);
        rotation = (solutionRotation + scramble) % 4;
      }
      grid[row][column] = { type, rotation };
    }
  }

  render();
  messageEl.textContent = 'Tap the pipes to rotate them. Connect then start the water.';
  timerEl.textContent = formatTime(seconds);
  startTimer();
}

function render() {
  boardEl.replaceChildren();

  for (let row = 0; row < 9; row++) {
    for (let column = 0; column < 8; column++) {
      const pipe = grid[row][column];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.column = column;
      cell.setAttribute('aria-label', `Row ${row + 1}, column ${column + 1}: rotate pipe`);
      cell.innerHTML = `<span class="pipe" style="--r:${pipe.rotation * 90}deg">${pipeSvg(pipe.type)}</span>`;
      cell.addEventListener('click', () => rotatePipe(row, column, cell));
      boardEl.appendChild(cell);
    }
  }
}

function rotatePipe(row, column, cell) {
  if (paused || flowing || seconds <= 0) return;
  const pipe = grid[row][column];
  pipe.rotation = (pipe.rotation + 1) % 4;
  cell.querySelector('.pipe').style.setProperty('--r', `${pipe.rotation * 90}deg`);
}

function formatTime(value) {
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function startFlow() {
  if (paused || flowing || seconds <= 0) return;
  flowing = true;
  boardEl.querySelectorAll('.cell').forEach(cell => cell.classList.remove('wet'));

  let row = 0;
  let column = 0;
  let entry = W;
  const visited = new Set();

  function advance() {
    const key = `${row},${column}`;
    if (visited.has(key)) {
      fail('The water looped back on itself.');
      return;
    }
    visited.add(key);

    const cell = boardEl.querySelector(`[data-row="${row}"][data-column="${column}"]`);
    const pipe = grid[row][column];
    const pipeOpenings = openings(pipe.type, pipe.rotation);
    if (!pipeOpenings.includes(entry)) {
      fail('Leak! That pipe does not connect.');
      return;
    }

    cell.classList.add('wet');
    const exit = pipeOpenings.find(direction => direction !== entry);
    if (exit === undefined) {
      fail('Dead end.');
      return;
    }
    if (row === 8 && column === 7 && exit === S) {
      win();
      return;
    }

    const [rowDelta, columnDelta] = delta[exit];
    const nextRow = row + rowDelta;
    const nextColumn = column + columnDelta;
    if (nextRow < 0 || nextRow > 8 || nextColumn < 0 || nextColumn > 7) {
      fail('The water ran off the board.');
      return;
    }

    const nextPipe = grid[nextRow][nextColumn];
    if (!openings(nextPipe.type, nextPipe.rotation).includes(opposite[exit])) {
      scheduleFlow(() => fail('Leak! Two pipes do not line up.'), 180);
      return;
    }

    row = nextRow;
    column = nextColumn;
    entry = opposite[exit];
    scheduleFlow(advance, 105);
  }

  advance();
}

function fail(text) {
  clearFlowTimeout();
  flowing = false;
  pauseEl.disabled = false;
  messageEl.textContent = `${text} Keep rotating and try again.`;
  boardEl.classList.add('flash');
  setTimeout(() => boardEl.classList.remove('flash'), 550);
}

function win() {
  clearInterval(ticking);
  ticking = null;
  clearFlowTimeout();
  pauseEl.disabled = true;
  const gain = 100 + seconds * 5;
  score += gain;
  scoreEl.textContent = `Score: ${score}`;
  messageEl.hidden = true;
  roundScoreEl.textContent = `+${gain} points`;
  winMessageEl.hidden = false;
  celebrate();
  continueEl.focus();
}

function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#2e9df7', '#ffc907', '#8bd1cb', '#f4c38f'];

  for (let index = 0; index < 36; index++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.animationDuration = `${2.4 + Math.random() * 1.2}s`;
    piece.addEventListener('animationend', () => piece.remove());
    celebrationEl.append(piece);
  }
}

function togglePause() {
  if (seconds <= 0) return;

  paused = !paused;
  pauseEl.textContent = paused ? 'Resume' : 'Pause';
  pauseEl.setAttribute('aria-pressed', String(paused));

  if (paused) {
    clearInterval(ticking);
    ticking = null;
    if (flowTimeout) {
      flowDelay = Math.max(0, flowDelay - (Date.now() - flowScheduledAt));
      clearTimeout(flowTimeout);
      flowTimeout = null;
    }
    pausedMessage = messageEl.textContent;
    messageEl.textContent = 'Game paused.';
    return;
  }

  messageEl.textContent = pausedMessage;
  startTimer();
  if (flowCallback) scheduleFlow(flowCallback, flowDelay);
}

document.querySelector('#restart').addEventListener('click', newGame);
document.querySelector('#flow').addEventListener('click', startFlow);
continueEl.addEventListener('click', () => {
  level++;
  levelEl.textContent = `Level ${level}`;
  newGame();
});
pauseEl.addEventListener('click', togglePause);
newGame();