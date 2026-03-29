// ======= CONFIG =======
const SUPABASE_URL = 'https://YOUR_SUPABASE_URL.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_KEY';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ======= ELEMENTS =======
const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const btnGoogle = document.getElementById('btnGoogle');
const btnGuest = document.getElementById('btnGuest');
const btnSignOut = document.getElementById('btnSignOut');
const btnUpgrade = document.getElementById('btnUpgrade');
const syncDot = document.getElementById('syncDot');
const userAvatar = document.getElementById('userAvatar');
const avatarPh = document.getElementById('avatarPh');
const modeBadge = document.getElementById('modeBadge');
const todoList = document.getElementById('todoList');
const newTask = document.getElementById('newTask');
const newPri = document.getElementById('newPri');
const newDesc = document.getElementById('newDesc');
const btnAdd = document.getElementById('btnAdd');
const searchInp = document.getElementById('searchInp');
const searchClear = document.getElementById('searchClear');
const filterBtns = document.querySelectorAll('.filter-btn');
const storageBar = document.getElementById('storageBar');
const storageFill = document.getElementById('storageFill');
const storageLabel = document.getElementById('storageLabel');
const btnExport = document.getElementById('btnExport');
const btnImport = document.getElementById('btnImport');
const importFile = document.getElementById('importFile');
const toastEl = document.getElementById('toast');
const bottomBar = document.getElementById('bottomBar');
const bottomCount = document.getElementById('bottomCount');
const btnClear = document.getElementById('btnClear');
const btnClearAtts = document.getElementById('btnClearAtts');

let currentUser = null;
let tasks = [];
let filter = 'all';

// ======= TOAST =======
function showToast(msg, color) {
    toastEl.textContent = msg;
    toastEl.style.color = color || 'var(--green)';
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// ======= STORAGE =======
function saveLocal() {
    localStorage.setItem('todoTasks', JSON.stringify(tasks));
}

function loadLocal() {
    const saved = localStorage.getItem('todoTasks');
    if (saved) tasks = JSON.parse(saved);
}

// ======= RENDER =======
function renderTasks() {
    todoList.innerHTML = '';
    let visibleCount = 0;

    tasks.forEach((t, i) => {
        // FILTER
        if (filter === 'active' && t.done) return;
        if (filter === 'done' && !t.done) return;
        if (filter === 'high' && t.priority !== 'high') return;
        if (searchInp.value && !t.text.toLowerCase().includes(searchInp.value.toLowerCase())) return;

        visibleCount++;

        const item = document.createElement('div');
        item.className = `todo-item${t.done ? ' done' : ''}`;

        const pbar = document.createElement('div');
        pbar.className = 'pbar ' + (t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'medium' : 'low');
        item.appendChild(pbar);

        const checkArea = document.createElement('div');
        checkArea.className = 'check-area';
        const checkBox = document.createElement('div');
        checkBox.className = 'check-box';
        checkArea.appendChild(checkBox);
        checkArea.addEventListener('click', () => {
            t.done = !t.done;
            saveLocal();
            renderTasks();
        });
        item.appendChild(checkArea);

        const body = document.createElement('div');
        body.className = 'todo-body';
        const text = document.createElement('div');
        text.className = 'todo-text';
        text.textContent = t.text;
        body.appendChild(text);

        if (t.desc) {
            const desc = document.createElement('div');
            desc.className = 'todo-desc' + (t.expanded ? ' open' : '');
            desc.textContent = t.desc;
            body.appendChild(desc);

            const expandBtn = document.createElement('button');
            expandBtn.className = 'expand-btn' + (t.expanded ? ' open vis' : '');
            expandBtn.innerHTML = `Details <span class="arr">▶</span>`;
            expandBtn.addEventListener('click', () => {
                t.expanded = !t.expanded;
                renderTasks();
            });
            body.appendChild(expandBtn);
        }

        item.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'todo-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'act';
        editBtn.textContent = 'EDIT';
        editBtn.addEventListener('click', () => editTask(i));
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'act del';
        delBtn.textContent = 'DELETE';
        delBtn.addEventListener('click', () => deleteTask(i));
        actions.appendChild(delBtn);

        item.appendChild(actions);

        todoList.appendChild(item);
    });

    bottomBar.style.display = visibleCount ? 'flex' : 'none';
    bottomCount.textContent = `${tasks.filter(t => t.done).length} done / ${tasks.length} total`;
}

// ======= TASK CRUD =======
function addTask() {
    const text = newTask.value.trim();
    if (!text) return showToast('Task cannot be empty', 'var(--accent2)');
    tasks.push({
        text,
        priority: newPri.value,
        desc: newDesc.value.trim(),
        done: false,
        expanded: false
    });
    newTask.value = '';
    newDesc.value = '';
    saveLocal();
    renderTasks();
}

function editTask(i) {
    const t = tasks[i];
    const newText = prompt('Edit task text:', t.text);
    if (newText !== null) t.text = newText.trim();
    const newDesc = prompt('Edit description:', t.desc || '');
    if (newDesc !== null) t.desc = newDesc.trim();
    saveLocal();
    renderTasks();
}

function deleteTask(i) {
    if (!confirm('Delete this task?')) return;
    tasks.splice(i, 1);
    saveLocal();
    renderTasks();
}

// ======= EVENTS =======
btnAdd.addEventListener('click', addTask);
newTask.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
searchInp.addEventListener('input', renderTasks);
searchClear.addEventListener('click', () => { searchInp.value=''; renderTasks(); });
filterBtns.forEach(btn => btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.f;
    renderTasks();
}));

