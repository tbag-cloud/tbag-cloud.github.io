// ── GUEST MODE ────────────────────────────────────────────────────────────────
const _elTodoList = document.getElementById('todoList');
const _elBottomBar = document.getElementById('bottomBar');
const _elBottomCount = document.getElementById('bottomCount');

function enterGuestMode() {
  mode = 'guest'; currentUser = null;
  watchlistSyncAvailable = true;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = '';
  if (typeof repositionSiteBanner === 'function') repositionSiteBanner();
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
  renderWatchlist();
  globalUsage = null;
  updateAdminAccess();
  setPage(pageFromHash(), { updateHash: false });
  render(); updateStorageMeter();
  localStorage.setItem(LS_GUEST, '1');
}

function saveGuest() {
  try {
    localStorage.setItem(LS_TODOS, JSON.stringify(todos));
    localStorage.setItem(LS_ATTS, JSON.stringify(attMap));
  } catch(e) { toast('storage full', 'var(--accent2)'); }
  updateStorageMeter();
}

// ── LOAD SYNCED ───────────────────────────────────────────────────────────────
let _loadingSynced = false;
async function loadSynced() {
  if (_loadingSynced) return;
  _loadingSynced = true;
  dot('syncing');
  try {
    const [todosResult, attsResult] = await Promise.all([
      sb.from('todos').select('*').eq('user_id', currentUser.id),
      sb.from('attachments').select('*').eq('user_id', currentUser.id).catch(e => { console.warn('attachments query failed:', e); return { data: [], error: e }; })
    ]);

    const tData = todosResult.data;
    const tErr = todosResult.error;
    if (tErr) { dot('err'); toast('load error: ' + tErr.message, 'var(--danger)'); return; }

    let aData = [];
    if (attsResult.error) {
      console.warn('attachments query error:', attsResult.error);
    } else {
      aData = (attsResult.data || []).filter(a => !a.is_standalone && (!a.path || !a.path.includes('/drive/')));
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
        renderWatchlist();
        toast('watchlist sync unavailable - run watchlist SQL', 'var(--danger)');
      } else {
        throw error;
      }
    }

    dot('ok'); render(); updateStorageMeter();
    await loadGlobalUsage();
  } finally {
    _loadingSynced = false;
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
function newTodo(text, priority, desc) {
  return { id: uid(), text: text.trim(), desc: desc.trim(), priority, done: false, created: new Date().toISOString(), archived: false, due: null, tags: [], repeat: null, subtasks: [] };
}
async function addTodo(text, priority, desc) {
  text = text.trim(); if (!text) return;
  const todo = newTodo(text, priority, desc);
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    todos.unshift(todo);
    saveGuest(); render();
  } else {
    dot('syncing');
    const { error } = await sb.from('todos').insert({
      user_id: currentUser.id, text, description: desc.trim(), priority, done: false, metadata: metaPayload(todo)
    });
    if (error) { dot('err'); toast('add failed: ' + error.message, 'var(--danger)'); return; }
    await loadSynced();
  }
}

