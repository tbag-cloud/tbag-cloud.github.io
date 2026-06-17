// ── SETTINGS ────────────────────────────────────────────────────────────────
const LS_SETTINGS = 'todo_v3_settings';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  defaultPriority: 'medium',
  defaultFilter: 'all',
  compressEnabled: true,
  compressQuality: 0.82,
  compressMaxDimension: 1600,
  animationsEnabled: true,
  destructiveSafeguard: true,
  devMode: false,
  devDrive: true,
  devShowAdmin: false,
  devApiErrors: false
};

let settings = {};

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in parsed) settings[key] = parsed[key];
      }
    } else {
      settings = { ...DEFAULT_SETTINGS };
    }
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  applyTheme();
  syncDevMode();
}

function syncDevMode() {
  if (typeof devMode !== 'undefined') devMode = settings.devMode;
  if (typeof devScenario !== 'undefined') {
    devScenario.drive = settings.devMode ? settings.devDrive : true;
    devScenario.showAdmin = settings.devShowAdmin;
    devScenario.apiErrors = settings.devApiErrors;
  }
}

function saveSettings(partial) {
  Object.assign(settings, partial);
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch {}
  applyTheme();
  applyAnimations();
  syncDevMode();
}

function applyTheme() {
  document.body.classList.toggle('light-theme', settings.theme === 'light');
}

function applyAnimations() {
  document.body.classList.toggle('no-animations', !settings.animationsEnabled);
}

function applyDefaults() {
  document.getElementById('newPri').value = settings.defaultPriority;
  const filterBtn = document.querySelector('.filter-btn[data-f="' + settings.defaultFilter + '"]');
  if (filterBtn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    filterBtn.classList.add('active');
    filter = settings.defaultFilter;
  }
}

function renderSettingsPage() {
  document.getElementById('settingsDefaultPriority').value = settings.defaultPriority;
  document.getElementById('settingsDefaultFilter').value = settings.defaultFilter;
  document.getElementById('settingsCompressEnabled').checked = settings.compressEnabled;
  document.getElementById('settingsCompressQuality').value = settings.compressQuality;
  document.getElementById('settingsCompressQualityVal').textContent = String(settings.compressQuality);
  document.getElementById('settingsCompressMaxDimension').value = String(settings.compressMaxDimension);
  document.getElementById('settingsDestructiveSafeguard').checked = settings.destructiveSafeguard;

  document.querySelectorAll('#themeToggle .settings-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  });
  document.querySelectorAll('#animToggle .settings-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.anim === 'on') === settings.animationsEnabled);
  });
  renderDevModePanel();
  if (typeof renderStoragePanel === 'function') renderStoragePanel();
}

function renderStoragePanel() {
  const el = document.getElementById('settingsStorageContent');
  if (!el) return;
  const fmt = b => {
    if (b >= 1048576) return (b/1048576).toFixed(1) + 'MB';
    if (b >= 1024) return (b/1024).toFixed(1) + 'KB';
    return b + 'B';
  };
  const attCount = Object.values(window.attMap || {}).flat().length;
  const driveCount = (typeof driveFiles !== 'undefined' ? driveFiles : []).length;
  const todoCount = (typeof todos !== 'undefined' ? todos : []).length;
  const wlCount = (typeof watchlistData !== 'undefined' ? watchlistData : {}).totalCount || 0;

  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    let bytes = 0;
    try { bytes = (localStorage.getItem('todo_v3_todos')||'').length + (localStorage.getItem('todo_v3_atts')||'').length; } catch {}
    const maxGuest = 5000000;
    const pct = Math.min(100, (bytes / maxGuest) * 100);
    const cls = 'settings-storage-fill' + (pct > 80 ? ' full' : pct > 60 ? ' warn' : '');
    const warn = pct > 80 ? ' ⚠️' : '';
    el.innerHTML = '<div class="settings-storage-row">'
      + '<div class="settings-storage-label">local storage: ' + fmt(bytes) + ' / ~5MB' + warn + '</div>'
      + '<div class="settings-storage-bar"><div class="' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>'
      + '</div>'
      + '<div class="settings-storage-meta">' + todoCount + ' todo' + (todoCount===1?'':'s') + ' · ' + attCount + ' attachment' + (attCount===1?'':'s') + '</div>';
  } else {
    const attBytes = Object.values(window.attMap || {}).flat().reduce((s,a) => s + (a.size||0), 0);
    const driveBytes = driveFiles.reduce((s,f) => s + (f.size||0), 0);
    const totalBytes = attBytes + driveBytes;
    const totalMax = 1073741824;
    const totalPct = Math.min(100, (totalBytes / totalMax) * 100);
    const totalCls = 'settings-storage-fill' + (totalPct > 80 ? ' full' : totalPct > 60 ? ' warn' : '');
    el.innerHTML = '<div class="settings-storage-row">'
      + '<div class="settings-storage-label">supabase storage: ' + fmt(totalBytes) + ' / 1GB (' + totalPct.toFixed(0) + '%)</div>'
      + '<div class="settings-storage-bar"><div class="' + totalCls + '" style="width:' + totalPct.toFixed(1) + '%"></div></div>'
      + '</div>'
      + '<div class="settings-storage-meta">' + todoCount + ' todo' + (todoCount===1?'':'s') + ' · ' + attCount + ' attachment' + (attCount===1?'':'s') + ' · ' + driveCount + ' drive file' + (driveCount===1?'':'s') + ' · ' + wlCount + ' watchlist' + '</div>';
  }
}

