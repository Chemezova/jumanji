// Джуманджи — игра для двоих. Всё хранится на телефоне (localStorage).

const STORE_KEY = 'jumanji.v1';
const APP_VERSION = 47;            // совпадает с номером CACHE в sw.js — видно в Настройках
const KEY_STORE = 'jumanji.key';  // ключ к колоде после первого ввода пароля
const MIN = 60 * 1000;
const GAME_MS = 3 * 60 * MIN;     // сценарий и игра живут 3 часа
const MAX_PER_GAME = 4;            // поз и действий за игру
const FORCED_TURNS = 3;            // после «Никогда» ход у партнёра столько раз
const HE_CHANCE = 0.5;             // доля «ОН» в стрелке
const FAV_WEIGHT = 3;
const JOKER_WEIGHT = 3;            // джокер выпадает чаще обычной карты
const RARE_WEIGHT = 0.1;
const SPICE_WEIGHT = 2.5;          // карты выбранной в Настройках остроты — чаще остальных           // «слишком игровые» сценарии в режиме «Сейчас»
const POSES_PER_TURN = 3;          // поз за ход — несколько, сценарий и действие — по одному
const LATER_PER_TURN = 5;          // пятое «потом» за ход — красная карточка и ход партнёру
const LATER_TO_NEVER = 10;         // столько раз отложили — карта уходит в «Никогда»
const NEW_TOY_WEIGHT = 12;         // только что купленная игрушка выпадает почти сразу

// Колода приходит зашифрованной (deck.js) и заполняется после ввода пароля
let TOYS = [], PENALTIES = [], CARDS = [], FORGIVE = {};

const NAME = { M: 'ОН', F: 'ОНА' };

// Карта наказаний: колесо в красной карточке. Шесть зон, у каждой — своё орудие и сила
const BODY_MAP = [
  { zone: 'Ягодицы', short: 'Попа', how: '5 ударов шлёпалкой, ремнём или ладонью — в полную силу. Считать вслух.' },
  { zone: 'Бёдра снаружи', short: 'Бёдра', how: '5 ударов ладонью или шлёпалкой по внешней стороне бёдер. Ноги не сводить.' },
  { zone: 'Бёдра изнутри', short: 'Изнутри', how: '5 лёгких шлепков пальцами по внутренней стороне бёдер. Ближе к паху — ещё легче.' },
  { zone: 'Ступни', short: 'Ступни', how: 'Лечь на живот, ступни вверх. 5 лёгких хлёстких ударов стеком или линейкой по подушечкам ступней.' },
  { zone: 'Ладони', short: 'Ладони', how: 'Ладони вперёд. 5 ударов линейкой или стеком по середине ладони. Убрал руку — удар заново.' },
  { zone: 'Соски', short: 'Соски', how: '5 касаний хвостами флоггера или пальцами — едва-едва. Это про остроту, а не про силу.' },
];
const TYPE = {
  scenario: { one: 'Сценарий', many: 'Сценарии', sym: '✦', desc: 'Один на 3 часа' },
  pose: { one: 'Поза', many: 'Позы', sym: '❦', desc: `До ${POSES_PER_TURN} за ход` },
  action: { one: 'Действие', many: 'Действия', sym: '✧', desc: 'Одно за ход' },
};
const RESULT = {
  play: 'начали', plan: 'в планы', later: 'потом', never: 'никогда', skip: 'пропуск хода',
  punish: 'штраф', paid: 'выполнено', gift: 'подарок', refuse: 'отказ', stop: 'стоп-слово', done: 'сыграли',
};

// ---------- Хранилище ----------

