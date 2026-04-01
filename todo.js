// ── GUEST MODE ────────────────────────────────────────────────────────────────
function enterGuestMode() {
  mode = 'guest'; currentUser = null;
  watchlistSyncAvailable = true;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('modeBadge').textContent = 'GUEST';
  document.getElementById('modeBadge').className = 'mode-badge guest-mode';
  document.getElementById('btnUpgrade').style.display = 'inline-block';
  document.getElementById('btnSignOut').style.display = 'none';
  document.getElementById('userAvatar').style.display = 'none';
  document.getElementById('avatarPh').textContent = '?';
  dot('');
  try { todos = JSON.parse(localStorage.getItem(LS_TODOS) || '[]'); } catch { todos = []; }
  try { attMap = JSON.parse(localStorage.getItem(LS_ATTS) || '{}'); } catch { attMap = {}; }
  loadGuestWatchlist();
  renderWatchlistCategoryOptions();
  renderWatchlist();
  globalUsage = null;
  updateAdminAccess();
  setPage(pageFromHash(), { updateHash: false });
  render(); updateStorageMeter();
}

function saveGuest() {
  try {
    localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    localStorage.setItem(LS_ATTS, JSON.stringify(attMap));
  } catch(e) { toast('storage full', 'var(--accent2)'); }
  updateStorageMeter();
}

