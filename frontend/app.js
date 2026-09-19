/* SHL Workspace — frontend logic */
const $ = (s) => document.querySelector(s);
const chatBox = $('#chat-box'), chatScroll = $('#chat-scroll');
const userInput = $('#user-input'), sendBtn = $('#send-btn'), charCount = $('#char-count');
const emptyState = $('#empty-state'), followupsEl = $('#followups');
const toastEl = $('#toast');

// ---------- state ----------
let catalog = [];
let activeTypeFilter = 'All';
let shortlist = new Set(JSON.parse(localStorage.getItem('shl_shortlist') || '[]'));
let compareSet = new Set(JSON.parse(localStorage.getItem('shl_compare') || '[]'));
let sessions = JSON.parse(localStorage.getItem('shl_sessions') || '[]');
let activeSessionId = localStorage.getItem('shl_active') || null;

if (!sessions.length) {
  const s = { id: 's' + Date.now(), title: 'New conversation', history: [], created: Date.now() };
  sessions = [s]; activeSessionId = s.id;
}
if (!sessions.find(s => s.id === activeSessionId)) activeSessionId = sessions[0].id;
const activeSession = () => sessions.find(s => s.id === activeSessionId);

function persist() {
  localStorage.setItem('shl_sessions', JSON.stringify(sessions));
  localStorage.setItem('shl_active', activeSessionId);
  localStorage.setItem('shl_shortlist', JSON.stringify([...shortlist]));
  localStorage.setItem('shl_compare', JSON.stringify([...compareSet]));
}

// ---------- toast ----------
let toastT;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ---------- markdown (fixes * bullets from screenshot) ----------
function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function renderMarkdown(raw) {
  let text = escapeHtml(raw || '');
  // code blocks
  text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // headings
  text = text.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>');
  // bold + italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<strong>$2</strong>');
  // links [a](b) and bare urls
  text = text.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  text = text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');

  const lines = text.split('\n');
  let html = '', inUL = false, inOL = false;
  const closeLists = () => { if (inUL) { html += '</ul>'; inUL = false; } if (inOL) { html += '</ol>'; inOL = false; } };
  for (const line of lines) {
    const t = line.trim();
    const bullet = t.match(/^([*•\-–])\s+(.*)/);
    const numbered = t.match(/^(\d+)[.)]\s+(.*)/);
    if (bullet) { if (!inUL) { closeLists(); html += '<ul>'; inUL = true; } html += `<li>${bullet[2]}</li>`; }
    else if (numbered) { if (!inOL) { closeLists(); html += '<ol>'; inOL = true; } html += `<li>${numbered[2]}</li>`; }
    else if (!t) { closeLists(); html += '<div style="height:6px"></div>'; }
    else if (/^<h\d|^<pre|^<ul|^<ol|^<li/.test(t)) { closeLists(); html += line; }
    else { closeLists(); html += `<p>${line}</p>`; }
  }
  closeLists();
  return html;
}

function badgeClass(type) {
  return 'badge';
}
function enrich(rec) {
  const found = catalog.find(c => c.name.toLowerCase() === (rec.name || '').toLowerCase());
  return { ...rec, _full: found || null };
}

// ---------- chat rendering ----------
function updateStats() {
  $('#stat-msgs').textContent = activeSession().history.filter(m => m.role === 'user').length * 2 || activeSession().history.length;
  $('#session-count').textContent = sessions.length;
  $('#shortlist-count').textContent = shortlist.size;
  $('#compare-count').textContent = compareSet.size;
}
function refreshEmpty() {
  emptyState.style.display = activeSession().history.length ? 'none' : 'block';
}

