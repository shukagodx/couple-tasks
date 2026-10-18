'use strict';

/* ---------- helpers ---------- */

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const isoDow = (d) => ((d.getDay() + 6) % 7) + 1; // Пн=1 .. Вс=7
const hhmm = (t) => (t ? t.slice(0, 5) : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>',
};
const icon = (name) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = ICONS[name]; return s; };
const brandMark = () => h('span', { class: 'mark' }, h('i', { class: 'a' }), h('i', { class: 'b' }));

/* ---------- setup ---------- */

const sb = supabase.createClient(APP_CONFIG.url, APP_CONFIG.anonKey);
const root = document.getElementById('app');
const screenRoot = document.getElementById('screen-root');
const overlayRoot = document.getElementById('overlay-root');
const lockRoot = document.getElementById('lock-root');

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WINDOW_DAYS = 14;
const LOGIN_DOMAIN = 'couple-tasks.app';
const NICK_RE = /^[a-z0-9._-]{2,30}$/i;
const LOCK_AFTER_MS = 30000;

const state = { me: null, profiles: [], tasks: [], logs: [], tab: 'mine', day: ymd(new Date()), unlocked: false, hiddenAt: 0 };
const photoCache = new Map();

const nameOf = (id) => (state.profiles.find((p) => p.id === id) || {}).name || '—';
const partner = () => state.profiles.find((p) => p.id !== state.me.id);
const personClass = (id) => (state.profiles.map((p) => p.id).sort().indexOf(id) === 0 ? 'a' : 'b');
const avatar = (id, size) => h('span', { class: `av ${personClass(id)} ${size || ''}`, title: nameOf(id) }, (nameOf(id)[0] || '?').toUpperCase());

