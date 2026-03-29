// --- CONFIGURATION ---
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

// --- APP STATE ---
let mode = 'guest';
let currentUser = null;
let todos = [];

// --- DOM ELEMENTS ---
const $ = (id) => document.getElementById(id);
const el = {
    auth: $('authScreen'),
    app: $('appScreen'),
    list: $('todoList'),
    input: $('newTask'),
    desc: $('newDesc'),
    pri: $('newPri'),
    addBtn: $('btnAdd'),
    stats: $('statsLabel'),
    mode: $('modeBadge'),
    dot: $('syncDot'),
    signOut: $('btnSignOut'),
    toast: $('toast')
};

// --- UTILS ---
function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    setTimeout(() => el.toast.classList.remove('show'), 2000);
}

// Map SQL naming to JS naming
function normalize(t) {
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
    el.list.innerHTML = '';
    todos.forEach(t => {
        const item = document.createElement('div');
        item.className = 'todo-item';
        item.innerHTML = `
            <div style="cursor:pointer; display:flex; align-items:center; justify-content:center;">
                <input type="checkbox" ${t.done ? 'checked' : ''}>
            </div>
            <div style="padding:0 10px;">
                <div style="${t.done ? 'text-decoration:line-through; color:var(--muted)' : ''}">${t.text}</div>
                <div class="todo-desc ${t._open ? 'open' : ''}">${t.desc}</div>
            </div>
            <button class="del-btn" style="background:none; border:none; color:var(--muted);">✕</button>
        `;

        // Toggle Done
        item.querySelector('input').onchange = () => toggleDone(t.id);
        // Delete
        item.querySelector('.del-btn').onclick = () => deleteTodo(t.id);
        
        el.list.appendChild(item);
    });

    el.stats.textContent = `${todos.filter(t => t.done).length}/${todos.length} DONE`;
    $('bottomBar').style.display = todos.length > 0 ? 'flex' : 'none';
}

// --- ACTIONS ---
async function toggleDone(id) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    if (mode === 'synced') {
        await sb.from('todos').update({ done: t.done }).eq('id', id);
    } else {
        localStorage.setItem('todos', JSON.stringify(todos));
    }
    render();
}

async function deleteTodo(id) {
    todos = todos.filter(x => x.id !== id);
    if (mode === 'synced') {
        await sb.from('todos').delete().eq('id', id);
    } else {
        localStorage.setItem('todos', JSON.stringify(todos));
    }
    render();
}

el.addBtn.onclick = async () => {
    const text = el.input.value.trim();
    if (!text) return;

    const newTodo = {
        id: Date.now().toString(),
        text: text,
        desc: el.desc.value.trim(),
        priority: el.pri.value,
        done: false
    };

    todos.unshift(newTodo);

    if (mode === 'synced') {
        const { error } = await sb.from('todos').insert([{
            id: newTodo.id,
            user_id: currentUser.id,
            text: newTodo.text,
            description: newTodo.desc, // MAPS TO SQL
            priority: newTodo.priority,
            done: false
        }]);
        if (error) console.error("Insert Error:", error);
    } else {
        localStorage.setItem('todos', JSON.stringify(todos));
    }

    el.input.value = '';
    el.desc.value = '';
    render();
};

// --- AUTH LOGIC ---
sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
        console.log("Logged in as:", session.user.email);
        mode = 'synced';
        currentUser = session.user;
        el.auth.style.display = 'none';
        el.app.style.display = 'block';
        el.signOut.style.display = 'inline-block';
        el.mode.textContent = 'SYNCED';
        el.dot.classList.add('synced');

        const { data, error } = await sb.from('todos').select('*').order('created_at', { ascending: false });
        if (error) console.error("Fetch Error:", error);
        todos = (data || []).map(normalize);
    } else {
        console.log("Guest Mode active");
        mode = 'guest';
        el.auth.style.display = 'block';
        el.app.style.display = 'none';
        const localData = localStorage.getItem('todos');
        todos = localData ? JSON.parse(localData) : [];
    }
    render();
});

$('btnGoogle').onclick = () => sb.auth.signInWithOAuth({ provider: 'google' });
$('btnSignOut').onclick = () => sb.auth.signOut();
$('btnGuest').onclick = () => {
    el.auth.style.display = 'none';
    el.app.style.display = 'block';
};