// ── LOAD SYNCED ───────────────────────────────────────────────────────────────
async function loadSynced() {
  dot('syncing');
  const { data: tData, error: tErr } = await sb.from('todos').select('*').eq('user_id', currentUser.id);

  if (tErr) { dot('err'); toast('load error: ' + tErr.message, 'var(--danger)'); return; }

  // Load attachments - try different approaches for compatibility
  let aData = [];
  try {
    const result = await sb.from('attachments').select('*').eq('user_id', currentUser.id);
    if (result.error && result.error.message.includes('is_standalone')) {
      // Column doesn't exist, get all
      const allResult = await sb.from('attachments').select('*').eq('user_id', currentUser.id);
      aData = allResult.data || [];
    } else {
      aData = (result.data || []).filter(a => !a.is_standalone);
    }
  } catch (e) {
    console.warn('attachments query failed:', e);
    aData = [];
  }

  todos = (tData || [])
    .map(normalize)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  attMap = {};
  (aData || [])
    .sort((a, b) => new Date(a.created_at || a.created || 0) - new Date(b.created_at || b.created || 0))
    .forEach(a => {
      (attMap[a.todo_id] = attMap[a.todo_id] || []).push({
        id: a.id, name: a.name, size: a.size, mime: a.mime_type, path: a.path, todoId: a.todo_id
      });
    });

  try {
    watchlistSyncAvailable = true;
    await loadSyncedWatchlist();
  } catch (error) {
    if (isMissingWatchlistTable(error)) {
      watchlistSyncAvailable = false;
      loadGuestWatchlist();
      renderWatchlistCategoryOptions();
      renderWatchlist();
      toast('watchlist sync unavailable - run watchlist SQL', 'var(--danger)');
    } else {
      throw error;
    }
  }

  dot('ok'); render(); updateStorageMeter();
  await loadGlobalUsage();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function addTodo(text, priority, desc) {
  text = text.trim(); if (!text) return;
  if (mode === 'guest') {
    todos.unshift({ id: uid(), text, desc: desc.trim(), priority, done: false, created: new Date().toISOString() });
    saveGuest(); render();
  } else {
    dot('syncing');
    const { error } = await sb.from('todos').insert({
      user_id: currentUser.id, text, description: desc.trim(), priority, done: false
    });
    if (error) { dot('err'); toast('add failed: ' + error.message, 'var(--danger)'); return; }
    await loadSynced();
  }
}

async function toggleDone(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  t.done = !t.done;
  if (mode === 'guest') { saveGuest(); render(); }
  else {
    render();
    dot('syncing');
    const { error } = await sb.from('todos').update({ done: t.done }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { t.done = !t.done; dot('err'); render(); } else dot('ok');
  }
}

async function deleteTodo(id) {
  confirmDeleteId = null;
  if (mode === 'guest') {
    todos = todos.filter(t => t.id !== id); delete attMap[id]; saveGuest(); render();
  } else {
    dot('syncing');
    try {
      await removeStoragePaths((attMap[id] || []).map(a => a.path));
      const { error: attErr } = await sb.from('attachments').delete().eq('todo_id', id).eq('user_id', currentUser.id);
      if (attErr) throw attErr;
      const { error } = await sb.from('todos').delete().eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('delete failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced();
  }
}

async function commitEdit(id, text, desc) {
  text = text.trim(); if (!text) { clearEditingState(); render(); return; }
  if (mode === 'guest') {
    const t = todos.find(t => t.id === id);
    if (t) { t.text = text; t.desc = desc.trim(); }
    clearEditingState(); saveGuest(); render();
  } else {
    dot('syncing');
    const { error } = await sb.from('todos').update({ text, description: desc.trim() }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { dot('err'); toast('save failed', 'var(--danger)'); return; }
    clearEditingState(); await loadSynced();
  }
}

async function clearDone() {
  const ids = todos.filter(t => t.done).map(t => t.id); if (!ids.length) return;
  if (mode === 'guest') {
    todos = todos.filter(t => !t.done); ids.forEach(id => delete attMap[id]); saveGuest(); render(); toast('completed cleared');
  } else {
    dot('syncing');
    try {
      await removeStoragePaths(ids.flatMap(id => (attMap[id] || []).map(a => a.path)));
      const { error: attErr } = await sb.from('attachments').delete().in('todo_id', ids).eq('user_id', currentUser.id);
      if (attErr) throw attErr;
      const { error } = await sb.from('todos').delete().in('id', ids).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('clear failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced(); toast('completed cleared');
  }
}

async function clearDoneAttachments() {
  const doneIds = new Set(todos.filter(t => t.done).map(t => t.id));
  const affected = Object.keys(attMap).filter(id => doneIds.has(id));
  if (!affected.length) { toast('no attachments on completed tasks'); return; }
  if (!confirm('Delete all attachments from completed tasks?')) return;
  if (mode === 'guest') {
    affected.forEach(id => delete attMap[id]); saveGuest(); render(); toast('cleared');
  } else {
    dot('syncing');
    try {
      await removeStoragePaths(affected.flatMap(id => (attMap[id] || []).map(a => a.path)));
      const { error } = await sb.from('attachments').delete().in('todo_id', affected).eq('user_id', currentUser.id);
      if (error) throw error;
    } catch (error) {
      dot('err'); toast('clear failed: ' + error.message, 'var(--danger)'); return;
    }
    await loadSynced(); toast('cleared attachments from completed tasks');
  }
}

async function importSyncedTodos(importedTodos, importedAtts, merge) {
  const skippedAttachments = Object.values(importedAtts).reduce((count, atts) => count + atts.length, 0);

  if (!merge) {
    await removeStoragePaths(Object.values(attMap).flat().map(a => a.path));
    const { error: attErr } = await sb.from('attachments').delete().eq('user_id', currentUser.id);
    if (attErr) throw attErr;
    const { error: todoErr } = await sb.from('todos').delete().eq('user_id', currentUser.id);
    if (todoErr) throw todoErr;
  }

  for (const todo of importedTodos) {
    const normalized = normalize(todo);
    const payload = {
      user_id: currentUser.id,
      text: normalized.text,
      description: normalized.desc,
      priority: normalized.priority,
      done: normalized.done
    };
    if (merge && todos.some(t => t.id === normalized.id)) continue;

    const { error } = await sb.from('todos').insert(payload);
    if (error) throw error;
  }

  await loadSynced();
  toast((merge ? 'merged ' : 'imported ') + importedTodos.length + ' tasks'
    + (skippedAttachments ? ' · attachments skipped in sync mode' : ''));
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function getFiltered() {
  let list = filter === 'active' ? todos.filter(t => !t.done)
    : filter === 'done' ? todos.filter(t => t.done)
    : filter === 'high' ? todos.filter(t => t.priority === 'high')
    : todos;
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(t => t.text.toLowerCase().includes(q) || (t.desc||'').toLowerCase().includes(q));
  }
  return list;
}

function render() {
  const list = getFiltered();
  const done = todos.filter(t => t.done).length;
  if (currentPage === 'todo') {
    document.getElementById('statsLabel').textContent = (todos.length - done) + ' active · ' + done + ' done' + (searchQ ? ' · ' + list.length + ' results' : '');
  }
  const bb = document.getElementById('bottomBar');
  bb.style.display = todos.length ? 'flex' : 'none';
  document.getElementById('bottomCount').textContent = todos.length + ' total';

  const tl = document.getElementById('todoList');
  if (!list.length) {
    tl.innerHTML = '<div class="empty"><div class="big">' + (searchQ ? '🔍' : filter === 'done' ? '☐' : '◈') + '</div><p>'
      + (searchQ ? 'no results for "' + esc(searchQ) + '"' : filter === 'done' ? 'nothing done yet' : filter === 'active' ? 'all caught up' : filter === 'high' ? 'no high priority' : 'add your first task')
      + '</p></div>';
    return;
  }
  tl.innerHTML = '';
  list.forEach(t => tl.appendChild(buildItem(t)));
  bindEvents(tl);
  if (mode === 'synced') loadSignedPreviews(tl);
}

function buildItem(t) {
  const isEdit = editingId === t.id;
  const isConfirmDel = confirmDeleteId === t.id;
  const isExpanded = expandedIds.has(t.id);
  const isAttOpen = openAttIds.has(t.id);
  const hasDesc = !!(t.desc && t.desc.trim());
  const atts = attMap[t.id] || [];

  const div = document.createElement('div');
  div.className = 'todo-item' + (t.done ? ' done' : '');
  div.dataset.id = t.id;

  let body;
  if (isEdit) {
    const valueToUse = editingId === t.id && editingValue !== '' ? editingValue : t.text;
    body = '<input class="edit-inp" value="' + esc(valueToUse) + '" data-id="' + t.id + '">'
      + '<textarea class="edit-desc-ta" data-id="' + t.id + '" rows="2" placeholder="description...">' + esc(t.desc||'') + '</textarea>';
  } else {
    const attBadge = atts.length ? ' · 📎 ' + atts.length : '';
    const descBtn = '<button class="expand-btn' + (hasDesc ? ' vis' : '') + (isExpanded ? ' open' : '') + '" data-role="desc" data-id="' + t.id + '"><i class="arr">▶</i> ' + (hasDesc ? (isExpanded ? 'hide' : 'notes') : '+ note') + '</button>';
    const attLabel = isAttOpen ? 'hide' : (atts.length ? 'files (' + atts.length + ')' : 'files');
    const attBtn = '<button class="expand-btn' + (atts.length ? ' vis' : '') + (isAttOpen ? ' open' : '') + '" data-role="att" data-id="' + t.id + '"><i class="arr">▶</i> ' + attLabel + '</button>';
    body = '<span class="todo-text">' + esc(t.text) + '</span>'
      + '<div class="todo-meta">' + t.priority.toUpperCase() + ' · ' + fmtDate(t.created) + attBadge + '</div>'
      + '<div class="expand-row">' + descBtn + attBtn + '</div>'
      + (hasDesc ? '<div class="todo-desc' + (isExpanded ? ' open' : '') + '">' + esc(t.desc) + '</div>' : '')
      + (isAttOpen ? buildAttPanel(t.id, atts) : '');
  }

  let actions;
  if (isEdit) {
    actions = '<button class="act save-btn" data-id="' + t.id + '">SAVE</button><button class="act cancel-btn">×</button>';
  } else if (isConfirmDel) {
    actions = '<span class="del-confirm"><span>sure?</span>'
      + '<button class="act del-yes" data-id="' + t.id + '">YES</button>'
      + '<button class="act del-no">NO</button></span>';
  } else {
    actions = '<button class="act edit-btn" data-id="' + t.id + '">EDIT</button>'
      + '<button class="act del confirm-del-btn" data-id="' + t.id + '">DEL</button>';
  }

  div.innerHTML = '<div class="pbar ' + t.priority + '"></div>'
    + '<div class="check-area" data-id="' + t.id + '"><div class="check-box"></div></div>'
    + '<div class="todo-body">' + body + '</div>'
    + '<div class="todo-actions">' + actions + '</div>';
  return div;
}

function bindEvents(tl) {
  tl.querySelectorAll('.todo-item').forEach(item => {
    const btns = item.querySelectorAll('.expand-btn:not(.vis)');
    item.addEventListener('mouseenter', () => btns.forEach(b => b.style.opacity = '1'));
    item.addEventListener('mouseleave', () => btns.forEach(b => b.style.opacity = ''));
  });
  tl.querySelectorAll('.check-area').forEach(el => el.addEventListener('click', () => toggleDone(el.dataset.id)));
  tl.querySelectorAll('.edit-btn').forEach(el => el.addEventListener('click', () => {
    const todo = todos.find(t => t.id === el.dataset.id);
    if (todo) {
      editingId = el.dataset.id;
      editingValue = todo.text;
      saveEditingState();
      confirmDeleteId = null;
      render();
    }
    requestAnimationFrame(() => { const i = document.querySelector('.edit-inp'); if (i) { i.focus(); i.select(); } });
  }));
  tl.querySelectorAll('.confirm-del-btn').forEach(el => el.addEventListener('click', () => {
    confirmDeleteId = el.dataset.id; editingId = null; render();
  }));
  tl.querySelectorAll('.del-yes').forEach(el => el.addEventListener('click', () => deleteTodo(el.dataset.id)));
  tl.querySelectorAll('.del-no').forEach(el => el.addEventListener('click', () => { confirmDeleteId = null; render(); }));
  tl.querySelectorAll('.save-btn').forEach(el => el.addEventListener('click', () => {
    const inp = tl.querySelector('.edit-inp'), desc = tl.querySelector('.edit-desc-ta');
    if (inp) commitEdit(el.dataset.id, inp.value, desc?.value || '');
  }));
  tl.querySelectorAll('.cancel-btn').forEach(el => el.addEventListener('click', () => { clearEditingState(); render(); }));
  tl.querySelectorAll('.edit-inp').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { clearEditingState(); render(); }
      if (e.key === 'Enter' && !e.shiftKey) { const desc = tl.querySelector('.edit-desc-ta'); commitEdit(inp.dataset.id, inp.value, desc?.value||''); }
    });
    inp.addEventListener('input', e => {
      editingValue = e.target.value;
      saveEditingState();
    });
  });
  tl.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = btn.dataset.id, role = btn.dataset.role;
    if (role === 'desc') {
      if (!btn.classList.contains('vis') && !expandedIds.has(id)) {
        const todo = todos.find(t => t.id === id);
        if (todo) {
          editingId = id;
          editingValue = todo.text;
          saveEditingState();
        }
        render();
        requestAnimationFrame(() => { const ta = document.querySelector('.edit-desc-ta'); if (ta) ta.focus(); });
        return;
      }
      expandedIds.has(id) ? expandedIds.delete(id) : expandedIds.add(id);
    } else {
      openAttIds.has(id) ? openAttIds.delete(id) : openAttIds.add(id);
    }
    render();
  }));
  tl.querySelectorAll('.att-name').forEach(el => el.addEventListener('click', () => openAttachment(el.dataset.att)));
  tl.querySelectorAll('.att-img').forEach(img => img.addEventListener('click', () => openAttachment(img.dataset.att)));
  tl.querySelectorAll('.att-rm').forEach(btn => btn.addEventListener('click', () => deleteAttachment(btn.dataset.att, btn.dataset.tid)));
  tl.querySelectorAll('.file-input').forEach(inp => inp.addEventListener('change', async () => {
    const tid = inp.dataset.tid;
    const prog = document.getElementById('ap-' + tid);
    if (prog) prog.style.display = 'inline';
    for (const f of inp.files) await uploadFile(tid, f);
    if (prog) prog.style.display = 'none';
    inp.value = '';
  }));
}