const loginToEmail = (v) => { v = v.trim().toLowerCase(); return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`; };
const emailToLogin = (e) => (e && e.endsWith('@' + LOGIN_DOMAIN) ? e.slice(0, -(LOGIN_DOMAIN.length + 1)) : e || '');

function dayTitle(ds) {
  const today = ymd(new Date());
  if (ds === today) return 'Сегодня';
  if (ds === ymd(addDays(new Date(), 1))) return 'Завтра';
  return cap(parseYmd(ds).toLocaleDateString('ru-RU', { weekday: 'long' }));
}
const fullDate = (ds) => parseYmd(ds).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const daysLabel = (days) => (days.length === 7 ? 'каждый день' : days.slice().sort().map((n) => DOW[n - 1]).join(' '));

function authError(err) {
  const m = (err && err.message) || '';
  if (/invalid login/i.test(m)) return 'Неверный ник или пароль';
  if (/already registered|already been registered/i.test(m)) return 'Этот ник уже занят';
  if (/at least/i.test(m)) return 'Пароль: минимум 6 символов';
  if (/rate limit/i.test(m)) return 'Слишком много попыток, подожди минуту';
  if (/signups? (are )?disabled|not allowed/i.test(m)) return 'Регистрация закрыта';
  return m || 'Ошибка';
}

/* ---------- screens (full-screen layer with back button) ---------- */

let screenOpen = false;
function openScreen(el) {
  screenRoot.replaceChildren(el);
  if (!screenOpen) { history.pushState({ screen: 1 }, ''); screenOpen = true; }
}
function clearScreen() { screenRoot.replaceChildren(); screenOpen = false; }
function closeScreen() { if (screenOpen) history.back(); }
window.addEventListener('popstate', clearScreen);

function frame({ right, body, foot }) {
  return h('div', { class: 'screen' },
    h('div', { class: 'screen-bar' },
      h('button', { class: 'back', onclick: closeScreen, 'aria-label': 'Назад' }, icon('back'), 'Назад'),
      right || null),
    h('div', { class: 'screen-body' }, h('div', { class: 'in' }, body)),
    foot ? h('div', { class: 'screen-foot' }, h('div', { class: 'in' }, foot)) : null);
}

/* ---------- data ---------- */

async function loadAll() {
  const [p, t, l] = await Promise.all([
    sb.from('profiles').select('*'),
    sb.from('tasks').select('*').order('due_date').order('due_time', { nullsFirst: false }),
    sb.from('task_logs').select('*'),
  ]);
  state.profiles = p.data || [];
  state.tasks = t.data || [];
  state.logs = l.data || [];
}

function buildItems() {
  const mine = state.tab === 'mine';
  const items = [];
  for (const task of state.tasks) {
    if (mine ? task.assigned_to !== state.me.id : task.created_by !== state.me.id) continue;
    const dates = [];
    if (!task.days.length) {
      dates.push(task.due_date);
    } else {
      for (let i = 0; i < WINDOW_DAYS; i++) {
        const d = addDays(new Date(), i);
        if (ymd(d) >= task.due_date && task.days.includes(isoDow(d))) dates.push(ymd(d));
      }
    }
    for (const date of dates) {
      items.push({ task, date, log: state.logs.find((l) => l.task_id === task.id && l.date === date) });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.task.due_time || '99').localeCompare(b.task.due_time || '99'));
  return items;
}

/* ---------- auth ---------- */

function renderAuth(mode = 'login', msg = '') {
  lockRoot.replaceChildren();
  clearScreen();
  const signup = mode === 'signup';
  const nick = h('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Ник латиницей', enterkeyhint: 'next' });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: signup ? 'new-password' : 'current-password', placeholder: 'Пароль', enterkeyhint: 'go' });
  const peek = h('button', {
    type: 'button', class: 'peek',
    onclick: () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.textContent = show ? 'Скрыть' : 'Показать'; },
  }, 'Показать');
  const err = h('div', { class: 'err', role: 'alert' }, msg);
  const submit = h('button', { type: 'submit', class: 'btn primary' }, signup ? 'Создать аккаунт' : 'Войти');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const login = nick.value.trim();
      if (!login || !pass.value) { err.textContent = 'Введи ник и пароль'; return; }
      if (!login.includes('@') && !NICK_RE.test(login)) { err.textContent = 'Ник: латиница, цифры, точка, дефис или _'; return; }
      submit.disabled = true;
      const creds = { email: loginToEmail(login), password: pass.value };
      const { error } = signup ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
      submit.disabled = false;
      if (error) { err.textContent = authError(error); return; }
      state.unlocked = true;
      boot();
    },
  },
    h('div', { class: 'field' }, nick),
    h('div', { class: 'field' }, pass, peek),
    submit,
    err);

  root.replaceChildren(h('div', { class: 'auth' },
    brandMark(),
    h('h1', {}, 'Задания'),
    h('p', { class: 'lead' }, signup ? 'Придумай ник и пароль' : 'Для двоих'),
    form,
    h('button', { class: 'link', onclick: () => renderAuth(signup ? 'login' : 'signup') }, signup ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать')));
}

function askName() {
  const input = h('input', { type: 'text', name: 'name', autocomplete: 'off', placeholder: 'Твоё имя', value: cap(emailToLogin(state.me.email).split('@')[0]) });
  const err = h('div', { class: 'err' });
  root.replaceChildren(h('div', { class: 'auth' },
    brandMark(),
    h('h1', {}, 'Как тебя зовут?'),
    h('p', { class: 'lead' }, 'Имя увидит вторая половинка'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const { error } = await sb.from('profiles').insert({ id: state.me.id, name });
        if (error) { err.textContent = error.message; return; }
        boot();
      },
    }, h('div', { class: 'field' }, input), h('button', { type: 'submit', class: 'btn primary' }, 'Продолжить'), err)));
}

/* ---------- Face ID lock (WebAuthn, на этом устройстве) ---------- */

const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
const lockSupported = () => !!(window.PublicKeyCredential && navigator.credentials);
const lockKey = () => 'lockCred:' + state.me.id;
const lockEnabled = () => { try { return !!localStorage.getItem(lockKey()); } catch (_) { return false; } };

async function enableLock() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Задания', id: location.hostname },
      user: { id: new TextEncoder().encode(state.me.id), name: emailToLogin(state.me.email), displayName: nameOf(state.me.id) },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  localStorage.setItem(lockKey(), b64u.enc(cred.rawId));
}

async function verifyLock() {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: b64u.dec(localStorage.getItem(lockKey())) }],
      userVerification: 'required',
      rpId: location.hostname,
      timeout: 60000,
    },
  });
}

function showLock() {
  state.unlocked = false;
  const msg = h('div', { class: 'err' });
  const attempt = async (manual) => {
    try {
      await verifyLock();
      state.unlocked = true;
      lockRoot.replaceChildren();
    } catch (_) {
      if (manual) msg.textContent = 'Не получилось подтвердить. Попробуй ещё раз.';
    }
  };
  lockRoot.replaceChildren(h('div', { class: 'lock' },
    brandMark(),
    h('h1', {}, 'Задания'),
    h('p', { class: 'lead' }, 'Подтверди вход с Face ID'),
    h('button', { class: 'btn primary', onclick: () => attempt(true) }, 'Разблокировать'),
    h('button', { class: 'link', onclick: async () => { lockRoot.replaceChildren(); await sb.auth.signOut(); boot(); } }, 'Войти с паролем'),
    msg));
  attempt(false);
}

/* ---------- push ---------- */

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushOn = () => pushSupported() && Notification.permission === 'granted';

function urlB64ToUint8(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function syncPush(askPermission) {
  if (!pushSupported()) return;
  if (Notification.permission !== 'granted') {
    if (!askPermission) return;
    if ((await Notification.requestPermission()) !== 'granted') return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(APP_CONFIG.vapidPublicKey) }));
  const j = sub.toJSON();
  await sb.from('push_subscriptions').upsert(
    { user_id: state.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: 'endpoint' }
  );
}

function pushNotice() {
  if (pushOn()) return null;
  if (pushSupported()) {
    return h('div', { class: 'notice' }, 'Включи уведомления, чтобы не пропустить задание',
      h('button', { onclick: async () => { try { await syncPush(true); } catch (_) {} render(); } }, 'Включить'));
  }
  return h('div', { class: 'notice' }, 'Для уведомлений: Поделиться → «На экран Домой», затем открой приложение с иконки.');
}

/* ---------- menu ---------- */

function openMenu() {
  const close = () => overlayRoot.replaceChildren();
  const build = () => {
    const rows = [];
    if (lockSupported()) {
      rows.push(h('div', { class: 'menu-row' },
        h('div', {}, 'Вход по Face ID', h('small', {}, lockEnabled() ? 'Включён на этом телефоне' : 'Спрашивать при открытии')),
        h('button', {
          onclick: async () => {
            if (lockEnabled()) { localStorage.removeItem(lockKey()); }
            else {
              try { await enableLock(); state.unlocked = true; }
              catch (_) { alert('Не удалось включить Face ID на этом устройстве'); }
            }
            build();
          },
        }, lockEnabled() ? 'Выключить' : 'Включить')));
    }
    rows.push(h('div', { class: 'menu-row' },
      h('div', {}, 'Уведомления', h('small', {}, pushOn() ? 'Включены' : pushSupported() ? 'Выключены' : 'Нужен экран «Домой»')),
      pushSupported() && !pushOn() ? h('button', { onclick: async () => { try { await syncPush(true); } catch (_) {} build(); render(); } }, 'Включить') : null));
    rows.push(h('div', { class: 'menu-row' },
      h('div', {}, 'Аккаунт'),
      h('button', { class: 'danger', onclick: async () => { close(); await sb.auth.signOut(); state.unlocked = false; boot(); } }, 'Выйти')));
    const sheet = h('div', { class: 'menu' },
      h('div', { class: 'who' }, avatar(state.me.id), h('div', {}, h('b', {}, nameOf(state.me.id)), h('span', { class: 'muted' }, emailToLogin(state.me.email)))),
      rows);
    overlayRoot.replaceChildren(h('div', { class: 'backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, sheet));
  };
  build();
}

/* ---------- main view ---------- */

function render() {
  const today = ymd(new Date());
  if (state.day < today) state.day = today;
  const items = buildItems();
  const p = partner();
  const isToday = state.day === today;

  const dayItems = items.filter((i) => i.date === state.day);
  const over = isToday ? items.filter((i) => i.date < today && !i.log) : [];
  const archive = isToday ? items.filter((i) => i.date < today && i.log).reverse() : [];
  const done = dayItems.filter((i) => i.log && i.log.status === 'done').length;

  const prevStrip = root.querySelector('.strip');
  const stripScroll = prevStrip ? prevStrip.scrollLeft : 0;
  const pageY = window.scrollY;

  const days = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const ds = ymd(addDays(new Date(), i));
    const its = items.filter((x) => x.date === ds);
    const open = its.some((x) => !x.log);
    const d = parseYmd(ds);
    days.push(h('button', {
      class: 'day' + (ds === state.day ? ' on' : '') + (ds === today ? ' today' : ''),
      onclick: () => { state.day = ds; render(); },
    },
      h('span', { class: 'wd' }, DOW[isoDow(d) - 1]),
      h('span', { class: 'num' }, d.getDate()),
      h('span', { class: 'dot-ind ' + (its.length ? (open ? 'todo' : 'finished') : '') })));
  }

  const rows = [];
  if (!p) {
    rows.push(h('div', { class: 'empty' }, h('b', {}, 'Ждём вторую половинку'), 'Пусть создаст аккаунт в приложении'));
  } else if (!dayItems.length && !over.length) {
    rows.push(h('div', { class: 'empty' }, brandMark(),
      h('b', {}, 'На этот день заданий нет'),
      state.tab === 'sent' ? 'Нажми «Новое задание», чтобы поставить' : 'Можно отдохнуть'));
  }
  if (over.length) rows.push(h('div', { class: 'group-title over' }, 'Просрочено'), over.map(itemRow));
  if (over.length && dayItems.length) rows.push(h('div', { class: 'group-title' }, 'На сегодня'));
  rows.push(dayItems.map(itemRow));
  if (archive.length) rows.push(h('details', { class: 'archive' }, h('summary', {}, `Архив (${archive.length})`), archive.map(itemRow)));

  const tab = (key, label) => h('button', { class: state.tab === key ? 'on' : '', onclick: () => { state.tab = key; render(); } }, label);

  root.replaceChildren(
    h('div', { class: 'hero' },
      h('div', { class: 'topbar' }, brandMark(),
        h('button', { class: 'avatar-btn', onclick: openMenu, 'aria-label': 'Меню' }, avatar(state.me.id))),
      h('div', { class: 'tabs' }, tab('mine', 'Мне'), tab('sent', p ? `Для ${p.name}` : 'От меня')),
      h('h1', { class: 'daytitle' }, dayTitle(state.day)),
      h('div', { class: 'daydate' }, fullDate(state.day)),
      h('div', { class: 'progress' }, dayItems.map((i) => h('i', { class: i.log ? i.log.status : '' }))),
      h('div', { class: 'progress-note' }, dayItems.length ? `Выполнено ${done} из ${dayItems.length}` : 'Заданий нет'),
      h('div', { class: 'strip' }, days)),
    h('div', { class: 'panel' }, h('div', { class: 'panel-in' }, pushNotice(), rows)),
    p ? h('button', { class: 'fab', onclick: openNewTask }, icon('plus'), 'Новое задание') : null);

  const strip = root.querySelector('.strip');
  if (strip) strip.scrollLeft = stripScroll;
  window.scrollTo(0, pageY);
}

function itemRow(item) {
  const { task, log } = item;
  const mine = state.tab === 'mine';
  const sub = [];
  if (task.days.length) sub.push(daysLabel(task.days));
  if (task.photo_path) sub.push('фото');
  const mark = log ? icon(log.status === 'done' ? 'check' : 'x') : null;
  return h('div', { class: 'item' + (log ? ' finished' : ''), onclick: () => openDetail(item) },
    h('div', { class: 'time' }, hhmm(task.due_time) || ''),
    h('div', { class: 'dot ' + (log ? log.status : '') }, mark),
    h('div', { class: 'main' },
      h('div', { class: 'title' }, task.title),
      sub.length ? h('div', { class: 'sub' }, sub.join(', ')) : null),
    avatar(mine ? task.created_by : task.assigned_to, 'sm'));
}

/* ---------- task details ---------- */

async function openDetail(item) {
  const { task, date } = item;
  const isAssignee = task.assigned_to === state.me.id;
  const isCreator = task.created_by === state.me.id;
  const current = () => state.logs.find((l) => l.task_id === task.id && l.date === date);

  const photoSlot = h('div');
  const commentsBox = h('div');
  const input = h('input', { type: 'text', placeholder: 'Написать комментарий', enterkeyhint: 'send' });
  let screenEl;

  const setStatus = (status) => {
    const existing = current();
    const toggledOff = !!existing && existing.status === status;
    if (toggledOff) state.logs = state.logs.filter((l) => l !== existing);
    else if (existing) existing.status = status;
    else state.logs.push({ id: 'tmp-' + Date.now(), task_id: task.id, date, status, by: state.me.id });
    render();
    if (!toggledOff) {
      screenEl.append(h('div', { class: 'pop' }, h('div', { class: 'ball ' + status }, icon(status === 'done' ? 'check' : 'x'))));
    }
    setTimeout(closeScreen, toggledOff ? 80 : 650);
    const req = toggledOff
      ? sb.from('task_logs').delete().eq('task_id', task.id).eq('date', date)
      : sb.from('task_logs').upsert({ task_id: task.id, date, status, by: state.me.id }, { onConflict: 'task_id,date' });
    req.then(({ error }) => {
      if (error) alert('Не удалось сохранить: ' + error.message);
      return loadAll().then(render);
    });
  };

  const st = current();
  const foot = isAssignee
    ? h('div', { class: 'row' },
        h('button', { class: 'btn ok' + (st && st.status === 'done' ? ' on' : ''), onclick: () => setStatus('done') }, icon('check'), 'Выполнено'),
        h('button', { class: 'btn bad' + (st && st.status === 'failed' ? ' on' : ''), onclick: () => setStatus('failed') }, icon('x'), 'Не выполнено'))
    : st ? h('div', { class: 'chips-row' }, h('span', { class: 'chip' }, st.status === 'done' ? 'Выполнено' : 'Не выполнено')) : null;

  async function loadComments() {
    const { data } = await sb.from('comments').select('*').eq('task_id', task.id).order('created_at');
    commentsBox.replaceChildren(...(data || []).map((c) =>
      h('div', { class: 'comment' }, avatar(c.author, 'sm'),
        h('div', { class: 'bubble' },
          h('div', { class: 'who' }, `${nameOf(c.author)}, ${new Date(c.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`),
          h('div', { class: 'body' }, c.body)))));
  }

  const sendComment = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    await sb.from('comments').insert({ task_id: task.id, author: state.me.id, body });
    loadComments();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendComment(); });

  const chips = [h('span', { class: 'chip' }, dayTitle(date))];
  if (task.due_time) chips.push(h('span', { class: 'chip' }, hhmm(task.due_time)));
  if (task.days.length) chips.push(h('span', { class: 'chip' }, daysLabel(task.days)));
  chips.push(h('span', { class: 'chip' }, avatar(task.created_by, 'sm'), `от ${nameOf(task.created_by)}`));

  const del = isCreator ? h('button', {
    class: 'text-btn danger',
    onclick: async () => {
      if (!confirm('Удалить задание?')) return;
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      state.logs = state.logs.filter((l) => l.task_id !== task.id);
      render();
      closeScreen();
      if (task.photo_path) sb.storage.from('photos').remove([task.photo_path]);
      sb.from('tasks').delete().eq('id', task.id).then(() => loadAll().then(render));
    },
  }, 'Удалить') : null;

  screenEl = frame({
    right: del,
    body: [
      h('h2', {}, task.title),
      h('div', { class: 'chips-row' }, chips),
      task.note ? h('div', { class: 'note' }, task.note) : null,
      photoSlot,
      h('div', { class: 'sec' }, 'Комментарии'),
      commentsBox,
      h('div', { class: 'send' }, input, h('button', { onclick: sendComment, 'aria-label': 'Отправить' }, '↑')),
    ],
    foot,
  });
  openScreen(screenEl);
  loadComments();

  if (task.photo_path) {
    let url = photoCache.get(task.photo_path);
    if (!url) {
      const { data } = await sb.storage.from('photos').createSignedUrl(task.photo_path, 3600);
      url = data && data.signedUrl;
      if (url) photoCache.set(task.photo_path, url);
    }
    if (url) photoSlot.replaceChildren(h('img', { class: 'photo', src: url, alt: 'Фото к заданию' }));
  }
}

/* ---------- new task ---------- */

function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('compress failed'))), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = url;
  });
}

function openNewTask() {
  const p = partner();
  const form = { recurring: false, days: new Set(), blob: null };

  const title = h('input', { type: 'text', class: 'big', placeholder: 'Что нужно сделать?', enterkeyhint: 'next' });
  const note = h('textarea', { placeholder: 'Подробности, если нужно' });
  const date = h('input', { type: 'date', value: state.day });
  const time = h('input', { type: 'time' });
  const err = h('div', { class: 'err', role: 'alert' });
  const dateLabel = h('label', {}, 'Дата');
  const daysField = h('div', { class: 'field', style: 'display:none' }, h('label', {}, 'Дни недели'));
  daysField.append(h('div', { class: 'chips' }, DOW.map((name, i) =>
    h('button', {
      type: 'button',
      onclick: (e) => {
        const n = i + 1;
        form.days.has(n) ? form.days.delete(n) : form.days.add(n);
        e.currentTarget.classList.toggle('on', form.days.has(n));
      },
    }, name))));

  const once = h('button', { class: 'on', type: 'button' }, 'Один раз');
  const weekly = h('button', { type: 'button' }, 'По дням недели');
  const setMode = (rec) => {
    form.recurring = rec;
    once.classList.toggle('on', !rec);
    weekly.classList.toggle('on', rec);
    daysField.style.display = rec ? '' : 'none';
    dateLabel.textContent = rec ? 'Начиная с' : 'Дата';
  };
  once.onclick = () => setMode(false);
  weekly.onclick = () => setMode(true);

  const preview = h('div');
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      form.blob = await compressImage(f);
      preview.replaceChildren(h('img', { class: 'preview', src: URL.createObjectURL(form.blob), alt: '' }));
    } catch (_) {
      err.textContent = 'Не удалось прочитать фото';
    }
  });

  const save = h('button', { class: 'btn primary' }, 'Поставить задание');
  save.onclick = async () => {
    err.textContent = '';
    if (!title.value.trim()) { err.textContent = 'Напиши, что нужно сделать'; return; }
    if (!date.value) { err.textContent = 'Выбери дату'; return; }
    if (form.recurring && !form.days.size) { err.textContent = 'Выбери хотя бы один день недели'; return; }
    save.disabled = true;
    save.textContent = 'Сохраняю…';
    try {
      let photo_path = null;
      if (form.blob) {
        photo_path = `${state.me.id}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from('photos').upload(photo_path, form.blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const { error } = await sb.from('tasks').insert({
        created_by: state.me.id,
        assigned_to: p.id,
        title: title.value.trim(),
        note: note.value.trim() || null,
        photo_path,
        due_date: date.value,
        due_time: time.value || null,
        days: form.recurring ? [...form.days].sort() : [],
      });
      if (error) throw error;
      state.tab = 'sent';
      state.day = !form.recurring && date.value >= ymd(new Date()) ? date.value : ymd(new Date());
      closeScreen();
      await loadAll();
      render();
    } catch (e) {
      err.textContent = e.message || 'Ошибка';
      save.disabled = false;
      save.textContent = 'Поставить задание';
    }
  };

  openScreen(frame({
    body: [
      h('h2', {}, `Задание для ${p.name}`),
      h('div', { class: 'field' }, title),
      h('div', { class: 'field' }, note),
      h('div', { class: 'field' }, h('div', { class: 'seg' }, once, weekly)),
      daysField,
      h('div', { class: 'row field' }, h('div', {}, dateLabel, date), h('div', {}, h('label', {}, 'Время'), time)),
      h('div', { class: 'field' }, h('label', { class: 'filebtn' }, icon('img'), 'Прикрепить фото или скриншот', file), preview),
      err,
    ],
    foot: save,
  }));
}

/* ---------- boot ---------- */

let reloadTimer;
let channel;
function subscribe() {
  if (channel) return;
  channel = sb.channel('all-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (!state.me) return;
        await loadAll();
        render();
      }, 300);
    })
    .subscribe();
}

async function boot() {
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) {
    state.me = null;
    if (channel) { sb.removeChannel(channel); channel = null; }
    return renderAuth();
  }
  state.me = session.user;
  if (lockEnabled() && !state.unlocked) showLock();
  await loadAll();
  if (!state.profiles.some((p) => p.id === state.me.id)) return askName();
  render();
  subscribe();
  syncPush(false).catch(() => {});
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') { state.hiddenAt = Date.now(); return; }
  if (!state.me) return;
  if (lockEnabled() && state.hiddenAt && Date.now() - state.hiddenAt > LOCK_AFTER_MS) showLock();
  await loadAll();
  render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
