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
let sb = null;
let mode = 'guest'; // 'guest' | 'synced'
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

  if (mode === 'guest') {
    let bytes = 0;
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
    const bytes = new Blob([JSON.stringify(todos)]).size;
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
// GUEST MODE
// ─────────────────────────────────────────────────────────────────────────────
function loadGuest() {
  todos = safeLocalLoad(LS_TODOS, []).map(normalizeTodo);
  attMap = safeLocalLoad(LS_ATTS, {});
  render();
}

function saveGuest() {
  if (!safeLocalSave(LS_TODOS, todos)) {
    toast('storage full or blocked', 'var(--danger)');
  }
  safeLocalSave(LS_ATTS, attMap);
  updateStorageMeter();
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNCED MODE
// ─────────────────────────────────────────────────────────────────────────────
async function loadSynced() {
  if (!sb || !currentUser) return;

  dot('syncing');

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      dot('err');
      toast('session lost, please sign in again', 'var(--danger)');
      leaveSyncedMode();
      return;
    }

    const [tResult, aResult] = await Promise.all([
      sb.from('todos')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created', { ascending: false }),
      sb.from('attachments')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created', { ascending: true }),
    ]);

    if (tResult.error) throw tResult.error;

    todos = (tResult.data || []).map(normalizeTodo);

    attMap = {};
    if (!aResult.error && Array.isArray(aResult.data)) {
      for (const a of aResult.data) {
        (attMap[a.todo_id] = attMap[a.todo_id] || []).push({
          id: a.id,
          name: a.name,
          size: a.size,
          mime: a.mime_type,
          path: a.path,
          todoId: a.todo_id,
        });
      }
    }

    dot('ok');
    render();
  } catch (err) {
    console.error(err);
    dot('err');
    toast(`load error: ${err.message || err}`, 'var(--danger)');
  }
}

