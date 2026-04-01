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
  if (mode !== 'synced' || !currentUser) return;
  dot('syncing');
  
  let data;
  try {
    // Get ALL attachments - filter by path containing /drive/
    const result = await sb.from('attachments')
      .select('*')
      .eq('user_id', currentUser.id);
    
    console.log('All attachments:', result.data?.map(a => a.path));
    
    if (result.error) {
      console.warn('load error:', result.error);
      data = [];
    } else {
      // Filter to only show Drive files (path contains /drive/)
      data = (result.data || []).filter(a => a.path && a.path.includes('/drive/'));
      console.log('Filtered drive files:', data.length, data.map(a => a.path));
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
  
  if (mode === 'guest') {
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
  
  if (!confirm('Delete "' + file.name + '" from Drive?')) return;
  
  if (mode === 'guest') {
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
  
  if (mode === 'guest') {
    if (file.size > MAX_GUEST_FILE) {
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

  const MAX_FILE = 50 * 1024 * 1024;
  if (file.size > MAX_FILE) {
    toast('max 50MB per file', 'var(--accent2)');
    return;
  }

  const ext = file.name.split('.').pop();
  const fileId = Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const path = currentUser.id + '/drive/' + fileId + '_' + file.name;
  
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
    // Simple insert - same as todo attachments
    dbResult = await sb.from('attachments').insert({
      user_id: currentUser.id,
      name: file.name,
      size: file.size,
      mime_type: file.type,
      path: path
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
  toast('uploaded ' + file.name);
}

function exportDrive() {
  if (mode === 'guest') {
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
      
      if (mode === 'guest') {
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
document.getElementById('driveUploadBtn').addEventListener('click', () => {
  document.getElementById('driveFileInput').click();
});

document.getElementById('driveFileInput').addEventListener('change', async e => {
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

document.getElementById('driveExportBtn').addEventListener('click', exportDrive);

document.getElementById('driveImportBtn').addEventListener('click', () => {
  document.getElementById('driveImportFile').click();
});

document.getElementById('driveImportFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    importDriveFile(file);
    e.target.value = '';
  }
});

document.getElementById('driveSearchInp').addEventListener('input', e => {
  driveSearchQ = e.target.value.trim();
  document.getElementById('driveSearchClear').className = 'search-clear' + (driveSearchQ ? ' vis' : '');
  renderDrive();
});

document.getElementById('driveSearchClear').addEventListener('click', () => {
  driveSearchQ = '';
  document.getElementById('driveSearchInp').value = '';
  document.getElementById('driveSearchClear').className = 'search-clear';
  renderDrive();
});

document.getElementById('driveGrid').addEventListener('click', async e => {
  const delBtn = e.target.closest('.drive-card-btn.del');
  if (delBtn) {
    const card = delBtn.closest('.drive-card');
    if (card) await deleteDriveFile(card.dataset.id);
    return;
  }
  
  const card = e.target.closest('.drive-card');
  if (card) await openDriveFile(card.dataset.id);
});

async function loadDrivePreviews() {
  const grid = document.getElementById('driveGrid');
  if (!grid) return;
  
  for (const img of grid.querySelectorAll('.drive-card-img[data-path]')) {
    const url = await getSignedUrl(img.dataset.path);
    if (url) img.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;">';
  }
}