async function toggleDone(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  const wasDone = t.done;
  t.done = !t.done;
  // Recurring: when marking done, create a new un-done copy
  let copy;
  if (t.done && t.repeat) {
    copy = newTodo(t.text, t.priority, t.desc);
    copy.tags = [...t.tags];
    copy.subtasks = t.subtasks.filter(s => !s.done).map(s => ({ ...s, id: uid() }));
    if (t.due) {
      const d = new Date(t.due);
      if (t.repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (t.repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (t.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
      copy.due = d.toISOString().slice(0, 10);
    }
    if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
      todos.unshift(copy);
    }
  }
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) { saveGuest(); renderItem(t); }
  else {
    renderItem(t);
    dot('syncing');
    try {
      if (t.done && t.repeat) {
        const { error: insErr } = await sb.from('todos').insert({
          user_id: currentUser.id, text: copy.text, description: copy.desc, priority: copy.priority, done: false, metadata: metaPayload(copy)
        });
        if (insErr) throw insErr;
      }
      const { error } = await sb.from('todos').update({ done: t.done, metadata: metaPayload(t) }).eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
      dot('ok');
      await loadSynced();
    } catch (error) {
      t.done = wasDone; dot('err'); toast('sync failed: ' + error.message, 'var(--danger)'); renderItem(t);
    }
  }
}

async function deleteTodo(id) {
  pushUndo();
  confirmDeleteId = null;
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
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
  undoableToast('deleted');
}

async function commitEdit(id, text, desc) {
  text = text.trim(); if (!text) { clearEditingState(); render(); return; }
  pushUndo();
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    const t = todos.find(t => t.id === id);
    if (t) { t.text = text; t.desc = desc.trim(); }
    clearEditingState(); saveGuest(); render();
  } else {
    dot('syncing');
    const t = todos.find(t => t.id === id);
    const { error } = await sb.from('todos').update({ text, description: desc.trim(), metadata: t ? metaPayload(t) : undefined }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { dot('err'); toast('save failed', 'var(--danger)'); return; }
    clearEditingState(); await loadSynced();
  }
}

async function clearDone() {
  const ids = todos.filter(t => t.done).map(t => t.id); if (!ids.length) return;
  pushUndo();
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    todos = todos.filter(t => !t.done); ids.forEach(id => delete attMap[id]); saveGuest(); render();
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
    await loadSynced();
  }
  undoableToast('completed cleared');
}

async function clearDoneAttachments() {
  const doneIds = new Set(todos.filter(t => t.done).map(t => t.id));
  const affected = Object.keys(attMap).filter(id => doneIds.has(id));
  if (!affected.length) { toast('no attachments on completed tasks'); return; }
  if (!await showConfirm('Delete all attachments from completed tasks?')) return;
  pushUndo();
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
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

async function importSyncedTodos(importedTodos, merge) {
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
      done: normalized.done,
      metadata: metaPayload(normalized)
    };
    if (merge && todos.some(t => t.id === normalized.id)) continue;

    const { error } = await sb.from('todos').insert(payload);
    if (error) throw error;
  }

  await loadSynced();
  toast((merge ? 'merged ' : 'imported ') + importedTodos.length + ' tasks');
}

// ── UNDO ──────────────────────────────────────────────────────────────────────
function pushUndo() {
  undoStack.push(JSON.stringify(todos));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}
function popUndo() {
  if (!undoStack.length) return;
  todos = JSON.parse(undoStack.pop());
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) saveGuest();
  render();
  toast('undone');
}

// ── ARCHIVE / RESTORE ─────────────────────────────────────────────────────────
function archiveTodo(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  pushUndo();
  t.archived = !t.archived;
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) { saveGuest(); render(); }
  else {
    sb.from('todos').update({ metadata: metaPayload(t) }).eq('id', id).eq('user_id', currentUser.id).then().catch();
    render();
  }
  toast(t.archived ? 'archived' : 'restored');
}
async function archiveDone() {
  const ids = todos.filter(t => t.done && !t.archived).map(t => t.id); if (!ids.length) return;
  pushUndo();
  ids.forEach(id => { const t = todos.find(x => x.id === id); if (t) t.archived = true; });
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    saveGuest();
  } else {
    dot('syncing');
    try {
      await Promise.all(ids.map(id => sb.from('todos').update({ metadata: metaPayload(todos.find(x => x.id === id)) }).eq('id', id).eq('user_id', currentUser.id)));
      dot('ok');
    } catch { dot('err'); }
  }
  render();
  toast('archived ' + ids.length + ' completed');
}