function emptyState() {
  return {
    version: 1,
    seenRules: false,
    pin: '',
    arsenal: {},          // id игрушки → true, если есть
    customToys: [],       // [{ id, name }]
    shop: [],             // id игрушек к покупке
    lvlMax: 3,
    pickMode: 'random',   // random | turns
    when: 'now',          // now | next
    leader: null,         // M | F
    forced: null,         // { who, left, gift } — ходы закреплены: штраф за «Никогда» или подарок
    game: null,           // { start, pose, action }
    scenario: null,       // { id, leader, start }
    playing: null,        // { id, leader, start }
    drawn: null,          // { id, from } — вытянутая карта ждёт решения
    newToy: null,         // только что купленная игрушка — с неё начинается следующая игра
    customCards: [],      // свои карты пары: { id: 'my-…', type, title, lvl, min, steps, mine: true }
    stopWord: '',         // стоп-слово пары — видно на паузе, в правилах и на острых картах
    penaltyDue: null,     // { who, title, text, ts } — наказание назначено и не выполнено: игра стоит
    turnUsed: {},         // тип → уже взят в этом ходе (за ход — 1 сценарий, 1 поза, 1 действие)
    turnLater: 0,         // сколько раз за ход нажали «Давай потом»
    stats: {},            // id → { p: сыграли, l: откладывали } — рейтинг карты
    shown: {},            // id → сколько раз выпадала — очередь для карт без рейтинга
    turnPlays: 0,         // сколько карт взято в игру за текущий ход
    fav: {},
    never: {},
    later: [],            // [{ id, ts, plan }]
    seen: {},             // id → когда выпадала
    log: [],              // [{ ts, id, L, r, note, dur }]
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(emptyState(), JSON.parse(raw));
  } catch (e) {}
  return emptyState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

// Дубли, слитые в одну карту: старый id → оставшаяся карта (журнал, избранное и т. п.)
const MERGED = {
  'bd-count': 'ac-spank', 'bs-maid-strict': 'sc-maid', 'ac-nuru': 'po-oil-slide',
  'ac-couples-tease': 'ac-remote-home', 'bs-stripper': 'sc-strip-club', 'ac-on-command': 'ac-countdown',
  'po-seated-reverse': 'po-living-chair', 'po-office-chair': 'po-chair', 'sc-blind-date': 'sc-strangers',
};
let state = load();
// перенести отметки со слитых карт на оставшиеся
for (const [from, to] of Object.entries(MERGED)) {
  for (const k of ['fav', 'never', 'stats', 'shown', 'seen']) {
    const m = state[k];
    if (m && m[from] !== undefined) { if (m[to] === undefined) m[to] = m[from]; delete m[from]; }
  }
}
state.later.forEach(x => { x.id = MERGED[x.id] || x.id; });
state.later = state.later.filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
for (const id of ['jk-scenario', 'jk-pose', 'jk-action']) delete state.never[id];   // джокер нельзя потерять

// Экран и всплывающие окна — не сохраняются
const ui = {
  screen: 'dash',       // dash | shuffle | card | playing | settings | journal
  locked: !!state.pin,
  pinEntry: '',
  modal: null,
  peek: null,           // id карты, открытой поверх
  skipLater: {},        // тип → отказались от отложенного в этой игре
  back: 'dash',
};

// ---------- Помощники ----------

const $ = sel => document.querySelector(sel);
const now = () => Date.now();
const other = L => (L === 'M' ? 'F' : 'M');
const byId = id => CARDS.find(c => c.id === (MERGED[id] || id));

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function allToys() { return TOYS.concat(state.customToys); }
function toyName(id) { const t = allToys().find(t => t.id === id); return t ? t.name : id; }
function hasToy(id) { return !!state.arsenal[id]; }

// needs: ['cuffs|rope'] — каждая строка закрывается любой из игрушек
function missingNeeds(card) {
  return (card.needs || []).filter(n => !n.split('|').some(hasToy));
}

function pad2(n) { return String(n).padStart(2, '0'); }
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}
function hm(ts) { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dayName(ts) {
  const d = new Date(ts), t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Сегодня';
  t.setDate(t.getDate() - 1);
  if (same(d, t)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
function turns(n) { return `${n} ${plural(n, 'ход', 'хода', 'ходов')}`; }
const fixedWhy = f => (f.gift ? 'ходы подарены' : 'штраф за «Никогда»');
// подарок: сколько осталось — ходами или «весь вечер»
const giftLeft = f => (f.evening ? 'весь вечер' : `ещё ${turns(f.left)}`);
// сейчас идут подаренные ходы, и ведёт получатель подарка
const inGift = () => !!(state.forced && state.forced.gift && state.leader === state.forced.who);
// Минимальное время карты: 40 мин, 2 ч, 1 сутки
function duration(min, short) {
  if (min >= 1440) return `${Math.round(min / 1440)} ${short ? 'сут' : plural(Math.round(min / 1440), 'сутки', 'суток', 'суток')}`;
  if (min >= 120 && min % 60 === 0) return `${min / 60} ч`;
  return short ? `${min}′` : `${min} мин`;
}
function peppers(n) { return '🌶'.repeat(n); }

// Текст карточки под ведущего: заголовок, вступление, подсказка и игрушки заменяются,
// шаги и лайфхаки — добавляются к общим
function cardFor(card, L) {
  const own = card[L] || {};
  return {
    title: own.title || card.title,
    intro: own.intro || card.intro || '',
    steps: (card.steps || []).concat(own.steps || []),
    tips: (card.tips || []).concat(own.tips || []),
    tell: own.tell || card.tell || '',
    order: own.order || card.order || '',
    uses: own.uses || card.uses || [],
  };
}

// Кто ведёт карту. Мазо-карта (switch) переворачивает роли: ведущий становится нижним,
// и карту исполняет партнёр. Тексты таких карт написаны для того, кто их исполняет
function topFor(card, L) { return card.switch ? other(L) : L; }

// Фантазия, записанная на карте-джокере
function jokerWish() {
  const v = ($('#jokerWish') || {}).value;
  return v && v.trim() ? { note: v.trim() } : undefined;
}

function log(id, r, extra) {
  state.log.push(Object.assign({ ts: now(), id, L: state.leader, r }, extra || {}));
  if (state.log.length > 1000) state.log.splice(0, state.log.length - 1000);
}

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// ---------- Правила игры ----------

// Сценарий и игра истекают через 3 часа — сыгранными считаются автоматически
function expire() {
  const t = now();
  let changed = false;
  if (state.scenario && t - state.scenario.start > GAME_MS) { state.scenario = null; changed = true; }
  // сценарий, по которому уже нажали «Сыграли» (остался от прежней версии), — снять
  if (state.scenario && state.log.some(e => e.r === 'done' && e.id === state.scenario.id && e.ts >= state.scenario.start)) {
    state.scenario = null; changed = true;
  }
  if (state.game && t - state.game.start > GAME_MS) {
    state.game = null; ui.skipLater = {}; changed = true;
    if (state.forced && state.forced.evening) state.forced = null;
  }
  if (changed) save();
}

function ensureGame() {
  if (!state.game) state.game = { start: now(), pose: 0, action: 0 };
}

function used(type) { return state.game ? state.game[type] || 0 : 0; }

function canDraw(type) {
  if (!state.leader) return 'Сначала выберите ведущего';
  if (type === 'scenario' && state.scenario) return 'Сценарий уже идёт — переиграть нельзя';
  const u = (state.turnUsed || {})[type];
  if (type === 'pose' && (u || 0) >= POSES_PER_TURN) return `${POSES_PER_TURN} позы в этом ходе уже было. Дальше — «Ход сделан»`;
  if (type !== 'pose' && u) return `${TYPE[type].one} в этом ходе уже есть. Дальше — «Ход сделан»`;
  return '';
}

function fits(card, L) {
  if (state.never[card.id]) return false;
  if (card.switch && inGift()) return false;   // в свой подарок получатель нижним не становится
  if ((card.lvl || 1) > state.lvlMax) return false;
  if (card.leaders && !card.leaders.includes(topFor(card, L))) return false;
  if (state.when === 'now') {
    if (card.when === 'next') return false;
    if (missingNeeds(card).length) return false;
  }
  return true;
}

// Рейтинг карты: избранное и частая игра поднимают, «Давай потом» опускает,
// «слишком игровые» сценарии сегодня почти не выпадают
function cardWeight(c) {
  const st = (state.stats || {})[c.id] || {};
  let w = state.fav[c.id] ? FAV_WEIGHT : 1;
  if (c.joker) w *= JOKER_WEIGHT;
  if (st.p) w *= 1 + Math.min(st.p, 5) * 0.2;
  if (st.l) w *= Math.pow(0.8, st.l);
  if (c.rare && state.when === 'now') w *= RARE_WEIGHT;
  // выбранная острота выпадает чаще, сильно мягче неё — реже
  const gap = state.lvlMax - (c.lvl || 1);
  if (gap === 0) w *= SPICE_WEIGHT;
  else if (gap >= 2) w *= 0.5;
  if (state.newToy && usesToy(c, state.newToy)) w *= NEW_TOY_WEIGHT;   // новинка — первой
  return w;
}

// Карта без рейтинга — нейтральная: такие идут по очереди, пока не выпадут все
function isNeutral(c) {
  const st = (state.stats || {})[c.id];
  return !state.fav[c.id] && !(st && (st.p || st.l)) && !c.rare && !c.joker && !(state.newToy && usesToy(c, state.newToy));
}

function pickRandom(type) {
  const L = state.leader;
  const laterIds = new Set(state.later.map(x => x.id));
  let pool = CARDS.filter(c => c.type === type && fits(c, L) && !laterIds.has(c.id));
  if (!pool.length) return null;
  // подарок: первая же вытянутая карта — джокер (карт-бланш получателю)
  if (inGift() && !state.forced.jokerDone) {
    const joker = pool.find(c => c.joker);
    if (joker) return joker;
  }
  // идёт сценарий — позы и действия близкой остроты: нежному нежное, жёсткому жёсткое
  const sc = state.scenario && type !== 'scenario' ? byId(state.scenario.id) : null;
  if (sc) {
    const near = pool.filter(c => c.joker || Math.abs((c.lvl || 1) - (sc.lvl || 1)) <= 1);
    if (near.length) pool = near;
  }
  const shown = state.shown || {};
  const neutral = pool.filter(isNeutral);
  if (neutral.length) {
    const minShown = Math.min(...neutral.map(c => shown[c.id] || 0));
    pool = pool.filter(c => !isNeutral(c) || (shown[c.id] || 0) === minShown);
  }
  const t = now();
  const weights = pool.map(c => {
    let w = cardWeight(c);
    if (sc && (c.lvl || 1) === (sc.lvl || 1)) w *= 2;   // та же острота, что у сценария, — чаще
    const seen = state.seen[c.id];
    if (seen && t - seen < 24 * 60 * MIN) w *= 0.25;   // недавно выпадала — реже
    return w;
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function pendingFor(type) {
  return state.later.filter(x => {
    const c = byId(x.id);
    return c && c.type === type && !state.never[c.id] && (!c.leaders || c.leaders.includes(state.leader))
      && (c.when !== 'next' || x.plan) && !missingNeeds(c).length
      && (!x.plan || (c.buy || []).every(hasToy));   // запланированное ждёт, пока купите нужное
  });
}

// Ход — это всё, что ведущий взял в игру: сценарий, позы, действия вместе.
// Ход закончился: закреплённые ходы (штраф, подарок) идут вниз,
// «по очереди» ведущий меняется, со стрелкой — крутим заново
// Пока по вытянутой карте нет решения, ведущий не меняется: ни стрелкой, ни вручную,
// ни подарком, ни «Ход сделан» — иначе карта достанется следующему игроку
// Пока наказание не выполнено, игра стоит: ни новых карт, ни смены ведущего
function waitPenalty() {
  const p = state.penaltyDue;
  toast(`Сначала наказание: ${NAME[p.who]} — ${p.title}. Ведущий нажимает «Выполнено»`);
  ui.screen = 'dash';
  window.scrollTo(0, 0);
}

// Пока карта в игре, ведущий не меняется — сначала «Сыграли» (или «Ход сделан»)
function waitPlaying() {
  toast('Сейчас идёт карта. Сначала «Сыграли» или «Ход сделан»');
  ui.screen = 'playing';
  window.scrollTo(0, 0);
}

function waitDecision() {
  toast('Сначала решите, что делать с вытянутой картой: «Играем», «Потом» или «Никогда»');
  ui.screen = 'card';
  window.scrollTo(0, 0);
}

function resetTurn() {
  state.turnPlays = 0;
  state.turnUsed = {};
  state.turnLater = 0;
}

function endTurn() {
  resetTurn();
  closePlaying();
  state.scenario = null;
  if (state.forced) {
    state.forced.left--;
    if (state.forced.left > 0) { state.leader = state.forced.who; return; }
    state.forced = null;
  }
  if (state.pickMode === 'turns' && state.leader) state.leader = other(state.leader);
  else state.leader = null;
}

// Взяли карту в игру (или в планы): за ход — одна карта каждого типа; рейтинг растёт
function markPlayed(card) {
  if (!state.turnUsed) state.turnUsed = {};
  if (card.type === 'pose') state.turnUsed.pose = (state.turnUsed.pose || 0) + 1;
  else state.turnUsed[card.type] = true;
  stat(card.id).p++;
}

// Ход уходит партнёру со штрафом: пропуск, слишком много «потом»
function passTurn(L, reason) {
  if (state.forced) endTurn();
  else { resetTurn(); state.leader = other(L); }
  ui.modal = { type: 'punish', who: L, reason };
}

// Закрыть карту, которая шла, — когда ведущий берёт следующую
function closePlaying() {
  const p = state.playing;
  if (!p) return;
  state.log.push({ ts: now(), id: p.id, L: p.leader, r: 'done', dur: now() - p.start });
  state.playing = null;
}

// Карта как-то связана с игрушкой: нужна, пригодится или покупается
function usesToy(card, id) {
  const lists = [card.needs, card.uses, card.buy, card.M && card.M.uses, card.F && card.F.uses];
  return lists.some(l => (l || []).some(n => n.split('|').includes(id)));
}

function stat(id) {
  if (!state.stats) state.stats = {};
  return state.stats[id] || (state.stats[id] = { p: 0, l: 0 });
}

function removeLater(id) { state.later = state.later.filter(x => x.id !== id); }

// ---------- Действия ----------

const actions = {
  // правила
  rules() { ui.modal = { type: 'rules' }; },
  rulesOk() { state.seenRules = true; save(); ui.modal = null; },

  // ведущий
  pickLeader(d) {
    if (state.penaltyDue) return waitPenalty();
    if (state.drawn) return waitDecision();
    if (state.playing) return waitPlaying();
    if (state.turnPlays) return toast('Ход ещё идёт. Закончите его кнопкой «Ход сделан»');
    if (state.forced) return toast(`Ход у ${state.forced.who === 'M' ? 'него' : 'неё'}: ${fixedWhy(state.forced)}`);
    state.leader = d.l; save();
  },
  pickMode(d) { state.pickMode = d.m; save(); },
  when(d) { state.when = d.w; save(); },
  spin() {
    if (state.penaltyDue) return waitPenalty();
    if (state.drawn) return waitDecision();
    if (state.playing) return waitPlaying();
    if (state.turnPlays) return toast('Ход ещё идёт. Закончите его кнопкой «Ход сделан»');
    if (state.forced) return toast(`Сейчас ведущий закреплён: ${fixedWhy(state.forced)}`);
    ui.modal = { type: 'spin', result: null };
  },
  spinGo() {
    if (ui.modal.spinning) return;
    const he = Math.random() < HE_CHANCE;
    const span = he ? [8, 360 * HE_CHANCE - 8] : [360 * HE_CHANCE + 8, 352];
    const angle = span[0] + Math.random() * (span[1] - span[0]);
    ui.modal.spinning = true;
    const needle = $('.needle');
    needle.style.transition = '';
    needle.getBoundingClientRect();
    needle.style.transform = `rotate(${360 * 6 + angle}deg)`;
    setTimeout(() => {
      state.leader = he ? 'M' : 'F'; save();
      ui.modal = { type: 'spin', result: state.leader, angle };
      render();
    }, 3700);
    document.querySelectorAll('.sheet .btns .btn').forEach(b => { b.disabled = true; });
    return 'norender';
  },

  // колоды
  draw(d) {
    if (state.penaltyDue) return waitPenalty();
    if (state.drawn) { ui.screen = 'card'; window.scrollTo(0, 0); return; }   // сначала решение по вытянутой
    const why = canDraw(d.t);
    if (why) return toast(why);
    if (state.when === 'now' && !ui.skipLater[d.t]) {
      const p = pendingFor(d.t);
      if (p.length) { ui.modal = { type: 'pending', t: d.t, id: p[0].id }; return; }
    }
    const card = pickRandom(d.t);
    if (!card) return toast('Подходящих карт нет — загляните в арсенал или остроту');
    state.seen[card.id] = now();
    if (!state.shown) state.shown = {};
    state.shown[card.id] = (state.shown[card.id] || 0) + 1;
    if (card.joker && state.forced && state.forced.gift) state.forced.jokerDone = true;
    save();
    ui.screen = 'shuffle';
    render();
    setTimeout(() => { ui.screen = 'card'; state.drawn = { id: card.id, from: 'deck' }; save(); render(); window.scrollTo(0, 0); }, 1400);
    return 'norender';
  },
  pendingYes() {
    const id = ui.modal.id;
    ui.modal = null;
    ui.screen = 'card';
    state.drawn = { id, from: 'later' }; save();
    window.scrollTo(0, 0);
  },
  pendingNo() {
    const t = ui.modal.t;
    ui.skipLater[t] = true;
    ui.modal = null;
    return actions.draw({ t });
  },

  // решение по карте
  play() {
    const card = byId(state.drawn.id);
    removeLater(card.id);
    if (state.when === 'next') {
      state.later.push({ id: card.id, ts: now(), plan: true });
      const needs = missingNeeds(card).map(n => n.split('|')[0]);
      const toBuy = needs.concat((card.buy || []).filter(id => !hasToy(id)));
      toBuy.forEach(id => { if (!state.shop.includes(id)) state.shop.push(id); });
      log(card.id, 'plan', Object.assign({ L: topFor(card, state.leader) }, jokerWish()));
      markPlayed(card);
      state.turnPlays++; save();
      ui.screen = 'dash'; state.drawn = null; save();
      toast(toBuy.length ? 'В планах. Покупки — в списке «Купить»' : 'Запланировано на следующий раз');
      return;
    }
    ensureGame();
    const top = topFor(card, state.leader);
    if (card.type === 'scenario') state.scenario = { id: card.id, leader: top, start: now() };
    else state.game[card.type] = used(card.type) + 1;
    closePlaying();
    state.playing = { id: card.id, leader: top, start: now() };
    log(card.id, 'play', Object.assign({ L: top }, state.drawn.from === 'joker' ? { via: 'joker' } : {}, jokerWish()));
    if (state.newToy && usesToy(card, state.newToy)) state.newToy = null;   // новинку обыграли
    markPlayed(card);
    state.turnPlays++; save();
    ui.screen = 'playing'; state.drawn = null; save();
    window.scrollTo(0, 0);
    wakeLock();
  },
  later() {
    const card = byId(state.drawn.id);
    const wasPlan = state.later.find(x => x.id === card.id)?.plan;
    removeLater(card.id);
    state.later.push({ id: card.id, ts: now(), plan: wasPlan || state.when === 'next' });
    log(card.id, 'later');
    const st = stat(card.id);
    if (!card.joker) st.l++;   // джокер «Потом» не понижает и в «Никогда» сам не уходит
    if (!inGift()) state.turnLater = (state.turnLater || 0) + 1;   // в подарок «Потом» без лимита
    ui.screen = 'dash'; state.drawn = null;
    if (st.l >= LATER_TO_NEVER) {
      state.never[card.id] = true;
      removeLater(card.id);
      toast(`Карту откладывали ${LATER_TO_NEVER} раз — она ушла в «Никогда». Вернуть можно в Настройках`);
    } else toast(inGift() ? 'Отложено. В подарок «Потом» без ограничений' : `Отложено. «Потом» в этом ходе: ${state.turnLater} из ${LATER_PER_TURN}`);
    if (state.turnLater >= LATER_PER_TURN) passTurn(state.leader, `${LATER_PER_TURN} раз «Давай потом» за ход`);
    save();
  },
  never() { ui.modal = { type: 'never' }; },
  // джокер: вместо своей фантазии — любая карта этой колоды или из избранного
  jokerPick() {
    ui.jokerPick = byId(state.drawn.id).type;
    ui.deckType = ui.jokerPick;
    ui.screen = 'deck';
    window.scrollTo(0, 0);
  },
  jokerPlay(d) {
    ui.jokerPick = null;
    state.drawn = { id: d.id, from: 'joker' };
    return actions.play();
  },
  jokerBack() { ui.jokerPick = null; ui.screen = 'card'; },
  // отказ стать нижним по мазо-карте: карта не пропадает, ведущему — красная карточка
  refuseSwitch() {
    const L = state.leader;
    log(state.drawn.id, 'refuse');
    ui.screen = 'dash'; state.drawn = null; save();
    ui.modal = { type: 'punish', who: L, reason: 'отказ стать нижним' };
  },
  neverYes() {
    const card = byId(state.drawn.id);
    const L = state.leader;
    state.never[card.id] = true;
    removeLater(card.id);
    log(card.id, 'never');
    if (!inGift()) {   // в подарок ход остаётся у получателя: только карта и красная карточка
      state.forced = { who: other(L), left: FORCED_TURNS };
      state.leader = other(L);
      resetTurn();
    }
    save();
    ui.screen = 'dash'; state.drawn = null; save();
    ui.modal = { type: 'punish', who: L, reason: '«Никогда»' };
  },
  fav() {
    const id = ui.peek || state.drawn.id;
    if (state.fav[id]) delete state.fav[id]; else state.fav[id] = true;
    save();
  },
  skip() {
    if (state.penaltyDue) return waitPenalty();
    if (state.forced) return toast(`Сейчас пропустить нельзя: ${fixedWhy(state.forced)}`);
    ui.modal = { type: 'skip' };
  },
  skipYes() {
    const L = state.leader;
    log(state.drawn ? state.drawn.id : null, 'skip');
    ui.screen = 'dash'; state.drawn = null;
    passTurn(L, 'пропуск хода');
    save();
  },

  // идёт игра
  peek(d) { ui.peek = d.id; },
  peekClose() { ui.peek = null; ui.deckFor = null; },
  deckType(d) { ui.deckType = d.t; },
  deckLead(d) { ui.deckLead = d.l; },
  deckView(d) { ui.peek = d.id; ui.deckFor = ui.deckLead || 'M'; },
  done() {
    const p = state.playing;
    const card = byId(p.id);
    const passed = now() - p.start;
    if (passed < card.min * MIN && !(ui.modal && ui.modal.type === 'early')) {
      ui.modal = { type: 'early' };
      return;
    }
    state.log.push({ ts: now(), id: p.id, L: p.leader, r: 'done', dur: passed });
    if (state.scenario && state.scenario.id === p.id) state.scenario = null;   // сценарий сыгран — колода снова открыта
    state.playing = null; save();
    ui.modal = null; ui.screen = 'dash';
    releaseWake();
  },
  refused() {
    const p = state.playing;
    ui.modal = { type: 'punish', who: other(p.leader), reason: 'отказ подчиниться', by: p.leader };
  },
  stop() { ui.modal = { type: 'stop' }; },
  stopGoOn() { ui.modal = null; },
  stopEnd() {
    const p = state.playing;
    if (p) state.log.push({ ts: now(), id: p.id, L: p.leader, r: 'stop', dur: now() - p.start });
    state.playing = null; state.game = null; state.scenario = null;
    save();
    ui.modal = null; ui.screen = 'dash';
    releaseWake();
  },

  // штрафы
  penalty(d) {
    const m = ui.modal;
    const allowed = PENALTIES.map((p, i) => i).filter(i => (PENALTIES[i].lvl || 1) <= state.lvlMax);
    const i = d.i === 'rand' ? allowed[Math.floor(Math.random() * allowed.length)] : +d.i;
    const p = PENALTIES[i];
    state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `${p.title} — ${m.reason}` });
    state.penaltyDue = { who: m.who, title: p.title, text: p.text, ts: now() };
    save();
    ui.modal = { type: 'penaltyShow', who: m.who, title: p.title, text: p.text };
  },
  penaltyOwn() {
    const text = $('#ownPenalty').value.trim();
    if (!text) return toast('Напишите, чего хотите');
    const m = ui.modal;
    state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `Прихоть: ${text} — ${m.reason}` });
    state.penaltyDue = { who: m.who, title: 'Прихоть', text, ts: now() };
    save();
    ui.modal = { type: 'penaltyShow', who: m.who, title: 'Прихоть', text };
  },
  // «Простить» — не бесплатно: оценить проступок от 1 до 5 и выбрать цену прощения
  forgive() { const m = ui.modal; ui.modal = { type: 'forgive', who: m.who, by: m.by, reason: m.reason, deg: 0, picks: [] }; },
  forgiveDeg(d) {
    const m = ui.modal;
    m.deg = +d.deg;
    const pool = (FORGIVE[m.deg] || []).slice();
    m.picks = [];
    while (pool.length && m.picks.length < 3) m.picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  },
  forgiveMore() { return actions.forgiveDeg({ deg: ui.modal.deg }); },
  forgivePick(d) {
    const m = ui.modal;
    const text = m.picks[+d.i];
    state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `Прощение: ${text} — ${m.reason}` });
    state.penaltyDue = { who: m.who, title: 'Цена прощения', text, ts: now() };
    save(); ui.modal = null;
  },
  forgiveFree() { ui.modal = null; toast('Прощено без условий'); },
  bodyMap() { const m = ui.modal; ui.modal = { type: 'bodyMap', who: m.who, by: m.by, reason: m.reason, spins: [], angle: 0 }; },
  punishBack() { const m = ui.modal; ui.modal = { type: 'punish', who: m.who, by: m.by, reason: m.reason }; },
  // отменить наказание с колеса: запись из журнала убирается
  bodyAccept() {
    const m = ui.modal;
    const z = BODY_MAP[m.spins[0]];
    state.penaltyDue = { who: m.who, title: `Карта наказаний: ${z.zone}`, text: z.how, ts: now() };
    save(); ui.modal = null;
  },
  penaltyDone() {
    const p = state.penaltyDue;
    state.log.push({ ts: now(), id: null, L: p.who, r: 'paid', note: `Наказание выполнено: ${p.title}` });
    state.penaltyDue = null;
    save(); toast('Наказание выполнено. Игра продолжается');
  },
  bodyCancel() {
    const e = state.log[state.log.length - 1];
    if (e && e.r === 'punish' && (e.note || '').startsWith('Карта наказаний')) state.log.pop();
    save(); ui.modal = null; toast('Наказание отменено');
  },
  bodySpin() {
    const m = ui.modal;
    if (m.spinning || m.spins.length) return 'norender';   // колесо крутится один раз
    const i = Math.floor(Math.random() * BODY_MAP.length);
    const step = 360 / BODY_MAP.length;
    const target = i * step + 8 + Math.random() * (step - 16);
    const start = m.angle || 0;
    const angle = start - (start % 360) + 360 * 5 + target;
    m.spinning = true;
    const needle = $('.needle');
    needle.style.transition = '';
    needle.getBoundingClientRect();
    needle.style.transform = `rotate(${angle}deg)`;
    document.querySelectorAll('.sheet .btns .btn').forEach(b => { b.disabled = true; });
    setTimeout(() => {
      m.spinning = false;
      m.angle = angle;
      m.spins.push(i);
      state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `Карта наказаний: ${BODY_MAP[i].zone} — ${m.reason}` });
      save();
      render();
    }, 3700);
    return 'norender';
  },
  closeModal() { ui.modal = null; },

  // сценарий на дашборде
  viewScenario() { ui.peek = state.scenario.id; },
  endGame() { ui.modal = { type: 'endGame' }; },
  endGameYes() {
    closePlaying();
    state.game = null; state.scenario = null; resetTurn(); ui.skipLater = {};
    if (state.forced && state.forced.evening) state.forced = null;   // подаренный вечер кончился вместе с игрой
    if (state.pickMode === 'random' && !state.forced) state.leader = null;
    save(); ui.modal = null;
    toast('Игра завершена');
  },

  // навигация
  go(d) { ui.back = ui.screen; ui.screen = d.s; ui.jokerPick = null; window.scrollTo(0, 0); },
  openDrawn() { ui.screen = 'card'; window.scrollTo(0, 0); },
  openPlaying() { ui.screen = 'playing'; window.scrollTo(0, 0); },
  home() {
    if (ui.reloadPending) { location.reload(); return 'norender'; }
    ui.screen = 'dash'; ui.jokerPick = null; window.scrollTo(0, 0);
  },
  view(d) { ui.peek = d.id; },
  viewPlayed(d) { ui.peek = d.id; ui.deckFor = d.l; },

  // арсенал и покупки
  toy(d) { if (state.arsenal[d.id]) delete state.arsenal[d.id]; else state.arsenal[d.id] = true; save(); },
  addToy() {
    const name = $('#newToy').value.trim();
    if (!name) return;
    state.customToys.push({ id: 'my-' + now(), name });
    state.arsenal[state.customToys[state.customToys.length - 1].id] = true;
    save();
  },
  delToy(d) {
    state.customToys = state.customToys.filter(t => t.id !== d.id);
    delete state.arsenal[d.id];
    state.shop = state.shop.filter(id => id !== d.id);
    save();
  },
  bought(d) {
    state.arsenal[d.id] = true;
    state.shop = state.shop.filter(id => id !== d.id);
    state.newToy = d.id;
    save(); toast(`${toyName(d.id)} — в арсенале. Следующая игра начнётся с неё`);
  },
  shopAdd(d) {
    if (!state.shop.includes(d.id)) state.shop.push(d.id);
    save(); toast(`${toyName(d.id)} — в списке «Купить»`);
  },
  dropNewToy() { state.newToy = null; save(); },
  unshop(d) { state.shop = state.shop.filter(id => id !== d.id); save(); },
  addShop() {
    const id = $('#shopPick').value;
    if (id && !state.shop.includes(id)) state.shop.push(id);
    save();
  },

  // настройки
  lvl(d) { state.lvlMax = +d.v; save(); },
  unnever(d) { delete state.never[d.id]; save(); },
  unlater(d) { removeLater(d.id); save(); },
  clearLater() { ui.modal = { type: 'clearLater' }; },
  clearLaterYes() { state.later = []; save(); ui.modal = null; toast('Отложенное очищено'); },
  peekUnlater() { removeLater(ui.peek); save(); ui.peek = null; ui.deckFor = null; toast('Убрано из отложенного'); },
  unfav(d) { delete state.fav[d.id]; save(); },
  // свои карты
  addCustom() {
    const title = $('#myTitle').value.trim();
    const steps = $('#myText').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!title || !steps.length) return toast('Нужны название и хотя бы одна строка описания');
    const card = { id: 'my-' + now(), type: $('#myType').value, title, lvl: +$('#myLvl').value, min: +$('#myMin').value || 15,
      teaser: 'Своя карта', steps, mine: true };
    if (!state.customCards) state.customCards = [];
    state.customCards.push(card);
    CARDS.push(card);
    save(); toast(`«${title}» — в колоде`);
  },
  delCustom(d) {
    state.customCards = (state.customCards || []).filter(c => c.id !== d.id);
    CARDS = CARDS.filter(c => c.id !== d.id);
    removeLater(d.id); delete state.fav[d.id];
    save();
  },
  // недоступные карты: нужная игрушка — сразу в «Купить»
  shopNeed(d) {
    if (!state.shop.includes(d.id)) state.shop.push(d.id);
    save(); toast(`${toyName(d.id)} — в списке «Купить»`);
  },
  setStopWord() {
    state.stopWord = $('#stopWord').value.trim();
    save(); toast(state.stopWord ? `Стоп-слово: «${state.stopWord}»` : 'Стоп-слово очищено');
  },
  setPin() {
    const v = $('#newPin').value.trim();
    if (!/^\d{4}$/.test(v)) return toast('Нужно 4 цифры');
    state.pin = v; save(); toast('Код установлен');
  },
  delPin() { state.pin = ''; save(); toast('Код снят'); },
  resetGame() { ui.modal = { type: 'resetGame' }; },
  clearLog() { ui.modal = { type: 'clearLog' }; },
  clearLogYes() { state.log = []; save(); ui.modal = null; toast('Журнал стёрт'); },
  resetGameYes() {
    Object.assign(state, { leader: null, forced: null, game: null, scenario: null, playing: null, drawn: null, turnPlays: 0 });
    ui.skipLater = {};
    save(); ui.modal = null; toast('Текущая игра сброшена');
  },

  // подарок ходов
  // ведущий сам отдаёт ход партнёру — без штрафа, сразу на несколько ходов подряд
  gift() {
    if (state.penaltyDue) return waitPenalty();
    if (state.drawn) return waitDecision();
    if (state.playing) return waitPlaying();
    if (state.turnPlays) return toast('Ход ещё идёт. Закончите его кнопкой «Ход сделан»');
    if (state.forced) return toast(`Сейчас ведущий закреплён: ${fixedWhy(state.forced)}`);
    ui.modal = { type: 'gift', n: 3 };
  },
  giftSet(d) { ui.modal.n = d.n === 'evening' ? 'evening' : +d.n; },
  giftYes() {
    const to = other(state.leader);
    const evening = ui.modal.n === 'evening';
    const n = evening ? 999 : ui.modal.n;
    state.forced = { who: to, left: n, gift: true, evening };
    state.leader = to;
    resetTurn();
    state.log.push({ ts: now(), id: null, L: to, r: 'gift', n: evening ? 0 : n, note: evening ? 'Весь вечер в подарок' : `${turns(n)} в подарок` });
    save();
    ui.modal = null;
    toast(evening ? `🎁 ${NAME[to]} ведёт весь вечер` : `🎁 ${NAME[to]} ведёт следующие ${turns(n)}`);
  },
  turnDone() {
    if (state.penaltyDue) return waitPenalty();
    if (state.drawn) return waitDecision();
    endTurn(); save();
    toast(state.leader ? `Ход переходит: ведёт ${NAME[state.leader]}` : 'Ход сделан. Крутите стрелку заново');
  },
  giftEnd() {
    state.forced = null; save();
    toast('Подарок закончен — ходы снова по обычным правилам');
  },

  // пароль к колоде
  unlockDeck() {
    ui.deckPwValue = $('#deckPw').value;
    ui.deckShow = $('#deckPw').type === 'text';
    // При вставке из заметок телефон тащит пробелы, переносы и невидимые символы.
    // В самом пароле пробелов нет (build.py это проверяет), поэтому убираем их все
    const pw = ui.deckPwValue.replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF]/g, '');
    if (!pw) return;
    ui.deckBusy = true; ui.deckError = false;
    render();
    openDeck(pw).then(ok => {
      ui.deckBusy = false;
      ui.deckError = !ok;
      if (ok) ui.deckPwValue = '';
      render();
    });
    return 'norender';
  },

  // показать или скрыть пароль, не теряя набранное
  togglePw() {
    const f = $('#deckPw');
    f.type = f.type === 'password' ? 'text' : 'password';
    $('#pwEye').textContent = f.type === 'password' ? 'Показать' : 'Скрыть';
    f.focus();
    return 'norender';
  },

  // замок
  key(d) {
    if (d.k === 'del') ui.pinEntry = ui.pinEntry.slice(0, -1);
    else if (ui.pinEntry.length < 4) ui.pinEntry += d.k;
    if (ui.pinEntry.length === 4) {
      if (ui.pinEntry === state.pin) { ui.locked = false; ui.pinEntry = ''; }
      else {
        ui.pinEntry = '';
        render();
        $('.dots')?.classList.add('shake');
        return 'norender';
      }
    }
  },
};