// ── DESTRUCTIVE CONFIRM ──────────────────────────────────────────────────────
function confirmDestructive(msg, count) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'img-modal';
    m.style.cursor = 'default';
    const needsTyping = settings.destructiveSafeguard;
    m.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--danger);padding:24px;max-width:420px;text-align:center;">'
      + '<p style="font-size:0.82rem;color:var(--text);line-height:1.7;margin-bottom:12px;">' + msg + '</p>'
      + (count != null ? '<p style="font-size:0.72rem;color:var(--accent2);margin-bottom:16px;">' + count + ' item' + (count === 1 ? '' : 's') + ' will be permanently deleted.</p>' : '')
      + (needsTyping ? '<div style="margin-bottom:14px;"><p style="font-size:0.68rem;color:var(--muted);margin-bottom:6px;">Type <strong style="color:var(--accent2);">DELETE</strong> to confirm:</p>'
        + '<input id="destructiveInput" type="text" maxlength="10" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:10px 12px;font-family:inherit;font-size:0.82rem;text-align:center;outline:none;"></div>'
        : '')
      + '<div style="display:flex;gap:10px;justify-content:center;">'
      + '<button class="img-modal-dl" id="destructiveYes" style="position:static;transform:none;background:var(--danger);">DELETE</button>'
      + '<button class="img-modal-close" id="destructiveNo" style="position:static;">CANCEL</button>'
      + '</div></div>';

    const confirmBtn = m.querySelector('#destructiveYes');
    const input = m.querySelector('#destructiveInput');

    function canConfirm() {
      return !needsTyping || !input || input.value === 'DELETE';
    }

    if (input) {
      input.addEventListener('input', () => {
        const ok = canConfirm();
        confirmBtn.disabled = !ok;
        confirmBtn.style.opacity = ok ? '1' : '0.35';
      });
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.35';
    }

    confirmBtn.onclick = () => {
      if (!canConfirm()) return;
      m.remove(); resolve(true);
    };
    m.querySelector('#destructiveNo').onclick = () => { m.remove(); resolve(false); };
    m.onclick = e => { if (e.target === m) { m.remove(); resolve(false); } };
    document.body.appendChild(m);
    if (input) setTimeout(() => input.focus(), 100);
  });
}

// ── DATA MANAGEMENT ──────────────────────────────────────────────────────────
async function clearAllTodos() {
  const count = todos.length;
  if (!count) { toast('no todos to clear', 'var(--muted)'); return; }
  if (!await confirmDestructive('Delete all todos?', count)) return;

  if (typeof _realMode !== 'undefined' ? _realMode === 'guest' : true) {
    todos = [];
    attMap = {};
    saveGuest();
  } else {
    try {
      const paths = Object.values(attMap).flat().map(a => a.path).filter(Boolean);
      if (paths.length) await removeStoragePaths(paths);
      await sb.from('attachments').delete().eq('user_id', currentUser.id);
      await sb.from('todos').delete().eq('user_id', currentUser.id);
      todos = [];
      attMap = {};
      await loadSynced();
    } catch (e) {
      toast('clear failed: ' + e.message, 'var(--danger)');
      return;
    }
  }
  toast('all todos cleared');
}