function appendMessage(role, content, recommendations = []) {
  const isUser = role === 'user';
  const wrap = document.createElement('div');
  wrap.className = `message ${isUser ? 'user' : 'bot'}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let recsHTML = '';
  if (recommendations && recommendations.length) {
    recsHTML = '<div class="rec-grid">' + recommendations.map(enrich).map(r => {
      const f = r._full;
      const meta = f
        ? `<div class="rec-meta"><span>${f.duration || 'Duration on request'}</span><span>${f.remote_testing === 'Yes' ? 'Remote testing' : 'Supervised delivery'}</span><span>${f.adaptive === 'Yes' ? 'Adaptive' : 'Fixed form'}</span></div>`
        : `<div class="rec-meta"><span>${r.test_type || ''}</span></div>`;
      const skills = f ? `<div class="cat-tags">${(f.skills_measured || []).slice(0, 3).map(s => `<span>${s}</span>`).join('')}</div>` : '';
      return `<div class="rec-card">
        <div class="rec-top"><div class="rec-name">${r.name}</div><span class="${badgeClass(r.test_type)}">${r.test_type || ''}</span></div>
        ${meta}${skills}
        <div class="rec-actions">
          <button class="mini-btn" onclick="openDetail('${encodeURIComponent(r.name)}')">Details</button>
          <button class="mini-btn ghost" onclick="toggleShortlist('${encodeURIComponent(r.name)}')">Save</button>
          <a class="mini-btn ghost" style="text-decoration:none;text-align:center" href="${r.url}" target="_blank">SHL page</a>
        </div></div>`;
    }).join('') + '</div>';
  }

  wrap.innerHTML = `
    <div class="avatar"><i class="${isUser ? 'ri-user-3-line' : 'ri-bank-line'}"></i></div>
    <div class="bubble">
      ${renderMarkdown(content)}
      ${recsHTML}
      ${!isUser ? `<div class="msg-meta"><span>${time}</span>
        <button title="Copy" onclick="copyText(this)"><i class="ri-file-copy-line"></i></button>
        <button title="Helpful" onclick="toast('Feedback recorded')"><i class="ri-thumb-up-line"></i></button>
        <button title="Not helpful" onclick="toast('Feedback recorded')"><i class="ri-thumb-down-line"></i></button>
      </div>` : `<div class="msg-meta" style="justify-content:flex-end"><span>${time}</span></div>`}
    </div>`;
  chatBox.appendChild(wrap);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  updateStats(); refreshEmpty();
}

function showTyping() {
  const d = document.createElement('div');
  d.className = 'message bot'; d.id = 'typing-row';
  d.innerHTML = `<div class="avatar"><i class="ri-bank-line"></i></div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  chatBox.appendChild(d); chatScroll.scrollTop = chatScroll.scrollHeight;
}
function hideTyping() { document.getElementById('typing-row')?.remove(); }

function showFollowups(hasRecs) {
  const items = hasRecs
    ? ['Compare these tests', 'Only remote-friendly ones', 'Something under 30 minutes', 'More leadership-focused']
    : ['Recommend for Java developers', 'Compare Verify G+ vs OPQ32', 'Remote tests for support roles'];
  followupsEl.innerHTML = items.map(t => `<button class="chip" data-p="${t}">${t}</button>`).join('');
  followupsEl.querySelectorAll('button').forEach(b => b.onclick = () => { userInput.value = b.dataset.p; send(); });
}

// ---------- send ----------
async function send() {
  const text = userInput.value.trim();
  if (!text) return;
  const sess = activeSession();
  if (sess.history.length === 0) {
    sess.title = text.slice(0, 42) + (text.length > 42 ? '…' : '');
    renderSessions();
  }
  appendMessage('user', text);
  sess.history.push({ role: 'user', content: text });
  persist(); userInput.value = ''; charCount.textContent = '0'; autoGrow();
  followupsEl.innerHTML = '';
  showTyping(); sendBtn.disabled = true;
  try {
    const res = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation: sess.history }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    hideTyping();
    appendMessage('assistant', data.message, data.recommendations || []);
    sess.history.push({ role: 'assistant', content: data.message });
    persist(); showFollowups((data.recommendations || []).length > 0);
  } catch (e) {
    console.error(e); hideTyping();
    appendMessage('assistant', 'The service is currently unreachable. Please check that the API is running and try again.');
  } finally { sendBtn.disabled = false; }
}

function autoGrow() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
}
userInput.addEventListener('input', () => { charCount.textContent = userInput.value.length; autoGrow(); });
userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#chat-form')?.addEventListener('submit', (e) => { e.preventDefault(); send(); });
document.querySelector('#composer-form, #chat-form');
sendBtn.onclick = send;

// quick prompts + hero chips
document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { userInput.value = b.dataset.prompt; send(); });

