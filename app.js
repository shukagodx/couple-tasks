'use strict';

const sb = supabase.createClient(APP_CONFIG.url, APP_CONFIG.anonKey);
const root = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WINDOW_DAYS = 14;

const state = { me: null, profiles: [], tasks: [], logs: [], tab: 'mine' };

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
  for (const c of kids.flat()) {
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
const nameOf = (id) => (state.profiles.find((p) => p.id === id) || {}).name || '—';
const partner = () => state.profiles.find((p) => p.id !== state.me.id);

function dayLabel(ds) {
  const today = ymd(new Date());
  if (ds === today) return 'Сегодня';
  if (ds === ymd(addDays(new Date(), 1))) return 'Завтра';
  const d = parseYmd(ds);
  return `${DOW[isoDow(d) - 1]}, ${d.getDate()}.${pad(d.getMonth() + 1)}`;
}

function daysLabel(days) {
  if (days.length === 7) return 'каждый день';
  return days.slice().sort().map((n) => DOW[n - 1]).join(' ');
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
  const today = ymd(new Date());
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
        const ds = ymd(d);
        if (ds >= task.due_date && task.days.includes(isoDow(d))) dates.push(ds);
      }
    }
    for (const date of dates) {
      const log = state.logs.find((l) => l.task_id === task.id && l.date === date);
      items.push({ task, date, log });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.task.due_time || '99').localeCompare(b.task.due_time || '99'));
  return { items, today };
}

/* ---------- auth ---------- */

function renderAuth(msg) {
  sheetRoot.replaceChildren();
  const email = h('input', { type: 'email', placeholder: 'Почта', autocomplete: 'email' });
  const pass = h('input', { type: 'password', placeholder: 'Пароль (минимум 6 символов)', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' }, msg || '');
  const go = async (signup) => {
    err.textContent = '';
    const creds = { email: email.value.trim(), password: pass.value };
    const { error } = signup ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
    if (error) { err.textContent = error.message; return; }
    boot();
  };
  root.replaceChildren(
    h('div', { class: 'auth' },
      h('h1', {}, 'Задания'),
      h('div', { class: 'field' }, email),
      h('div', { class: 'field' }, pass),
      h('button', { class: 'btn primary', onclick: () => go(false) }, 'Войти'),
      h('button', { class: 'btn', onclick: () => go(true) }, 'Создать аккаунт'),
      err
    )
  );
}

async function askName() {
  const input = h('input', { type: 'text', placeholder: 'Как тебя зовут?' });
  const err = h('div', { class: 'err' });
  root.replaceChildren(
    h('div', { class: 'auth' },
      h('h1', {}, 'Привет'),
      h('div', { class: 'field' }, input),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const name = input.value.trim();
          if (!name) return;
          const { error } = await sb.from('profiles').insert({ id: state.me.id, name });
          if (error) { err.textContent = error.message; return; }
          boot();
        },
      }, 'Продолжить'),
      err
    )
  );
}

/* ---------- main view ---------- */

function render() {
  const { items, today } = buildItems();
  const over = items.filter((i) => i.date < today && !i.log);
  const upcoming = items.filter((i) => i.date >= today);
  const archive = items.filter((i) => i.date < today && i.log).reverse();

  const groups = [];
  if (over.length) groups.push({ title: 'Просрочено', cls: 'over', list: over });
  const byDate = new Map();
  for (const i of upcoming) {
    if (!byDate.has(i.date)) byDate.set(i.date, []);
    byDate.get(i.date).push(i);
  }
  for (const [date, list] of byDate) groups.push({ title: dayLabel(date), list });

  const p = partner();
  const body = [];
  if (!p) {
    body.push(h('div', { class: 'empty' }, 'Ждём вторую половинку.\nПусть создаст аккаунт в приложении.'));
  } else if (!groups.length && !archive.length) {
    body.push(h('div', { class: 'empty' }, state.tab === 'mine' ? 'Заданий нет' : 'Ты пока ничего не поставил(а)'));
  }
  for (const g of groups) {
    body.push(h('div', { class: 'group ' + (g.cls || '') }, h('h2', {}, g.title), g.list.map(itemRow)));
  }
  if (archive.length) {
    body.push(h('details', { class: 'archive' }, h('summary', {}, `Архив (${archive.length})`), archive.map(itemRow)));
  }

  const tab = (key, label) => h('button', { class: state.tab === key ? 'on' : '', onclick: () => { state.tab = key; render(); } }, label);
  const sentLabel = p ? `Для ${p.name}` : 'От меня';

  root.replaceChildren(
    h('div', { class: 'wrap' },
      h('div', { class: 'top' },
        h('h1', {}, 'Задания'),
        h('button', { class: 'link', onclick: async () => { await sb.auth.signOut(); boot(); } }, `${nameOf(state.me.id)} · выйти`)
      ),
      pushBanner(),
      h('div', { class: 'tabs' }, tab('mine', 'Мне'), tab('sent', sentLabel)),
      body
    ),
    p ? h('button', { class: 'fab', 'aria-label': 'Новое задание', onclick: openNewTask }, '+') : null
  );
}

