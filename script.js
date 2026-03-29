// ── KEYS ─────────────────────────────────────────────────────────────────────
const SUPA_URL = 'https://hxkjwebubmdqjzwmnvrh.supabase.co';
const SUPA_KEY = 'sb_publishable_iZkIPeb7P6Eb8RCXC1hNOQ_GhIUlnj0';
const SUPA_MAX_FILE = 50 * 1024 * 1024;
const SUPA_STORAGE_LIMIT = 50 * 1024 * 1024;

// ── STATE ─────────────────────────────────────────────────────────────────────
let sb = null;
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
let realtimeCh = null;
const LS_TODOS = 'todo_v3_todos';
const LS_ATTS  = 'todo_v3_atts';

// ── UTILS ─────────────────────────────────────────────────────────────────────
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}).toUpperCase();
const fmtSize = b => b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB';
const mimeIcon = m => m.startsWith('image/')?'🖼':m==='application/pdf'?'📄':m.startsWith('video/')?'🎬':m.startsWith('audio/')?'🎵':m.includes('zip')?'🗜':'📎';

let toastTimer;
function toast(msg,col){
  const el=document.getElementById('toast');
  el.textContent='// '+msg; el.style.color=col||'var(--green)';
  el.classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}
function dot(s){document.getElementById('syncDot').className='sync-dot '+s;}
function show(id){const el=document.getElementById(id);if(el)el.style.display='block';}
function hide(id){const el=document.getElementById(id);if(el)el.style.display='none';}

// ── IMAGE COMPRESS ────────────────────────────────────────────────────────────
async function compressImage(file, maxW=1600, quality=0.82){
  return new Promise(resolve=>{
    if(!file.type.startsWith('image/')){resolve(file);return;}
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let {width:w,height:h}=img;
      if(w<=maxW&&h<=maxW){resolve(file);return;}
      const ratio=Math.min(maxW/w,maxW/h);
      w=Math.round(w*ratio); h=Math.round(h*ratio);
      const c=document.createElement('canvas');
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      c.toBlob(blob=>{
        if(!blob||blob.size>=file.size){resolve(file);return;}
        resolve(new File([blob],file.name,{type:blob.type||file.type}));
      },file.type||'image/jpeg',quality);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);resolve(file);};
    img.src=url;
  });
}

// ── STORAGE METER ─────────────────────────────────────────────────────────────
function updateStorageMeter(){
  const bar=document.getElementById('storageBar');
  const fill=document.getElementById('storageFill');
  const label=document.getElementById('storageLabel');
  if(mode==='guest'){
    let bytes=0;
    try{bytes=(localStorage.getItem(LS_TODOS)||'').length+(localStorage.getItem(LS_ATTS)||'').length;}catch{}
    const pct=Math.min(100,(bytes/5000000)*100);
    bar.className='storage-bar visible';
    fill.className='storage-fill'+(pct>80?' danger':pct>60?' warn':'');
    fill.style.width=pct.toFixed(1)+'%';
    label.textContent='local storage: '+fmtSize(bytes)+' / ~5MB ('+pct.toFixed(0)+'%)';
  } else {
    let bytes=Object.values(attMap).flat().reduce((s,a)=>s+(a.size||0),0);
    const pct=Math.min(100,(bytes/SUPA_STORAGE_LIMIT)*100);
    bar.className='storage-bar visible';
    fill.className='storage-fill'+(pct>80?' danger':pct>60?' warn':'');
    fill.style.width=pct.toFixed(1)+'%';
    label.textContent='supabase storage: '+fmtSize(bytes)+' / 50MB ('+pct.toFixed(0)+'%)';
    const doneIds=new Set(todos.filter(t=>t.done).map(t=>t.id));
    const hasDoneAtts=Object.keys(attMap).some(id=>doneIds.has(id)&&attMap[id].length>0);
    document.getElementById('btnClearAtts').style.display=hasDoneAtts?'inline-block':'none';
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init(){
  try{
    if (!window.supabase) {
      console.error('Supabase not loaded');
      show('authScreen');
      return;
    }
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth:{detectSessionInUrl:false,persistSession:true,storageKey:'todo-app-auth'}
    });
    window._sb = sb;
  }catch(e){
    console.error('Supabase init failed:', e);
    show('authScreen');
    return;
  }
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.replace(/^#+/, ''));
    const at = params.get('access_token');
    const rt = params.get('refresh_token');
    if (at && rt) {
      await sb.auth.setSession({ access_token: at, refresh_token: rt });
      history.replaceState(null,'',window.location.pathname);
    }
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await enterSyncedMode(session.user);
  } else {
    show('authScreen');
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await enterSyncedMode(session.user);
    }
    if (event === 'SIGNED_OUT') {
      leaveSyncedMode();
      show('authScreen');
    }
  });
}

// ── GUEST MODE ────────────────────────────────────────────────────────────────
function enterGuestMode(){
  mode='guest'; currentUser=null;
  hide('authScreen'); show('appScreen');
  document.getElementById('modeBadge').textContent='GUEST';
  document.getElementById('modeBadge').className='mode-badge guest-mode';
  document.getElementById('btnUpgrade').style.display='inline-block';
  document.getElementById('btnSignOut').style.display='none';
  document.getElementById('userAvatar').style.display='none';
  document.getElementById('avatarPh').textContent='?';
  dot('');
  loadGuest();
}