// ── BULK ──────────────────────────────────────────────────────────────────────
function toggleBulkMode() {
  bulkMode = !bulkMode;
  if (!bulkMode) bulkSelection.clear();
  render();
}
function bulkToggle(id) {
  bulkSelection.has(id) ? bulkSelection.delete(id) : bulkSelection.add(id);
  render();
}
function bulkSelectAll() {
  const list = getFiltered().filter(t => !t.archived);
  list.forEach(t => bulkSelection.add(t.id));
  render();
}
async function bulkAction(action) {
  if (!bulkSelection.size) return;
  pushUndo();
  const ids = [...bulkSelection];
  if (action === 'done') {
    todos.forEach(t => { if (ids.includes(t.id)) t.done = true; });
  } else if (action === 'active') {
    todos.forEach(t => { if (ids.includes(t.id)) t.done = false; });
  } else if (action === 'archive') {
    todos.forEach(t => { if (ids.includes(t.id)) t.archived = true; });
  } else if (action === 'delete') {
    todos = todos.filter(t => !ids.includes(t.id));
    ids.forEach(id => delete attMap[id]);
  }
  bulkSelection.clear();
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    saveGuest();
  } else {
    dot('syncing');
    try {
      await Promise.all(ids.map(id => {
        const t = todos.find(x => x.id === id);
        if (action === 'delete') {
          return sb.from('todos').delete().eq('id', id).eq('user_id', currentUser.id);
        }
        if (!t) return;
        if (action === 'done' || action === 'active') {
          return sb.from('todos').update({ done: t.done, metadata: metaPayload(t) }).eq('id', id).eq('user_id', currentUser.id);
        }
        if (action === 'archive') {
          return sb.from('todos').update({ metadata: metaPayload(t) }).eq('id', id).eq('user_id', currentUser.id);
        }
      }));
      dot('ok');
    } catch { dot('err'); }
  }
  render();
  toast('bulk ' + action + ': ' + ids.length + ' items');
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function getFiltered() {
  let list = filter === 'archived' ? todos.filter(t => t.archived)
    : filter === 'active' ? todos.filter(t => !t.done && !t.archived)
    : filter === 'done' ? todos.filter(t => t.done && !t.archived)
    : filter === 'high' ? todos.filter(t => t.priority === 'high' && !t.archived)
    : todos.filter(t => !t.archived);
  if (currentTagFilter) {
    list = list.filter(t => t.tags && t.tags.includes(currentTagFilter));
  }
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(t => t.text.toLowerCase().includes(q) || (t.desc||'').toLowerCase().includes(q) || (t.tags||[]).some(tag => tag.toLowerCase().includes(q)));
  }
  // Sort by due date if filter has due sort
  if (filter === 'due') {
    list = [...list].sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1; if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  }
  return list;
}

function render() {
  const list = getFiltered();
  if (!_elBottomBar || !_elBottomCount) return;
  focusedItemId = null;
  const activeCount = todos.filter(t => !t.archived).length;
  _elBottomBar.style.display = activeCount ? 'flex' : 'none';
  _elBottomCount.textContent = activeCount + ' active' + (todos.filter(t => t.archived).length ? ' · ' + todos.filter(t => t.archived).length + ' archived' : '');

  if (!list.length) {
    if (_elTodoList) _elTodoList.innerHTML = '<div class="empty"><div class="big">' + (searchQ ? '🔍' : filter === 'done' ? '☐' : filter === 'archived' ? '📦' : '◈') + '</div><p>'
      + (searchQ ? 'no results for "' + esc(searchQ) + '"' : filter === 'done' ? 'nothing done yet' : filter === 'active' ? 'all caught up' : filter === 'high' ? 'no high priority' : filter === 'archived' ? 'nothing archived' : 'add your first task')
      + '</p></div>';
    return;
  }
  if (!_elTodoList) return;
  _elTodoList.innerHTML = '';
  // Bulk bar
  if (bulkMode) {
    const bar = document.createElement('div');
    bar.className = 'bulk-bar';
    bar.innerHTML = '<span class="bulk-count">' + bulkSelection.size + ' selected</span>'
      + '<button class="bulk-btn" data-bulk="done">DONE</button>'
      + '<button class="bulk-btn" data-bulk="active">UNDONE</button>'
      + '<button class="bulk-btn" data-bulk="archive">ARCHIVE</button>'
      + '<button class="bulk-btn danger" data-bulk="delete">DELETE</button>'
      + '<button class="bulk-btn" data-bulk="select-all">ALL</button>';
    _elTodoList.appendChild(bar);
  }
  list.forEach(t => _elTodoList.appendChild(buildItem(t)));
  if (typeof _realMode !== 'undefined' && _realMode === 'synced') loadSignedPreviews(_elTodoList);
}