// ---------- Экраны ----------

function render() {
  expire();
  const app = $('#app');
  if (!CARDS.length) { app.innerHTML = deckLockView(); return; }
  if (ui.locked) { app.innerHTML = lockView(); return; }
  if (ui.screen === 'card' && !state.drawn) ui.screen = 'dash';
  if (!state.playing && ui.screen === 'playing') ui.screen = 'dash';
  if (!state.seenRules && !ui.modal) ui.modal = { type: 'rules', first: true };

  const views = { dash: dashView, shuffle: shuffleView, card: cardScreen, playing: playingView, settings: settingsView, journal: journalView, deck: deckView };
  app.innerHTML = (views[ui.screen] || dashView)() + (ui.peek ? peekView() : '') + modalView();
}

function topBar() {
  return `<div class="top">
    <div class="logo">ДЖУМАНДЖИ<b>·</b></div>
    <div class="icons">
      <button class="ic" data-act="rules" aria-label="Правила">?</button>
      <button class="ic" data-act="go" data-s="deck" aria-label="Все карты">❖</button>
      <button class="ic" data-act="go" data-s="journal" aria-label="Журнал">☰</button>
      <button class="ic" data-act="go" data-s="settings" aria-label="Настройки">⚙</button>
    </div>
  </div>`;
}

