/**
 * TODO APP - CORE LOGIC
 * Corrected to match Supabase SQL schema (description, created_at)
 */

// --- CONFIG ---
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const LS_TODOS = 'todo_v3_todos';

// --- STATE ---
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let mode = 'guest'; 
let currentUser = null;
let todos = [];
let filter = 'all';
let searchQ = '';
let toastTimer = null;

// DOM Elements
const $ = (id) => document.getElementById(id);
const el = {
    authScreen: $('authScreen'),
    appScreen: $('appScreen'),
    btnGoogle: $('btnGoogle'),
    btnGuest: $('btnGuest'),
    btnSignOut: $('btnSignOut'),
    modeBadge: $('modeBadge'),
    todoList: $('todoList'),
    newTask: $('newTask'),
    newPri: $('newPri'),
    newDesc: $('newDesc'),
    btnAdd: $('btnAdd'),
    searchInp: $('searchInp'),
    statsLabel: $('statsLabel'),
    bottomBar: $('bottomBar'),
    bottomCount: $('bottomCount'),
    btnClear: $('btnClear'),
    toast: $('toast'),
    syncDot: $('syncDot')
};

// --- UTILS ---
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

// Maps Database names (description) to App names (desc)
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

// --- RENDER ---
function render() {
    const q = searchQ.toLowerCase();
    const visible = todos.filter(t => {
        const matchesFilter = filter === 'all' || 
                             (filter === 'active' && !t.done) || 
                             (filter === 'done' && t.done) ||
                             (filter === 'high' && t.priority === 'high');
        const matchesSearch = t.text.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
        return matchesFilter && matchesSearch;
    });

    el.todoList.innerHTML = '';
    if (visible.length === 0) {
        el.todoList.innerHTML = `<div class="empty"><div class="big">◈</div><p>No tasks found</p></div>`;
    }

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

        item.querySelector('.check-area').onclick = () => toggleTodo(t.id);
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

// --- CORE LOGIC ---
async function addTodo() {
    const text = el.newTask.value.trim();
    if (!text) return toast('Task is empty', 'var(--danger)');

    const newTodo = normalizeTodo({
        id: uid(),
        text: text,
        desc: el.newDesc.value.trim(),
        priority: el.newPri.value,
        done: false
    });

    todos.unshift(newTodo);
    
    if (mode === 'synced' && currentUser) {
        const { error } = await sb.from('todos').insert([{ 
            id: newTodo.id,
            user_id: currentUser.id,
            text: newTodo.text,
            description: newTodo.desc, // MAPS TO DB 'description'
            priority: newTodo.priority,
            done: newTodo.done
        }]);
        if (error) toast(error.message, 'var(--danger)');
    } else {
        localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    }

    el.newTask.value = '';
    el.newDesc.value = '';
    render();
}

async function toggleTodo(id) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    if (mode === 'synced') {
        await sb.from('todos').update({ done: t.done }).eq('id', id);
    } else {
        localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    }
    render();
}

async function deleteTodo(id) {
    todos = todos.filter(x => x.id !== id);
    if (mode === 'synced') {
        await sb.from('todos').delete().eq('id', id);
    } else {
        localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    }
    render();
}

// --- AUTH ---
sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
        mode = 'synced';
        currentUser = session.user;
        el.modeBadge.textContent = 'SYNCED';
        el.modeBadge.className = 'mode-badge synced-mode';
        el.btnSignOut.style.display = 'inline-block';
        el.authScreen.style.display = 'none';
        el.appScreen.style.display = 'block';
        
        const { data } = await sb.from('todos').select('*').order('created_at', { ascending: false });
        todos = (data || []).map(normalizeTodo);
        render();
    } else {
        mode = 'guest';
        el.authScreen.style.display = 'block';
        el.appScreen.style.display = 'none';
        const saved = localStorage.getItem(LS_TODOS);
        todos = saved ? JSON.parse(saved).map(normalizeTodo) : [];
        render();
    }
});

// --- EVENTS ---
el.btnAdd.onclick = addTodo;
el.btnGuest.onclick = () => { el.authScreen.style.display = 'none'; el.appScreen.style.display = 'block'; };
el.btnGoogle.onclick = () => sb.auth.signInWithOAuth({ provider: 'google' });
el.btnSignOut.onclick = () => sb.auth.signOut();
el.searchInp.oninput = (e) => { searchQ = e.target.value; render(); };
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filter = btn.dataset.f;
        render();
    };
});
