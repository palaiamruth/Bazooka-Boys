const API_KEY_STORAGE = 'slap-api-key';
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
 
// Search grounding has a much smaller free quota. Keep false unless you need sources.
const USE_SEARCH = false;
 
// ---------- Helpers ----------
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
function $(id) { return document.getElementById(id); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
 
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
 
// ---------- Theme ----------
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  store('slap-theme', t);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
}
setTheme(load('slap-theme') || 'dark');
 
// ---------- Settings panel ----------
function toggleSettings() {
  $('settingsPanel').classList.toggle('open');
  $('apiKeyInput').value = getApiKey();
  updateApiKeyStatus();
}
document.addEventListener('click', e => {
  if (!e.target.closest('.settings-wrap')) $('settingsPanel').classList.remove('open');
});
 
// ---------- API key ----------
function cleanKey(s) {
  return String(s || '').replace(/[^A-Za-z0-9._\-]/g, '');
}
function getApiKey() {
  return cleanKey(load(API_KEY_STORAGE));
}
function saveApiKey() {
  const raw = $('apiKeyInput').value.trim();
  if (!raw) { showToast('Enter an API key first'); return; }
  if (raw.includes('•')) { showToast('That is the masked key. Paste the real key'); return; }
  const key = cleanKey(raw);
  if (key.length < 20) { showToast('Key looks too short'); return; }
  store(API_KEY_STORAGE, key);
  $('apiKeyInput').value = key;
  updateApiKeyStatus();
  showToast('API key saved');
}
function clearApiKey() {
  remove(API_KEY_STORAGE);
  $('apiKeyInput').value = '';
  updateApiKeyStatus();
  showToast('API key cleared');
}
function updateApiKeyStatus() {
  const el = $('apiKeyStatus');
  const key = getApiKey();
  if (key) {
    const masked = key.length <= 8 ? '••••••••' : key.slice(0, 4) + '••••' + key.slice(-4);
    el.textContent = 'Saved: ' + masked;
    el.className = 'api-status ok';
  } else {
    el.textContent = 'No key saved';
    el.className = 'api-status';
  }
}
 
// ---------- Navigation / toast ----------
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
  $('nav-home').classList.toggle('active', name === 'home');
  $('nav-agent').classList.toggle('active', name === 'agent');
  window.scrollTo(0, 0);
}
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}
function clearSaved() {
  remove('slap-draft');
  clearApiKey();
  showToast('All saved data cleared');
}
 
// ---------- Product search ----------
function searchProduct() {
  const q = $('productInput').value.trim();
  if (!q) { showToast('Enter a product or category'); return; }
  const enc = encodeURIComponent(q);
  const g = 'https://www.google.com/search?q=';
  $('resultTitle').textContent = q;
  $('link-shopping').href = g + enc + '&tbm=shop';
  $('link-bestprice').href = g + enc + '+best+price';
  $('link-amazon').href = g + enc + '+site:amazon.in';
  $('link-flipkart').href = g + enc + '+site:flipkart.com';
  $('link-reviews').href = g + enc + '+reviews+rating';
  $('link-youtube').href = g + enc + '+review&tbm=vid';
  $('link-expert').href = g + enc + '+review+OR+%22expert+review%22';
  $('productResult').classList.add('show');
  $('productResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function quickSearch(name) {
  $('productInput').value = name;
  searchProduct();
}
 
// ---------- Draft save / load ----------
const FORM_FIELDS = ['question', 'domain', 'location', 'focus', 'context', 'notes'];
 
function saveFormData() {
  const data = {};
  FORM_FIELDS.forEach(f => data[f] = $('q-' + f).value);
  store('slap-draft', JSON.stringify(data));
  showToast('Draft saved');
}
function loadFormData() {
  const raw = load('slap-draft');
  if (!raw) { showToast('No draft'); return; }
  try {
    const d = JSON.parse(raw);
    FORM_FIELDS.forEach(f => $('q-' + f).value = d[f] || '');
    showToast('Loaded');
  } catch (e) {
    showToast('Draft is corrupted');
  }
}
 
// ---------- Research: Gemini ----------
function readForm() {
  return {
    question: $('q-question').value.trim(),
    domain: $('q-domain').value || 'General',
    location: $('q-location').value || 'India',
    focus: $('q-focus').value || 'competitors, pricing',
    context: $('q-context')?.value.trim() || '',
    notes: $('q-notes')?.value.trim() || ''
  };
}
 
async function callGemini(apiKey, prompt, useSearch) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  if (useSearch) body.tools = [{ google_search: {} }];
  else body.generationConfig.responseMimeType = 'application/json';
 
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    }
  );
 
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    // Google says how long to wait, e.g. "retryDelay": "34s"
    const info = (data?.error?.details || []).find(d => d.retryDelay);
    err.retryAfter = info ? Math.ceil(parseFloat(info.retryDelay)) : null;
    err.zeroQuota = /limit:\s*0/i.test(err.message);
    throw err;
  }
  return data;
}
 