function dashView() {
  const L = state.leader;
  const f = state.forced;
  const player = l => `<button class="player ${l} ${L === l ? 'on' : ''}" data-act="pickLeader" data-l="${l}" ${f && f.who !== l ? 'disabled' : ''} ${state.drawn || state.playing || state.penaltyDue || state.turnPlays ? 'data-why="1"' : ''}>
      <div class="nm">${NAME[l]}</div>
      <div class="st">${L === l ? 'ведёт' : 'подчиняется'}</div>
      ${f && f.gift && f.who === l ? `<div class="gift-badge">🎁 ${f.evening ? 'вечер' : f.left}</div>` : ''}
    </button>`;

  let h = topBar();
  h += `<div class="players">${player('M')}${player('F')}</div>`;
  h += `<div class="who-row">
      <button class="btn gold" data-act="spin" ${f ? 'disabled' : ''} ${state.drawn || state.playing || state.penaltyDue || state.turnPlays ? 'data-why="1"' : ''}>➶ Кто сегодня главный?</button>
    </div>`;
  h += `<div class="seg">
      <button class="${state.pickMode === 'random' ? 'on' : ''}" data-act="pickMode" data-m="random">Стрелка</button>
      <button class="${state.pickMode === 'turns' ? 'on' : ''}" data-act="pickMode" data-m="turns">По очереди</button>
    </div>`;
  if (state.newToy) h += `<div class="note gift">✨ Новинка в арсенале: ${esc(toyName(state.newToy))}. Ближайшие карты будут с ней.
      <button class="textlink" style="padding:4px 0 0;display:block" data-act="dropNewToy">Не начинать с неё</button></div>`;
  if (f && f.gift) h += `<div class="note gift">🎁 Подарок: ведёт ${NAME[f.who]} — ${giftLeft(f)}. Первая карта — джокер, «Потом» без ограничений, без мазо-карт.
      <button class="textlink" style="padding:4px 0 0;display:block" data-act="giftEnd">Закончить подарок раньше</button></div>`;
  else if (f) h += `<div class="note">Штраф за «Никогда»: ведёт ${NAME[f.who]} — ещё ${turns(f.left)}.</div>`;

  h += `<div class="seg">
      <button class="${state.when === 'now' ? 'on' : ''}" data-act="when" data-w="now">Играем сейчас</button>
      <button class="${state.when === 'next' ? 'on' : ''}" data-act="when" data-w="next">На следующий раз</button>
    </div>`;

  // Невыполненное наказание держит игру
  if (state.penaltyDue) {
    const p = state.penaltyDue;
    h += `<div class="note penalty-due">
      <div class="pd-head">🟥 ${NAME[p.who]} ${p.who === 'F' ? 'наказана' : 'наказан'}: <b>${esc(p.title)}</b></div>
      <div class="pd-text">${esc(p.text)}</div>
      <div class="pd-meta">Назначено ${dayName(p.ts).toLowerCase()} в ${hm(p.ts)}. Пока не выполнено — игра стоит.</div>
      <button class="btn primary" data-act="penaltyDone">Выполнено</button>
    </div>`;
  }

  // Незаконченное: карта в игре или вытянутая без решения
  if (state.playing) {
    const c = byId(state.playing.id);
    h += `<button class="deck active" data-act="openPlaying" style="margin-top:12px">
      <div class="sym">⏱</div>
      <div class="tx"><div class="t">Карта в игре</div><div class="d">${TYPE[c.type].one} · ведёт ${NAME[state.playing.leader]} · вернуться</div></div>
      <div class="cnt" data-since="${state.playing.start}">${clock(now() - state.playing.start)}</div>
    </button>`;
  }
  if (state.drawn) {
    const c = byId(state.drawn.id);
    h += `<button class="deck active" data-act="openDrawn" style="margin-top:12px">
      <div class="sym">${TYPE[c.type].sym}</div>
      <div class="tx"><div class="t">Карта ждёт решения</div><div class="d">${TYPE[c.type].one} · вернуться к карте</div></div>
    </button>`;
  }

  if (!L) {
    h += `<div class="note soft">Выберите ведущего — нажмите «ОН» или «ОНА» или доверьтесь стрелке.</div>`;
    return h;
  }

  h += `<div class="zone-title"><h2>Ведёт <span class="lead-${L}">${NAME[L]}</span></h2>
    ${f ? '' : '<button class="textlink" data-act="gift">🎁 Подарить ходы</button>'}</div>
    <p class="hint-line">Сценарий, позы и действия складываются — можно всё вместе за один ход.</p>`;

  // Сценарий
  const sc = state.scenario;
  if (sc) {
    const c = byId(sc.id);
    h += `<button class="deck active" data-act="viewScenario">
      <div class="sym">${TYPE.scenario.sym}</div>
      <div class="tx"><div class="t">${esc(cardFor(c, sc.leader).title)}</div>
      <div class="d">Сценарий идёт · ведёт ${NAME[sc.leader]}</div></div>
      <div class="cnt" data-left="${sc.start}">${clock(GAME_MS - (now() - sc.start))}</div>
    </button>`;
  } else {
    h += deckBtn('scenario', '');
  }
  h += deckBtn('pose', (state.turnUsed || {}).pose ? `${state.turnUsed.pose} / ${POSES_PER_TURN}` : '') + playedChips('pose');
  h += deckBtn('action', (state.turnUsed || {}).action ? '✓ в ходе' : '') + playedChips('action');
  h += state.turnPlays
    ? `<div class="who-row"><button class="btn" data-act="turnDone">Ход сделан — ${turnDoneText()}</button></div>`
    : f ? '' : `<div class="who-row"><button class="btn ghost small" data-act="skip">Пропустить ход (штраф)</button></div>`;

  // Отложенное
  if (state.later.length) {
    h += `<div class="zone-title" style="margin:20px 0 8px"><span class="sec" style="margin:0">Отложено и в планах</span>
      <button class="textlink" style="padding:0" data-act="clearLater">очистить</button></div><div class="links">`;
    h += state.later.map(x => {
      const c = byId(x.id);
      return c ? `<button class="chip ${x.plan ? 'buy' : ''}" data-act="view" data-id="${c.id}">${TYPE[c.type].sym} ${esc(cardFor(c, L).title)}</button>` : '';
    }).join('');
    h += `</div>`;
  }

  // Сыграно в этой игре
  if (state.game) {
    const played = state.log.filter(e => e.ts >= state.game.start && e.r === 'play' && byId(e.id));
    h += `<div class="sec">В этой игре</div>`;
    h += played.length
      ? `<ul class="list">${played.map(e => {
        const c = byId(e.id);
        return `<li data-act="viewPlayed" data-id="${c.id}" data-l="${e.L}"><span>${TYPE[c.type].sym}</span><span class="grow">${esc(playedTitle(e, c))}</span><span class="meta">${NAME[e.L]} · ${hm(e.ts)} ›</span></li>`;
      }).join('')}</ul>`
      : `<div class="empty">Пока ничего</div>`;
    h += `<div class="who-row"><button class="btn ghost small" data-act="endGame">Завершить игру</button></div>`;
  }
  return h;
}

// Карты этой игры одного типа — под кнопкой колоды, нажатие открывает карту
function playedOf(type) {
  if (!state.game) return [];
  return state.log.filter(e => e.ts >= state.game.start && e.r === 'play' && byId(e.id)?.type === type);
}
// Как подписать сыгранную карту: джокер — с загаданной фантазией, карта по джокеру — со звёздочкой
function playedTitle(e, c) {
  if (c.joker) return e.note ? `★ Джокер: ${e.note}` : '★ Джокер';
  return (e.via === 'joker' ? '★ ' : '') + cardFor(c, e.L || 'M').title;
}

function playedChips(type) {
  const list = playedOf(type);
  if (!list.length) return '';
  return `<div class="links played">${list.map(e => {
    const c = byId(e.id);
    return `<button class="chip have" data-act="viewPlayed" data-id="${c.id}" data-l="${e.L}">${TYPE[type].sym} ${esc(playedTitle(e, c))}</button>`;
  }).join('')}</div>`;
}

