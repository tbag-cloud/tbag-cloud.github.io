// ── DRIVE ───────────────────────────────────────────────────────────────────────
const LS_DRIVE = 'todo_v3_drive';

let driveFiles = [];
let driveSearchQ = '';

function loadDriveState() {
  try {
    const parsed = localStorage.getItem(LS_DRIVE);
    driveFiles = parsed ? JSON.parse(parsed) : [];
  } catch {
    driveFiles = [];
  }
}

function saveDriveState() {
  localStorage.setItem(LS_DRIVE, JSON.stringify(driveFiles));
  renderDrive();
}

async function loadSyncedDrive() {
  if (typeof _realMode !== 'undefined' && _realMode !== 'synced' || !currentUser) return;
  dot('syncing');
  
  let data;
  try {
    const result = await sb.from('attachments')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('is_standalone', true);
    
    if (result.error) {
      console.warn('load error:', result.error);
      data = [];
    } else {
      data = result.data || [];
    }
  } catch (e) {
    console.warn('drive load error:', e);
    data = [];
  }
  
  driveFiles = (data || []).map(a => ({
    id: a.id,
    name: a.name,
    size: a.size,
    mime: a.mime_type,
    path: a.path,
    created: a.created_at || a.created
  }));
  
  dot('ok');
  renderDrive();
  loadDrivePreviews();
}

function getFilteredDrive() {
  if (!driveSearchQ) return driveFiles;
  const q = driveSearchQ.toLowerCase();
  return driveFiles.filter(f => f.name.toLowerCase().includes(q));
}

function renderDrive() {
  const grid = document.getElementById('driveGrid');
  const empty = document.getElementById('driveEmpty');
  if (!grid || !empty) return;
  
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.innerHTML = '<div class="big">🔒</div><p>drive is synced only - sign in to use</p>';
    return;
  }
  
  const list = getFilteredDrive();
  
  if (!list.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.innerHTML = '<div class="big">📂</div><p>no files yet - upload your first file</p>';
    return;
  }
  
  empty.style.display = 'none';
  grid.innerHTML = list.map(f => buildDriveCard(f)).join('');
}

function buildDriveCard(file) {
  const isImg = (file.mime || '').startsWith('image/');
  const imgPreview = isImg ? `<div class="drive-card-img" data-path="${esc(file.path)}">🖼</div>` : `<div class="drive-card-icon">${mimeIcon(file.mime || '')}</div>`;
  
  return `<div class="drive-card" data-id="${file.id}">`
    + imgPreview
    + '<div class="drive-card-actions">'
    + `<button class="drive-card-btn del" data-action="delete">DEL</button>`
    + '</div>'
    + '<div class="drive-card-name">' + esc(file.name) + '</div>'
    + '<div class="drive-card-meta">' + fmtSize(file.size || 0) + ' · ' + fmtDate(file.created) + '</div>'
    + '</div>';
}

async function openDriveFile(id) {
  const file = driveFiles.find(f => f.id === id);
  if (!file) return;
  
  if (file.dataUrl) {
    if (file.mime && file.mime.startsWith('image/')) {
      showImgModal(file.dataUrl, file.name, file);
    } else {
      downloadDataUrl(file);
    }
    return;
  }
  
  const { data } = await sb.storage.from('attachments').createSignedUrl(file.path, 120);
  if (data?.signedUrl) {
    if (file.mime && file.mime.startsWith('image/')) {
      showImgModal(data.signedUrl, file.name, file);
    } else {
      openExternalSafe(data.signedUrl);
    }
  }
}

async function deleteDriveFile(id) {
  const file = driveFiles.find(f => f.id === id);
  if (!file) return;
  
  if (!await showConfirm('Delete "' + esc(file.name) + '" from Drive?')) return;
  
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    driveFiles = driveFiles.filter(f => f.id !== id);
    saveDriveState();
    toast('deleted');
    return;
  }
  
  dot('syncing');
  try {
    await removeStoragePaths([file.path]);
    const { error } = await sb.from('attachments').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (error) {
    dot('err');
    toast('delete failed: ' + error.message, 'var(--danger)');
    return;
  }
  
  await loadSyncedDrive();
  loadDrivePreviews();
  Promise.all([
    typeof updateStorageMeter === 'function' ? updateStorageMeter() : Promise.resolve(),
    typeof loadGlobalUsage === 'function' ? loadGlobalUsage().catch(() => {}) : Promise.resolve()
  ]);
  toast('deleted');
}