function renderItem(t) {
  if (!_elTodoList) return;
  const existing = _elTodoList.querySelector(`.todo-item[data-id="${t.id}"]`);
  if (existing) existing.replaceWith(buildItem(t));
}

function buildItem(t) {
  const isEdit = editingId === t.id;
  const isConfirmDel = confirmDeleteId === t.id;
  const isExpanded = expandedIds.has(t.id);
  const isAttOpen = openAttIds.has(t.id);
  const isSubOpen = expandedIds.has('sub_' + t.id);
  const hasDesc = !!(t.desc && t.desc.trim());
  const atts = attMap[t.id] || [];

  const div = document.createElement('div');
  div.className = 'todo-item' + (t.done ? ' done' : '') + (t.archived ? ' archived' : '');
  div.dataset.id = t.id;

  let body;
  if (isEdit) {
    const valueToUse = editingId === t.id && editingValue !== '' ? editingValue : t.text;
    body = '<input class="edit-inp" value="' + esc(valueToUse) + '" data-id="' + t.id + '">'
      + '<textarea class="edit-desc-ta" data-id="' + t.id + '" rows="2" placeholder="description...">' + esc(t.desc||'') + '</textarea>'
      + '<div class="edit-extras"><input class="edit-due" type="date" value="' + (t.due||'') + '" data-id="' + t.id + '">'
      + '<input class="edit-tags" placeholder="tags (comma)" value="' + esc((t.tags||[]).join(', ')) + '" data-id="' + t.id + '">'
      + '<select class="edit-repeat" data-id="' + t.id + '">'
      + '<option value="">no repeat</option>'
      + '<option value="daily"' + (t.repeat==='daily'?' selected':'') + '>daily</option>'
      + '<option value="weekly"' + (t.repeat==='weekly'?' selected':'') + '>weekly</option>'
      + '<option value="monthly"' + (t.repeat==='monthly'?' selected':'') + '>monthly</option>'
      + '</select></div>';
  } else {
    // Meta line: priority, date, due badge, tags, repeat indicator
    let metaParts = [t.priority.toUpperCase(), fmtDate(t.created)];
    if (t.due) {
      const isOverdue = new Date(t.due) < new Date(new Date().toISOString().slice(0,10)) && !t.done;
      metaParts.push('<span class="due-badge' + (isOverdue ? ' overdue' : '') + '">due ' + t.due + '</span>');
    }
    if (t.repeat) metaParts.push('↻ ' + t.repeat);
    if (atts.length) metaParts.push('📎 ' + atts.length);
    const metaHtml = metaParts.join(' · ');

    // Tags
    let tagsHtml = '';
    if (t.tags && t.tags.length) {
      tagsHtml = '<div class="todo-tags">' + t.tags.map(tag =>
        '<span class="todo-tag" data-tag="' + esc(tag) + '">' + esc(tag) + '</span>'
      ).join('') + '</div>';
    }

    const isNoteEditing = noteEditingId === t.id;
    const descBtn = '<button class="expand-btn vis' + (isExpanded ? ' open' : '') + '" data-role="desc" data-id="' + t.id + '"><i class="arr">▶</i> ' + (isNoteEditing ? 'cancel' : hasDesc ? (isExpanded ? 'hide' : 'notes') : '+ note') + '</button>';
    const attLabel = isAttOpen ? 'hide' : (atts.length ? 'files (' + atts.length + ')' : 'files');
    const attBtn = '<button class="expand-btn' + (atts.length ? ' vis' : '') + (isAttOpen ? ' open' : '') + '" data-role="att" data-id="' + t.id + '"><i class="arr">▶</i> ' + attLabel + '</button>';
    // Subtasks expand button
    const subCount = (t.subtasks||[]).length;
    const subBtn = subCount ? '<button class="expand-btn vis' + (isSubOpen ? ' open' : '') + '" data-role="sub" data-id="' + t.id + '"><i class="arr">▶</i> ' + (isSubOpen ? 'hide' : subCount + ' subtask' + (subCount===1?'':'s')) + '</button>' : '';

    let descHtml;
    if (isNoteEditing) {
      descHtml = '<textarea class="note-edit-ta" data-id="' + t.id + '" rows="1" placeholder="add note...">' + esc(t.desc||'') + '</textarea>';
    } else if (hasDesc) {
      descHtml = '<div class="todo-desc' + (isExpanded ? ' open' : '') + '">' + esc(t.desc) + '</div>';
    } else {
      descHtml = '';
    }

    // Subtasks
    let subsHtml = '';
    if (isSubOpen && subCount) {
      subsHtml = '<div class="subtask-list">' + t.subtasks.map(s =>
        '<div class="subtask">'
        + '<span class="sub-check' + (s.done ? ' done' : '') + '" data-sub="' + s.id + '" data-tid="' + t.id + '">' + (s.done ? '✓' : '○') + '</span>'
        + '<span class="sub-text' + (s.done ? ' done' : '') + '">' + esc(s.text) + '</span>'
        + '<button class="sub-del" data-sub="' + s.id + '" data-tid="' + t.id + '">×</button>'
        + '</div>'
      ).join('')
      + '<div class="sub-add-row"><input class="sub-add-inp" placeholder="+ subtask" data-tid="' + t.id + '"></div>'
      + '</div>';
    }

    body = '<div class="todo-top">'
      + '<span class="todo-text">' + esc(t.text) + '</span>'
      + '<div class="todo-meta">' + metaHtml + '</div>'
      + tagsHtml
      + '</div>'
      + '<div class="expand-row">' + descBtn + attBtn + subBtn + '</div>'
      + descHtml
      + (isAttOpen ? buildAttPanel(t.id, atts) : '')
      + subsHtml;
  }

  let actions;
  if (isEdit) {
    actions = '<button class="act save-btn" data-id="' + t.id + '">SAVE</button><button class="act cancel-btn">×</button>';
  } else if (isConfirmDel) {
    actions = '<span class="del-confirm"><span>sure?</span>'
      + '<button class="act del-yes" data-id="' + t.id + '">YES</button>'
      + '<button class="act del-no">NO</button></span>';
  } else {
    const archBtn = '<button class="act arch-btn" data-id="' + t.id + '" title="' + (t.archived ? 'restore' : 'archive') + '">' + (t.archived ? '↩' : '📦') + '</button>';
    actions = (bulkMode ? '<span class="bulk-chk' + (bulkSelection.has(t.id) ? ' sel' : '') + '" data-bulk="' + t.id + '"></span>' : '')
      + '<button class="act edit-btn" data-id="' + t.id + '">EDIT</button>'
      + archBtn
      + '<button class="act del confirm-del-btn" data-id="' + t.id + '">DEL</button>';
  }

  div.innerHTML = (bulkMode ? '<div class="pbar ' + t.priority + '"></div>' : '<div class="pbar ' + t.priority + '"></div>')
    + '<div class="check-area" data-id="' + t.id + '"><div class="check-box"></div></div>'
    + '<div class="todo-body">' + body + '</div>'
    + '<div class="todo-actions">' + actions + '</div>';
  return div;
}