// Что будет после «Ход сделан»
function turnDoneText() {
  const f = state.forced;
  if (f && f.evening) return `ведёт ${NAME[f.who]} дальше`;
  if (f && f.left > 1) return `ведёт ${NAME[f.who]}, ещё ${turns(f.left - 1)}`;
  if (state.pickMode === 'turns') return `ход ${f ? NAME[other(f.who)] : NAME[other(state.leader)]}`;
  return 'крутим стрелку';
}

function deckBtn(type, cnt) {
  const why = canDraw(type) && state.leader;
  const desc = state.when === 'next' ? 'Вытянуть на следующий раз' : TYPE[type].desc;
  return `<button class="deck" data-act="draw" data-t="${type}" ${why ? 'data-why="1"' : ''}>
    <div class="sym">${TYPE[type].sym}</div>
    <div class="tx"><div class="t">${TYPE[type].many}</div><div class="d">${desc}</div></div>
    <div class="cnt">${cnt}</div>
  </button>`;
}

function shuffleView() {
  return `<div class="shuffle"><div style="text-align:center">
    <div class="cardback"><span>✦</span></div>
    <div class="hint">Тасуем колоду…</div>
  </div></div>`;
}

// Декоративный узор для шапки карточки
function ornament(type) {
  const g = '#c9a46c';
  if (type === 'pose') return `<svg class="ornament" viewBox="0 0 100 100"><path d="M20 80 C20 40 50 20 50 50 C50 80 80 60 80 20" fill="none" stroke="${g}" stroke-width="1.5"/><path d="M28 86 C30 50 58 32 58 58 C58 84 86 66 86 30" fill="none" stroke="${g}" stroke-width="1" opacity=".6"/></svg>`;
  if (type === 'action') return `<svg class="ornament" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="${g}" stroke-width="1.2"/><circle cx="50" cy="50" r="18" fill="none" stroke="${g}" stroke-width="1" opacity=".6"/><circle cx="50" cy="50" r="5" fill="${g}"/></svg>`;
  return `<svg class="ornament" viewBox="0 0 100 100"><path d="M50 8 L60 40 L92 50 L60 60 L50 92 L40 60 L8 50 L40 40 Z" fill="none" stroke="${g}" stroke-width="1.3"/><path d="M50 30 L55 45 L70 50 L55 55 L50 70 L45 55 L30 50 L45 45 Z" fill="${g}" opacity=".5"/></svg>`;
}

