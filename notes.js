// ── NOTES ────────────────────────────────────────────────────────────────────
const LS_NOTES = 'notes_v1';
const NOTE_COLORS = ['', 'accent', 'accent2', 'danger', 'success', 'warning'];
let notesData = [];
let notesArchivedView = false;
let pendingAttachments = [];
const MAX_NOTE_FILE = 5 * 1024 * 1024;

function noteId() { return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }

function loadGuestNotes() {
  try { notesData = JSON.parse(localStorage.getItem(LS_NOTES) || '[]'); } catch { notesData = []; }
}

function saveGuestNotes() {
  try {
    localStorage.setItem(LS_NOTES, JSON.stringify(notesData));
    renderNotes();
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      toast('Storage full — try smaller files or delete old notes', 'var(--danger)');
      if (notesData.length) notesData.pop();
    } else { throw e; }
    return false;
  }
}

async function saveNotesState() {
  if ((typeof _realMode !== 'undefined' ? _realMode === 'guest' : true)) {
    return saveGuestNotes();
  }
  try {
    await sb.from('notes').delete().eq('user_id', currentUser.id);
    if (notesData.length) {
      const rows = notesData.map(n => ({
        user_id: currentUser.id, text: n.text, pinned: n.pinned || false,
        color: n.color || '', archived: n.archived || false,
        attachments: JSON.stringify(n.attachments || []),
        created_at: n.created, updated_at: n.updated
      }));
      const { error } = await sb.from('notes').insert(rows);
      if (error) throw error;
    }
    renderNotes();
    return true;
  } catch (e) {
    if (e && e.message && (e.message.includes('42P01') || e.message.includes('notes'))) {
      return saveGuestNotes();
    }
    console.warn('notes save error:', e);
    return saveGuestNotes();
  }
}

async function loadSyncedNotes() {
  if (typeof _realMode !== 'undefined' && _realMode !== 'synced' || !currentUser) return;
  const { data, error } = await sb.from('notes').select('*').eq('user_id', currentUser.id);
  if (error) {
    if (error.message && (error.message.includes('42P01') || error.message.includes('notes'))) {
      loadGuestNotes();
      renderNotes();
      return;
    }
    console.warn('notes load error:', error);
    loadGuestNotes();
    renderNotes();
    return;
  }
  notesData = (data || []).map(n => ({
    id: n.id, text: n.text, pinned: n.pinned || false,
    color: n.color || '', archived: n.archived || false,
    attachments: (typeof n.attachments === 'string' ? JSON.parse(n.attachments) : (n.attachments || [])),
    created: n.created_at, updated: n.updated_at
  }));
  await loadNoteAttachmentUrls();
  renderNotes();
}

async function loadNoteAttachmentUrls() {
  const promises = [];
  for (const n of notesData) {
    for (const a of (n.attachments || [])) {
      if (a.path && !a.dataUrl && !a.signedUrl) {
        promises.push(
          sb.storage.from('attachments').createSignedUrl(a.path, 300).then(r => {
            if (r.data) a.signedUrl = r.data.signedUrl;
          }).catch(() => {})
        );
      }
    }
  }
  if (promises.length) await Promise.all(promises);
}

function getSortedNotes() {
  const view = notesArchivedView;
  const filtered = notesData.filter(n => view ? n.archived : !n.archived);
  return filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.created) - new Date(a.created);
  });
}

function fmtRelTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const d = Math.floor(hr / 24);
  if (d < 7) return d + 'd ago';
  if (d < 30) return Math.floor(d / 7) + 'w ago';
  return new Date(dateStr).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownToHtml(text) {
  let h = escHtml(text);
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/`(.+?)`/g, '<code>$1</code>');
  h = h.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/^- (.+)/gm, '<span class="note-bullet">•</span> $1');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function renderNotes() {
  const list = document.getElementById('notesList');
  const empty = document.getElementById('notesEmpty');
  const stats = document.getElementById('notesStats');
  if (!list) return;

  const sorted = getSortedNotes();

  if (sorted.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (stats) stats.textContent = notesArchivedView ? '0 archived' : '0 notes';
    return;
  }

  if (empty) empty.style.display = 'none';
  const activeCount = notesData.filter(n => !n.archived).length;
  const archivedCount = notesData.filter(n => n.archived).length;
  if (stats) {
    if (notesArchivedView) stats.textContent = archivedCount + ' archived';
    else stats.textContent = activeCount + ' note' + (activeCount === 1 ? '' : 's');
  }

  let html = '';
  let lastPinned = null;
  for (const n of sorted) {
    if (n.pinned && lastPinned === null) { html += '<div class="notes-pinned-header">📌 Pinned</div>'; lastPinned = true; }
    if (!n.pinned && lastPinned === true) { html += '<div class="notes-divider"></div>'; lastPinned = false; }
    html += renderNoteBubble(n);
  }
  list.innerHTML = html;
}

