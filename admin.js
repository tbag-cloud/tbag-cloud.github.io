function isAdminUser() { return !!currentUser?.email && ADMIN_EMAILS.includes(currentUser.email.toLowerCase()); }

function renderUsageList(elId, rows, emptyText) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.textContent = emptyText;
    return;
  }
  el.innerHTML = rows.map(row =>
    '<div class="row"><span class="k">' + esc(row.key) + '</span><span class="v">' + esc(row.value) + '</span></div>'
  ).join('');
}

function updateSiteBanner() {
  const banner = document.getElementById('siteBanner');
  if (!banner) return;
  if (!siteNotice?.enabled || !siteNotice?.message?.trim()) {
    banner.style.display = 'none';
    return;
  }
  banner.classList.remove('maintenance', 'announcement');
  banner.classList.add(siteNotice.maintenance ? 'maintenance' : 'announcement');
  document.getElementById('siteBannerTitle').textContent = siteNotice.maintenance ? 'MAINTENANCE NOTICE' : 'ANNOUNCEMENT';
  document.getElementById('siteBannerText').textContent = siteNotice.message;
  banner.style.display = 'block';
}

function updateAdminPanelState() {
  const panel = document.getElementById('globalUsagePanel');
  const body = document.getElementById('adminPanelBody');
  if (!panel || !body) return;
  panel.classList.toggle('open', adminPanelOpen);
  body.style.display = adminPanelOpen ? 'block' : 'none';
}

function updateGlobalUsagePanel() {
  const panel = document.getElementById('globalUsagePanel');
  if (!panel) return;
  if (mode !== 'synced' || !isAdminUser() || !globalUsage) {
    panel.style.display = 'none';
    return;
  }
  document.getElementById('globalAttachmentBytes').textContent = fmtSize(globalUsage.total_attachment_bytes || 0);
  document.getElementById('globalTodoCount').textContent = fmtCount(globalUsage.total_todo_count || 0);
  document.getElementById('globalAttachmentCount').textContent = fmtCount(globalUsage.total_attachment_count || 0);
  document.getElementById('globalUserCount').textContent = fmtCount(globalUsage.total_user_count || 0);
  renderUsageList('topStorageUsers', (globalUsage.top_storage_users || []).map(user => ({
    key: user.email || user.user_id || 'unknown',
    value: fmtSize(user.total_bytes || 0) + ' · ' + fmtCount(user.attachment_count || 0) + ' files'
  })), 'No attachment data');
  renderUsageList('fileTypeBreakdown', (globalUsage.file_type_breakdown || []).map(type => ({
    key: type.mime_type || 'unknown',
    value: fmtCount(type.file_count || 0) + ' · ' + fmtSize(type.total_bytes || 0)
  })), 'No file types yet');
  document.getElementById('noticeEnabled').checked = !!siteNotice?.enabled;
  document.getElementById('noticeText').value = siteNotice?.message || '';
  document.getElementById('noticeModeAnnouncement').checked = !siteNotice?.maintenance;
  document.getElementById('noticeModeMaintenance').checked = !!siteNotice?.maintenance;
  panel.style.display = 'block';
  updateAdminPanelState();
}

async function loadGlobalUsage() {
  if (mode !== 'synced' || !isAdminUser()) {
    globalUsage = null;
    updateGlobalUsagePanel();
    return;
  }
  const { data, error } = await sb.rpc('get_global_usage_totals');
  if (error) {
    globalUsage = null;
    updateGlobalUsagePanel();
    return;
  }
  globalUsage = Array.isArray(data) ? data[0] : data;
  updateGlobalUsagePanel();
}

async function loadSiteNotice() {
  const { data, error } = await sb.rpc('get_public_notice');
  if (error) {
    siteNotice = null;
    updateSiteBanner();
    return;
  }
  siteNotice = Array.isArray(data) ? data[0] : data;
  updateSiteBanner();
  updateGlobalUsagePanel();
}

async function saveSiteNotice() {
  if (!isAdminUser()) return;
  const enabled = document.getElementById('noticeEnabled').checked;
  const message = document.getElementById('noticeText').value.trim();
  const maintenance = document.getElementById('noticeModeMaintenance').checked;
  const { error } = await sb.rpc('set_public_notice', {
    p_enabled: enabled,
    p_message: message,
    p_maintenance: maintenance
  });
  if (error) {
    toast('notice save failed: ' + error.message, 'var(--danger)');
    return;
  }
  siteNotice = { enabled, message, maintenance };
  updateSiteBanner();
  updateGlobalUsagePanel();
  toast('notice saved');
}