function cardHtml(card, L) {
  const t = cardFor(card, L);
  const miss = missingNeeds(card);
  let h = `<article class="card ${card.joker ? 'joker' : ''} ${card.switch ? 'switch' : ''}">
    <div class="card-head">
      ${ornament(card.type)}
      <div class="card-type"><span>${card.joker ? '★ Джокер · ' : ''}${card.switch ? '⇅ Мазо · ' : ''}${TYPE[card.type].one}</span><span>${card.switch ? 'ведёт' : 'для ведущего'}: ${NAME[L]}</span></div>
      <h1>${esc(t.title)}</h1>
      <div class="teaser">${esc(card.teaser || '')}</div>
      <div class="facts">
        <span class="fact">${peppers(card.lvl || 1)}</span>
        <span class="fact">⏱ от ${duration(card.min)}</span>
        ${card.when === 'next' ? '<span class="fact">на следующий раз</span>' : ''}
        ${state.fav[card.id] ? '<span class="fact">★ любимая</span>' : ''}
      </div>
    </div>
    <div class="card-body">`;
  if (t.intro) h += `<p>${esc(t.intro)}</p>`;
  if (t.order) h += `<div class="box order"><b>Приказ — прочитай вслух</b>${esc(t.order)}</div>`;
  if ((card.lvl || 1) >= 3) h += `<div class="stopword">Стоп-слово: ${state.stopWord ? `<b>«${esc(state.stopWord)}»</b>` : '<button class="textlink" data-act="go" data-s="settings">не задано — задать</button>'} — останавливает всё сразу</div>`;
  const toys = (card.needs || []).map(n => {
    const ok = !miss.includes(n);
    return `<span class="chip ${ok ? 'have' : 'miss'}">${n.split('|').map(toyName).map(esc).join(' или ')}${ok ? '' : ' — нет'}</span>`;
  }).concat(t.uses.filter(id => !(card.buy || []).includes(id)).map(id =>
    `<span class="chip ${hasToy(id) ? 'have' : ''}">${esc(toyName(id))}${hasToy(id) ? '' : ' · по желанию'}</span>`));
  if (toys.length) h += `<div class="sec">Понадобится</div><div class="links">${toys.join('')}</div>`;
  if (card.buyAny) {
    const missing = allToys().filter(x => !hasToy(x.id));
    h += `<div class="sec">Чего у вас ещё нет — нажмите, чтобы добавить в «Купить»</div><div class="links">${missing.map(x =>
      `<button class="chip ${state.shop.includes(x.id) ? 'buy' : ''}" data-act="shopAdd" data-id="${x.id}">${state.shop.includes(x.id) ? '✓ ' : '+ '}${esc(x.name)}</button>`).join('') || '<span class="empty">В арсенале уже есть всё</span>'}</div>`;
  }
  if (card.buy && card.buy.length) h += `<div class="sec">Купить к игре</div><div class="links">${card.buy.map(id => `<span class="chip ${hasToy(id) ? 'have' : 'buy'}">${esc(toyName(id))}${hasToy(id) ? ' — есть' : ''}</span>`).join('')}</div>`;
  if (t.steps.length) h += `<div class="sec">Как играть</div><ol class="steps">${t.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
  h += t.tips.map(s => `<div class="box tip"><b>Лайфхак</b>${esc(s)}</div>`).join('');
  if (t.tell) h += `<div class="box tell"><b>Партнёру можно сказать</b>${esc(t.tell)}</div>`;
  if (card.ph) h += `<a class="textlink" href="https://www.pornhub.com/video/search?search=${encodeURIComponent(card.ph)}" target="_blank" rel="noopener noreferrer">Найти похожее видео ↗</a>`;
  h += `</div></article>`;
  return h;
}

function cardScreen() {
  const card = byId(state.drawn.id);
  const L = state.leader;
  let h = `<button class="home-btn" data-act="home">‹ Главная</button><button class="stop-btn" data-act="stop">Стоп</button>`;
  if (card.switch) h += `<div class="note switch" style="margin:40px 0 12px">⇅ Мазо-карта. В этот раз ${NAME[L]} — ${L === 'F' ? 'нижняя' : 'нижний'}: карту исполняет ${NAME[other(L)]}. Принимаешь — отдай телефон. Отказ — красная карточка.</div>`;
  else if (state.drawn.from === 'later') h += `<div class="note soft" style="margin:40px 0 12px">Отложено с прошлого раза — выполняем?</div>`;
  else h += `<div style="height:44px"></div>`;
  h += cardHtml(card, topFor(card, L));
  if (card.joker) h += `<div class="sec">Моя фантазия</div><textarea id="jokerWish" class="field" rows="3" placeholder="Что именно ты хочешь. Партнёр увидит это в журнале — потом"></textarea>
    <div class="who-row"><button class="btn gold" data-act="jokerPick">★ Выбрать любую карту: ${TYPE[card.type].many.toLowerCase()} и избранное</button></div>`;
  h += card.switch
    ? `<div class="card-actions">
    <button class="btn primary" data-act="play">Принимаю — я ${L === 'F' ? 'нижняя' : 'нижний'}</button>
    <button class="btn" style="grid-column:1/-1" data-act="refuseSwitch">Отказываюсь — красная карточка</button>
  </div>`
    : `<div class="card-actions">
    <button class="btn primary" data-act="play">Играем</button>
    <button class="btn" data-act="later">Давай потом</button>
    ${card.joker ? '' : '<button class="btn" data-act="never">Никогда</button>'}
  </div>`;
  h += `<div class="card-tools">
    <button class="fav ${state.fav[card.id] ? 'on' : ''}" data-act="fav">${state.fav[card.id] ? '★ В избранном' : '☆ В избранное'}</button>
    ${state.turnPlays ? '' : '<button class="textlink" data-act="skip">Пропустить ход</button>'}
  </div>`;
  return h;
}

function playingView() {
  const p = state.playing;
  const card = byId(p.id);
  const R = 100, C = 2 * Math.PI * R;
  return `<button class="home-btn" data-act="home">‹ Главная</button><button class="stop-btn" data-act="stop">Стоп</button>
  <div class="playing">
    <div class="lbl">Карта в игре · ведёт ${NAME[p.leader]}</div>
    <div class="ring">
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle cx="110" cy="110" r="${R}" fill="none" stroke="#2e252b" stroke-width="4"/>
        <circle id="ringArc" cx="110" cy="110" r="${R}" fill="none" stroke="#a8233b" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
      </svg>
      <div class="time"><b id="elapsed">00:00</b><small>минимум ${duration(card.min)}</small></div>
    </div>
    <p class="lbl" style="max-width:280px;line-height:1.6;text-transform:none;letter-spacing:0;font-size:14px">
      Положите телефон экраном вниз. Что выпало — знает только ведущий.</p>
    <div class="btns">
      <button class="btn" data-act="peek" data-id="${p.id}">Подсмотреть карту</button>
      <button class="btn primary" data-act="done">Сыграли</button>
      <button class="btn ghost" data-act="refused">${NAME[other(p.leader)]} отказывается подчиняться</button>
    </div>
    <div class="sec" style="margin-bottom:0">Добавить к игре</div>
    <div class="who-row" style="width:100%;margin-top:0">
      ${state.scenario ? '' : '<button class="btn small" style="flex:1" data-act="draw" data-t="scenario">+ Сценарий</button>'}
      <button class="btn small" style="flex:1" data-act="draw" data-t="pose">+ Поза</button>
      <button class="btn small" style="flex:1" data-act="draw" data-t="action">+ Действие</button>
    </div>
  </div>`;
}

function peekView() {
  const card = byId(ui.peek);
  const sc = state.scenario && state.scenario.id === card.id ? state.scenario.leader : null;
  const pl = state.playing && state.playing.id === card.id ? state.playing.leader : null;
  const L = ui.deckFor || sc || pl || state.leader || 'M';
  return `<div class="peek"><div class="inner">
    <button class="back" data-act="peekClose">‹ Закрыть</button>
    ${cardHtml(card, L)}
    <div class="card-tools"><button class="fav ${state.fav[card.id] ? 'on' : ''}" data-act="fav">${state.fav[card.id] ? '★ В избранном' : '☆ В избранное'}</button>
      ${state.later.some(x => x.id === card.id) ? '<button class="textlink" data-act="peekUnlater">Убрать из отложенного</button>' : ''}</div>
  </div></div>`;
}

// Карты, которые в «Сейчас» не выпадают из-за недостающих игрушек — по игрушке
function unavailableHtml() {
  const groups = {};
  for (const c of CARDS) {
    if (c.joker || c.when === 'next' || state.never[c.id] || (c.lvl || 1) > state.lvlMax) continue;
    for (const n of missingNeeds(c)) (groups[n] = groups[n] || []).push(c);
  }
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  let h = `<div class="set-sec"><h2>Недоступно сейчас</h2><p class="lead">Эти карты в режиме «Сейчас» не выпадают — не хватает игрушки. Нажмите, чтобы увидеть карты; «В Купить» — добавить в список покупок.</p>`;
  if (!keys.length) return h + `<div class="empty">Всё доступно — арсенал полный</div></div>`;
  h += keys.map(n => {
    const first = n.split('|')[0];
    return `<details class="unav"><summary><span class="grow">${n.split('|').map(toyName).map(esc).join(' или ')}</span><span class="meta">${groups[n].length} ${plural(groups[n].length, 'карта', 'карты', 'карт')}</span></summary>
      <ul class="list">${groups[n].map(c => `<li><span>${TYPE[c.type].sym}</span><button class="grow" style="text-align:left" data-act="view" data-id="${c.id}">${esc(c.title)}</button></li>`).join('')}</ul>
      ${state.shop.includes(first) ? '<div class="meta">✓ уже в «Купить»</div>' : `<button class="btn small gold" data-act="shopNeed" data-id="${first}">В «Купить»: ${esc(toyName(first))}</button>`}
    </details>`;
  }).join('');
  return h + '</div>';
}

// Свои карты пары
function customHtml() {
  const mine = state.customCards || [];
  return `<div class="set-sec"><h2>Свои карты</h2><p class="lead">Ваша идея — новая карта в колоде. Каждая строка описания станет шагом.</p>
    ${mine.length ? `<ul class="list">${mine.map(c => `<li><span>✎</span><button class="grow" style="text-align:left" data-act="view" data-id="${c.id}">${esc(c.title)}<div class="meta">${TYPE[c.type].one} · ${peppers(c.lvl)}</div></button><button class="x" data-act="delCustom" data-id="${c.id}">удалить</button></li>`).join('')}</ul>` : ''}
    <select id="myType" class="field"><option value="scenario">Сценарий</option><option value="pose">Поза</option><option value="action" selected>Действие</option></select>
    <input id="myTitle" class="field" placeholder="Название">
    <textarea id="myText" class="field" rows="4" placeholder="Что делать — по шагу на строку"></textarea>
    <div class="addrow"><select id="myLvl" class="field"><option value="1">🌶</option><option value="2" selected>🌶🌶</option><option value="3">🌶🌶🌶</option></select>
      <input id="myMin" class="field" type="number" inputmode="numeric" min="1" value="15" placeholder="минут">
      <button class="btn small" data-act="addCustom">Добавить</button></div>
  </div>`;
}

function settingsView() {
  let h = `<button class="back" data-act="home">‹ Назад</button><h1 style="font-size:30px;margin:6px 0 4px">Настройки</h1>`;

  h += `<div class="set-sec"><h2>Арсенал</h2><p class="lead">Что у вас есть: ${allToys().filter(t => hasToy(t.id)).length} из ${allToys().length}. Карты с недостающими игрушками в «Сейчас» не выпадают — только «на следующий раз».</p>`;
  const cats = [...new Set(allToys().map(t => t.cat || 'Свои'))];
  h += cats.map(cat => `<div class="sec">${esc(cat)}</div><ul class="list">${allToys().filter(t => (t.cat || 'Свои') === cat).map(t => `<li>
      <span class="grow">${esc(t.name)}${t.hint ? `<div class="meta">${esc(t.hint)}</div>` : ''}</span>
      ${t.id.startsWith('my-') ? `<button class="x" data-act="delToy" data-id="${t.id}">убрать</button>` : ''}
      <button class="toggle ${hasToy(t.id) ? 'on' : ''}" data-act="toy" data-id="${t.id}" aria-label="${esc(t.name)}"></button>
    </li>`).join('')}</ul>`).join('');
  h += `<div class="addrow"><input id="newToy" class="field" placeholder="Своя игрушка"><button class="btn small" data-act="addToy">Добавить</button></div></div>`;

  h += `<div class="set-sec"><h2>Купить</h2><p class="lead">Сюда попадают покупки из карт «на следующий раз». Купили — игрушка уходит в арсенал.</p>`;
  h += state.shop.length
    ? `<ul class="list">${state.shop.map(id => `<li><span class="grow">${esc(toyName(id))}</span>
        <button class="x" data-act="unshop" data-id="${id}">убрать</button>
        <button class="btn small gold" data-act="bought" data-id="${id}">Купили</button></li>`).join('')}</ul>`
    : `<div class="empty">Список пуст</div>`;
  const notOwned = allToys().filter(t => !hasToy(t.id) && !state.shop.includes(t.id));
  if (notOwned.length) h += `<div class="addrow"><select id="shopPick" class="field">${notOwned.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="btn small" data-act="addShop">В список</button></div>`;
  h += `</div>`;

  h += `<div class="set-sec"><h2>Острота</h2><p class="lead">Карты выбранной остроты выпадают чаще, острее — не выпадают совсем. Штрафы — тоже по этой остроте.</p><div class="seg">
    ${[1, 2, 3].map(v => `<button class="${state.lvlMax === v ? 'on' : ''}" data-act="lvl" data-v="${v}">${peppers(v)}</button>`).join('')}
  </div></div>`;

  const list = (title, lead, ids, act, label) => {
    let s = `<div class="set-sec"><h2>${title}</h2><p class="lead">${lead}</p>`;
    s += ids.length
      ? `<ul class="list">${ids.map(id => byId(id)).filter(Boolean).map(c => `<li>
          <span>${TYPE[c.type].sym}</span><button class="grow" style="text-align:left" data-act="view" data-id="${c.id}">${esc(c.title)}</button>
          <button class="x" data-act="${act}" data-id="${c.id}">${label}</button></li>`).join('')}</ul>`
      : `<div class="empty">Пусто</div>`;
    return s + `</div>`;
  };
  h += unavailableHtml();
  h += customHtml();
  h += list('Избранное', 'Эти карты выпадают в три раза чаще.', Object.keys(state.fav), 'unfav', 'убрать');
  h += list('Отложено и в планах', 'Предлагаются первыми в следующей игре. Убрать можно по одной или все сразу.', state.later.map(x => x.id), 'unlater', 'убрать');
  if (state.later.length) h += `<div class="who-row"><button class="btn ghost small" data-act="clearLater">Очистить всё отложенное</button></div>`;
  h += list('Никогда', 'Эти карты больше не выпадают. Можно вернуть, если передумали.', Object.keys(state.never), 'unnever', 'вернуть');

  h += `<div class="set-sec"><h2>Стоп-слово</h2><p class="lead">Слово, которое останавливает игру сразу и без штрафов. Его увидите на паузе, в правилах и на острых картах.</p>
    <div class="addrow"><input id="stopWord" class="field" placeholder="Например: красный" value="${esc(state.stopWord || '')}"><button class="btn small" data-act="setStopWord">Сохранить</button></div>
  </div>`;

  h += `<div class="set-sec"><h2>Код на вход</h2><p class="lead">Приложение будет спрашивать 4 цифры при каждом открытии.</p>
    ${state.pin
      ? `<button class="btn small" data-act="delPin">Снять код</button>`
      : `<div class="addrow"><input id="newPin" class="field" type="password" inputmode="numeric" maxlength="4" placeholder="4 цифры"><button class="btn small" data-act="setPin">Установить</button></div>`}
  </div>`;

  const n = t => CARDS.filter(c => c.type === t).length;
  h += `<div class="set-sec"><h2>Игра</h2><p class="lead">В колоде: сценариев ${n('scenario')}, поз ${n('pose')}, действий ${n('action')}. Версия приложения: ${APP_VERSION}.</p>
    <div class="btns" style="display:grid;gap:10px">
      <button class="btn" data-act="rules">Правила</button>
      <button class="btn ghost" data-act="resetGame">Сбросить текущую игру</button>
    </div></div>`;
  return h;
}

// Вся колода: просмотр любой карты в версии для ведущего ОН или ОНА
function deckView() {
  if (ui.jokerPick) return jokerDeckView();
  const t = ui.deckType || 'scenario';
  const lead = ui.deckLead || 'M';
  // карты с пометкой pos встают на своё место в списке (pos: 8 — восьмая строка),
  // остальные перемешаны раз и навсегда, чтобы новые партии не шли хвостом в конце
  let h = `<button class="back" data-act="home">‹ Назад</button><h1 style="font-size:30px;margin:6px 0 4px">Колода</h1>
    <p class="lead" style="color:var(--muted);margin:0">Всего карт: ${CARDS.length}. Нажмите на карту, чтобы открыть её целиком.</p>
    <input id="deckSearch" class="field" type="search" placeholder="Поиск: врач, наручники, ванна…" value="${esc(ui.deckQuery || '')}" autocomplete="off">
    <div class="seg">${Object.keys(TYPE).map(k => `<button class="${t === k ? 'on' : ''}" data-act="deckType" data-t="${k}">${TYPE[k].many} · ${CARDS.filter(c => c.type === k).length}</button>`).join('')}</div>
    <div class="seg"><button class="${lead === 'M' ? 'on' : ''}" data-act="deckLead" data-l="M">Ведёт ОН</button><button class="${lead === 'F' ? 'on' : ''}" data-act="deckLead" data-l="F">Ведёт ОНА</button></div>
    <ul class="list" id="deckList" style="margin-top:12px">${deckListHtml()}</ul>`;
  return h;
}

// Строки каталога: с поиском — по всем колодам, без поиска — выбранная колода
function deckListHtml() {
  const t = ui.deckType || 'scenario';
  const lead = ui.deckLead || 'M';
  const q = (ui.deckQuery || '').trim();
  const ok = c => !c.leaders || c.leaders.includes(lead);
  let list;
  if (q) list = CARDS.filter(c => ok(c) && matches(c, q)).sort(byMix);
  else {
    const all = CARDS.filter(c => c.type === t && ok(c));
    // карты с пометкой pos встают на своё место (pos: 8 — восьмая строка), остальные — в постоянном перемешанном порядке
    list = all.filter(c => !c.pos).sort(byMix);
    all.filter(c => c.pos).sort((a, b) => a.pos - b.pos).forEach(c => list.splice(Math.min(c.pos - 1, list.length), 0, c));
  }
  if (!list.length) return `<li class="empty">Ничего не нашлось</li>`;
  return list.map(c => `<li data-act="deckView" data-id="${c.id}">
      <span>${c.joker ? '★' : c.mine ? '✎' : TYPE[c.type].sym}</span>
      <div class="grow"><div>${esc(cardFor(c, lead).title)}${state.never[c.id] ? ' <span class="res never">никогда</span>' : ''}</div>
        <div class="meta">${q ? TYPE[c.type].one + ' · ' : ''}${esc(c.teaser || '')}</div></div>
      <span class="meta" style="white-space:nowrap">${peppers(c.lvl || 1)} ${duration(c.min, true)}</span>
    </li>`).join('');
}

// Поиск: все слова запроса должны найтись в названиях, тексте, ключевых словах или игрушках карты
function matches(c, q) {
  const text = [c.title, c.M && c.M.title, c.F && c.F.title, c.teaser, c.intro, c.keys,
    JSON.stringify(c.steps || []), JSON.stringify(c.M || {}), JSON.stringify(c.F || {}),
    [...(c.needs || []), ...(c.uses || [])].flatMap(n => n.split('|')).map(toyName).join(' ')].join(' ').toLowerCase().replace(/ё/g, 'е');
  return q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).every(w => text.includes(w));
}

// Постоянный «перемешанный» порядок каталога: по хэшу id, одинаковый на любом телефоне.
// «Доктор» оставлен первым — с него колода начиналась
function mixKey(c) {
  if (c.id === 'sc-doctor') return -1;
  let h = 2166136261;
  for (const ch of c.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function byMix(a, b) { return mixKey(a) - mixKey(b); }

// Джокер: любая карта той же колоды, избранное — сверху
function jokerDeckView() {
  const t = ui.jokerPick;
  const L = state.leader;
  const q = (ui.deckQuery || '').trim();
  const ok = CARDS.filter(c => c.type === t && !c.joker && !state.never[c.id] && (!c.leaders || c.leaders.includes(topFor(c, L))) && (!q || matches(c, q)));
  const favs = ok.filter(c => state.fav[c.id]).sort(byMix);
  const rest = ok.filter(c => !state.fav[c.id]).sort(byMix);
  const row = c => `<li>
      <span>${c.switch ? '⇅' : TYPE[c.type].sym}</span>
      <button class="grow" style="text-align:left" data-act="view" data-id="${c.id}"><div>${esc(cardFor(c, topFor(c, L)).title)}</div><div class="meta">${esc(c.teaser || '')}</div></button>
      <button class="btn small gold" data-act="jokerPlay" data-id="${c.id}">▶ Играть</button>
    </li>`;
  let h = `<button class="back" data-act="jokerBack">‹ К джокеру</button><h1 style="font-size:30px;margin:6px 0 4px">★ Джокер</h1>
    <p class="lead" style="color:var(--muted);margin:0">Выбери любую карту — ${TYPE[t].many.toLowerCase()}. Нажми на название, чтобы прочитать, «Играть» — чтобы взять в игру.</p>
    <input id="jokerSearch" class="field" type="search" placeholder="Поиск: врач, проститутка, связать…" value="${esc(ui.deckQuery || '')}" autocomplete="off">
    <div id="jokerList">`;
  if (favs.length) h += `<div class="sec">Избранное</div><ul class="list">${favs.map(row).join('')}</ul>`;
  h += `<div class="sec">${q ? 'Нашлось' : 'Вся колода'}</div><ul class="list">${rest.map(row).join('') || '<li class="empty">Ничего не нашлось</li>'}</ul>`;
  return h + '</div>';
}

function journalView() {
  let h = `<button class="back" data-act="home">‹ Назад</button><h1 style="font-size:30px;margin:6px 0 4px">Журнал</h1>
    <p class="lead" style="color:var(--muted);margin:0">Здесь можно проверить, что на самом деле выпало ведущему.</p>`;
  if (!state.log.length) return h + `<div class="empty" style="margin-top:20px">Пока пусто</div>`;
  h += statsHtml();
  let day = '';
  h += state.log.slice().reverse().map(e => {
    const c = e.id ? byId(e.id) : null;
    const d = dayName(e.ts);
    const head = d !== day ? `${day ? '</ul>' : ''}<div class="day">${d}</div><ul class="list">` : '';
    day = d;
    const title = c ? esc(e.r === 'play' ? playedTitle(e, c) : cardFor(c, e.L || 'M').title) : esc(e.note || '');
    const dur = e.dur ? ` · ${Math.round(e.dur / MIN)} мин` : '';
    return `${head}<li ${c ? `data-act="view" data-id="${c.id}"` : ''}>
      <span>${c ? TYPE[c.type].sym : e.r === 'gift' ? '🎁' : '✕'}</span>
      <div class="grow"><div>${title}</div>${c && e.note && !(c.joker && e.r === 'play') ? `<div class="meta">«${esc(e.note)}»</div>` : ''}<div class="meta">${hm(e.ts)} · ${e.r === 'punish' || e.r === 'paid' ? 'штраф для' : 'ведёт'} ${NAME[e.L] || '—'}${dur}</div></div>
      <span class="res ${e.r}">${RESULT[e.r] || e.r}</span></li>`;
  }).join('') + '</ul>';
  h += `<div class="who-row" style="justify-content:center;margin-top:24px"><button class="textlink" data-act="clearLog">Стереть</button></div>`;
  return h;
}

// Соцсоревнование: кто сколько раз вёл и сколько часов это длилось — за всю историю
function statsHtml() {
  const st = { M: { n: 0, ms: 0, pun: 0, gift: 0 }, F: { n: 0, ms: 0, pun: 0, gift: 0 } };
  for (const e of state.log) {
    if (!st[e.L]) continue;
    if (e.r === 'play') st[e.L].n++;
    if ((e.r === 'done' || e.r === 'stop') && e.dur) st[e.L].ms += e.dur;
    if (e.r === 'punish') st[e.L].pun++;
    if (e.r === 'gift') st[other(e.L)].gift++;   // в записи — получатель, дарил другой
  }
  const hours = ms => {
    const m = Math.round(ms / MIN);
    return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${pad2(m % 60)} мин`;
  };
  const lead = st.M.n === st.F.n ? null : (st.M.n > st.F.n ? 'M' : 'F');
  const col = L => `<div class="stat ${L} ${lead === L ? 'win' : ''}">
      <div class="nm">${NAME[L]}${lead === L ? ' ♛' : ''}</div>
      <div class="big">${st[L].n}</div><div class="meta">${plural(st[L].n, 'раз', 'раза', 'раз')} ${L === 'F' ? 'вела' : 'вёл'}</div>
      <div class="mid">${hours(st[L].ms)}</div><div class="meta">в роли ${L === 'F' ? 'ведущей' : 'ведущего'}</div>
      <div class="meta">наказан${L === 'F' ? 'а' : ''}: ${st[L].pun}</div>
      <div class="meta">дарил${L === 'F' ? 'а' : ''} ходы: ${st[L].gift} ${plural(st[L].gift, 'раз', 'раза', 'раз')}</div>
    </div>`;
  return `<div class="stats">${col('M')}${col('F')}</div>
    <p class="meta" style="text-align:center;margin:6px 0 0">${lead ? `Лидирует ${NAME[lead]}` : 'Пока ничья'} · считаются карты, взятые в игру, и время по «Сыграли»</p>`;
}

