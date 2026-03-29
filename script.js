// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';

const LS_TODOS = 'todo_v3_todos';
const LS_ATTS = 'todo_v3_atts';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let mode = 'guest';
let currentUser = null;
let todos = [];
let attMap = {};
let filter = 'all';
let searchQ = '';
let realtimeCh = null;
let toastTimer = null;

// ─────────────────────────────────────────────────────────────────────────────
// DOM HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  authScreen: $('authScreen'),
  appScreen: $('appScreen'),
  btnGoogle: $('btnGoogle'),
  btnGuest: $('btnGuest'),
  btnSignOut: $('btnSignOut'),
  btnUpgrade: $('btnUpgrade'),
  syncDot: $('syncDot'),
  userAvatar: $('userAvatar'),
  avatarPh: $('avatarPh'),
  modeBadge: $('modeBadge'),
  todoList: $('todoList'),
  newTask: $('newTask'),
  newPri: $('newPri'),
  newDesc: $('newDesc'),
  btnAdd: $('btnAdd'),
  searchInp: $('searchInp'),
  searchClear: $('searchClear'),
  filterBtns: document.querySelectorAll('.filter-btn'),
  storageBar: $('storageBar'),
  storageFill: $('storageFill'),
  storageLabel: $('storageLabel'),
  btnExport: $('btnExport'),
  btnImport: $('btnImport'),
  importFile: $('importFile'),
  bottomBar: $('bottomBar'),
  bottomCount: $('bottomCount'),
  btnClear: $('btnClear'),
  btnClearAtts: $('btnClearAtts'),
  statsLabel: $('statsLabel'),
  toast: $('toast'),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  }).toUpperCase();

const fmtSize = (b) =>
  b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;

const mimeIcon = (m = '') =>
  m.startsWith('image/') ? '🖼' :
  m === 'application/pdf' ? '📄' :
  m.startsWith('video/') ? '🎬' :
  m.startsWith('audio/') ? '🎵' :
  m.includes('zip') ? '🗜' :
  '📎';