function itemRow(item) {
  const { task, date, log } = item;
  const bits = [];
  if (task.due_time) bits.push(hhmm(task.due_time));
  if (task.days.length) bits.push(daysLabel(task.days));
  if (task.photo_path) bits.push('фото');
  if (state.tab === 'sent' || task.created_by !== state.me.id) bits.push(state.tab === 'sent' ? `для ${nameOf(task.assigned_to)}` : `от ${nameOf(task.created_by)}`);
  const mark = log ? (log.status === 'done' ? '✓' : '✕') : '';
  return h('div', { class: 'item' + (log ? ' finished' : ''), onclick: () => openDetail(item) },
    h('div', { class: 'dot ' + (log ? log.status : '') }, mark),
    h('div', { class: 'main' },
      h('div', { class: 'title' }, task.title),
      bits.length ? h('div', { class: 'sub' }, bits.join(' · ')) : null
    )
  );
}

/* ---------- sheet ---------- */

function closeSheet() { sheetRoot.replaceChildren(); }

function openSheet(...content) {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) closeSheet(); } },
    h('div', { class: 'sheet' }, content));
  sheetRoot.replaceChildren(overlay);
}

async function signedUrl(path) {
  const { data } = await sb.storage.from('photos').createSignedUrl(path, 3600);
  return data && data.signedUrl;
}