function deckLockView() {
  return `<form class="lock" data-form="unlockDeck">
    <div class="logo">ДЖУМАНДЖИ<b>·</b></div>
    <p class="lead" style="color:var(--muted);text-align:center;max-width:280px;margin:0">Колода зашифрована. Введите пароль — на этом телефоне это нужно сделать один раз.</p>
    <div class="pw-row">
      <input id="deckPw" class="field" type="${ui.deckShow ? 'text' : 'password'}" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Пароль" value="${esc(ui.deckPwValue || '')}" ${ui.deckBusy ? 'disabled' : ''}>
      <button type="button" id="pwEye" class="pw-eye" data-act="togglePw">${ui.deckShow ? 'Скрыть' : 'Показать'}</button>
    </div>
    ${ui.deckError ? '<div class="note" style="margin:0;max-width:300px">Пароль не подошёл. Нажмите «Показать» и проверьте заглавные буквы и раскладку.</div>' : ''}
    <button class="btn primary" style="flex:0 0 auto;min-width:200px" ${ui.deckBusy ? 'disabled' : ''}>${ui.deckBusy ? 'Открываем…' : 'Открыть'}</button>
  </form>`;
}

function lockView() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return `<div class="lock">
    <div class="logo">ДЖУМАНДЖИ<b>·</b></div>
    <div class="dots">${[0, 1, 2, 3].map(i => `<i class="${i < ui.pinEntry.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pad">${keys.map(k => k ? `<button data-act="key" data-k="${k}">${k === 'del' ? '⌫' : k}</button>` : '<span></span>').join('')}</div>
  </div>`;
}

// ---------- Всплывающие окна ----------

function wheelSvg() {
  const cx = 130, cy = 130, r = 118;
  const pt = a => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const sector = (a, b, fill) => {
    const [x1, y1] = pt(a), [x2, y2] = pt(b);
    return `<path d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2} Z" fill="${fill}" stroke="#0d0a0c" stroke-width="3"/>`;
  };
  const split = 360 * HE_CHANCE;
  const lbl = (a, text) => { const k = 0.6; const x = cx + r * k * Math.sin(a * Math.PI / 180), y = cy - r * k * Math.cos(a * Math.PI / 180); return `<text x="${x}" y="${y + 8}" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="#ede4e0" letter-spacing="3">${text}</text>`; };
  const rot = ui.modal.result ? 360 * 6 + ui.modal.angle : 0;
  return `<svg viewBox="0 0 260 260">
    ${sector(0, split, '#26304f')}${sector(split, 360, '#4f2636')}
    ${lbl(split / 2, 'ОН')}${lbl(split + (360 - split) / 2, 'ОНА')}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c9a46c" stroke-width="1.5"/>
    <g class="needle" style="transform: rotate(${rot}deg); transition: none">
      <path d="M${cx} ${cy - 96} L${cx + 9} ${cy} L${cx - 9} ${cy} Z" fill="#c9a46c"/>
      <circle cx="${cx}" cy="${cy}" r="12" fill="#c9a46c"/><circle cx="${cx}" cy="${cy}" r="5" fill="#0d0a0c"/>
    </g>
  </svg>`;
}

function bodyWheelSvg() {
  const cx = 130, cy = 130, r = 118, n = BODY_MAP.length, step = 360 / n;
  const pt = (a, k = 1) => [cx + r * k * Math.sin(a * Math.PI / 180), cy - r * k * Math.cos(a * Math.PI / 180)];
  const fills = ['#4f2636', '#3a1f33', '#4f2636', '#3a1f33', '#4f2636', '#3a1f33'];
  const sectors = BODY_MAP.map((z, i) => {
    const a = i * step, b = a + step;
    const [x1, y1] = pt(a), [x2, y2] = pt(b), [lx, ly] = pt(a + step / 2, 0.66);
    return `<path d="M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z" fill="${fills[i]}" stroke="#0d0a0c" stroke-width="3"/>
      <text x="${lx}" y="${ly + 5}" text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="#ede4e0">${z.short}</text>`;
  }).join('');
  const rot = ui.modal.angle || 0;
  return `<svg viewBox="0 0 260 260">
    ${sectors}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c9a46c" stroke-width="1.5"/>
    <g class="needle" style="transform: rotate(${rot}deg); transition: none">
      <path d="M${cx} ${cy - 96} L${cx + 9} ${cy} L${cx - 9} ${cy} Z" fill="#c9a46c"/>
      <circle cx="${cx}" cy="${cy}" r="12" fill="#c9a46c"/><circle cx="${cx}" cy="${cy}" r="5" fill="#0d0a0c"/>
    </g>
  </svg>`;
}

