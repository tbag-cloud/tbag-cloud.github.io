// ── APP PAGES ────────────────────────────────────────────────────────────────
function closeAppMenu() {
  const menu = document.getElementById('appMenu');
  if (menu) menu.style.display = 'none';
}

function updatePageMenuState() {
  document.querySelectorAll('.app-menu-item').forEach(btn => {
    if (btn.dataset.page === 'drive' && mode === 'guest') {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
    btn.classList.toggle('active', btn.dataset.page === currentPage);
  });
}

function updateAdminAccess() {
  const adminBtn = document.getElementById('menuPageAdmin');
  if (!adminBtn) return;
  const allowed = mode === 'synced' && isAdminUser();
  adminBtn.style.display = allowed ? 'block' : 'none';
  if (!allowed && currentPage === 'admin') {
    currentPage = 'todo';
  }
}

function updateWatchlistStats() {
  document.getElementById('statsLabel').textContent = '';
}

function pageFromHash(hash = window.location.hash) {
  const clean = (hash || '').replace(/^#+/, '').toLowerCase();
  if (clean === 'drive') return 'drive';
  if (clean === 'watchlist') return 'watchlist';
  if (clean === 'admin') return 'admin';
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
  const driveAllowed = mode === 'synced';
  currentPage = page === 'watchlist'
    ? 'watchlist'
    : page === 'drive' && driveAllowed
      ? 'drive'
      : page === 'admin' && adminAllowed
        ? 'admin'
        : 'todo';
  document.getElementById('todoPage').style.display = currentPage === 'todo' ? 'block' : 'none';
  document.getElementById('drivePage').style.display = currentPage === 'drive' ? 'block' : 'none';
  document.getElementById('watchlistPage').style.display = currentPage === 'watchlist' ? 'block' : 'none';
  document.getElementById('adminPage').style.display = currentPage === 'admin' ? 'block' : 'none';
  document.getElementById('todoToolbar').style.display = currentPage === 'todo' ? 'flex' : 'none';
  const title = document.querySelector('h1 span');
  if (title) title.textContent = currentPage === 'todo' ? 'TODO' : currentPage === 'drive' ? 'DRIVE' : currentPage === 'watchlist' ? 'WATCHLIST' : 'ADMIN';
  updatePageMenuState();
  closeAppMenu();
  if (updateHash) syncPageHash();
  if (currentPage === 'todo') render();
  else if (currentPage === 'drive') { 
    loadSyncedDrive().catch(err => { console.warn('drive load error:', err); toast('drive load failed', 'var(--danger)'); });
  }
  else updateWatchlistStats();
  
  // Always update storage meter and global usage on page change
  if (mode === 'synced') {
    if (typeof updateStorageMeter === 'function') updateStorageMeter();
    if (typeof loadGlobalUsage === 'function') loadGlobalUsage().catch(err => { console.warn('global usage error:', err); });
  }
}
