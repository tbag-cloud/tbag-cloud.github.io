// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Double-check this is the long JWT string

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
    btnExport: $('btnExport'),
    btnImport: $('btnImport'),
    importFile: $('importFile'),
    bottomBar: $('bottomBar'),
    bottomCount: $('bottomCount'),
    btnClear: $('btnClear'),
    statsLabel: $('statsLabel'),
    toast: $('toast'),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const esc = (s) => 
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtDate = (iso) => 
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();

const fmtSize = (b) => 
    b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(1)}MB`;

function toast(msg, color = 'var(--green)') {
    if (!el.toast) return;
    el.toast.textContent = `// ${msg}`;
    el.toast.style.borderLeft = `4px solid ${color}`;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function updateSyncStatus(state) {
    if (!el.syncDot) return;
    el.syncDot.className = `sync-dot ${state}`; // 'syncing', 'ok', 'err'
}

function setScreen(isAppVisible) {
    el.authScreen.style.display = isAppVisible ? 'none' : 'flex';
    el.appScreen.style.display = isAppVisible ? 'block' : 'none';
}

function normalizeTodo(t) {
    return {
        id: t.id,
        text: t.text || 'Untitled Task',
        desc: t.desc || t.description || '',
        priority: t.priority || 'medium',
        done: !!t.done,
        created: t.created || t.created_at || new Date().toISOString(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOGIC
// ─────────────────────────────────────────────────────────────────────────────
function render() {
    const q = (searchQ || '').trim().toLowerCase();
    
    const visible = todos.filter(t => {
        const matchesFilter = 
            filter === 'all' ? true :
            filter === 'active' ? !t.done :
            filter === 'done' ? t.done :
            filter === 'high' ? t.priority === 'high' : true;
            
        const matchesSearch = q === '' || 
            t.text.toLowerCase().includes(q) || 
            t.desc.toLowerCase().includes(q);
            
        return matchesFilter && matchesSearch;
    });

    el.todoList.innerHTML = '';

    if (visible.length === 0) {
        el.todoList.innerHTML = `<div class="empty"><p>No tasks found.</p></div>`;
    }

    visible.forEach(t => {
        const item = document.createElement('div');
        item.className = `todo-item ${t.done ? 'done' : ''}`;
        item.innerHTML = `
            <div class="pbar ${t.priority}"></div>
            <div class="check-area">
                <div class="check-box ${t.done ? 'checked' : ''}"></div>
            </div>
            <div class="todo-body">
                <div class="todo-text">${esc(t.text)}</div>
                <div class="todo-meta">${t.priority.toUpperCase()} • ${fmtDate(t.created)}</div>
                ${t.desc ? `<div class="todo-desc ${t._open ? 'open' : ''}">${esc(t.desc)}</div>` : ''}
                ${t.desc ? `<button class="expand-btn ${t._open ? 'open' : ''}">DETAILS <span>▶</span></button>` : ''}
            </div>
            <div class="todo-actions">
                <button class="act edit-btn">EDIT</button>
                <button class="act del del-btn">DELETE</button>
            </div>
        `;

        // Events
        item.querySelector('.check-area').onclick = () => toggleTodoDone(t.id);
        item.querySelector('.del-btn').onclick = () => deleteTodo(t.id);
        item.querySelector('.edit-btn').onclick = () => editTodo(t.id);
        if (t.desc) {
            item.querySelector('.expand-btn').onclick = () => {
                t._open = !t._open;
                render();
            };
        }

        el.todoList.appendChild(item);
    });

    // Update Stats UI
    const doneCount = todos.filter(t => t.done).length;
    el.statsLabel.textContent = `${doneCount}/${todos.length} DONE`;
    el.bottomCount.textContent = `${doneCount} done / ${todos.length} total`;
    el.bottomBar.style.display = todos.length > 0 ? 'flex' : 'none';
    
    updateStorageMeter();
}

function updateStorageMeter() {
    let bytes = new Blob([JSON.stringify(todos) + JSON.stringify(attMap)]).size;
    const limit = 5000000; // 5MB approx limit for LocalStorage
    const pct = Math.min(100, (bytes / limit) * 100);
    
    el.storageFill.style.width = `${pct}%`;
    el.storageLabel.textContent = `${mode.toUpperCase()} STORAGE: ${fmtSize(bytes)} / 5MB`;
    el.storageFill.className = `storage-fill ${pct > 80 ? 'danger' : pct > 50 ? 'warn' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
async function addTodo() {
    const text = el.newTask.value.trim();
    if (!text) return toast('Task is empty', 'var(--danger)');

    const newTodo = normalizeTodo({
        id: uid(),
        text,
        desc: el.newDesc.value.trim(),
        priority: el.newPri.value,
        done: false,
    });

    todos.unshift(newTodo);
    el.newTask.value = '';
    el.newDesc.value = '';
    
    if (mode === 'synced') {
        const { error } = await sb.from('todos').insert([{ ...newTodo, user_id: currentUser.id }]);
        if (error) toast(error.message, 'red');
    } else {
        saveLocal();
    }
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

async function editTodo(id) {
    const t = todos.find(x => x.id === id);
    const nextText = prompt("Update task:", t.text);
    if (nextText === null) return;
    
    t.text = nextText;
    if (mode === 'synced') {
        await sb.from('todos').update({ text: nextText }).eq('id', id);
    } else {
        saveLocal();
    }
    render();
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
function saveLocal() {
    localStorage.setItem(LS_TODOS, JSON.stringify(todos));
}

function loadLocal() {
    const raw = localStorage.getItem(LS_TODOS);
    todos = raw ? JSON.parse(raw).map(normalizeTodo) : [];
}

async function loadSynced() {
    updateSyncStatus('syncing');
    const { data, error } = await sb.from('todos')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) {
        updateSyncStatus('err');
        toast("Sync Error", "red");
    } else {
        todos = data.map(normalizeTodo);
        updateSyncStatus('ok');
        render();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT & EVENTS
// ─────────────────────────────────────────────────────────────────────────────
el.btnAdd.onclick = addTodo;
el.newTask.onkeypress = (e) => e.key === 'Enter' && addTodo();

el.filterBtns.forEach(btn => {
    btn.onclick = () => {
        el.filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filter = btn.dataset.f; // Fixed: using data-f from HTML
        render();
    };
});

el.searchInp.oninput = (e) => {
    searchQ = e.target.value;
    el.searchClear.classList.toggle('vis', searchQ.length > 0);
    render();
};

el.searchClear.onclick = () => {
    el.searchInp.value = '';
    searchQ = '';
    el.searchClear.classList.remove('vis');
    render();
};

// Auth Listeners
el.btnGuest.onclick = () => {
    mode = 'guest';
    loadLocal();
    setScreen(true);
    render();
};

el.btnGoogle.onclick = () => sb.auth.signInWithOAuth({ provider: 'google' });
el.btnSignOut.onclick = () => sb.auth.signOut();

// The Single Source of Truth for Auth
sb.auth.onAuthStateChange((event, session) => {
    if (session) {
        mode = 'synced';
        currentUser = session.user;
        setScreen(true);
        el.modeBadge.textContent = "SYNCED";
        el.modeBadge.className = "mode-badge synced-mode";
        el.btnSignOut.style.display = "block";
        el.btnUpgrade.style.display = "none";
        
        const avatar = session.user.user_metadata.avatar_url;
        if (avatar) {
            el.userAvatar.src = avatar;
            el.userAvatar.style.display = "block";
            el.avatarPh.style.display = "none";
        }
        loadSynced();
    } else {
        mode = 'guest';
        currentUser = null;
        setScreen(false);
    }
});