async function openDetail(item) {
  const { task, date } = item;
  const isAssignee = task.assigned_to === state.me.id;
  const isCreator = task.created_by === state.me.id;
  const current = () => state.logs.find((l) => l.task_id === task.id && l.date === date);

  const meta = [dayLabel(date)];
  if (task.due_time) meta.push(hhmm(task.due_time));
  if (task.days.length) meta.push(daysLabel(task.days));
  meta.push(`от ${nameOf(task.created_by)}`);

  const photoSlot = h('div');
  const commentsBox = h('div');
  const input = h('input', { type: 'text', placeholder: 'Комментарий' });

  const setStatus = async (status) => {
    const existing = current();
    if (existing && existing.status === status) {
      await sb.from('task_logs').delete().eq('id', existing.id);
    } else {
      await sb.from('task_logs').upsert({ task_id: task.id, date, status, by: state.me.id }, { onConflict: 'task_id,date' });
    }
    await loadAll();
    render();
    openDetail(item);
  };

  const st = current();
  const statusRow = isAssignee
    ? h('div', { class: 'row' },
        h('button', { class: 'btn ok' + (st && st.status === 'done' ? ' on' : ''), onclick: () => setStatus('done') }, 'Выполнено'),
        h('button', { class: 'btn bad' + (st && st.status === 'failed' ? ' on' : ''), onclick: () => setStatus('failed') }, 'Не выполнено'))
    : st ? h('div', { class: 'meta' }, st.status === 'done' ? '✓ Выполнено' : '✕ Не выполнено') : null;

  const sendComment = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    await sb.from('comments').insert({ task_id: task.id, author: state.me.id, body });
    loadComments();
  };

  async function loadComments() {
    const { data } = await sb.from('comments').select('*').eq('task_id', task.id).order('created_at');
    commentsBox.replaceChildren(...(data || []).map((c) =>
      h('div', { class: 'comment' },
        h('div', { class: 'who' }, `${nameOf(c.author)} · ${new Date(c.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`),
        h('div', { class: 'body' }, c.body))));
  }

  openSheet(
    h('h3', {}, task.title),
    h('div', { class: 'meta' }, meta.join(' · ')),
    task.note ? h('div', { class: 'note' }, task.note) : null,
    photoSlot,
    statusRow,
    h('div', { class: 'sec' }, 'Комментарии'),
    commentsBox,
    h('div', { class: 'send' }, input, h('button', { class: 'btn', onclick: sendComment }, '→')),
    isCreator ? h('button', {
      class: 'btn danger', style: 'width:100%;margin-top:24px',
      onclick: async () => {
        if (!confirm('Удалить задание?')) return;
        if (task.photo_path) await sb.storage.from('photos').remove([task.photo_path]);
        await sb.from('tasks').delete().eq('id', task.id);
        closeSheet();
        await loadAll();
        render();
      },
    }, 'Удалить задание') : null
  );

  loadComments();
  if (task.photo_path) {
    const url = await signedUrl(task.photo_path);
    if (url) photoSlot.replaceChildren(h('img', { class: 'photo', src: url, alt: '' }));
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

  const title = h('input', { type: 'text', placeholder: 'Что нужно сделать?' });
  const note = h('textarea', { placeholder: 'Подробности (необязательно)' });
  const date = h('input', { type: 'date', value: ymd(new Date()) });
  const time = h('input', { type: 'time' });
  const err = h('div', { class: 'err' });
  const dateLabel = h('label', {}, 'Дата');
  const daysField = h('div', { class: 'field', style: 'display:none' }, h('label', {}, 'Дни недели'));
  const chips = h('div', { class: 'chips' }, DOW.map((name, i) =>
    h('button', {
      type: 'button',
      onclick: (e) => {
        const n = i + 1;
        form.days.has(n) ? form.days.delete(n) : form.days.add(n);
        e.currentTarget.classList.toggle('on', form.days.has(n));
      },
    }, name)));
  daysField.append(chips);

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
    } catch (e) {
      err.textContent = 'Не удалось прочитать фото';
    }
  });

  const save = h('button', { class: 'btn primary', style: 'width:100%;margin-top:6px' }, 'Поставить задание');
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
      closeSheet();
      state.tab = 'sent';
      await loadAll();
      render();
    } catch (e) {
      err.textContent = e.message || 'Ошибка';
      save.disabled = false;
      save.textContent = 'Поставить задание';
    }
  };

  openSheet(
    h('h3', {}, `Задание для ${p.name}`),
    h('div', { class: 'meta' }, ''),
    h('div', { class: 'field' }, title),
    h('div', { class: 'field' }, note),
    h('div', { class: 'field' }, h('div', { class: 'seg' }, once, weekly)),
    daysField,
    h('div', { class: 'row field' },
      h('div', {}, dateLabel, date),
      h('div', {}, h('label', {}, 'Время'), time)),
    h('div', { class: 'field' },
      h('label', { class: 'filebtn' }, 'Прикрепить фото или скриншот', file),
      preview),
    save,
    err
  );
}

/* ---------- push ---------- */

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
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

function pushBanner() {
  if (pushSupported()) {
    if (Notification.permission === 'granted') return null;
    return h('button', {
      class: 'link', style: 'display:block;margin:4px 0',
      onclick: async () => { await syncPush(true); render(); },
    }, 'Включить уведомления');
  }
  return h('div', { class: 'sub', style: 'color:var(--muted);font-size:13px;margin:4px 0' },
    'Для уведомлений: Поделиться → «На экран Домой», затем открой приложение с иконки.');
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
        if (!sheetRoot.firstChild) render();
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
  await loadAll();
  if (!state.profiles.some((p) => p.id === state.me.id)) return askName();
  render();
  subscribe();
  syncPush(false).catch(() => {});
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.me) {
    await loadAll();
    if (!sheetRoot.firstChild) render();
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