// ---------- sessions ----------
function renderSessions() {
  const list = $('#session-list'); list.innerHTML = '';
  [...sessions].reverse().forEach(s => {
    const b = document.createElement('div');
    b.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    b.innerHTML = `<div class="s-title">${escapeHtml(s.title)}</div>
      <div class="s-meta"><span>${s.history.length} msgs</span><span class="s-del" data-id="${s.id}" title="Delete">✕</span></div>`;
    b.onclick = (e) => {
      if (e.target.classList.contains('s-del')) {
        sessions = sessions.filter(x => x.id !== s.id);
        if (!sessions.length) sessions = [{ id: 's' + Date.now(), title: 'New conversation', history: [], created: Date.now() }];
        if (activeSessionId === s.id) activeSessionId = sessions[0].id;
        persist(); renderSessions(); renderAllMessages(); return;
      }
      activeSessionId = s.id; persist(); renderSessions(); renderAllMessages();
      if (window.innerWidth < 860) $('#sidebar').classList.remove('open');
    };
    list.appendChild(b);
  });
  updateStats();
}
function renderAllMessages() {
  chatBox.innerHTML = ''; refreshEmpty();
  activeSession().history.forEach(m => appendMessage(m.role, m.content, []));
  // note: recommendations aren't persisted in history; they re-render on new sends
  chatBox.scrollTop = chatScroll.scrollHeight; updateStats();
}
$('#new-chat-btn').onclick = () => {
  const s = { id: 's' + Date.now(), title: 'New conversation', history: [], created: Date.now() };
  sessions.unshift(s); activeSessionId = s.id; persist(); renderSessions(); renderAllMessages(); followupsEl.innerHTML = '';
  toast('New conversation started');
};
$('#clear-btn').onclick = () => {
  activeSession().history = []; persist(); renderAllMessages(); followupsEl.innerHTML = ''; toast('Chat cleared');
};
$('#export-btn').onclick = () => {
  const s = activeSession();
  let md = `# SHL Conversation — ${s.title}\n\n`;
  s.history.forEach(m => md += `**${m.role === 'user' ? 'You' : 'Assistant'}:** ${m.content}\n\n`);
  download(md, 'shl-chat.md', 'text/markdown'); toast('Chat exported');
};

// ---------- catalog ----------
async function loadCatalog() {
  try {
    const r = await fetch('/catalog'); const j = await r.json();
    catalog = j.items || [];
  } catch { catalog = []; }
  renderTypeFilters(); renderCatalog(); renderShortlist(); renderCompare(); updateStats();
}
function renderTypeFilters() {
  const types = ['All', ...new Set(catalog.map(c => c.test_type))];
  $('#type-filters').innerHTML = types.map(t => `<button class="f-chip ${t === activeTypeFilter ? 'active' : ''}" data-t="${t}">${t}</button>`).join('');
  document.querySelectorAll('.f-chip').forEach(b => b.onclick = () => { activeTypeFilter = b.dataset.t; renderTypeFilters(); renderCatalog(); });
}
function renderCatalog() {
  const q = ($('#catalog-search').value || '').toLowerCase();
  const items = catalog.filter(c =>
    (activeTypeFilter === 'All' || c.test_type === activeTypeFilter) &&
    (!q || (c.name + ' ' + (c.skills_measured || []).join(' ') + ' ' + (c.job_roles || []).join(' ') + ' ' + c.description).toLowerCase().includes(q))
  );
  $('#catalog-list').innerHTML = items.map(c => `
    <div class="cat-card">
      <span class="${badgeClass(c.test_type)}">${c.test_type}</span>
      <h4>${c.name}</h4><p>${c.description}</p>
      <div class="cat-tags"><span>${c.duration}</span><span>${c.remote_testing === 'Yes' ? 'Remote testing' : 'Supervised delivery'}</span><span>${c.adaptive === 'Yes' ? 'Adaptive' : 'Fixed form'}</span></div>
      <div class="cat-actions">
        <button class="mini-btn" onclick="openDetail('${encodeURIComponent(c.name)}')">Details</button>
        <button class="mini-btn ghost" onclick="toggleShortlist('${encodeURIComponent(c.name)}')">${shortlist.has(c.name) ? 'Saved' : 'Save'}</button>
        <button class="mini-btn ghost" onclick="toggleCompare('${encodeURIComponent(c.name)}')">${compareSet.has(c.name) ? 'Selected' : 'Compare'}</button>
      </div>
    </div>`).join('') || '<div class="panel-hint">No matches. Try another skill or role.</div>';
}
$('#catalog-search').addEventListener('input', renderCatalog);