function renderNoteBubble(n) {
  const colorStyle = n.color ? 'border-left-color:var(--' + n.color + ')' : '';
  return '<div class="note-bubble' + (n.pinned ? ' pinned' : '') + '" data-id="' + n.id + '" style="' + colorStyle + '">'
    + '<div class="note-text">' + markdownToHtml(n.text) + '</div>'
    + renderNoteAttachments(n)
    + '<div class="note-actions">'
    + '<button class="note-btn pin" title="' + (n.pinned ? 'Unpin' : 'Pin') + '">📌</button>'
    + '<button class="note-btn attach" title="Attach">📎</button>'
    + '<button class="note-btn color" title="Color">🎨</button>'
    + '<button class="note-btn archive" title="' + (n.archived ? 'Restore' : 'Archive') + '">' + (n.archived ? '📂' : '📦') + '</button>'
    + '<button class="note-btn delete" title="Delete">🗑</button>'
    + '<span class="note-time">' + fmtRelTime(n.updated || n.created) + '</span>'
    + '</div></div>';
}

function renderNoteAttachments(n) {
  const atts = n.attachments || [];
  if (!atts.length) return '';
  let html = '<div class="note-attach-grid">';
  for (const a of atts) {
    const mime = a.mime || '';
    if (mime.startsWith('image/')) {
      html += '<div class="note-attach-item note-attach-img" data-att-id="' + a.id + '">'
        + '<img src="' + escHtml(a.signedUrl || a.dataUrl || '') + '" loading="lazy" alt="' + escHtml(a.name) + '">'
        + '</div>';
    } else if (mime.startsWith('audio/')) {
      const src = escHtml(a.dataUrl || a.signedUrl || '');
      html += '<div class="note-attach-audio">'
        + '<audio controls src="' + src + '" style="width:100%;height:40px;">' + escHtml(a.name) + '</audio>'
        + '<div class="note-attach-audio-info"><span class="note-attach-name">' + escHtml(a.name) + '</span><span class="note-attach-size">' + (typeof fmtSize === 'function' ? fmtSize(a.size) : a.size) + '</span></div>'
        + '</div>';
    } else {
      html += '<div class="note-attach-item note-attach-file" data-att-id="' + a.id + '">'
        + '<span class="note-attach-icon">' + mimeIcon(a.mime || '') + '</span>'
        + '<span class="note-attach-name">' + escHtml(a.name) + '</span>'
        + '<span class="note-attach-size">' + (typeof fmtSize === 'function' ? fmtSize(a.size) : a.size) + '</span>'
        + '</div>';
    }
  }
  html += '</div>';
  return html;
}

async function addNote(text) {
  text = text.trim();
  if (!text && !pendingAttachments.length) return;
  const now = new Date().toISOString();
  const attachments = [];
  for (const f of pendingAttachments) {
    attachments.push(await processAttachment(f));
  }
  const note = { id: noteId(), text, pinned: false, color: '', archived: false, attachments, created: now, updated: now };
  notesData.unshift(note);
  if (await saveNotesState()) {
    pendingAttachments = [];
    clearPendingChips();
    document.getElementById('notesInput').value = '';
    document.getElementById('notesSendBtn').disabled = true;
  } else {
    notesData.shift();
    renderNotes();
    renderPendingChips();
    return;
  }
  const list = document.getElementById('notesList');
  if (list) list.scrollTop = 0;
  renderNotes();
  if (typeof updateStorageMeter === 'function') updateStorageMeter();
}