function modalView() {
  const m = ui.modal;
  if (!m) return '';
  let body = '';
  switch (m.type) {
    case 'rules':
      body = `<h2>Правила</h2><p class="lead">Игра для двоих взрослых, которые доверяют друг другу. Немного дерзости, немного азарта — и никаких «давай как обычно».</p>
      <ul class="rules">
        <li>Вас двое: <b>ОН</b> и <b>ОНА</b>. Ведущий — <b>верхний</b>, партнёр — <b>нижний</b> и подчиняется полностью.</li>
        <li>Ведущего выбирает <b>стрелка</b> или играете <b>по очереди</b>.</li>
        <li>За ход — <b>1 сценарий, до ${POSES_PER_TURN} поз и 1 действие</b>. Закончил — «Ход сделан».</li>
        <li>Выпала карта: <b>Играем</b>, <b>Потом</b> или <b>Никогда</b> — тогда карта исчезнет, ход уйдёт партнёру на ${FORCED_TURNS} раза и будет <b>красная карточка</b>. Слишком много «Потом» за ход — тоже красная карточка.</li>
        <li><b>★ Любимые карты</b> (в избранном) выпадают чаще.</li>
        <li><b>★ Джокер</b> — карт-бланш: любая карта из списка или своя фантазия.</li>
        <li><b>⇅ Мазо-карта</b>: ведущий сам становится нижним. Отказ — красная карточка.</li>
        <li>Пропустил ход или отказался подчиняться — <b>штраф на выбор ведущего</b>.</li>
        <li>🎁 Вместо своего хода можно <b>подарить</b> партнёру 3–5 ходов или весь вечер: первая карта — джокер, «Потом» без ограничений, без мазо-карт.</li>
        <li>Карту можно прочитать вслух, а можно положить телефон <b>экраном вниз</b> и устроить сюрприз. Проверить — потом, в журнале.</li>
        <li>У каждой карты есть <b>минимальное время</b>: не на отвяжись.</li>
        <li><b>Стоп-слово сильнее любых правил.</b> ${state.stopWord ? `Ваше — <b>«${esc(state.stopWord)}»</b>. ` : 'Задайте его в Настройках. '}Прозвучало — останавливаетесь сразу, без штрафов и вопросов.</li>
      </ul>
      <div class="btns"><button class="btn primary" data-act="rulesOk">${m.first ? 'Нам есть 18. Играем' : 'Понятно'}</button></div>`;
      break;

    case 'spin':
      body = `<h2 style="text-align:center">Кто сегодня главный?</h2>
      <div class="wheel-wrap">${wheelSvg()}</div>
      <div class="wheel-res">${m.result ? `Ведёт <span class="lead-${m.result}">${NAME[m.result]}</span>` : ''}</div>
      <div class="btns">${m.result
        ? `<button class="btn primary" data-act="closeModal">Начинаем</button>`
        : `<button class="btn primary" data-act="spinGo">Крутить</button><button class="btn ghost" data-act="closeModal">Отмена</button>`}</div>`;
      break;

    case 'pending': {
      const c = byId(m.id);
      body = `<h2>Сначала — отложенное</h2><p class="lead">В прошлый раз вы отложили «${esc(cardFor(c, state.leader).title)}». Сыграть сейчас?</p>
      <div class="btns"><button class="btn primary" data-act="pendingYes">Показать карту</button>
      <button class="btn" data-act="pendingNo">Нет, к колоде</button></div>`;
      break;
    }

    case 'never':
      body = `<h2>Никогда?</h2><p class="lead">Карта больше не выпадет. Ход перейдёт к ${state.leader === 'M' ? 'ней' : 'нему'} на ${FORCED_TURNS} раза подряд — и изменить это будет нельзя. А ещё вам могут показать красную карточку.</p>
      <div class="btns"><button class="btn primary" data-act="neverYes">Никогда</button><button class="btn ghost" data-act="closeModal">Передумал(а)</button></div>`;
      break;

    case 'skip':
      body = `<h2>Пропустить ход?</h2><p class="lead">Ход перейдёт к ${state.leader === 'M' ? 'ней' : 'нему'}, а за пропуск положен штраф — его выберет партнёр.</p>
      <div class="btns"><button class="btn primary" data-act="skipYes">Пропустить и принять штраф</button><button class="btn ghost" data-act="closeModal">Остаться</button></div>`;
      break;

    case 'punish': {
      const judge = m.by || other(m.who);
      body = `<div class="redcard"></div><h2 style="text-align:center">Красная карточка</h2>
      <p class="lead" style="text-align:center">${NAME[judge]} решает, как наказать ${m.who === 'M' ? 'его' : 'её'} за ${esc(m.reason)}.</p>
      ${PENALTIES.map((p, i) => (p.lvl || 1) > state.lvlMax ? '' : `<button class="pen" data-act="penalty" data-i="${i}"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></button>`).join('')}
      <button class="pen" data-act="penalty" data-i="rand"><b>Случайное наказание</b><span>Пусть решит колода</span></button>
      <button class="pen" data-act="bodyMap"><b>🎯 Карта наказаний</b><span>Колесо выбирает место на теле — ягодицы, бёдра, ступни, ладони или соски</span></button>
      <div class="sec">Своя прихоть</div>
      <div class="addrow"><input id="ownPenalty" class="field" placeholder="Например: весь вечер без белья"><button class="btn small" data-act="penaltyOwn">Назначить</button></div>
      <div class="btns"><button class="btn ghost" data-act="forgive">Простить…</button></div>`;
      break;
    }

    case 'bodyMap': {
      const last = m.spins.length ? BODY_MAP[m.spins[0]] : null;
      body = `<div class="redcard"></div><h2 style="text-align:center">Карта наказаний</h2>
      <p class="lead" style="text-align:center">Для: ${NAME[m.who]}. Колесо выбирает место, ${NAME[m.by || other(m.who)]} — силу.</p>
      <div class="wheel-wrap">${bodyWheelSvg()}</div>
      ${last ? `<div class="box order" style="text-align:center"><b>${esc(last.zone)}</b>${esc(last.how)}</div>` : ''}
      <div class="btns">${last
        ? `<button class="btn primary" data-act="bodyAccept">Принято</button>
        <button class="btn ghost" data-act="bodyCancel">Отменить наказание</button>`
        : `<button class="btn primary" data-act="bodySpin">Крутить</button>
        <button class="btn ghost" data-act="punishBack">Назад</button>`}
      </div>`;
      break;
    }

    case 'forgive': {
      const degs = { 1: 'пустяк', 2: 'мелочь', 3: 'заметно', 4: 'серьёзно', 5: 'очень серьёзно' };
      body = `<h2 style="text-align:center">Простить?</h2>
      <p class="lead" style="text-align:center">${NAME[m.by || other(m.who)]}, насколько серьёзен проступок? Чем серьёзнее, тем дороже прощение.</p>
      <div class="seg">${[1, 2, 3, 4, 5].map(n => `<button class="${m.deg === n ? 'on' : ''}" data-act="forgiveDeg" data-deg="${n}">${n}</button>`).join('')}</div>
      ${m.deg ? `<p class="lead" style="text-align:center;margin:10px 0 6px">${degs[m.deg]} — цена на выбор:</p>
        ${m.picks.map((t, i) => `<button class="pen" data-act="forgivePick" data-i="${i}"><span style="color:var(--text);font-size:15px;margin:0">${esc(t)}</span></button>`).join('')}
        <button class="textlink" data-act="forgiveMore">Другие варианты</button>` : ''}
      <div class="btns"><button class="btn ghost" data-act="forgiveFree">Простить даром</button><button class="btn ghost" data-act="punishBack">Назад к наказаниям</button></div>`;
      break;
    }

    case 'penaltyShow':
      body = `<div class="redcard"></div><h2 style="text-align:center">${esc(m.title)}</h2>
      <p class="lead" style="text-align:center;color:var(--text);font-size:17px">${esc(m.text)}</p>
      <p class="lead" style="text-align:center">Для: ${NAME[m.who]}</p>
      <div class="btns"><button class="btn primary" data-act="closeModal">Принято</button></div>`;
      break;

    case 'early': {
      const c = byId(state.playing.id);
      body = `<h2>Уже всё?</h2><p class="lead">Прошло ${Math.floor((now() - state.playing.start) / MIN)} мин из минимальных ${duration(c.min)}. Карта рассчитана на большее.</p>
      <div class="btns"><button class="btn primary" data-act="closeModal">Продолжаем</button><button class="btn ghost" data-act="done">Да, закончили</button></div>`;
      break;
    }

    case 'stop':
      body = `<h2>Пауза</h2>${state.stopWord ? `<p class="lead" style="color:var(--text)">Прозвучало «${esc(state.stopWord)}».</p>` : ''}<p class="lead">Стоп-слово — без штрафов и без вопросов. Выдохните, попейте воды, обнимитесь. Если что-то задело — скажите об этом сейчас, а не завтра.</p>
      <div class="btns"><button class="btn primary" data-act="stopGoOn">Всё хорошо, продолжаем</button><button class="btn" data-act="stopEnd">Заканчиваем на сегодня</button></div>`;
      break;

    case 'gift':
      body = `<h2>Подарить ходы</h2><p class="lead">${NAME[state.leader]} отдаёт свой ход без штрафа. ${NAME[other(state.leader)]} ведёт подряд — и получает привилегии: первая же карта — джокер, «Потом» без ограничений, мазо-карты не выпадают.</p>
      <div class="sec">Сколько</div>
      <div class="seg" style="margin-top:0">
        ${[3, 4, 5].map(n => `<button class="${m.n === n ? 'on' : ''}" data-act="giftSet" data-n="${n}">${n}</button>`).join('')}
        <button class="${m.n === 'evening' ? 'on' : ''}" data-act="giftSet" data-n="evening">Весь вечер</button>
      </div>
      <div class="btns"><button class="btn primary" data-act="giftYes">${m.n === 'evening' ? 'Подарить весь вечер' : `Подарить ${turns(m.n)}`}</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;

    case 'endGame':
      body = `<h2>Завершить игру?</h2><p class="lead">Всё, что сейчас идёт, будет отмечено сыгранным. Подаренный вечер тоже закончится.</p>
      <div class="btns"><button class="btn primary" data-act="endGameYes">Завершить</button><button class="btn ghost" data-act="closeModal">Ещё играем</button></div>`;
      break;

    case 'clearLater':
      body = `<h2>Очистить отложенное?</h2><p class="lead">Все карты из «Отложено и в планах» вернутся в обычные колоды. Список покупок не изменится.</p>
      <div class="btns"><button class="btn primary" data-act="clearLaterYes">Очистить</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;

    case 'clearLog':
      body = `<h2>Стереть журнал?</h2><p class="lead">Вся история игр и статистика «кто сколько вёл» исчезнут насовсем. Колода, избранное, арсенал и настройки останутся.</p>
      <div class="btns"><button class="btn primary" data-act="clearLogYes">Стереть</button><button class="btn ghost" data-act="closeModal">Оставить</button></div>`;
      break;

    case 'resetGame':
      body = `<h2>Сбросить игру?</h2><p class="lead">Снимется ведущий, штраф за «Никогда», идущий сценарий и счётчики. Журнал, избранное и арсенал останутся.</p>
      <div class="btns"><button class="btn primary" data-act="resetGameYes">Сбросить</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;
  }
  // правила при первом входе и красную карточку не закрыть мимо кнопок
  const sticky = (m.type === 'rules' && m.first) || m.type === 'punish' || m.type === 'bodyMap' || m.type === 'forgive' || m.spinning;
  return `<div class="overlay" ${sticky ? '' : 'data-act="closeModal" data-self="1"'}><div class="sheet">${body}</div></div>`;
}

// ---------- Таймеры, экран, запуск ----------

function tick() {
  if (ui.locked) return;
  const el = $('#elapsed');
  if (el && state.playing) {
    const passed = now() - state.playing.start;
    el.textContent = clock(passed);
    const arc = $('#ringArc');
    if (arc) {
      const C = 2 * Math.PI * 100;
      const k = Math.min(1, passed / (byId(state.playing.id).min * MIN));
      arc.setAttribute('stroke-dashoffset', String(C * (1 - k)));
      arc.setAttribute('stroke', k >= 1 ? '#6fae8a' : '#a8233b');
    }
  }
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = clock(now() - +el.dataset.since); });
  document.querySelectorAll('[data-left]').forEach(el => {
    const left = GAME_MS - (now() - +el.dataset.left);
    if (left <= 0) render(); else el.textContent = clock(left);
  });
}

// Не даём экрану погаснуть, пока карта в игре
let wake = null;
async function wakeLock() {
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function releaseWake() { try { wake && wake.release(); } catch (e) {} wake = null; }

document.addEventListener('input', e => {
  if (e.target.id === 'deckSearch') { ui.deckQuery = e.target.value; $('#deckList').innerHTML = deckListHtml(); }
  if (e.target.id === 'jokerSearch') { ui.deckQuery = e.target.value; const box = document.createElement('div'); box.innerHTML = jokerDeckView(); $('#jokerList').replaceWith(box.querySelector('#jokerList')); }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.self && e.target !== el) return;   // клик внутри окна, а не по фону
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (fn(el.dataset) !== 'norender') render();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.pin) { ui.locked = true; ui.pinEntry = ''; ui.peek = null; render(); }
  if (!document.hidden && state.playing) wakeLock();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    // приложение с экрана «Домой» живёт долго и само не перезагружается:
    // при каждом возвращении проверяем, нет ли новой версии
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
  // новая версия встала — перезагрузиться, пока не идёт игра; иначе — при выходе на главную
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }   // первая установка — не перезагружаем
    if (!CARDS.length || (ui.screen === 'dash' && !ui.modal)) location.reload();
    else ui.reloadPending = true;
  });
}

// ---------- Колода ----------

const fromB64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function deriveKey(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(DECK.salt), iterations: DECK.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

async function decryptWith(key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(DECK.iv) }, key, fromB64(DECK.data));
  const deck = new Function(new TextDecoder().decode(plain) +
    '\nreturn { TOYS, PENALTIES, CARDS, FORGIVE: typeof FORGIVE === "undefined" ? {} : FORGIVE };')();
  ({ TOYS, PENALTIES, CARDS, FORGIVE } = deck);
  CARDS = CARDS.concat(state.customCards || []);   // свои карты пары — в общую колоду
  cleanState();
}

// Карты, которых больше нет в колоде (удалили), — убрать из отложенного, избранного и текущей игры
function cleanState() {
  const has = id => !!byId(id);
  state.later = state.later.filter(x => has(x.id));
  for (const k of ['fav', 'never']) for (const id of Object.keys(state[k] || {})) if (!has(id)) delete state[k][id];
  for (const k of ['scenario', 'playing', 'drawn']) if (state[k] && !has(state[k].id)) state[k] = null;
  save();
}

// Пароль -> ключ; ключ запоминаем на телефоне, чтобы не спрашивать снова
async function openDeck(pw) {
  try {
    const key = await deriveKey(pw);
    await decryptWith(key);
    try { localStorage.setItem(KEY_STORE, toB64(await crypto.subtle.exportKey('raw', key))); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

async function openSavedDeck() {
  try {
    const raw = localStorage.getItem(KEY_STORE);
    if (!raw) return;
    const key = await crypto.subtle.importKey('raw', fromB64(raw), 'AES-GCM', false, ['decrypt']);
    await decryptWith(key);
  } catch (e) {
    try { localStorage.removeItem(KEY_STORE); } catch (e2) {}   // пароль сменили — спросим заново
  }
}

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (actions[form.dataset.form]() !== 'norender') render();
});

openSavedDeck().then(() => {
  render();
  setInterval(tick, 1000);
});