function loadGuest(){
  try{todos=JSON.parse(localStorage.getItem(LS_TODOS)||'[]');}catch{todos=[];}
  try{attMap=JSON.parse(localStorage.getItem(LS_ATTS)||'{}');}catch{attMap={};}
  render(); updateStorageMeter();
}

function saveGuest(){
  try{
    localStorage.setItem(LS_TODOS,JSON.stringify(todos));
    localStorage.setItem(LS_ATTS,JSON.stringify(attMap));
  }catch(e){
    toast('storage full — data may not save','var(--accent2)');
  }
  updateStorageMeter();
}

// ── SYNCED MODE ───────────────────────────────────────────────────────────────
async function enterSyncedMode(user){
  mode = 'synced';
  currentUser = user;
  hide('authScreen');
  show('appScreen');
  document.getElementById('modeBadge').textContent='SYNCED';
  document.getElementById('modeBadge').className='mode-badge synced-mode';
  document.getElementById('btnUpgrade').style.display='none';
  document.getElementById('btnSignOut').style.display='inline-block';
  const av = document.getElementById('userAvatar');
  const ph = document.getElementById('avatarPh');
  if(currentUser.user_metadata?.avatar_url){
    av.src = currentUser.user_metadata.avatar_url;
    av.style.display = 'inline-block';
    ph.style.display = 'none';
  } else {
    ph.textContent = (currentUser.email || '?')[0].toUpperCase();
    av.style.display = 'none';
  }
  await loadSynced();
  subscribeRealtime();
}

function leaveSyncedMode(){
  mode = 'guest';
  currentUser = null;
  todos = [];
  attMap = {};
  if(realtimeCh){
    sb.removeChannel(realtimeCh);
    realtimeCh = null;
  }
  document.getElementById('appScreen').style.display='none';
  document.getElementById('authScreen').style.display='block';
}

async function loadSynced(){
  dot('syncing');
  const { data: { session } } = await sb.auth.getSession();
  if(!session){
    dot('err');
    toast('session lost — please sign in again','var(--danger)');
    leaveSyncedMode();
    return;
  }
  const [{ data: tData, error: tErr }, { data: aData, error: aErr }] = await Promise.all([
    sb.from('todos').select('*').eq('user_id', currentUser.id).order('created', { ascending: false }),
    sb.from('attachments').select('*').eq('user_id', currentUser.id).order('created', { ascending: true })
  ]);
  if (tErr) { dot('err'); toast('load error: ' + tErr.message, 'var(--danger)'); return; }
  todos = (tData || []).map(t => ({ ...t, desc: t.description || '' }));
  attMap = {};
  (aData || []).forEach(a => {
    (attMap[a.todo_id] = attMap[a.todo_id] || []).push({
      id: a.id, name: a.name, size: a.size, mime: a.mime_type, path: a.path, todoId: a.todo_id
    });
  });
  dot('ok');
  render();
  updateStorageMeter();
}

function subscribeRealtime(){
  if(realtimeCh) sb.removeChannel(realtimeCh);
  let rtTimer;
  function safeReload(){
    clearTimeout(rtTimer);
    rtTimer = setTimeout(() => loadSynced(), 250);
  }
  realtimeCh = sb.channel('rt-' + currentUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'todos'}, safeReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'attachments'}, safeReload)
    .subscribe();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function addTodo(text, priority, desc){
  text = text.trim();
  if(!text) return;
  if(mode === 'guest'){
    todos.unshift({ id: uid(), text, desc: desc.trim(), priority, done: false, created: new Date().toISOString() });
    saveGuest(); render(); return;
  }
  const tempId = 'temp-' + uid();
  const tempTodo = { id: tempId, text, desc: desc.trim(), priority, done: false, created: new Date().toISOString(), _optimistic: true };
  todos.unshift(tempTodo);
  render();
  dot('syncing');
  const { data, error } = await sb.from('todos').insert({
      user_id: currentUser.id, text, description: desc.trim(), priority, done: false
    }).select().single();
  if(error){ todos = todos.filter(t => t.id !== tempId); dot('err'); render(); toast('add failed: ' + error.message, 'var(--danger)'); return; }
  const i = todos.findIndex(t => t.id === tempId);
  if(i !== -1){ todos[i] = { ...data, desc: data.description || '' }; }
  dot('ok'); render(); updateStorageMeter();
}

// ── LISTENERS ─────────────────────────────────────────────────────────────────
document.getElementById('btnAdd').addEventListener('click', () => {
  const t = document.getElementById('newTask');
  const p = document.getElementById('newPri');
  const d = document.getElementById('newDesc');
  addTodo(t.value, p.value, d.value);
  t.value = ''; d.value = ''; t.focus();
});

document.getElementById('btnGoogle').addEventListener('click',()=>
  sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.href}})
);
document.getElementById('btnGuest').addEventListener('click',enterGuestMode);
document.getElementById('btnSignOut').addEventListener('click',async()=> { await sb.auth.signOut(); });

init();