async function processAttachment(file) {
  const isGuest = (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true);
  let processed;
  try {
    processed = await (typeof compressImage === 'function' ? compressImage(file) : Promise.resolve(file));
  } catch { processed = file; }
  if (isGuest) {
    try {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve({ id: noteId(), name: file.name, size: file.size, mime: file.type, dataUrl: ev.target.result });
        reader.onerror = reject;
        reader.onabort = reject;
        reader.readAsDataURL(processed);
      });
    } catch { return { id: noteId(), name: file.name, size: file.size, mime: file.type, failed: true }; }
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = currentUser.id + '/notes/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + safeName;
  const { error: upErr } = await sb.storage.from('attachments').upload(path, processed);
  if (upErr) { toast('upload failed: ' + upErr.message, 'var(--danger)'); return { id: noteId(), name: file.name, size: file.size, mime: file.type, path: '', failed: true }; }
  const isImg = (file.type || '').startsWith('image/');
  let signedUrl = '';
  if (isImg) {
    const { data: signed } = await sb.storage.from('attachments').createSignedUrl(path, 120);
    if (signed) signedUrl = signed.signedUrl;
  }
  return { id: noteId(), name: file.name, size: file.size, mime: file.type, path, signedUrl };
}

async function handleNoteAttach(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.mp3,.wav,.ogg,.aac,.flac';
  input.multiple = true;
  input.onchange = async () => {
    const note = notesData.find(x => x.id === id);
    if (!note || !input.files.length) return;
    for (const f of input.files) {
      if (f.size > MAX_NOTE_FILE) { toast('max 5MB per file', 'var(--accent2)'); continue; }
      note.attachments.push(await processAttachment(f));
    }
    note.updated = new Date().toISOString();
    await saveNotesState();
  };
  input.click();
}

function clearPendingChips() {
  const container = document.getElementById('pendingChips');
  if (container) container.innerHTML = '';
}

function renderPendingChips() {
  const container = document.getElementById('pendingChips');
  if (!container) return;
  if (!pendingAttachments.length) { container.innerHTML = ''; return; }
  container.innerHTML = pendingAttachments.map(f => {
    const isImg = (f.type || '').startsWith('image/');
    return '<div class="note-pending-chip">'
      + (isImg ? '<div class="note-pending-thumb" style="background-image:url(' + URL.createObjectURL(f) + ')"></div>' : '<span class="note-pending-icon">' + mimeIcon(f.type || '') + '</span>')
      + '<span class="note-pending-name">' + escHtml(f.name) + '</span>'
      + '<span class="note-pending-size">' + (typeof fmtSize === 'function' ? fmtSize(f.size) : f.size) + '</span>'
      + '<button class="note-pending-del" data-idx="' + pendingAttachments.indexOf(f) + '">×</button>'
      + '</div>';
  }).join('');
}

async function deleteNote(id) {
  const note = notesData.find(x => x.id === id);
  if (note) {
    const paths = (note.attachments || []).filter(a => a.path).map(a => a.path);
    if (paths.length && typeof removeStoragePaths === 'function') {
      await removeStoragePaths(paths).catch(() => {});
    }
  }
  notesData = notesData.filter(n => n.id !== id);
  await saveNotesState();
  renderNotes();
  if (typeof updateStorageMeter === 'function') updateStorageMeter();
}

async function togglePin(id) {
  const n = notesData.find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updated = new Date().toISOString();
  await saveNotesState();
}

async function cycleColor(id) {
  const n = notesData.find(x => x.id === id);
  if (!n) return;
  const idx = NOTE_COLORS.indexOf(n.color);
  n.color = NOTE_COLORS[(idx + 1) % NOTE_COLORS.length];
  n.updated = new Date().toISOString();
  await saveNotesState();
}

async function toggleArchive(id) {
  const n = notesData.find(x => x.id === id);
  if (!n) return;
  n.archived = !n.archived;
  n.updated = new Date().toISOString();
  await saveNotesState();
}

function toggleArchivedView() {
  notesArchivedView = !notesArchivedView;
  document.getElementById('notesArchiveToggle').textContent = notesArchivedView ? '← ACTIVE' : '📦 ARCHIVED';
  renderNotes();
}