async function clearAllDriveFiles() {
  if (typeof _realMode !== 'undefined' && _realMode !== 'synced' && !devMode) { toast('drive is synced only', 'var(--accent2)'); return; }
  const count = driveFiles.length;
  if (!count) { toast('no drive files to clear', 'var(--muted)'); return; }
  if (!await confirmDestructive('Delete all Drive files?', count)) return;

  try {
    if (devMode) {
      driveFiles = [];
      toast('all drive files cleared');
      if (typeof updateStorageMeter === 'function') updateStorageMeter();
      return;
    }
    const paths = driveFiles.map(f => f.path).filter(Boolean);
    if (paths.length) await removeStoragePaths(paths);
    await sb.from('attachments').delete().eq('user_id', currentUser.id).eq('is_standalone', true);
    driveFiles = [];
    await loadSyncedDrive();
    if (typeof updateStorageMeter === 'function') updateStorageMeter();
    if (typeof loadGlobalUsage === 'function') loadGlobalUsage();
  } catch (e) {
    toast('clear failed: ' + e.message, 'var(--danger)');
    return;
  }
  toast('all drive files cleared');
}

function resetSettings() {
  confirmDestructive('Reset all settings to defaults?').then(ok => {
    if (!ok) return;
    saveSettings(DEFAULT_SETTINGS);
    renderSettingsPage();
    applyDefaults();
    toast('settings reset');
  });
}

function renderDevModePanel() {
  document.getElementById('settingsDevMode').checked = settings.devMode;
  document.getElementById('settingsDevDrive').checked = settings.devDrive;
  document.getElementById('settingsDevShowAdmin').checked = settings.devShowAdmin;
  document.getElementById('settingsDevApiErrors').checked = settings.devApiErrors;
  document.getElementById('settingsDevScenarios').style.display = settings.devMode ? 'block' : 'none';
}

// ── EVENT BINDINGS ───────────────────────────────────────────────────────────
function bindSettingsEvents() {
  document.getElementById('themeToggle').addEventListener('click', e => {
    const btn = e.target.closest('.settings-toggle-btn');
    if (!btn) return;
    saveSettings({ theme: btn.dataset.theme });
    renderSettingsPage();
  });

  document.getElementById('animToggle').addEventListener('click', e => {
    const btn = e.target.closest('.settings-toggle-btn');
    if (!btn) return;
    saveSettings({ animationsEnabled: btn.dataset.anim === 'on' });
    renderSettingsPage();
  });

  document.getElementById('settingsDefaultPriority').addEventListener('change', e => {
    saveSettings({ defaultPriority: e.target.value });
    applyDefaults();
  });

  document.getElementById('settingsDefaultFilter').addEventListener('change', e => {
    saveSettings({ defaultFilter: e.target.value });
    applyDefaults();
  });

  document.getElementById('settingsCompressEnabled').addEventListener('change', e => {
    saveSettings({ compressEnabled: e.target.checked });
  });

  document.getElementById('settingsCompressQuality').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    document.getElementById('settingsCompressQualityVal').textContent = String(val);
    saveSettings({ compressQuality: val });
  });

  document.getElementById('settingsCompressMaxDimension').addEventListener('change', e => {
    saveSettings({ compressMaxDimension: Number(e.target.value) });
  });

  document.getElementById('settingsDestructiveSafeguard').addEventListener('change', e => {
    saveSettings({ destructiveSafeguard: e.target.checked });
  });

  document.getElementById('settingsClearTodos').addEventListener('click', clearAllTodos);
  document.getElementById('settingsClearDrive').addEventListener('click', clearAllDriveFiles);
  document.getElementById('settingsReset').addEventListener('click', resetSettings);

  document.getElementById('settingsDevMode').addEventListener('change', e => {
    saveSettings({ devMode: e.target.checked });
    renderDevModePanel();
    if (typeof syncDevMode === 'function') syncDevMode();
    if (typeof updateStorageMeter === 'function') updateStorageMeter();
    if (typeof updateAdminAccess === 'function') updateAdminAccess();
    if (typeof updatePageMenuState === 'function') updatePageMenuState();
    setPage(currentPage, { updateHash: false });
  });
  document.getElementById('settingsDevDrive').addEventListener('change', e => {
    saveSettings({ devDrive: e.target.checked });
    if (typeof syncDevMode === 'function') syncDevMode();
    if (typeof updatePageMenuState === 'function') updatePageMenuState();
  });
  document.getElementById('settingsDevShowAdmin').addEventListener('change', e => {
    saveSettings({ devShowAdmin: e.target.checked });
    if (typeof syncDevMode === 'function') syncDevMode();
    if (typeof updateAdminAccess === 'function') updateAdminAccess();
  });
  document.getElementById('settingsDevApiErrors').addEventListener('change', e => {
    saveSettings({ devApiErrors: e.target.checked });
    if (typeof syncDevMode === 'function') syncDevMode();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSettingsEvents);
} else {
  bindSettingsEvents();
}
