// Джуманджи — игра для двоих. Всё хранится на телефоне (localStorage).

const STORE_KEY = 'jumanji.v1';
const KEY_STORE = 'jumanji.key';  // ключ к колоде после первого ввода пароля
const MIN = 60 * 1000;
const GAME_MS = 3 * 60 * MIN;     // сценарий и игра живут 3 часа
const MAX_PER_GAME = 4;            // поз и действий за игру
const FORCED_TURNS = 3;            // после «Никогда» ход у партнёра столько раз
const HE_CHANCE = 0.5;             // доля «ОН» в стрелке
const FAV_WEIGHT = 3;
const NEW_TOY_WEIGHT = 12;         // только что купленная игрушка выпадает почти сразу

// Колода приходит зашифрованной (deck.js) и заполняется после ввода пароля
let TOYS = [], PENALTIES = [], CARDS = [];

const NAME = { M: 'ОН', F: 'ОНА' };
const TYPE = {
  scenario: { one: 'Сценарий', many: 'Сценарии', sym: '✦', desc: 'Один на 3 часа' },
  pose: { one: 'Поза', many: 'Позы', sym: '❦', desc: `До ${MAX_PER_GAME} за игру` },
  action: { one: 'Действие', many: 'Действия', sym: '✧', desc: `До ${MAX_PER_GAME} за игру` },
};
const RESULT = {
  play: 'начали', plan: 'в планы', later: 'потом', never: 'никогда', skip: 'пропуск хода',
  punish: 'штраф', gift: 'подарок', refuse: 'отказ', stop: 'стоп-слово', done: 'сыграли',
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

let state = load();

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
const byId = id => CARDS.find(c => c.id === id);

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
  if (state.game && t - state.game.start > GAME_MS) { state.game = null; ui.skipLater = {}; changed = true; }
  if (changed) save();
}

function ensureGame() {
  if (!state.game) state.game = { start: now(), pose: 0, action: 0 };
}

function used(type) { return state.game ? state.game[type] || 0 : 0; }

function canDraw(type) {
  if (!state.leader) return 'Сначала выберите ведущего';
  if (type === 'scenario' && state.scenario) return 'Сценарий уже идёт — переиграть нельзя';
  if (type !== 'scenario' && state.when === 'now' && used(type) >= MAX_PER_GAME) return `${TYPE[type].many} на эту игру закончились`;
  return '';
}

function fits(card, L) {
  if (state.never[card.id]) return false;
  if ((card.lvl || 1) > state.lvlMax) return false;
  if (card.leaders && !card.leaders.includes(topFor(card, L))) return false;
  if (state.when === 'now') {
    if (card.when === 'next') return false;
    if (missingNeeds(card).length) return false;
  }
  return true;
}