async function openNoteAttachment(noteId, attId) {
  const note = notesData.find(x => x.id === noteId);
  if (!note) return;
  const att = (note.attachments || []).find(a => a.id === attId);
  if (!att) return;
  if (att.dataUrl) {
    if ((att.mime || '').startsWith('image/')) {
      if (typeof showImgModal === 'function') showImgModal(att.dataUrl, att.name, att);
    } else {
      const a = document.createElement('a');
      a.href = att.dataUrl;
      a.download = att.name;
      a.click();
    }
    return;
  }
  if (att.path) {
    const { data } = await sb.storage.from('attachments').createSignedUrl(att.path, 120);
    if (data?.signedUrl) {
      if ((att.mime || '').startsWith('image/')) {
        if (typeof showImgModal === 'function') showImgModal(data.signedUrl, att.name, att);
      } else {
        window.open(data.signedUrl, '_blank');
      }
    }
  }
}

function renderNotesInput() {
  const container = document.getElementById('notesInputContainer');
  if (!container) return;
  container.innerHTML = '<div class="notes-input-bar">'
    + '<button class="notes-attach-btn" id="notesAttachBtn" title="Attach file">📎</button>'
    + '<textarea class="notes-input" id="notesInput" placeholder="Type a message..." rows="1"></textarea>'
    + '<button class="notes-send-btn" id="notesSendBtn" disabled>SEND</button>'
    + '</div>'
    + '<div class="notes-pending-chips" id="pendingChips"></div>';
  const inp = document.getElementById('notesInput');
  const send = document.getElementById('notesSendBtn');
  if (!inp) return;
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
    send.disabled = !inp.value.trim() && !pendingAttachments.length;
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!send.disabled) addNote(inp.value); }
  });
  send.addEventListener('click', () => addNote(inp.value));
  document.getElementById('notesAttachBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.mp3,.wav,.ogg,.aac,.flac';
    input.multiple = true;
    input.onchange = () => {
      for (const f of input.files) {
        if (f.size > MAX_NOTE_FILE) { toast('max 5MB per file', 'var(--accent2)'); continue; }
        pendingAttachments.push(f);
      }
      renderPendingChips();
      send.disabled = !inp.value.trim() && !pendingAttachments.length;
    };
    input.click();
  });
  document.addEventListener('click', e => {
    const del = e.target.closest('.note-pending-del');
    if (!del) return;
    const idx = parseInt(del.dataset.idx);
    if (!isNaN(idx) && idx >= 0 && idx < pendingAttachments.length) {
      pendingAttachments.splice(idx, 1);
      renderPendingChips();
      send.disabled = !inp.value.trim() && !pendingAttachments.length;
    }
  });
}

// ── EVENT DELEGATION ─────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const bubble = e.target.closest('.note-bubble');
  if (bubble) {
    const id = bubble.dataset.id;
    if (e.target.closest('.note-btn.pin')) { await togglePin(id); return; }
    if (e.target.closest('.note-btn.attach')) { await handleNoteAttach(id); return; }
    if (e.target.closest('.note-btn.color')) { await cycleColor(id); return; }
    if (e.target.closest('.note-btn.archive')) { await toggleArchive(id); return; }
    if (e.target.closest('.note-btn.delete')) {
      if (!await (typeof showConfirm === 'function' ? showConfirm('Delete this note?') : Promise.resolve(confirm('Delete this note?')))) return;
      await deleteNote(id);
      return;
    }
  }
  const attItem = e.target.closest('.note-attach-item');
  if (attItem) {
    const attId = attItem.dataset.attId;
    const bubble = attItem.closest('.note-bubble');
    if (bubble && attId) await openNoteAttachment(bubble.dataset.id, attId);
  }
});

// ── INIT ─────────────────────────────────────────────────────────────────────
function initNotes() {
  loadGuestNotes();
  renderNotesInput();
  renderNotes();
  const toggle = document.getElementById('notesArchiveToggle');
  if (toggle && !toggle._listening) { toggle._listening = true; toggle.addEventListener('click', toggleArchivedView); }
}
