// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Replace with your actual anon key

const LS_TODOS = 'todo_v3_todos';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let mode = 'guest';
let currentUser = null;
let todos = [];
let filter = 'all';
let searchQ = '';
let toastTimer = null;

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
  storageFill: $('storageFill'),
  storageLabel: $('storageLabel'),
  bottomBar: $('bottomBar'),
  bottomCount: $('bottomCount'),
  btnClear: $('btnClear'),
  statsLabel: $('statsLabel'),
  toast: $('toast'),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS & NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();

function toast(msg, color = 'var(--green)') {
  if (!el.toast) return;
  el.toast.textContent = `// ${msg}`;
  el.toast.style.color = color;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

// This bridges the gap between your SQL (description) and JS (desc)
function normalizeTodo(t) {
  return {
    id: t.id,
    text: t.text || '',
    desc: t.description || t.desc || '', 
    priority: t.priority || 'medium',
    done: !!t.done,
    created: t.created_at || t.created || new Date().toISOString(),
    _open: false
  };
}

function setScreen(isAppVisible) {
  el.authScreen.style.display = isAppVisible ? 'none' : 'block';
  el.appScreen.style.display = isAppVisible ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
async function addTodo() {
  const text = el.newTask.value.trim();
  if (!text) return toast('Task cannot be empty', 'var(--danger)');

  const newTodo = normalizeTodo({
    id: uid(),
    text,
    desc: el.newDesc.value.trim(),
    priority: el.newPri.value,
    done: false
  });

  todos.unshift(newTodo);
  
  if (mode === 'synced') {
    const { error } = await sb.from('todos').insert([{ 
      id: newTodo.id,
      user_id: currentUser.id,
      text: newTodo.text,
      description: newTodo.desc, // Matches SQL
      priority: newTodo.priority,
      done: newTodo.done,
      created_at: newTodo.created // Matches SQL
    }]);
    if (error) toast(error.message, 'var(--danger)');
  } else {
    saveLocal();
  }

  el.newTask.value = '';
  el.newDesc.value = '';
  render();
}

async function toggleTodoDone(id) {
  const t = todos.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;

  if (mode === 'synced') {
    await sb.from('todos').update({ done: t.done }).eq('id', id);
  } else {
    saveLocal();
  }
  render();
}

async function deleteTodo(id) {
  todos = todos.filter(x => x.id !== id);
  if (mode === 'synced') {
    await sb.from('todos').delete().eq('id', id);
  } else {
    saveLocal();
  }
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER & UI
// ─────────────────────────────────────────────────────────────────────────────
function render() {
  const q = (searchQ || '').toLowerCase();
  const visible = todos.filter(t => {
    const matchesFilter = filter === 'all' ? true :
                         filter === 'active' ? !t.done :
                         filter === 'done' ? t.done :
                         filter === 'high' ? t.priority === 'high' : true;
    const matchesSearch = t.text.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  el.todoList.innerHTML = '';
  visible.forEach(t => {
    const item = document.createElement('div');
    item.className = `todo-item ${t.done ? 'done' : ''}`;
    item.innerHTML = `
      <div class="pbar ${t.priority}"></div>
      <div class="check-area"><div class="check-box"></div></div>
      <div class="todo-body">
        <div class="todo-text">${esc(t.text)}</div>
        <div class="todo-meta">${t.priority.toUpperCase()} • ${fmtDate(t.created)}</div>
        <div class="todo-desc ${t._open ? 'open' : ''}">${esc(t.desc)}</div>
        ${t.desc ? `<button class="expand-btn">DETAILS <span>▶</span></button>` : ''}
      </div>
      <div class="todo-actions">
        <button class="act del">DELETE</button>
      </div>
    `;

    item.querySelector('.check-area').onclick = () => toggleTodoDone(t.id);
    item.querySelector('.del').onclick = () => deleteTodo(t.id);
    if (t.desc) {
      item.querySelector('.expand-btn').onclick = () => { t._open = !t._open; render(); };
    }
    el.todoList.appendChild(item);
  });

  const doneCount = todos.filter(t => t.done).length;
  el.statsLabel.textContent = `${doneCount}/${todos.length} done`;
  el.bottomCount.textContent = `${doneCount} done / ${todos.length} total`;
  el.bottomBar.style.display = todos.length ? 'flex' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE & AUTH
// ─────────────────────────────────────────────────────────────────────────────
function saveLocal() { localStorage.setItem(LS_TODOS, JSON.stringify(todos)); }
function loadLocal() { 
  const data = localStorage.getItem(LS_TODOS);
  todos = data ? JSON.parse(data).map(normalizeTodo) : [];
  render();
}

async function loadSynced() {
  const { data, error } = await sb.from('todos').select('*').order('created_at', { ascending: false });
  if (!error) {
    todos = data.map(normalizeTodo);
    render();
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (session) {
    mode = 'synced';
    currentUser = session.user;
    el.modeBadge.textContent = 'SYNCED';
    el.btnSignOut.style.display = 'block';
    el.btnUpgrade.style.display = 'none';
    setScreen(true);
    loadSynced();
  } else {
    mode = 'guest';
    loadLocal();
  }
});

el.btnGuest.onclick = () => { mode = 'guest'; loadLocal(); setScreen(true); };
el.btnGoogle.onclick = () => sb.auth.signInWithOAuth({ provider: 'google' });
el.btnSignOut.onclick = () => { sb.auth.signOut(); setScreen(false); };

el.btnAdd.onclick = addTodo;
el.newTask.onkeypress = (e) => e.key === 'Enter' && addTodo();

el.filterBtns.forEach(btn => {
  btn.onclick = () => {
    el.filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.f; // Uses the data-f attribute from your HTML
    render();
  };
});

el.searchInp.oninput = (e) => { searchQ = e.target.value; render(); };
