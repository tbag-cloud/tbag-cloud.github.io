// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const MAX_GUEST_FILE = 5 * 1024 * 1024;
const MAX_SYNC_FILE  = 50 * 1024 * 1024;

// ── STATE ─────────────────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

let mode = 'guest';
let currentUser = null;
let todos = [];
let attMap = {};

let filter = 'all';
let searchQ = '';
let editingId = null;
let confirmDeleteId = null;

let expandedIds = new Set();
let openAttIds = new Set();

const LS_TODOS = 'todo_v3_todos';
const LS_ATTS  = 'todo_v3_atts';

// ── UTILS ─────────────────────────────────────────────────────────────────────
const esc = s => (s || '')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;');

const uid = () => crypto.randomUUID();

const fmtDate = iso =>
  new Date(iso).toLocaleDateString('en-GB',{
    day:'2-digit',month:'short'
  }).toUpperCase();

const fmtSize = b =>
  b < 1024 ? b+'B' :
  b < 1048576 ? (b/1024).toFixed(1)+'KB' :
  (b/1048576).toFixed(1)+'MB';

const mimeIcon = m =>
  m?.startsWith('image/') ? '🖼' :
  m === 'application/pdf' ? '📄' :
  m?.startsWith('video/') ? '🎬' :
  m?.startsWith('audio/') ? '🎵' :
  m?.includes('zip') ? '🗜' : '📎';

// Normalize DB row
function normalize(t) {
  return {
    id: t.id,
    text: t.text || '',
    desc: t.description || '',
    priority: t.priority || 'medium',
    done: !!t.done,
    created: t.created_at || new Date().toISOString()
  };
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, col) {
  const el = document.getElementById('toast');
  if (!el) return;

  el.textContent = '// ' + msg;
  el.style.color = col || 'var(--green)';
  el.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function dot(state) {
  const el = document.getElementById('syncDot');
  if (!el) return;
  el.className = 'sync-dot ' + state;
}

// ── IMAGE COMPRESS ────────────────────────────────────────────────────────────
async function compressImage(file, maxW=1600, quality=0.82) {
  if (!file.type.startsWith('image/')) return file;

  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width:w, height:h } = img;

      if (w <= maxW && h <= maxW) {
        resolve(file);
        return;
      }

      const ratio = Math.min(maxW/w, maxW/h);
      w *= ratio;
      h *= ratio;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) {
          resolve(file);
        } else {
          resolve(new File([blob], file.name, { type: blob.type }));
        }
      }, file.type, quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}

// ── STORAGE METER ─────────────────────────────────────────────────────────────
function updateStorageMeter() {
  const fill = document.getElementById('storageFill');
  const label = document.getElementById('storageLabel');
  if (!fill || !label) return;

  if (mode === 'guest') {
    let bytes = 0;
    try {
      bytes =
        (localStorage.getItem(LS_TODOS)||'').length +
        (localStorage.getItem(LS_ATTS)||'').length;
    } catch {}

    const pct = Math.min(100, (bytes / 5000000) * 100);

    fill.style.width = pct + '%';
    label.textContent = `local storage: ${fmtSize(bytes)}`;
  } else {
    const bytes = Object.values(attMap)
      .flat()
      .reduce((s,a) => s + (a.size||0), 0);

    const pct = Math.min(100, (bytes / MAX_SYNC_FILE) * 100);

    fill.style.width = pct + '%';
    label.textContent = `supabase: ${fmtSize(bytes)} (${pct.toFixed(0)}%)`;
  }
}

// ── LOAD SYNCED ───────────────────────────────────────────────────────────────
let loading = false;

async function loadSynced() {
  if (loading) return;
  loading = true;

  dot('syncing');

  try {
    const { data: tData, error: tErr } =
      await sb.from('todos').select('*').order('created', { ascending:false });

    if (tErr) throw tErr;

    const { data: aData } =
      await sb.from('attachments').select('*');

    todos = (tData || []).map(normalize);

    attMap = {};

    (aData || []).forEach(a => {
      (attMap[a.todo_id] = attMap[a.todo_id] || []).push({
        id: a.id,
        name: a.name,
        size: a.size,
        mime: a.mime_type,
        path: a.path,
        todoId: a.todo_id
      });
    });

    dot('ok');
    render();
    updateStorageMeter();

  } catch (err) {
    dot('err');
    toast(err.message, 'var(--danger)');
  }

  loading = false;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function addTodo(text, priority, desc) {
  text = text.trim();
  if (!text) return;

  if (mode === 'guest') {
    todos.unshift({
      id: uid(),
      text,
      desc: desc.trim(),
      priority,
      done:false,
      created: new Date().toISOString()
    });
    saveGuest();
    render();
    return;
  }

  try {
    dot('syncing');

    const { error } = await sb.from('todos').insert({
      user_id: currentUser.id,
      text,
      description: desc.trim(),
      priority
    });

    if (error) throw error;

    await loadSynced();

  } catch (err) {
    dot('err');
    toast(err.message, 'var(--danger)');
  }
}

async function toggleDone(id) {
  const t = todos.find(t => t.id === id);
  if (!t) return;

  t.done = !t.done;
  render();

  if (mode === 'guest') {
    saveGuest();
    return;
  }

  try {
    await sb.from('todos')
      .update({ done: t.done })
      .eq('id', id);
    dot('ok');
  } catch {
    t.done = !t.done;
    dot('err');
    render();
  }
}

async function deleteTodo(id) {
  confirmDeleteId = null;

  if (mode === 'guest') {
    todos = todos.filter(t => t.id !== id);
    delete attMap[id];
    saveGuest();
    render();
    return;
  }

  try {
    dot('syncing');

    const atts = attMap[id] || [];

    for (const a of atts) {
      if (a.path)
        await sb.storage.from('attachments').remove([a.path]);
    }

    await sb.from('todos').delete().eq('id', id);

    await loadSynced();

  } catch {
    dot('err');
    toast('delete failed', 'var(--danger)');
  }
}

// ── GUEST SAVE ────────────────────────────────────────────────────────────────
function saveGuest() {
  try {
    localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    localStorage.setItem(LS_ATTS, JSON.stringify(attMap));
  } catch {
    toast('storage full', 'var(--danger)');
  }

  updateStorageMeter();
}