// ── ADD FORM ──────────────────────────────────────────────────────────────────
const newDesc = document.getElementById('newDesc');
newDesc.addEventListener('input', () => { newDesc.style.height = 'auto'; newDesc.style.height = Math.min(newDesc.scrollHeight, 120) + 'px'; });
function doAdd() {
  const text = document.getElementById('newTask').value.trim(); if (!text) return;
  addTodo(text, document.getElementById('newPri').value, newDesc.value);
  document.getElementById('newTask').value = ''; newDesc.value = ''; newDesc.style.height = 'auto';
  document.getElementById('newTask').focus();
}
document.getElementById('btnAdd').addEventListener('click', doAdd);
document.getElementById('newTask').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.getElementById('searchInp').addEventListener('input', e => {
  searchQ = e.target.value.trim();
  document.getElementById('searchClear').className = 'search-clear' + (searchQ ? ' vis' : '');
  render();
});
document.getElementById('searchClear').addEventListener('click', () => {
  searchQ = ''; document.getElementById('searchInp').value = '';
  document.getElementById('searchClear').className = 'search-clear'; render();
});

// ── FILTERS ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => {
  filter = btn.dataset.f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); render();
}));
document.getElementById('btnClear').addEventListener('click', clearDone);
document.getElementById('btnClearAtts').addEventListener('click', clearDoneAttachments);