function toast(msg, color) {
  if (!el.toast) return;
  el.toast.textContent = `// ${msg}`;
  el.toast.style.color = color || 'var(--green)';
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function dot(state) {
  if (!el.syncDot) return;
  el.syncDot.className = `sync-dot ${state || ''}`.trim();
}

function show(id) {
  const node = $(id);
  if (node) node.style.display = 'block';
}

function hide(id) {
  const node = $(id);
  if (node) node.style.display = 'none';
}

function setAvatar(user) {
  if (!el.userAvatar || !el.avatarPh) return;

  const avatarUrl = user?.user_metadata?.avatar_url;
  if (avatarUrl) {
    el.userAvatar.src = avatarUrl;
    el.userAvatar.style.display = 'inline-block';
    el.avatarPh.style.display = 'none';
  } else {
    el.userAvatar.style.display = 'none';
    el.avatarPh.style.display = 'flex';
    el.avatarPh.textContent = (user?.email || '?')[0].toUpperCase();
  }
}

function setModeUI(nextMode) {
  if (!el.modeBadge) return;

  if (nextMode === 'synced') {
    el.modeBadge.textContent = 'SYNCED';
    el.modeBadge.className = 'mode-badge synced-mode';
    if (el.btnUpgrade) el.btnUpgrade.style.display = 'none';
    if (el.btnSignOut) el.btnSignOut.style.display = 'inline-block';
  } else {
    el.modeBadge.textContent = 'GUEST';
    el.modeBadge.className = 'mode-badge guest-mode';
    if (el.btnUpgrade) el.btnUpgrade.style.display = 'inline-block';
    if (el.btnSignOut) el.btnSignOut.style.display = 'none';
  }
}

function setScreen(appVisible) {
  if (el.authScreen) el.authScreen.style.display = appVisible ? 'none' : 'block';
  if (el.appScreen) el.appScreen.style.display = appVisible ? 'block' : 'none';
}

function safeLocalLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeTodo(t) {
  return {
    id: t.id,
    text: t.text || '',
    desc: t.desc ?? t.description ?? '',
    priority: t.priority || 'medium',
    done: !!t.done,
    created: t.created || new Date().toISOString(),
  };
}

function getVisibleTodos() {
  const q = (searchQ || '').trim().toLowerCase();

  return todos.filter((t) => {
    if (filter === 'active' && t.done) return false;
    if (filter === 'done' && !t.done) return false;
    if (filter === 'high' && t.priority !== 'high') return false;

    if (q) {
      const hay = `${t.text} ${t.desc || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

function updateStats() {
  if (!el.statsLabel) return;
  const done = todos.filter((t) => t.done).length;
  const total = todos.length;
  el.statsLabel.textContent = `${done}/${total} done`;
}

function updateStorageMeter() {
  if (!el.storageBar || !el.storageFill || !el.storageLabel) return;

  el.storageBar.className = 'storage-bar visible';

  let bytes = 0;
  if (mode === 'guest') {
    try {
      const t = localStorage.getItem(LS_TODOS) || '';
      const a = localStorage.getItem(LS_ATTS) || '';
      bytes = new Blob([t + a]).size;
    } catch {
      bytes = 0;
    }

    const pct = Math.min(100, (bytes / 5000000) * 100);
    el.storageFill.className = `storage-fill${pct > 80 ? ' danger' : pct > 60 ? ' warn' : ''}`;
    el.storageFill.style.width = `${pct.toFixed(1)}%`;
    el.storageLabel.textContent = `local storage: ${fmtSize(bytes)} / ~5MB (${pct.toFixed(0)}%)`;
  } else {
    try {
      bytes = new Blob([JSON.stringify(todos)]).size;
    } catch {
      bytes = 0;
    }
    const pct = Math.min(100, (bytes / 5000000) * 100);
    el.storageFill.className = `storage-fill${pct > 80 ? ' danger' : pct > 60 ? ' warn' : ''}`;
    el.storageFill.style.width = `${pct.toFixed(1)}%`;
    el.storageLabel.textContent = `synced data: ${fmtSize(bytes)} (${pct.toFixed(0)}%)`;
  }

  if (el.btnClearAtts) el.btnClearAtts.style.display = 'none';
}

function updateClearSearchBtn() {
  if (!el.searchClear) return;
  el.searchClear.classList.toggle('vis', !!el.searchInp?.value);
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────────────────
function render() {
  if (!el.todoList) return;

  const visible = getVisibleTodos();
  el.todoList.innerHTML = '';

  if (!visible.length) {
    el.todoList.innerHTML = `
      <div class="empty">
        <div class="big">◈</div>
        <p>${todos.length ? 'No tasks match your filters' : 'No tasks yet'}</p>
      </div>
    `;
    if (el.bottomBar) el.bottomBar.style.display = 'none';
    updateStats();
    updateStorageMeter();
    updateClearSearchBtn();
    return;
  }

  for (const t of visible) {
    const item = document.createElement('div');
    item.className = `todo-item${t.done ? ' done' : ''}`;
    item.dataset.id = t.id;

    const pbar = document.createElement('div');
    pbar.className = `pbar ${t.priority || 'low'}`;
    item.appendChild(pbar);

    const checkArea = document.createElement('div');
    checkArea.className = 'check-area';
    checkArea.innerHTML = '<div class="check-box"></div>';
    checkArea.addEventListener('click', () => toggleTodoDone(t.id));
    item.appendChild(checkArea);

    const body = document.createElement('div');
    body.className = 'todo-body';

    const text = document.createElement('div');
    text.className = 'todo-text';
    text.innerHTML = esc(t.text);
    body.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'todo-meta';
    meta.textContent = `${(t.priority || 'medium').toUpperCase()} · ${fmtDate(t.created)}`;
    body.appendChild(meta);

    if (t.desc) {
      const isOpen = !!t._open;
      const desc = document.createElement('div');
      desc.className = `todo-desc${isOpen ? ' open' : ''}`;
      desc.textContent = t.desc;
      body.appendChild(desc);

      const expandBtn = document.createElement('button');
      expandBtn.className = `expand-btn${isOpen ? ' open vis' : ''}`;
      expandBtn.innerHTML = `Details <span class="arr">▶</span>`;
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(t.id);
      });
      body.appendChild(expandBtn);
    }

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'todo-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'act';
    editBtn.textContent = 'EDIT';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editTodo(t.id);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'act del';
    delBtn.textContent = 'DELETE';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTodo(t.id);
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);
    el.todoList.appendChild(item);
  }

  const doneCount = todos.filter((t) => t.done).length;
  if (el.bottomBar) el.bottomBar.style.display = 'flex';
  if (el.bottomCount) el.bottomCount.textContent = `${doneCount} done / ${todos.length} total`;

  updateStats();
  updateStorageMeter();
  updateClearSearchBtn();
}

// ─────────────────────────────────────────────────────────────────────────────
// TODO CRUD
// ─────────────────────────────────────────────────────────────────────────────
function addTodo() {
  const text = el.newTask.value.trim();
  if (!text) return toast('Task cannot be empty', 'var(--danger)');

  const todo = {
    id: uid(),
    text,
    desc: el.newDesc.value.trim(),
    priority: el.newPri.value || 'medium',
    done: false,
    created: new Date().toISOString(),
  };

  todos.unshift(todo);

  if (mode === 'guest') {
    saveGuest();
  } else {
    sb.from('todos').insert([{ ...todo, user_id: currentUser.id }]).then((res) => {
      if (res.error) toast(`Error adding todo: ${res.error.message}`, 'var(--danger)');
    });
  }

  el.newTask.value = '';
  el.newDesc.value = '';
  el.newPri.value = 'medium';
  render();
}

function editTodo(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const newText = prompt('Edit task', t.text);
  if (newText === null) return;
  t.text = newText.trim();

  render();
  if (mode === 'guest') saveGuest();
  else sb.from('todos').update({ text: t.text }).eq('id', t.id).then(res => {
    if (res.error) toast(res.error.message,'var(--danger)')
  });
}

function deleteTodo(id) {
  todos = todos.filter((x) => x.id !== id);
  if (mode === 'guest') saveGuest();
  else sb.from('todos').delete().eq('id', id).then(res => {
    if(res.error) toast(res.error.message,'var(--danger)')
  });
  render();
}

function toggleTodoDone(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;

  if (mode === 'guest') saveGuest();
  else sb.from('todos').update({ done: t.done }).eq('id', id).then(res=>{
    if(res.error) toast(res.error.message,'var(--danger)')
  });

  render();
}

function toggleExpand(id) {
  const t = todos.find(x => x.id === id);
  if (!t) return;
  t._open = !t._open;
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH / FILTER
// ─────────────────────────────────────────────────────────────────────────────
el.searchInp?.addEventListener('input', (e) => {
  searchQ = e.target.value;
  render();
});

el.searchClear?.addEventListener('click', () => {
  searchQ = '';
  el.searchInp.value = '';
  render();
});

el.filterBtns.forEach(btn => btn.addEventListener('click', () => {
  filter = btn.dataset.filter || 'all';
  render();
}));

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / EXPORT
// ─────────────────────────────────────────────────────────────────────────────
el.btnExport?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ todos, attMap })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'todo-export.json';
  a.click();
  URL.revokeObjectURL(url);
});

el.importFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      todos = Array.isArray(data.todos) ? data.todos.map(normalizeTodo) : [];
      attMap = data.attMap || {};
      if (mode === 'guest') saveGuest();
      render();
    } catch (err) {
      toast('Invalid JSON file', 'var(--danger)');
    }
  };
  reader.readAsText(file);
});

// ─────────────────────────────────────────────────────────────────────────────
// GUEST / SYNCED MODES
// ─────────────────────────────────────────────────────────────────────────────
function loadGuest() {
  todos = safeLocalLoad(LS_TODOS, []).map(normalizeTodo);
  attMap = safeLocalLoad(LS_ATTS, {});
  render();
  setModeUI('guest');
  dot('');
}

function saveGuest() {
  if (!safeLocalSave(LS_TODOS, todos)) toast('Storage full', 'var(--danger)');
  safeLocalSave(LS_ATTS, attMap);
  updateStorageMeter();
}

async function loadSynced() {
  if (!sb || !currentUser) return;
  dot('syncing');

  try {
    const [tRes, aRes] = await Promise.all([
      sb.from('todos').select('*').eq('user_id', currentUser.id).order('created', { ascending: false }),
      sb.from('attachments').select('*').eq('user_id', currentUser.id),
    ]);

    if (tRes.error) throw tRes.error;
    todos = (tRes.data || []).map(normalizeTodo);

    attMap = {};
    if (!aRes.error && Array.isArray(aRes.data)) {
      for (const a of aRes.data) {
        (attMap[a.todo_id] = attMap[a.todo_id] || []).push(a);
      }
    }

    dot('ok');
    render();
  } catch (err) {
    console.error(err);
    dot('err');
    toast(`Load error: ${err.message}`, 'var(--danger)');
  }
}

function subscribeRealtime() {
  if (!sb || !currentUser) return;
  if (realtimeCh) sb.removeChannel(realtimeCh);

  const safeReload = () => setTimeout(loadSynced, 250);
  realtimeCh = sb.channel(`rt-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `user_id=eq.${currentUser.id}` }, safeReload)
    .subscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
el.btnGuest?.addEventListener('click', () => {
  mode = 'guest';
  currentUser = { id: uid(), email: 'Guest' };
  loadGuest();
  setScreen(true);
});

el.btnGoogle?.addEventListener('click', async () => {
  try {
    const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google' });
    if (error) throw error;
  } catch (err) {
    toast(`Login failed: ${err.message}`, 'var(--danger)');
  }
});

el.btnSignOut?.addEventListener('click', async () => {
  await sb.auth.signOut();
  currentUser = null;
  mode = 'guest';
  loadGuest();
  setScreen(false);
});

sb.auth.onAuthStateChange((_, session) => {
  if (session?.user) {
    mode = 'synced';
    currentUser = session.user;
    setModeUI('synced');
    setAvatar(currentUser);
    loadSynced();
    subscribeRealtime();
    setScreen(true);
  } else {
    mode = 'guest';
    currentUser = null;
    loadGuest();
    setScreen(false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZE
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (sb.auth.getSession()) sb.auth.getSession().then(r => {
    if (r.data?.session?.user) {
      currentUser = r.data.session.user;
      mode = 'synced';
      setModeUI('synced');
      setAvatar(currentUser);
      loadSynced();
      subscribeRealtime();
      setScreen(true);
    } else loadGuest();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
el.btnAdd?.addEventListener('click', addTodo);
el.newTask?.addEventListener('keypress', (e) => { if (e.key === 'Enter') addTodo(); });

el.btnClear?.addEventListener('click', () => {
  if (!confirm('Clear all todos?')) return;
  todos = [];
  attMap = {};
  if (mode === 'guest') saveGuest();
  else sb.from('todos').delete().eq('user_id', currentUser.id).then(()=>loadSynced());
  render();
});