btnClear.addEventListener('click', () => {
    tasks = tasks.filter(t => !t.done);
    saveLocal();
    renderTasks();
});

// ======= IMPORT/EXPORT =======
btnExport.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks.json';
    a.click();
    URL.revokeObjectURL(url);
});

btnImport.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const imported = JSON.parse(reader.result);
            tasks = imported;
            saveLocal();
            renderTasks();
            showToast('Tasks imported');
        } catch {
            showToast('Invalid JSON', 'var(--danger)');
        }
    };
    reader.readAsText(file);
});

// ======= AUTH =======
async function signInGoogle() {
    const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google' });
    if (error) return showToast(error.message, 'var(--danger)');
    currentUser = data.user;
    showApp();
}

function signInGuest() {
    currentUser = { guest: true };
    showApp();
}

function signOut() {
    sb.auth.signOut();
    currentUser = null;
    showAuth();
}

btnGoogle.addEventListener('click', signInGoogle);
btnGuest.addEventListener('click', signInGuest);
btnSignOut.addEventListener('click', signOut);
btnUpgrade.addEventListener('click', signInGoogle);

// ======= UI TOGGLE =======
function showApp() {
    authScreen.style.display = 'none';
    appScreen.style.display = 'block';
    modeBadge.textContent = currentUser.guest ? 'GUEST' : 'SYNCED';
    btnSignOut.style.display = currentUser.guest ? 'none' : 'inline-flex';
    btnUpgrade.style.display = currentUser.guest ? 'inline-flex' : 'none';
    userAvatar.style.display = currentUser.user_metadata?.avatar_url ? 'inline-block' : 'none';
    avatarPh.style.display = userAvatar.style.display === 'none' ? 'flex' : 'none';
    renderTasks();
    updateStorage();
}

function showAuth() {
    authScreen.style.display = 'block';
    appScreen.style.display = 'none';
}

// ======= STORAGE BAR =======
function updateStorage() {
    const used = new Blob([JSON.stringify(tasks)]).size;
    const limit = 50000;
    const pct = Math.min((used/limit)*100,100);
    storageBar.style.display = 'block';
    storageFill.style.width = pct+'%';
    storageLabel.textContent = `storage: ${used} / ${limit} bytes`;
}

// ======= INIT =======
loadLocal();
showAuth();