function subscribeRealtime() {
  if (!sb || !currentUser) return;

  if (realtimeCh) {
    sb.removeChannel(realtimeCh);
    realtimeCh = null;
  }

  let rtTimer = null;
  const safeReload = () => {
    clearTimeout(rtTimer);
    rtTimer = setTimeout(() => loadSynced(), 250);
  };

  realtimeCh = sb
    .channel(`rt-${currentUser.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, safeReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, safeReload)
    .subscribe();
}

function enterGuestMode() {
  mode = 'guest';
  currentUser = null;

  if (realtimeCh && sb) {
    sb.removeChannel(realtimeCh);
    realtimeCh = null;
  }

  setScreen(true);
  setModeUI('guest');
  dot('');
  if (el.userAvatar) el.userAvatar.style.display = 'none';
  if (el.avatarPh) {
    el.avatarPh.style.display = 'flex';
    el.avatarPh.textContent = '?';
  }

  loadGuest();
}

async function enterSyncedMode(user) {
  if (!user) return;

  mode = 'synced';
  currentUser = user;

  setScreen(true);
  setModeUI('synced');
  setAvatar(user);

  await loadSynced();
  subscribeRealtime();
}

function leaveSyncedMode() {
  mode = 'guest';
  currentUser = null;
  todos = [];
  attMap = {};

  if (realtimeCh && sb) {
    sb.removeChannel(realtimeCh);
    realtimeCh = null;
  }

  if (el.appScreen) el.appScreen.style.display = 'none';
  if (el.authScreen) el.authScreen.style.display = 'block';
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────
async function addTodo(text, priority, desc) {
  text = String(text || '').trim();
  desc = String(desc || '').trim();
  priority = priority || 'medium';

  if (!text) {
    toast('type a task first', 'var(--accent2)');
    return;
  }

  if (mode === 'guest') {
    todos.unshift({
      id: uid(),
      text,
      desc,
      priority,
      done: false,
      created: new Date().toISOString(),
      _open: false,
    });
    saveGuest();
    render();
    return;
  }

  if (!sb || !currentUser) {
    toast('not signed in', 'var(--danger)');
    return;
  }

  const tempId = `temp-${uid()}`;
  todos.unshift({
    id: tempId,
    text,
    desc,
    priority,
    done: false,
    created: new Date().toISOString(),
    _open: false,
    _optimistic: true,
  });
  render();
  dot('syncing');

  try {
    const { data, error } = await sb
      .from('todos')
      .insert({
        user_id: currentUser.id,
        text,
        description: desc,
        priority,
        done: false,
      })
      .select()
      .single();

    if (error) throw error;

    const idx = todos.findIndex((t) => t.id === tempId);
    if (idx !== -1) todos[idx] = normalizeTodo(data);

    dot('ok');
    render();
  } catch (err) {
    todos = todos.filter((t) => t.id !== tempId);
    dot('err');
    render();
    toast(`add failed: ${err.message || err}`, 'var(--danger)');
  }
}

function toggleExpand(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t._open = !t._open;
  render();
  if (mode === 'guest') saveGuest();
}

async function toggleTodoDone(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const next = !t.done;

  if (mode === 'guest') {
    t.done = next;
    saveGuest();
    render();
    return;
  }

  t.done = next;
  render();
  dot('syncing');

  try {
    const { error } = await sb
      .from('todos')
      .update({ done: next })
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    dot('ok');
  } catch (err) {
    t.done = !next;
    dot('err');
    render();
    toast(`update failed: ${err.message || err}`, 'var(--danger)');
  }
}

async function editTodo(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const nextText = prompt('Edit task:', t.text);
  if (nextText === null) return;

  const nextDesc = prompt('Edit description:', t.desc || '');
  if (nextDesc === null) return;

  const newText = nextText.trim();
  const newDesc = nextDesc.trim();

  if (!newText) {
    toast('task cannot be empty', 'var(--accent2)');
    return;
  }

  if (mode === 'guest') {
    t.text = newText;
    t.desc = newDesc;
    saveGuest();
    render();
    return;
  }

  dot('syncing');

  const old = { text: t.text, desc: t.desc };

  t.text = newText;
  t.desc = newDesc;
  render();

  try {
    const { error } = await sb
      .from('todos')
      .update({
        text: newText,
        description: newDesc,
      })
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    dot('ok');
  } catch (err) {
    t.text = old.text;
    t.desc = old.desc;
    dot('err');
    render();
    toast(`edit failed: ${err.message || err}`, 'var(--danger)');
  }
}

async function deleteTodo(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;

  const ok = confirm('Delete this task?');
  if (!ok) return;

  if (mode === 'guest') {
    todos = todos.filter((x) => x.id !== id);
    delete attMap[id];
    saveGuest();
    render();
    return;
  }

  const backup = [...todos];
  todos = todos.filter((x) => x.id !== id);
  render();
  dot('syncing');

  try {
    const { error } = await sb
      .from('todos')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    if (attMap[id]) delete attMap[id];
    dot('ok');
  } catch (err) {
    todos = backup;
    dot('err');
    render();
    toast(`delete failed: ${err.message || err}`, 'var(--danger)');
  }
}

async function clearCompleted() {
  const doneIds = todos.filter((t) => t.done).map((t) => t.id);
  if (!doneIds.length) return;

  const ok = confirm('Clear all completed tasks?');
  if (!ok) return;

  if (mode === 'guest') {
    todos = todos.filter((t) => !t.done);
    saveGuest();
    render();
    return;
  }

  const backup = [...todos];
  todos = todos.filter((t) => !t.done);
  render();
  dot('syncing');

  try {
    const { error } = await sb
      .from('todos')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('done', true);

    if (error) throw error;

    dot('ok');
  } catch (err) {
    todos = backup;
    dot('err');
    render();
    toast(`clear failed: ${err.message || err}`, 'var(--danger)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT / EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    todos,
    attMap,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'todo-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result || ''));
      const importedTodos = Array.isArray(raw) ? raw : raw.todos;
      if (!Array.isArray(importedTodos)) throw new Error('No tasks found');

      todos = importedTodos.map(normalizeTodo);
      attMap = raw.attMap && typeof raw.attMap === 'object' ? raw.attMap : {};

      if (mode === 'guest') {
        saveGuest();
      }

      render();
      toast('import complete');
    } catch (err) {
      toast(`import failed: ${err.message || err}`, 'var(--danger)');
    }
  };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────
el.btnAdd?.addEventListener('click', () => {
  addTodo(el.newTask?.value, el.newPri?.value, el.newDesc?.value);

  if (el.newTask) el.newTask.value = '';
  if (el.newDesc) el.newDesc.value = '';
  if (el.newTask) el.newTask.focus();
});

el.newTask?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.btnAdd?.click();
  }
});

el.searchInp?.addEventListener('input', () => {
  searchQ = el.searchInp.value;
  updateClearSearchBtn();
  render();
});

el.searchClear?.addEventListener('click', () => {
  if (el.searchInp) el.searchInp.value = '';
  searchQ = '';
  updateClearSearchBtn();
  render();
});

el.filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    el.filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.f || 'all';
    render();
  });
});

el.btnClear?.addEventListener('click', clearCompleted);
el.btnExport?.addEventListener('click', exportData);

el.btnImport?.addEventListener('click', () => el.importFile?.click());
el.importFile?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importData(file);
  e.target.value = '';
});

el.btnGuest?.addEventListener('click', enterGuestMode);
el.btnUpgrade?.addEventListener('click', () => {
  el.btnGoogle?.click();
});

el.btnSignOut?.addEventListener('click', async () => {
  if (!sb) return;
  await sb.auth.signOut();
});

el.btnGoogle?.addEventListener('click', async () => {
  if (!sb) {
    toast('supabase not ready', 'var(--danger)');
    return;
  }

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://tbag-cloud.github.io', // <- your app landing page
    },
  });

  if (error) {
    toast(`sign in failed: ${error.message}`, 'var(--danger)');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  try {
    if (!window.supabase) {
      console.error('Supabase library missing');
      show('authScreen');
      return;
    }

    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'todo-app-auth',
      },
    });

    // Support URL hash sessions just in case
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.replace(/^#+/, ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      if (access_token && refresh_token) {
        await sb.auth.setSession({ access_token, refresh_token });
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    const { data: { session } } = await sb.auth.getSession();

    if (session?.user) {
      await enterSyncedMode(session.user);
    } else {
      mode = 'guest';
      setScreen(false);
      setModeUI('guest');
      show('authScreen');
      hide('appScreen');
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await enterSyncedMode(session.user);
      }

      if (event === 'SIGNED_OUT') {
        leaveSyncedMode();
        mode = 'guest';
        setModeUI('guest');
        show('authScreen');
        hide('appScreen');
      }
    });
  } catch (err) {
    console.error('Init failed:', err);
    toast(`init failed: ${err.message || err}`, 'var(--danger)');
    show('authScreen');
  }
}

init();