// ── DELEGATED EVENTS (set up once, not per render) ────────────────────
function setupTodoDelegatedEvents() {
  if (!_elTodoList) return;

  _elTodoList.addEventListener('click', e => {
    const target = e.target;

    // Bulk checkbox
    const bulkChk = target.closest('.bulk-chk');
    if (bulkChk) { bulkToggle(bulkChk.dataset.bulk); return; }
    // Bulk action buttons
    if (target.classList.contains('bulk-btn') && target.dataset.bulk) {
      if (target.dataset.bulk === 'select-all') { bulkSelectAll(); return; }
      bulkAction(target.dataset.bulk); return;
    }

    // Archive / restore
    if (target.classList.contains('arch-btn')) { archiveTodo(target.dataset.id); return; }
    // Archive done
    if (target.classList.contains('arch-done-btn')) { archiveDone(); return; }

    // Tag filter
    if (target.classList.contains('todo-tag')) {
      const tag = target.dataset.tag;
      currentTagFilter = currentTagFilter === tag ? '' : tag;
      render();
      return;
    }

    // Subtask delete
    const subDel = target.closest('.sub-del');
    if (subDel) {
      const tid = subDel.dataset.tid, sid = subDel.dataset.sub;
      const t = todos.find(x => x.id === tid);
      if (t && t.subtasks) {
        t.subtasks = t.subtasks.filter(x => x.id !== sid);
        renderItem(t);
      }
      return;
    }

    // Subtask toggle
    const subCheck = target.closest('.sub-check');
    if (subCheck) {
      const tid = subCheck.dataset.tid, sid = subCheck.dataset.sub;
      const t = todos.find(x => x.id === tid);
      if (t && t.subtasks) {
        const s = t.subtasks.find(x => x.id === sid);
        if (s) { s.done = !s.done; renderItem(t); }
      }
      return;
    }

    // Main check
    const checkArea = target.closest('.check-area');
    if (checkArea) { toggleDone(checkArea.dataset.id); return; }

    if (target.classList.contains('edit-btn')) {
      const todo = todos.find(t => t.id === target.dataset.id);
      if (todo) {
        editingId = target.dataset.id;
        editingValue = todo.text;
        saveEditingState();
        confirmDeleteId = null;
        render();
        requestAnimationFrame(() => { const i = document.querySelector('.edit-inp'); if (i) { i.focus(); i.select(); } });
      }
      return;
    }

    if (target.classList.contains('confirm-del-btn')) {
      confirmDeleteId = target.dataset.id; editingId = null; render();
      return;
    }

    if (target.classList.contains('del-yes')) { pushUndo(); deleteTodo(target.dataset.id); return; }
    if (target.classList.contains('del-no')) { confirmDeleteId = null; render(); return; }

    if (target.classList.contains('save-btn')) {
      const inp = _elTodoList.querySelector('.edit-inp'), desc = _elTodoList.querySelector('.edit-desc-ta');
      const due = _elTodoList.querySelector('.edit-due'), tags = _elTodoList.querySelector('.edit-tags'), repeat = _elTodoList.querySelector('.edit-repeat');
      const id = target.dataset.id;
      if (inp) {
        const t = todos.find(x => x.id === id);
        if (t) {
          t.due = due ? due.value || null : t.due;
          t.tags = tags ? tags.value.split(',').map(s => s.trim()).filter(Boolean) : t.tags;
          t.repeat = repeat ? repeat.value || null : t.repeat;
        }
        commitEdit(id, inp.value, desc?.value || '');
      }
      return;
    }

    if (target.classList.contains('cancel-btn')) { clearEditingState(); render(); return; }

    // Subtask add
    const subAdd = target.closest('.sub-add-btn');
    if (!subAdd) {
      const subInp = target.closest('.sub-add-inp');
      if (subInp && subInp.value.trim()) {
        const tid = subInp.dataset.tid;
        const t = todos.find(x => x.id === tid);
        if (t) {
          t.subtasks = t.subtasks || [];
          t.subtasks.push({ id: uid(), text: subInp.value.trim(), done: false });
          expandedIds.add('sub_' + tid);
          renderItem(t);
        }
      }
    }

    const expandBtn = target.closest('[data-role]');
    if (expandBtn) {
      e.stopPropagation();
      const id = expandBtn.dataset.id, role = expandBtn.dataset.role;
      if (role === 'sub') {
        expandedIds.has('sub_' + id) ? expandedIds.delete('sub_' + id) : expandedIds.add('sub_' + id);
        const todo = todos.find(t => t.id === id);
        if (todo) { renderItem(todo); return; }
      } else if (role === 'desc') {
        if (noteEditingId === id) {
          noteEditingId = null;
          const t = todos.find(t => t.id === id);
          if (t) renderItem(t);
          return;
        }
        if (noteEditingId && noteEditingId !== id) {
          const prevTa = document.querySelector('.note-edit-ta');
          let prev;
          if (prevTa) {
            prev = todos.find(t => t.id === noteEditingId);
            if (prev) prev.desc = prevTa.value.trim();
            if (typeof _realMode !== 'undefined' && _realMode !== 'guest') {
              sb.from('todos').update({ description: prevTa.value.trim(), metadata: metaPayload(prev) }).eq('id', noteEditingId).eq('user_id', currentUser.id).then().catch();
            }
          }
          noteEditingId = null;
          if (prev) renderItem(prev);
        }
        const todo = todos.find(t => t.id === id);
        if (todo && !(todo.desc && todo.desc.trim())) {
          noteEditingId = id;
          renderItem(todo);
          requestAnimationFrame(() => { const nt = document.querySelector('.note-edit-ta'); if (nt) nt.focus(); });
          return;
        }
        expandedIds.has(id) ? expandedIds.delete(id) : expandedIds.add(id);
        if (todo) { renderItem(todo); return; }
      } else {
        openAttIds.has(id) ? openAttIds.delete(id) : openAttIds.add(id);
        const todo = todos.find(t => t.id === id);
        if (todo) { renderItem(todo); return; }
      }
    }

    const attName = target.closest('.att-name');
    if (attName) { openAttachment(attName.dataset.att); return; }

    const attImg = target.closest('.att-img, .att-thumb');
    if (attImg) { openAttachment(attImg.dataset.att); return; }

    const attRm = target.closest('.att-rm');
    if (attRm) { deleteAttachment(attRm.dataset.att, attRm.dataset.tid); return; }
  });

  _elTodoList.addEventListener('keydown', e => {
    const inp = e.target.closest('.edit-inp');
    if (inp) {
      if (e.key === 'Escape') { clearEditingState(); render(); }
      if (e.key === 'Enter' && !e.shiftKey) {
        const desc = _elTodoList.querySelector('.edit-desc-ta');
        commitEdit(inp.dataset.id, inp.value, desc?.value || '');
      }
      return;
    }
    const noteTa = e.target.closest('.note-edit-ta');
    if (noteTa) {
      if (e.key === 'Escape') { noteEditingId = null; render(); }
      return;
    }
    const subInp = e.target.closest('.sub-add-inp');
    if (subInp && e.key === 'Enter' && subInp.value.trim()) {
      const tid = subInp.dataset.tid;
      const t = todos.find(x => x.id === tid);
      if (t) {
        t.subtasks = t.subtasks || [];
        t.subtasks.push({ id: uid(), text: subInp.value.trim(), done: false });
        expandedIds.add('sub_' + tid);
        renderItem(t);
      }
    }
  });

  _elTodoList.addEventListener('focusout', e => {
    const ta = e.target.closest('.note-edit-ta');
    if (!ta) return;
    const id = ta.dataset.id;
    if (noteEditingId !== id) return;
    const text = ta.value.trim();
    const t = todos.find(t => t.id === id);
    if (!t) return;
    t.desc = text;
    noteEditingId = null;
    if (typeof _realMode !== 'undefined' && _realMode !== 'guest') {
      sb.from('todos').update({ description: text, metadata: t ? metaPayload(t) : undefined }).eq('id', id).eq('user_id', currentUser.id).then().catch();
    } else {
      saveGuest();
    }
    render();
  });

  _elTodoList.addEventListener('input', e => {
    const inp = e.target.closest('.edit-inp');
    if (inp) {
      editingValue = inp.value;
      saveEditingState();
    }
  });

  _elTodoList.addEventListener('change', async e => {
    const inp = e.target.closest('.file-input');
    if (!inp) return;
    const tid = inp.dataset.tid;
    const prog = document.getElementById('ap-' + tid);
    if (prog) prog.style.display = 'inline';
    for (const f of inp.files) await uploadFile(tid, f);
    if (prog) prog.style.display = 'none';
    inp.value = '';
  });
}