// ---------- shortlist / compare ----------
window.toggleShortlist = (enc) => {
  const name = decodeURIComponent(enc);
  shortlist.has(name) ? shortlist.delete(name) : shortlist.add(name);
  persist(); renderCatalog(); renderShortlist(); updateStats();
  toast(shortlist.has(name) ? 'Saved to shortlist' : 'Removed from shortlist');
};
function renderShortlist() {
  const items = catalog.filter(c => shortlist.has(c.name));
  $('#shortlist-list').innerHTML = items.map(c => `
    <div class="cat-card"><span class="${badgeClass(c.test_type)}">${c.test_type}</span>
      <h4>${c.name}</h4><p>${c.description}</p>
      <div class="cat-actions"><button class="mini-btn" onclick="openDetail('${encodeURIComponent(c.name)}')">Details</button>
      <a class="mini-btn ghost" style="text-decoration:none;text-align:center" href="${c.url}" target="_blank">SHL page</a>
      <button class="mini-btn ghost" onclick="toggleShortlist('${encodeURIComponent(c.name)}')">Remove</button></div></div>`).join('')
    || '<div class="panel-hint">No saved assessments. Use Save on any catalog entry.</div>';
}
$('#clear-shortlist').onclick = () => { shortlist.clear(); persist(); renderCatalog(); renderShortlist(); updateStats(); };
$('#export-shortlist').onclick = () => {
  const items = catalog.filter(c => shortlist.has(c.name));
  let md = '# SHL Shortlist\n\n' + items.map(c => `- **${c.name}** (${c.test_type}, ${c.duration}) — ${c.url}`).join('\n');
  download(md || '# Empty shortlist', 'shl-shortlist.md', 'text/markdown'); toast('Shortlist exported');
};
$('#shortlist-toggle').onclick = () => { switchTab('shortlist'); $('#panel').classList.add('open'); };

window.toggleCompare = (enc) => {
  const name = decodeURIComponent(enc);
  if (compareSet.has(name)) compareSet.delete(name);
  else { if (compareSet.size >= 3) { toast('Compare up to 3 — remove one first'); return; } compareSet.add(name); }
  persist(); renderCatalog(); renderCompare(); updateStats();
};
function renderCompare() {
  const items = catalog.filter(c => compareSet.has(c.name));
  if (!items.length) { $('#compare-table-wrap').innerHTML = '<div class="panel-hint">No items selected yet.</div>'; return; }
  const rows = [['Type', 'test_type'], ['Duration', 'duration'], ['Remote', 'remote_testing'], ['Adaptive', 'adaptive'], ['Languages', null]];
  $('#compare-table-wrap').innerHTML = `<table class="compare-table"><tr><th></th>${items.map(c => `<th>${c.name}</th>`).join('')}</tr>` +
    rows.map(([label, k]) => `<tr><td><b>${label}</b></td>${items.map(c => `<td>${k ? c[k] : (c.languages || []).join(', ')}</td>`).join('')}</tr>`).join('') +
    `<tr><td><b>Top skills</b></td>${items.map(c => `<td>${(c.skills_measured || []).slice(0, 4).join(', ')}</td>`).join('')}</tr></table>`;
}
$('#clear-compare').onclick = () => { compareSet.clear(); persist(); renderCatalog(); renderCompare(); updateStats(); };