async function uploadDriveFile(rawFile) {
  let file;
  try {
    file = await compressImage(rawFile);
    if (file.size < rawFile.size) {
      toast('compressed ' + rawFile.name + ': ' + fmtSize(rawFile.size) + ' → ' + fmtSize(file.size));
    }
  } catch (e) {
    console.warn('compress failed:', e);
    file = rawFile;
  }
  
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    if (!devMode && file.size > MAX_GUEST_FILE) {
      toast('guest: max 5MB per file', 'var(--accent2)');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      driveFiles.unshift({
        id: uid(),
        name: file.name,
        size: file.size,
        mime: file.type,
        dataUrl: ev.target.result,
        created: new Date().toISOString()
      });
      saveDriveState();
      toast('uploaded ' + file.name);
    };
    reader.onerror = () => toast('read error', 'var(--danger)');
    reader.readAsDataURL(file);
    return;
  }

  if (file.size > MAX_SYNC_FILE) {
    toast('max 50MB per file', 'var(--accent2)');
    return;
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = safeName.split('.').pop();
  const fileId = Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const path = currentUser.id + '/drive/' + fileId + '_' + safeName;
  
  dot('syncing');
  
  let uploadResult;
  try {
    uploadResult = await sb.storage.from('attachments').upload(path, file);
  } catch (e) {
    console.warn('storage upload error:', e);
    dot('err');
    toast('upload failed: ' + (e.message || 'unknown error'), 'var(--danger)');
    return;
  }
  
  if (uploadResult.error) {
    dot('err');
    toast('upload failed: ' + uploadResult.error.message, 'var(--danger)');
    return;
  }

  let dbResult;
  try {
    // Insert with a placeholder UUID for todo_id (valid UUID format)
    dbResult = await sb.from('attachments').insert({
      user_id: currentUser.id,
      name: file.name,
      size: file.size,
      mime_type: file.type,
      path: path,
      todo_id: '00000000-0000-0000-0000-000000000000',
      is_standalone: true
    });
  } catch (e) {
    console.warn('db insert error:', e);
    await removeStoragePaths([path]).catch(() => {});
    dot('err');
    toast('record failed: ' + (e.message || 'db error'), 'var(--danger)');
    return;
  }
  
  if (dbResult.error) {
    console.warn('insert error:', dbResult.error);
    await removeStoragePaths([path]).catch(() => {});
    dot('err');
    toast('record failed: ' + dbResult.error.message, 'var(--danger)');
    return;
  }
  
  dot('ok');
  await loadSyncedDrive();
  loadDrivePreviews();
  Promise.all([
    typeof updateStorageMeter === 'function' ? updateStorageMeter() : Promise.resolve(),
    typeof loadGlobalUsage === 'function' ? loadGlobalUsage().catch(() => {}) : Promise.resolve()
  ]);
  toast('uploaded ' + file.name);
}

function exportDrive() {
  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), files: driveFiles }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'drive_' + new Date().toISOString().slice(0,10) + '.json' });
    a.click();
    URL.revokeObjectURL(a.href);
    toast('exported ' + driveFiles.length + ' files');
    return;
  }
  
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), files: driveFiles.map(f => ({ name: f.name, size: f.size, mime: f.mime, created: f.created })) }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'drive_' + new Date().toISOString().slice(0,10) + '.json' });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('exported ' + driveFiles.length + ' files');
}

async function importDriveFile(file) {
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const importedFiles = Array.isArray(data.files) ? data.files : [];
      
      if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
        const existingIds = new Set(driveFiles.map(f => f.id));
        const newFiles = importedFiles.filter(f => !existingIds.has(f.id));
        driveFiles = [...newFiles, ...driveFiles];
        saveDriveState();
        toast('imported ' + newFiles.length + ' files');
        return;
      }
      
      toast('import is for guest mode only in sync', 'var(--accent2)');
    } catch (err) {
      toast('import failed: ' + err.message, 'var(--danger)');
    }
  };
  reader.readAsText(file);
}

// ── DRIVE EVENT BINDINGS ──────────────────────────────────────────────────────
// Only bind events when elements exist (after page loads)
const driveUploadBtn = document.getElementById('driveUploadBtn');
if (driveUploadBtn) {
  driveUploadBtn.addEventListener('click', () => {
    const fileInput = document.getElementById('driveFileInput');
    if (fileInput) fileInput.click();
  });
}

const driveFileInput = document.getElementById('driveFileInput');
if (driveFileInput) {
  driveFileInput.addEventListener('change', async e => {
    const files = e.target.files;
    if (!files.length) return;
    
    for (const f of files) {
      try {
        await uploadDriveFile(f);
      } catch (err) {
        console.error('upload error:', err);
        toast('upload error: ' + (err.message || 'unknown'), 'var(--danger)');
      }
    }
    
    e.target.value = '';
  });
}

const driveSearchInp = document.getElementById('driveSearchInp');
const driveSearchClear = document.getElementById('driveSearchClear');
const driveGrid = document.getElementById('driveGrid');

if (driveSearchInp) {
  driveSearchInp.addEventListener('input', e => {
    driveSearchQ = e.target.value.trim();
    if (driveSearchClear) driveSearchClear.className = 'search-clear' + (driveSearchQ ? ' vis' : '');
    renderDrive();
  });
}

if (driveSearchClear) {
  driveSearchClear.addEventListener('click', () => {
    driveSearchQ = '';
    if (driveSearchInp) driveSearchInp.value = '';
    driveSearchClear.className = 'search-clear';
    renderDrive();
  });
}

if (driveGrid) {
  driveGrid.addEventListener('click', async e => {
    const delBtn = e.target.closest('.drive-card-btn.del');
    if (delBtn) {
      const card = delBtn.closest('.drive-card');
      if (card) await deleteDriveFile(card.dataset.id);
      return;
    }
    
    const card = e.target.closest('.drive-card');
    if (card) await openDriveFile(card.dataset.id);
  });
}

async function loadDrivePreviews() {
  if (!driveGrid) return;
  
  const imgs = [...driveGrid.querySelectorAll('.drive-card-img[data-path]')];
  const urls = await Promise.all(imgs.map(img => getSignedUrl(img.dataset.path)));
  urls.forEach((url, i) => {
    if (url) imgs[i].innerHTML = '<img src="' + url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;">';
  });
}