setupTodoDelegatedEvents();

// ── ADD FORM ──────────────────────────────────────────────────────────────────
const newDesc = document.getElementById('newDesc');
newDesc.addEventListener('input', () => {
  if (newDesc.scrollHeight) { newDesc.style.height = 'auto'; newDesc.style.height = Math.min(newDesc.scrollHeight, 120) + 'px'; }
});
function doAdd() {
  const text = document.getElementById('newTask').value.trim(); if (!text) return;
  addTodo(text, document.getElementById('newPri').value, newDesc.value);
  document.getElementById('newTask').value = ''; newDesc.value = ''; newDesc.style.height = 'auto';
  document.getElementById('newTask').focus();
}
document.getElementById('btnAdd').addEventListener('click', doAdd);
document.getElementById('newTask').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

// ── GLOBAL KEYBOARD SHORTCUTS ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ignore if typing in an input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { popUndo(); e.preventDefault(); }
    return;
  }
  if (e.key === 'n' && currentPage === 'todo') {
    e.preventDefault();
    const inp = document.getElementById('newTask');
    if (inp) inp.focus();
  }
  if (e.key === '/' && currentPage === 'todo') {
    e.preventDefault();
    document.getElementById('searchInp').focus();
  }
  if (e.key === 'b' && currentPage === 'todo') {
    e.preventDefault(); toggleBulkMode();
  }
  if ((e.key === 'j' || e.key === 'k') && currentPage === 'todo') {
    e.preventDefault();
    const items = _elTodoList.querySelectorAll('.todo-item');
    if (!items.length) return;
    const ids = [...items].map(el => el.dataset.id);
    const curIdx = focusedItemId ? ids.indexOf(focusedItemId) : -1;
    const nextIdx = e.key === 'j' ? Math.min(curIdx + 1, ids.length - 1) : Math.max(curIdx - 1, 0);
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    focusedItemId = ids[nextIdx];
    items.forEach(el => el.classList.toggle('focused', el.dataset.id === focusedItemId));
    items[nextIdx].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Escape') {
    if (bulkMode) { toggleBulkMode(); return; }
    if (editingId) { clearEditingState(); render(); return; }
    if (noteEditingId) { noteEditingId = null; render(); return; }
    closeAppMenu();
  }
});

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
const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => btn.addEventListener('click', () => {
  filter = btn.dataset.f;
  filterBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); render();
}));
document.getElementById('filterArchived').addEventListener('click', () => {
  filter = 'archived'; currentTagFilter = '';
  filterBtns.forEach(b => b.classList.remove('active'));
  document.getElementById('filterArchived').classList.add('active'); render();
});
document.getElementById('filterDue').addEventListener('click', () => {
  filter = 'due'; currentTagFilter = '';
  filterBtns.forEach(b => b.classList.remove('active'));
  document.getElementById('filterDue').classList.add('active'); render();
});
document.getElementById('btnBulk').addEventListener('click', toggleBulkMode);
document.getElementById('btnUndo').addEventListener('click', popUndo);
document.getElementById('btnArchiveDone').addEventListener('click', archiveDone);
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
  const merge = await showConfirm('OK = Merge (keep existing)\nCancel = Replace all');
  if (!merge) {
    const reallyReplace = await showConfirm('⚠️ Replace ALL current tasks?');
    if (!reallyReplace) { e.target.value = ''; return; }
  }
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const importedTodos = Array.isArray(data) ? data : (data.todos || []);
      const importedAtts = data.attachments || {};
      if ((typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) && merge) {
        const ex = new Set(todos.map(t => t.id));
        todos = [...importedTodos.filter(t => !ex.has(t.id)), ...todos];
        for (const [tid, atts] of Object.entries(importedAtts)) {
          if (!attMap[tid]) attMap[tid] = [];
          const exA = new Set(attMap[tid].map(a => a.id));
          attMap[tid] = [...attMap[tid], ...atts.filter(a => !exA.has(a.id))];
        }
        toast('merged ' + importedTodos.length + ' tasks');
      } else if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
        todos = [...importedTodos]; attMap = { ...importedAtts };
        toast('replaced with ' + todos.length + ' tasks');
      }
      if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) { saveGuest(); render(); }
      else { await importSyncedTodos(importedTodos, merge); }
    } catch(err) { toast('import failed: ' + err.message, 'var(--danger)'); }
    e.target.value = '';
  };
  reader.readAsText(file);
});