// ---------- modal ----------
window.openDetail = (enc) => {
  const name = decodeURIComponent(enc);
  const c = catalog.find(x => x.name === name);
  if (!c) return;
  $('#modal-body').innerHTML = `
    <span class="${badgeClass(c.test_type)}">${c.test_type}</span>
    <h2>${c.name}</h2>
    <p class="desc">${c.description}</p>
    <div class="detail-grid">
      <div><b>Duration</b>${c.duration}</div>
      <div><b>Remote testing</b>${c.remote_testing === 'Yes' ? 'Supported' : 'Not supported'}</div>
      <div><b>Adaptive</b>${c.adaptive === 'Yes' ? 'Yes' : 'Fixed form'}</div>
      <div><b>Languages</b>${(c.languages || []).join(', ')}</div>
    </div>
    <b style="font-size:12px;color:var(--muted)">SKILLS MEASURED</b>
    <div class="skill-tags">${(c.skills_measured || []).map(s => `<span>${s}</span>`).join('')}</div>
    <b style="font-size:12px;color:var(--muted);display:block;margin-top:12px">SUITABLE ROLES</b>
    <div class="skill-tags">${(c.job_roles || []).map(s => `<span>${s}</span>`).join('')}</div>
    <div class="row-actions">
      <a class="secondary-btn" style="text-decoration:none;text-align:center" href="${c.url}" target="_blank">Open on SHL.com</a>
      <button class="secondary-btn" onclick="toggleShortlist('${encodeURIComponent(c.name)}')">${shortlist.has(c.name) ? 'Saved to shortlist' : 'Save to shortlist'}</button>
      <button class="secondary-btn" onclick="askAbout('${encodeURIComponent(c.name)}')">Ask about this test</button>
    </div>`;
  $('#modal-backdrop').classList.add('open');
};
window.askAbout = (enc) => {
  $('#modal-backdrop').classList.remove('open');
  userInput.value = `Tell me more about ${decodeURIComponent(enc)} and who it suits best.`;
  send();
};
$('#modal-close').onclick = () => $('#modal-backdrop').classList.remove('open');
$('#modal-backdrop').onclick = (e) => { if (e.target.id === 'modal-backdrop') e.target.classList.remove('open'); };

// ---------- tabs / panels ----------
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
$('#panel-toggle').onclick = () => $('#panel').classList.toggle('open');
$('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('open');
$('#sidebar-close').onclick = () => $('#sidebar').classList.remove('open');

// ---------- misc ----------
window.copyText = (btn) => {
  const txt = btn.closest('.bubble').innerText;
  navigator.clipboard.writeText(txt).then(() => toast('Copied to clipboard'));
};
function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
}
const micBtn = $('#mic-btn');
if (micBtn) micBtn.onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input not supported in this browser'); return; }
  const rec = new SR(); rec.lang = 'en-US';
  toast('Listening — speak now');
  rec.onresult = (e) => { userInput.value += e.results[0][0].transcript; charCount.textContent = userInput.value.length; autoGrow(); };
  rec.start();
};

async function loadStats() {
  try {
    const r = await fetch('/catalog/stats'); const s = await r.json();
    $('#stat-total').textContent = s.total;
    $('#stat-remote').textContent = s.remote_friendly;
    $('#stat-adaptive').textContent = s.adaptive;
  } catch { /* offline */ }
}
async function checkHealth() {
  try {
    const r = await fetch('/health'); const j = await r.json();
    const ok = j.status === 'ok';
    $('#health-dot').classList.toggle('off', !ok);
    $('#health-card').classList.toggle('bad', !ok);
    $('#health-title').textContent = ok ? 'Service operational' : 'Service issue';
    $('#health-sub').textContent = `Catalog ${j.chroma_db_exists ? 'loaded' : 'missing'} · API key ${j.google_api_key_set ? 'configured' : 'missing'}`;
  } catch {
    $('#health-dot').classList.add('off'); $('#health-card').classList.add('bad');
    $('#health-title').textContent = 'Service unreachable'; $('#health-sub').textContent = 'Unable to reach /health';
  }
}
$('#health-refresh').onclick = checkHealth;

// ---------- init ----------
renderSessions(); renderAllMessages(); loadCatalog(); loadStats(); checkHealth();
setInterval(checkHealth, 30000);
// welcome message on first run
if (activeSession().history.length === 0) {
  appendMessage('assistant', 'Welcome. State the **role**, the **skills to assess**, and constraints such as **duration** or **remote testing** — for example: “Java developers, data structures and algorithms, 60 minutes, remote”. I will return matching SHL assessments with catalog links.');
  showFollowups(false);
}