// ── EXPORT / IMPORT ───────────────────────────────────────────────────────────
document.getElementById('btnExport').addEventListener('click', () => {
  try {
    const blob = new Blob([JSON.stringify({ version: 3, exported: new Date().toISOString(), todos, attachments: attMap }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'todos_' + new Date().toISOString().slice(0,10) + '.json' });
    a.click(); URL.revokeObjectURL(a.href);
    toast('exported ' + todos.length + ' tasks');
  } catch(e) { toast('export failed', 'var(--danger)'); }
});

document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const merge = confirm('OK = Merge (keep existing)\nCancel = Replace all');
  if (!merge && !confirm('⚠️ Replace ALL current tasks?')) { e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const importedTodos = Array.isArray(data) ? data : (data.todos || []);
      const importedAtts = data.attachments || {};
      if (mode === 'guest' && merge) {
        const ex = new Set(todos.map(t => t.id));
        todos = [...importedTodos.filter(t => !ex.has(t.id)), ...todos];
        for (const [tid, atts] of Object.entries(importedAtts)) {
          if (!attMap[tid]) attMap[tid] = [];
          const exA = new Set(attMap[tid].map(a => a.id));
          attMap[tid] = [...attMap[tid], ...atts.filter(a => !exA.has(a.id))];
        }
        toast('merged ' + importedTodos.length + ' tasks');
      } else if (mode === 'guest') {
        todos = [...importedTodos]; attMap = { ...importedAtts };
        toast('replaced with ' + todos.length + ' tasks');
      }
      if (mode === 'guest') { saveGuest(); render(); }
      else { await importSyncedTodos(importedTodos, importedAtts, merge); }
    } catch(err) { toast('import failed: ' + err.message, 'var(--danger)'); }
    e.target.value = '';
  };
  reader.readAsText(file);
});
