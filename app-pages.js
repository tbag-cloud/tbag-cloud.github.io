// ── APP PAGES ────────────────────────────────────────────────────────────────
function closeAppMenu() {
  const menu = document.getElementById('appMenu');
  if (menu) menu.style.display = 'none';
}

function updatePageMenuState() {
  const driveHidden = mode === 'guest' || (typeof devScenario !== 'undefined' && !devScenario.drive);
  document.querySelectorAll('.app-menu-item').forEach(btn => {
    if (btn.dataset.page === 'drive' && driveHidden) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
    btn.classList.toggle('active', btn.dataset.page === currentPage);
  });
  document.querySelectorAll('.sidebar-btn[data-page]').forEach(btn => {
    if (btn.dataset.page === 'drive' && driveHidden) {
      btn.style.display = 'none';
    } else if (btn.id !== 'sidebarAdmin') {
      btn.style.display = '';
    }
    btn.classList.toggle('active', btn.dataset.page === currentPage);
  });
}

function updateAdminAccess() {
  const adminBtn = document.getElementById('menuPageAdmin');
  const sidebarAdmin = document.getElementById('sidebarAdmin');
  const allowed = mode === 'synced' && isAdminUser();
  if (adminBtn) adminBtn.style.display = allowed ? 'block' : 'none';
  if (sidebarAdmin) sidebarAdmin.style.display = allowed ? '' : 'none';
  if (!allowed && currentPage === 'admin') {
    currentPage = 'todo';
  }
}

function pageFromHash(hash = window.location.hash) {
  const clean = (hash || '').replace(/^#+/, '').toLowerCase();
  if (clean === 'drive') return 'drive';
  if (clean === 'watchlist') return 'watchlist';
  if (clean === 'admin') return 'admin';
  if (clean === 'settings') return 'settings';
  if (clean === 'notes') return 'notes';
  return 'todo';
}

function syncPageHash() {
  const nextHash = '#' + currentPage;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, '', nextHash);
  }
}

function setPage(page, { updateHash = true } = {}) {
  const adminAllowed = mode === 'synced' && isAdminUser();
  const driveAllowed = mode === 'synced' && (typeof devScenario === 'undefined' || devScenario.drive);
  if (page === 'settings') {
    currentPage = 'settings';
  } else if (page === 'watchlist') {
    currentPage = 'watchlist';
  } else if (page === 'notes') {
    currentPage = 'notes';
  } else if (page === 'drive' && driveAllowed) {
    currentPage = 'drive';
  } else if (page === 'admin' && adminAllowed) {
    currentPage = 'admin';
  } else {
    currentPage = 'todo';
  }
  document.getElementById('todoPage').style.display = currentPage === 'todo' ? 'block' : 'none';
  document.getElementById('drivePage').style.display = currentPage === 'drive' ? 'block' : 'none';
  document.getElementById('watchlistPage').style.display = currentPage === 'watchlist' ? 'block' : 'none';
  document.getElementById('adminPage').style.display = currentPage === 'admin' ? 'block' : 'none';
  document.getElementById('notesPage').style.display = currentPage === 'notes' ? 'block' : 'none';
  document.getElementById('settingsPage').style.display = currentPage === 'settings' ? 'block' : 'none';
  document.getElementById('todoToolbar').style.display = currentPage === 'todo' ? 'flex' : 'none';
  // Show/hide hero sections
  ['heroTodo', 'heroDrive', 'heroWatchlist', 'heroSettings', 'heroAdmin', 'heroNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === 'hero' + currentPage.charAt(0).toUpperCase() + currentPage.slice(1) ? '' : 'none';
  });
  const title = document.querySelector('h1 span');
  if (title) title.textContent = currentPage === 'todo' ? 'TODO' : currentPage === 'drive' ? 'DRIVE' : currentPage === 'watchlist' ? 'WATCHLIST' : currentPage === 'settings' ? 'SETTINGS' : currentPage === 'notes' ? 'NOTES' : 'ADMIN';
  updatePageMenuState();
  closeAppMenu();
  if (updateHash) syncPageHash();
  if (currentPage === 'todo') render();
  else if (currentPage === 'drive') { 
    loadSyncedDrive().catch(err => { console.warn('drive load error:', err); toast('drive load failed', 'var(--danger)'); });
  }
  else if (currentPage === 'notes') {
    if (typeof initNotes === 'function') initNotes();
    if (typeof loadSyncedNotes === 'function') loadSyncedNotes().catch(() => {});
  }
  else if (currentPage === 'settings') {
    if (typeof renderSettingsPage === 'function') renderSettingsPage();
  }
  
  // Always update storage meter, global usage, and site notice on page change
  updateStorageMeter();
  if (mode === 'synced') {
    if (typeof loadGlobalUsage === 'function') loadGlobalUsage().catch(err => { console.warn('global usage error:', err); });
    if (typeof loadSiteNotice === 'function') loadSiteNotice().catch(() => {});
  }
}