function isKeyError(e) {
  return e.status === 403 || e.status === 401 || /API key not valid|API_KEY_INVALID|permission denied/i.test(e.message);
}
 
function friendlyError(e) {
  if (isKeyError(e)) return 'Invalid API key, or the Generative Language API is not enabled for it.';
  if (e.status === 429 && e.zeroQuota) return 'Your key has no free quota for this model. Create a new key at aistudio.google.com/apikey ("Create API key in new project"), or try GEMINI_MODEL = "gemini-3.1-flash-lite".';
  if (e.status === 429) return 'Free-tier limit reached (too many requests per minute or per day). Wait a minute and try once. If it keeps failing, the daily quota is used up and resets tomorrow.';
  if (e.status === 404) return 'This Gemini model is unavailable for your API key.';
  return e.message;
}
 
// Pull JSON out of the model text, even if wrapped in ```json fences or extra words
function parseJsonLoose(text) {
  const clean = text.replace(/```json|```/gi, '').trim();
  try { return JSON.parse(clean); } catch (e) {}
  const s = clean.indexOf('{'), e2 = clean.lastIndexOf('}');
  if (s === -1 || e2 === -1) throw new Error('Gemini did not return valid JSON. Try again.');
  return JSON.parse(clean.slice(s, e2 + 1));
}
 