function pickRandom(type) {
  const L = state.leader;
  const laterIds = new Set(state.later.map(x => x.id));
  const pool = CARDS.filter(c => c.type === type && fits(c, L) && !laterIds.has(c.id));
  if (!pool.length) return null;
  const t = now();
  const weights = pool.map(c => {
    let w = state.fav[c.id] ? FAV_WEIGHT : 1;
    if (state.newToy && usesToy(c, state.newToy)) w *= NEW_TOY_WEIGHT;   // новинка — первой
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
function endTurn() {
  state.turnPlays = 0;
  if (state.forced) {
    state.forced.left--;
    if (state.forced.left > 0) { state.leader = state.forced.who; return; }
    state.forced = null;
  }
  if (state.pickMode === 'turns' && state.leader) state.leader = other(state.leader);
  else state.leader = null;
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

function removeLater(id) { state.later = state.later.filter(x => x.id !== id); }

// ---------- Действия ----------

const actions = {
  // правила
  rules() { ui.modal = { type: 'rules' }; },
  rulesOk() { state.seenRules = true; save(); ui.modal = null; },

  // ведущий
  pickLeader(d) {
    if (state.forced) return toast(`Ход у ${state.forced.who === 'M' ? 'него' : 'неё'}: ${fixedWhy(state.forced)}`);
    state.leader = d.l; save();
  },
  pickMode(d) { state.pickMode = d.m; save(); },
  when(d) { state.when = d.w; save(); },
  spin() {
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
    if (state.drawn) { ui.screen = 'card'; window.scrollTo(0, 0); return; }   // сначала решение по вытянутой
    const why = canDraw(d.t);
    if (why) return toast(why);
    if (state.when === 'now' && !ui.skipLater[d.t]) {
      const p = pendingFor(d.t);
      if (p.length) { ui.modal = { type: 'pending', t: d.t, id: p[0].id }; return; }
    }
    const card = pickRandom(d.t);
    if (!card) return toast('Подходящих карт нет — загляните в арсенал или остроту');
    state.seen[card.id] = now(); save();
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
    log(card.id, 'play', Object.assign({ L: top }, jokerWish()));
    if (state.newToy && usesToy(card, state.newToy)) state.newToy = null;   // новинку обыграли
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
    save();
    ui.screen = 'dash'; state.drawn = null; save();
    toast('Отложено — в следующий раз предложим первой');
  },
  never() { ui.modal = { type: 'never' }; },
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
    state.forced = { who: other(L), left: FORCED_TURNS };
    state.leader = other(L);
    state.turnPlays = 0;
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
    if (state.forced) return toast(`Сейчас пропустить нельзя: ${fixedWhy(state.forced)}`);
    ui.modal = { type: 'skip' };
  },
  skipYes() {
    const L = state.leader;
    log(state.drawn ? state.drawn.id : null, 'skip');
    state.leader = other(L);
    state.turnPlays = 0;
    save();
    ui.screen = 'dash'; state.drawn = null; save();
    ui.modal = { type: 'punish', who: L, reason: 'пропуск хода' };
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
    state.playing = null; state.game = null;
    save();
    ui.modal = null; ui.screen = 'dash';
    releaseWake();
  },

  // штрафы
  penalty(d) {
    const m = ui.modal;
    const i = d.i === 'rand' ? Math.floor(Math.random() * PENALTIES.length) : +d.i;
    const p = PENALTIES[i];
    state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `${p.title} — ${m.reason}` });
    save();
    ui.modal = { type: 'penaltyShow', who: m.who, title: p.title, text: p.text };
  },
  penaltyOwn() {
    const text = $('#ownPenalty').value.trim();
    if (!text) return toast('Напишите, чего хотите');
    const m = ui.modal;
    state.log.push({ ts: now(), id: null, L: m.who, r: 'punish', note: `Прихоть: ${text} — ${m.reason}` });
    save();
    ui.modal = { type: 'penaltyShow', who: m.who, title: 'Прихоть', text };
  },
  forgive() { ui.modal = null; },
  closeModal() { ui.modal = null; },

  // сценарий на дашборде
  viewScenario() { ui.peek = state.scenario.id; },
  endGame() { ui.modal = { type: 'endGame' }; },
  endGameYes() {
    state.game = null; state.turnPlays = 0; ui.skipLater = {};
    if (state.pickMode === 'random' && !state.forced) state.leader = null;
    save(); ui.modal = null;
    toast('Игра завершена. Сценарий держится до конца трёх часов');
  },

  // навигация
  go(d) { ui.back = ui.screen; ui.screen = d.s; window.scrollTo(0, 0); },
  openDrawn() { ui.screen = 'card'; window.scrollTo(0, 0); },
  openPlaying() { ui.screen = 'playing'; window.scrollTo(0, 0); },
  home() { ui.screen = 'dash'; window.scrollTo(0, 0); },
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
  setPin() {
    const v = $('#newPin').value.trim();
    if (!/^\d{4}$/.test(v)) return toast('Нужно 4 цифры');
    state.pin = v; save(); toast('Код установлен');
  },
  delPin() { state.pin = ''; save(); toast('Код снят'); },
  resetGame() { ui.modal = { type: 'resetGame' }; },
  resetGameYes() {
    Object.assign(state, { leader: null, forced: null, game: null, scenario: null, playing: null, drawn: null, turnPlays: 0 });
    ui.skipLater = {};
    save(); ui.modal = null; toast('Текущая игра сброшена');
  },

  // подарок ходов
  // ведущий сам отдаёт ход партнёру — без штрафа, сразу на несколько ходов подряд
  gift() {
    if (state.forced) return toast(`Сейчас ведущий закреплён: ${fixedWhy(state.forced)}`);
    ui.modal = { type: 'gift', n: 3 };
  },
  giftSet(d) { ui.modal.n = +d.n; },
  giftYes() {
    const to = other(state.leader);
    const n = ui.modal.n;
    state.forced = { who: to, left: n, gift: true };
    state.leader = to;
    state.turnPlays = 0;
    state.log.push({ ts: now(), id: null, L: to, r: 'gift', note: `${turns(n)} в подарок` });
    save();
    ui.modal = null;
    toast(`🎁 ${NAME[to]} ведёт следующие ${turns(n)}`);
  },
  turnDone() {
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
    // пробелы по краям — частая опечатка на телефоне; в самом пароле их нет
    const pw = ui.deckPwValue.trim();
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
  const player = l => `<button class="player ${l} ${L === l ? 'on' : ''}" data-act="pickLeader" data-l="${l}" ${f && f.who !== l ? 'disabled' : ''}>
      <div class="nm">${NAME[l]}</div>
      <div class="st">${L === l ? 'ведёт' : 'подчиняется'}</div>
    </button>`;

  let h = topBar();
  h += `<div class="players">${player('M')}${player('F')}</div>`;
  h += `<div class="who-row">
      <button class="btn gold" data-act="spin" ${f ? 'disabled' : ''}>➶ Кто сегодня главный?</button>
    </div>`;
  h += `<div class="seg">
      <button class="${state.pickMode === 'random' ? 'on' : ''}" data-act="pickMode" data-m="random">Стрелка</button>
      <button class="${state.pickMode === 'turns' ? 'on' : ''}" data-act="pickMode" data-m="turns">По очереди</button>
    </div>`;
  if (state.newToy) h += `<div class="note gift">✨ Новинка в арсенале: ${esc(toyName(state.newToy))}. Ближайшие карты будут с ней.
      <button class="textlink" style="padding:4px 0 0;display:block" data-act="dropNewToy">Не начинать с неё</button></div>`;
  if (f && f.gift) h += `<div class="note gift">🎁 Ходы в подарок: ведёт ${NAME[f.who]} — ещё ${turns(f.left)}.
      <button class="textlink" style="padding:4px 0 0;display:block" data-act="giftEnd">Закончить подарок раньше</button></div>`;
  else if (f) h += `<div class="note">Штраф за «Никогда»: ведёт ${NAME[f.who]} — ещё ${turns(f.left)}.</div>`;

  h += `<div class="seg">
      <button class="${state.when === 'now' ? 'on' : ''}" data-act="when" data-w="now">Играем сейчас</button>
      <button class="${state.when === 'next' ? 'on' : ''}" data-act="when" data-w="next">На следующий раз</button>
    </div>`;

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
  h += deckBtn('pose', state.when === 'now' ? `${used('pose')} / ${MAX_PER_GAME}` : '') + playedChips('pose');
  h += deckBtn('action', state.when === 'now' ? `${used('action')} / ${MAX_PER_GAME}` : '') + playedChips('action');
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
    const played = state.log.filter(e => e.ts >= state.game.start && e.r === 'play');
    h += `<div class="sec">В этой игре</div>`;
    h += played.length
      ? `<ul class="list">${played.map(e => {
        const c = byId(e.id);
        return `<li data-act="viewPlayed" data-id="${c.id}" data-l="${e.L}"><span>${TYPE[c.type].sym}</span><span class="grow">${esc(cardFor(c, e.L).title)}</span><span class="meta">${NAME[e.L]} · ${hm(e.ts)} ›</span></li>`;
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
function playedChips(type) {
  const list = playedOf(type);
  if (!list.length) return '';
  return `<div class="links played">${list.map(e => {
    const c = byId(e.id);
    return `<button class="chip have" data-act="viewPlayed" data-id="${c.id}" data-l="${e.L}">${TYPE[type].sym} ${esc(cardFor(c, e.L).title)}</button>`;
  }).join('')}</div>`;
}

// Что будет после «Ход сделан»
function turnDoneText() {
  const f = state.forced;
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
  if (card.joker) h += `<div class="sec">Моя фантазия</div><textarea id="jokerWish" class="field" rows="3" placeholder="Что именно ты хочешь. Партнёр увидит это в журнале — потом"></textarea>`;
  h += card.switch
    ? `<div class="card-actions">
    <button class="btn primary" data-act="play">Принимаю — я ${L === 'F' ? 'нижняя' : 'нижний'}</button>
    <button class="btn" style="grid-column:1/-1" data-act="refuseSwitch">Отказываюсь — красная карточка</button>
  </div>`
    : `<div class="card-actions">
    <button class="btn primary" data-act="play">Играем</button>
    <button class="btn" data-act="later">Давай потом</button>
    <button class="btn" data-act="never">Никогда</button>
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

  h += `<div class="set-sec"><h2>Острота</h2><p class="lead">Карты острее выбранной не выпадают.</p><div class="seg">
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
  h += list('Избранное', 'Эти карты выпадают в три раза чаще.', Object.keys(state.fav), 'unfav', 'убрать');
  h += list('Отложено и в планах', 'Предлагаются первыми в следующей игре. Убрать можно по одной или все сразу.', state.later.map(x => x.id), 'unlater', 'убрать');
  if (state.later.length) h += `<div class="who-row"><button class="btn ghost small" data-act="clearLater">Очистить всё отложенное</button></div>`;
  h += list('Никогда', 'Эти карты больше не выпадают. Можно вернуть, если передумали.', Object.keys(state.never), 'unnever', 'вернуть');

  h += `<div class="set-sec"><h2>Код на вход</h2><p class="lead">Приложение будет спрашивать 4 цифры при каждом открытии.</p>
    ${state.pin
      ? `<button class="btn small" data-act="delPin">Снять код</button>`
      : `<div class="addrow"><input id="newPin" class="field" type="password" inputmode="numeric" maxlength="4" placeholder="4 цифры"><button class="btn small" data-act="setPin">Установить</button></div>`}
  </div>`;

  const n = t => CARDS.filter(c => c.type === t).length;
  h += `<div class="set-sec"><h2>Игра</h2><p class="lead">В колоде: сценариев ${n('scenario')}, поз ${n('pose')}, действий ${n('action')}.</p>
    <div class="btns" style="display:grid;gap:10px">
      <button class="btn" data-act="rules">Правила</button>
      <button class="btn ghost" data-act="resetGame">Сбросить текущую игру</button>
    </div></div>`;
  return h;
}

// Вся колода: просмотр любой карты в версии для ведущего ОН или ОНА
function deckView() {
  const t = ui.deckType || 'scenario';
  const lead = ui.deckLead || 'M';
  const list = CARDS.filter(c => c.type === t && (!c.leaders || c.leaders.includes(lead)));
  let h = `<button class="back" data-act="home">‹ Назад</button><h1 style="font-size:30px;margin:6px 0 4px">Колода</h1>
    <p class="lead" style="color:var(--muted);margin:0">Всего карт: ${CARDS.length}. Нажмите на карту, чтобы открыть её целиком.</p>
    <div class="seg">${Object.keys(TYPE).map(k => `<button class="${t === k ? 'on' : ''}" data-act="deckType" data-t="${k}">${TYPE[k].many} · ${CARDS.filter(c => c.type === k).length}</button>`).join('')}</div>
    <div class="seg"><button class="${lead === 'M' ? 'on' : ''}" data-act="deckLead" data-l="M">Ведёт ОН</button><button class="${lead === 'F' ? 'on' : ''}" data-act="deckLead" data-l="F">Ведёт ОНА</button></div>
    <ul class="list" style="margin-top:12px">`;
  h += list.map(c => `<li data-act="deckView" data-id="${c.id}">
      <span>${c.joker ? '★' : TYPE[c.type].sym}</span>
      <div class="grow"><div>${esc(cardFor(c, lead).title)}${state.never[c.id] ? ' <span class="res never">никогда</span>' : ''}</div>
        <div class="meta">${esc(c.teaser || '')}</div></div>
      <span class="meta" style="white-space:nowrap">${peppers(c.lvl || 1)} ${duration(c.min, true)}</span>
    </li>`).join('');
  return h + '</ul>';
}

function journalView() {
  let h = `<button class="back" data-act="home">‹ Назад</button><h1 style="font-size:30px;margin:6px 0 4px">Журнал</h1>
    <p class="lead" style="color:var(--muted);margin:0">Здесь можно проверить, что на самом деле выпало ведущему.</p>`;
  if (!state.log.length) return h + `<div class="empty" style="margin-top:20px">Пока пусто</div>`;
  let day = '';
  h += state.log.slice().reverse().map(e => {
    const c = e.id ? byId(e.id) : null;
    const d = dayName(e.ts);
    const head = d !== day ? `${day ? '</ul>' : ''}<div class="day">${d}</div><ul class="list">` : '';
    day = d;
    const title = c ? esc(cardFor(c, e.L || 'M').title) : esc(e.note || '');
    const dur = e.dur ? ` · ${Math.round(e.dur / MIN)} мин` : '';
    return `${head}<li ${c ? `data-act="view" data-id="${c.id}"` : ''}>
      <span>${c ? TYPE[c.type].sym : e.r === 'gift' ? '🎁' : '✕'}</span>
      <div class="grow"><div>${title}</div>${c && e.note ? `<div class="meta">«${esc(e.note)}»</div>` : ''}<div class="meta">${hm(e.ts)} · ${e.r === 'punish' ? 'штраф для' : 'ведёт'} ${NAME[e.L] || '—'}${dur}</div></div>
      <span class="res ${e.r}">${RESULT[e.r] || e.r}</span></li>`;
  }).join('') + '</ul>';
  return h;
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

function modalView() {
  const m = ui.modal;
  if (!m) return '';
  let body = '';
  switch (m.type) {
    case 'rules':
      body = `<h2>Правила</h2><p class="lead">Игра для двоих взрослых, которые доверяют друг другу. Немного дерзости, немного азарта — и никаких «давай как обычно».</p>
      <ul class="rules">
        <li>Вас двое: <b>ОН</b> и <b>ОНА</b>. Один <b>ведёт</b>, второй <b>подчиняется сценарию</b> — полностью.</li>
        <li>Ведущего выбирает <b>стрелка</b> или играете <b>по очереди</b>.</li>
        <li>Три колоды. <b>Сценарий</b> — один на 3 часа, переиграть нельзя. <b>Позы</b> и <b>Действия</b> — до ${MAX_PER_GAME} каждого за игру. Колоды независимы: можно тянуть только действие.</li>
        <li>Выпала карта — решай: <b>Играем</b>, <b>Потом</b> (в следующий раз предложим её первой) или <b>Никогда</b> — карта исчезнет навсегда, ход уйдёт партнёру на ${FORCED_TURNS} раза, а он может показать <b>красную карточку</b>.</li>
        <li>Можно прочитать карту вслух, а можно нажать «Играем», положить телефон <b>экраном вниз</b> и устроить сюрприз. Проверить, что выпало, — потом, в журнале.</li>
        <li>Пропустил ход или отказался подчиняться — <b>штраф</b> на выбор партнёра.</li>
        <li>Ведущий — <b>верхний</b>, партнёр — <b>нижний</b>. Иногда выпадает <b>мазо-карта ⇅</b>: роли меняются, и ведущий сам становится нижним. Отказ — красная карточка.</li>
        <li>Ход — это всё, что ведущий взял в игру: <b>сценарий, позы и действия складываются</b>. Закончил — «Ход сделан».</li>
        <li>🎁 Ведущий может <b>подарить ходы</b> партнёру — без штрафа, на 3–5 ходов подряд.</li>
        <li>У каждой карты есть <b>минимальное время</b>: не на отвяжись. ★ — любимые карты выпадают чаще.</li>
        <li><b>Стоп-слово сильнее любых правил.</b> Прозвучало — останавливаетесь сразу, без штрафов и вопросов.</li>
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
      ${PENALTIES.map((p, i) => `<button class="pen" data-act="penalty" data-i="${i}"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></button>`).join('')}
      <button class="pen" data-act="penalty" data-i="rand"><b>Случайное наказание</b><span>Пусть решит колода</span></button>
      <div class="sec">Своя прихоть</div>
      <div class="addrow"><input id="ownPenalty" class="field" placeholder="Например: весь вечер без белья"><button class="btn small" data-act="penaltyOwn">Назначить</button></div>
      <div class="btns"><button class="btn ghost" data-act="forgive">Простить</button></div>`;
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
      body = `<h2>Пауза</h2><p class="lead">Стоп-слово — без штрафов и без вопросов. Выдохните, попейте воды, обнимитесь. Если что-то задело — скажите об этом сейчас, а не завтра.</p>
      <div class="btns"><button class="btn primary" data-act="stopGoOn">Всё хорошо, продолжаем</button><button class="btn" data-act="stopEnd">Заканчиваем на сегодня</button></div>`;
      break;

    case 'gift':
      body = `<h2>Подарить ходы</h2><p class="lead">${NAME[state.leader]} отдаёт ход без штрафа. ${NAME[other(state.leader)]} ведёт несколько ходов подряд и сам${state.leader === 'M' ? 'а' : ''} тянет карты. Стрелка и очередь на это время отдыхают.</p>
      <div class="sec">Сколько ходов</div>
      <div class="seg" style="margin-top:0">
        ${[3, 4, 5].map(n => `<button class="${m.n === n ? 'on' : ''}" data-act="giftSet" data-n="${n}">${n}</button>`).join('')}
      </div>
      <div class="btns"><button class="btn primary" data-act="giftYes">Подарить ${turns(m.n)}</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;

    case 'endGame':
      body = `<h2>Завершить игру?</h2><p class="lead">Счётчики поз и действий обнулятся. Идущий сценарий останется до конца своих трёх часов.</p>
      <div class="btns"><button class="btn primary" data-act="endGameYes">Завершить</button><button class="btn ghost" data-act="closeModal">Ещё играем</button></div>`;
      break;

    case 'clearLater':
      body = `<h2>Очистить отложенное?</h2><p class="lead">Все карты из «Отложено и в планах» вернутся в обычные колоды. Список покупок не изменится.</p>
      <div class="btns"><button class="btn primary" data-act="clearLaterYes">Очистить</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;

    case 'resetGame':
      body = `<h2>Сбросить игру?</h2><p class="lead">Снимется ведущий, штраф за «Никогда», идущий сценарий и счётчики. Журнал, избранное и арсенал останутся.</p>
      <div class="btns"><button class="btn primary" data-act="resetGameYes">Сбросить</button><button class="btn ghost" data-act="closeModal">Отмена</button></div>`;
      break;
  }
  // правила при первом входе и красную карточку не закрыть мимо кнопок
  const sticky = (m.type === 'rules' && m.first) || m.type === 'punish' || m.spinning;
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
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
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
  const deck = new Function(new TextDecoder().decode(plain) + '\nreturn { TOYS, PENALTIES, CARDS };')();
  ({ TOYS, PENALTIES, CARDS } = deck);
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