function getText(data) {
  const c = data.candidates?.[0];
  if (!c) throw new Error('Gemini returned no response (it may have been blocked).');
  const text = (c.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response.');
  return { text, candidate: c };
}
 
let lastRun = 0;
 
async function runResearch() {
  const f = readForm();
  if (!f.question) { showToast('Enter a question'); return; }
 
  const apiKey = getApiKey();
  if (!apiKey) { showToast('No API key saved'); return runResearchOffline(); }
 
  // Block rapid repeat clicks (free tier allows only a few requests per minute)
  const wait = Math.ceil((lastRun + 15000 - Date.now()) / 1000);
  if (wait > 0) { showToast('Wait ' + wait + 's before running again'); return; }
  lastRun = Date.now();
 
  const out = $('agentResult');
  const btn = $('runBtn');
  if (btn) btn.disabled = true;
  out.style.display = 'block';
  out.innerHTML = '<p style="color:var(--muted);">Researching with Gemini…</p>';
 
  const prompt = `
Market research task.
 
Question: ${f.question.slice(0, 500)}
Domain: ${f.domain.slice(0, 100)}
Location: ${f.location.slice(0, 100)}
Focus: ${f.focus.slice(0, 200)}
Context: ${f.context.slice(0, 300) || 'none'}
 
Return ONLY valid JSON in exactly this shape:
{
 "market":"1-2 short sentences",
 "competitors":[{"name":"","pricing":""}],
 "opportunities":["",""],
 "risks":["",""],
 "recommendation":"1 short sentence"
}
 
Rules:
- Maximum 3 competitors, 2 opportunities, 2 risks
- Keep every field short
- Use INR when relevant
- No markdown, no text outside the JSON
`;
 
  try {
    let data;
    try {
      data = await callGemini(apiKey, prompt, USE_SEARCH);
    } catch (e) {
      // Short rate limit: wait the time Google asks for, then retry ONCE
      if (e.status === 429 && !e.zeroQuota && e.retryAfter && e.retryAfter <= 60) {
        for (let s = e.retryAfter; s > 0; s--) {
          out.innerHTML = '<p style="color:var(--muted);">Rate limit hit. Retrying in ' + s + 's…</p>';
          await sleep(1000);
        }
        out.innerHTML = '<p style="color:var(--muted);">Retrying…</p>';
        data = await callGemini(apiKey, prompt, USE_SEARCH);
      } else {
        throw e;
      }
    }
 
    const { text, candidate } = getText(data);
    renderReport(parseJsonLoose(text), candidate, f, USE_SEARCH);
 
  } catch (err) {
    console.error('Gemini error:', err);
    out.innerHTML =
      '<p style="color:var(--muted);">Gemini request failed: ' + escapeHtml(friendlyError(err)) + '</p>' +
      '<p><button class="btn btn-outline btn-sm" onclick="runResearchOffline()">Use offline template</button></p>';
  } finally {
    if (btn) btn.disabled = false;
  }
}
 
// ---------- Render Gemini report ----------
function renderReport(r, candidate, f, grounded) {
  const esc = escapeHtml;
  const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
 
  const comps = arr(r.competitors);
  const compHtml = comps.length
    ? '<table><thead><tr><th>Player</th><th>Pricing</th></tr></thead><tbody>' +
      comps.map(c => '<tr><td><strong>' + esc(c.name) + '</strong></td><td>' + esc(c.pricing) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p>No competitor data returned.</p>';
 
  const oppHtml = '<ul>' + arr(r.opportunities).map(o => '<li><span class="tag tag-green">Opp</span> ' + esc(o) + '</li>').join('') + '</ul>';
  const riskHtml = '<ul>' + arr(r.risks).map(o => '<li><span class="tag tag-red">Risk</span> ' + esc(o) + '</li>').join('') + '</ul>';
 
  // Sources from Google Search grounding (only when USE_SEARCH is true)
  let sourcesHtml = '';
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const items = [];
  chunks.forEach(c => {
    const u = c.web?.uri;
    if (u && !seen.has(u)) {
      seen.add(u);
      items.push('<li><span>' + esc(c.web.title || u) + '</span><a href="' + esc(u) + '" target="_blank" rel="noopener">Open ↗</a></li>');
    }
  });
  if (items.length) {
    sourcesHtml = '<div class="section-title">Sources</div><ul class="link-list">' + items.slice(0, 6).join('') + '</ul>';
  }
 
  const googleQ = encodeURIComponent(f.question + ' ' + f.location);
  const out = $('agentResult');
  out.style.display = 'block';
  out.innerHTML =
    '<span class="badge">' + esc(f.domain) + '</span>' +
    '<h2 style="margin:8px 0;">Report' + (grounded ? '' : ' (no live search)') + '</h2>' +
    '<p style="color:var(--muted);"><strong>Q:</strong> ' + esc(f.question) + '</p>' +
    (f.context ? '<p style="color:var(--muted);">Context: ' + esc(f.context) + '</p>' : '') +
    '<div class="section-title">Market</div><p>' + esc(r.market) + '</p>' +
    '<div class="section-title">Competitors</div>' + compHtml +
    '<div class="section-title">Opportunities</div>' + oppHtml +
    '<div class="section-title">Risks</div>' + riskHtml +
    '<div class="section-title">Recommendation</div><p>' + esc(r.recommendation) + '</p>' +
    sourcesHtml +
    '<div class="section-title">Google</div>' +
    '<ul class="link-list">' +
      '<li><span>Full search</span><a href="https://www.google.com/search?q=' + googleQ + '" target="_blank" rel="noopener">Open ↗</a></li>' +
    '</ul>';
  out.scrollIntoView({ behavior: 'smooth' });
}
 
// ---------- Research: offline template (fallback) ----------
function runResearchOffline() {
  const f = readForm();
  if (!f.question) { showToast('Enter a question'); return; }
  const esc = escapeHtml;
  const googleQ = encodeURIComponent(f.question + ' ' + f.location);
  const isScooter = /scooter|bengaluru|bangalore|electric|mobility|yulu|bounce/i.test(f.question + f.location);
 
  let competitors, market, opps, risks, reco;
  if (isScooter) {
    competitors = '<table><thead><tr><th>Player</th><th>Model</th><th>Pricing</th><th>Target</th></tr></thead><tbody>' +
      '<tr><td><strong>Yulu</strong></td><td>Low-speed</td><td>₹5+₹2.5/min</td><td>Last-mile</td></tr>' +
      '<tr><td><strong>Bounce Daily</strong></td><td>Hub rental</td><td>₹230–285/day</td><td>Gig/office</td></tr>' +
      '<tr><td><strong>OEM BaaS</strong></td><td>Low upfront+/km</td><td>From ₹45k</td><td>Ownership</td></tr>' +
      '</tbody></table>';
    market = 'Bengaluru is a top Indian EV market. ~1.15–1.28M e-2W sales India FY25.';
    opps = '<ul><li><span class="tag tag-green">Opp</span> Premium monthly / B2B fleet</li><li><span class="tag tag-green">Opp</span> Battery-swap moat</li></ul>';
    risks = '<ul><li><span class="tag tag-red">Risk</span> Yulu/Bounce competition</li><li><span class="tag tag-orange">Risk</span> Capex &amp; utilisation</li></ul>';
    reco = 'Differentiate (premium or B2B). Pilot in IT corridors.';
  } else {
    competitors = '<p>Use Google links for live competitor data.</p>';
    market = 'Validate size &amp; regulation for “' + esc(f.question) + '” in ' + esc(f.location) + '.';
    opps = '<ul><li><span class="tag tag-green">Opp</span> Niche differentiation</li></ul>';
    risks = '<ul><li><span class="tag tag-red">Risk</span> Competition &amp; capital</li></ul>';
    reco = 'Validate with primary research before scaling.';
  }
 
  const out = $('agentResult');
  out.style.display = 'block';
  out.innerHTML =
    '<span class="badge">' + esc(f.domain) + '</span>' +
    '<h2 style="margin:8px 0;">Report (offline template)</h2>' +
    '<p style="color:var(--muted);"><strong>Q:</strong> ' + esc(f.question) + '</p>' +
    (f.context ? '<p style="color:var(--muted);">Context: ' + esc(f.context) + '</p>' : '') +
    '<div class="section-title">Market</div><p>' + market + '</p>' +
    '<div class="section-title">Competitors</div>' + competitors +
    '<div class="section-title">Opportunities</div>' + opps +
    '<div class="section-title">Risks</div>' + risks +
    '<div class="section-title">Recommendation</div><p>' + reco + '</p>' +
    '<div class="section-title">Google</div>' +
    '<ul class="link-list">' +
      '<li><span>Full search</span><a href="https://www.google.com/search?q=' + googleQ + '" target="_blank" rel="noopener">Open ↗</a></li>' +
      '<li><span>Focus</span><a href="https://www.google.com/search?q=' + encodeURIComponent(f.focus + ' ' + f.location) + '" target="_blank" rel="noopener">Open ↗</a></li>' +
    '</ul>';
  out.scrollIntoView({ behavior: 'smooth' });
}
 
// Init status on load
updateApiKeyStatus();