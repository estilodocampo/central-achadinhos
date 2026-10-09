(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const html = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = v => Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  let toastTimer;
  function toast(msg, err = false) {
    const n = el('toast'); n.textContent = msg; n.classList.toggle('error', err); n.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('visible'), 3500);
  }
  const DRAFT = 'replicador-draft-v1';
  let draftTimer = null;
  function readDraft() { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') || null; } catch { return null; } }
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({
          adUrl: el('ad-url').value, platform: el('f-platform').value, title: el('f-title').value,
          price: el('f-price').value, old: el('f-old').value, coupon: el('f-coupon').value,
          link: el('f-link').value, image: el('f-image').value, message: el('message').value,
          groups: [...document.querySelectorAll('[data-group]:checked')].map(i => i.dataset.group)
        }));
      } catch {}
    }, 250);
  }
  function restoreDraft() {
    const d = readDraft();
    if (!d) return false;
    if (typeof d.adUrl === 'string') el('ad-url').value = d.adUrl;
    if (typeof d.platform === 'string' && [...el('f-platform').options].some(o => o.value === d.platform || o.text === d.platform)) el('f-platform').value = d.platform;
    for (const [id, key] of [['f-title', 'title'], ['f-price', 'price'], ['f-old', 'old'], ['f-coupon', 'coupon'], ['f-link', 'link'], ['f-image', 'image']]) {
      if (typeof d[key] === 'string') el(id).value = d[key];
    }
    if (typeof d.message === 'string' && d.message) el('message').value = d.message;
    return true;
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT); } catch {} }
  const plainNumber = v => {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN;
    let x = String(v ?? '').trim().replace(/\s|R\$/gi, '');
    if (!x) return NaN;
    if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.');
    else x = x.replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(x)) return NaN;
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  function platformForLink(link) {
    try {
      const h = new URL(link).hostname.toLowerCase();
      if (/(^|\.)shopee\.com(\.br)?$|(^|\.)shope\.ee$/.test(h)) return 'Shopee';
      if (/(^|\.)mercadolivre\.com(\.br)?$|(^|\.)mercadolibre\.com$|(^|\.)meli\.la$/.test(h)) return 'Mercado Livre';
      if (/(^|\.)tiktok\.com$|(^|\.)tiktokshop\.com$|(^|\.)tiktokv\.com$/.test(h)) return 'TikTok Shop';
    } catch {}
    return '';
  }
  function syncPlatformFromLink() {
    const p = platformForLink(el('ad-url').value.trim());
    if (p) el('f-platform').value = p;
    return p;
  }
  function buildMessage() {
    const platform = el('f-platform').value;
    const title = el('f-title').value.trim() || 'Oferta imperdível';
    const price = plainNumber(el('f-price').value);
    const oldT = el('f-old').value.trim();
    const old = oldT ? plainNumber(oldT) : NaN;
    const coupon = el('f-coupon').value.trim();
    const link = el('f-link').value.trim();
    let m = '🛍️ *ACHADINHO ' + platform.toUpperCase() + '*\n\n🔥 *' + title + '*\n';
    if (!Number.isNaN(price) && price > 0) {
      m += '\n💰 *Preço: ' + money(price) + '*';
      if (!Number.isNaN(old) && old > price) {
        const off = Math.round((1 - price / old) * 100);
        m += '\n🏷️ Antes: ' + money(old) + (off ? ' · ' + off + '% OFF' : '');
      }
    } else m += '\n💰 *Confira o preço no link*';
    if (coupon) m += '\n🎟️ Cupom: ' + coupon;
    if (link) m += '\n\n🛒 *Veja a oferta:*\n' + link;
    m += '\n\n⚠️ Preço e disponibilidade sujeitos a alteração.\n🔗 Link de afiliado.';
    el('message').value = m;
  }
  let importTimer = null;
  let importSerial = 0;
  let lastFetched = '';
  async function fetchPreview(auto = false) {
    const url = el('ad-url').value.trim();
    if (!url) return toast('Cole o link do anúncio.', true);
    if (auto && url === lastFetched) return;
    const serial = ++importSerial;
    syncPlatformFromLink();
    buildMessage();
    const btn = el('fetch-btn');
    btn.disabled = true; btn.textContent = 'Buscando…';
    el('fetch-status').className = 'assist-message';
    el('fetch-status').textContent = 'Consultando dados públicos…';
    try {
      const payload = {url};
      const sc = shopeeCreds();
      if (sc) { payload.shopeeAppId = sc.id; payload.shopeeAppSecret = sc.secret; }
      const tc = readCreds(TIKTOK_CREDS);
      if (tc?.key && tc?.secret) { payload.tiktokAppKey = String(tc.key).slice(0, 64); payload.tiktokAppSecret = String(tc.secret).slice(0, 256); }
      const r = await fetch('/api/preview', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
      const d = await r.json();
      if (serial !== importSerial) return;
      if (!r.ok) throw new Error(d.error || 'Prévia indisponível.');
      const prevFetched = lastFetched;
      lastFetched = url;
      const p = platformForLink(url);
      if (p) el('f-platform').value = p;
      if (d.title) el('f-title').value = d.title;
      if (typeof d.price === 'number' && d.price > 0) el('f-price').value = d.price.toFixed(2).replace('.', ',');
      if (typeof d.oldPrice === 'number' && d.oldPrice > (d.price || 0)) el('f-old').value = d.oldPrice.toFixed(2).replace('.', ',');
      if (d.image) el('f-image').value = d.image;
      updatePhotoPreview();
      if (!el('f-link').value || el('f-link').value === prevFetched) el('f-link').value = url;
      el('fetch-status').className = 'assist-message ' + (d.price != null ? 'success' : 'error');
      el('fetch-status').textContent = (d.priceNote || 'Confira o preço na loja.')
        + (d.shopeeSource === 'navegador' ? ' (usando SUA chave Shopee)' : '');
      buildMessage();
      el('ad-url').value = '';
      saveDraft();
      toast(d.price != null ? 'Dados puxados. Revise e replique.' : 'Sem preço confirmado — complete manualmente.', d.price == null);
    } catch (e) {
      el('f-link').value = el('f-link').value || url;
      syncPlatformFromLink();
      buildMessage();
      saveDraft();
      el('fetch-status').className = 'assist-message error';
      el('fetch-status').textContent = (e.message || 'Falha.') + ' Preencha manualmente.';
      if (serial !== importSerial) return;
      toast('A loja não liberou os dados.', true);
    } finally { if (serial === importSerial) { btn.disabled = false; btn.textContent = 'Buscar dados'; } }
  }
  function scheduleAutoImport() {
    clearTimeout(importTimer);
    const url = el('ad-url').value.trim();
    if (!url || url === lastFetched || !platformForLink(url)) return;
    importTimer = setTimeout(() => fetchPreview(true), 600);
  }
  function updatePhotoPreview() {
    const box = el('photo-preview');
    if (!box) return;
    let src = '';
    try {
      const u = new URL(el('f-image').value.trim());
      if (u.protocol === 'https:' && !u.username && !u.password) src = u.href;
    } catch {}
    if (!src) {
      box.classList.remove('broken');
      box.innerHTML = '<span>🛍️</span>';
      return;
    }
    if (box.dataset.src === src && box.querySelector('img')) return;
    box.dataset.src = src;
    box.classList.remove('broken');
    box.innerHTML = '';
    const img = document.createElement('img');
    img.alt = 'Foto do produto';
    img.loading = 'lazy';
    img.src = src;
    img.onerror = () => {
      box.classList.add('broken');
      box.innerHTML = 'Não consegui carregar a foto desse link. Confira a URL.';
    };
    box.appendChild(img);
  }
  async function copyText() {
    const v = el('message').value;
    if (!v) return toast('Nada para copiar.', true);
    try { await navigator.clipboard.writeText(v); toast('Mensagem copiada!'); }
    catch { toast('Bloqueado pelo navegador. Selecione e copie.', true); }
  }
  let waTimer = null;
  async function waRefresh() {
    try {
      const r = await fetch('/api/wa/status', {cache: 'no-store'});
      const s = await r.json();
      const pill = el('wa-pill'), st = el('wa-status');
      if (s.connected) {
        pill.textContent = 'WhatsApp: conectado' + (s.user ? ' • ' + s.user : '');
        pill.className = 'status-pill pronta';
        st.className = 'assist-message success';
        st.textContent = 'Conectado' + (s.user ? ' como ' + s.user : '') + '. Selecione os grupos abaixo.';
        el('qr-wrap').classList.add('hidden');
        el('repair-wrap').classList.add('hidden');
        await loadGroups(false);
      } else if (s.needsRepair) {
        pill.textContent = 'WhatsApp: reparar sessão';
        pill.className = 'status-pill rascunho';
        st.className = 'assist-message error';
        st.textContent = s.lastError || 'Sessão inválida. Gere um novo QR ou use o código.';
        el('qr-wrap').classList.add('hidden');
        el('repair-wrap').classList.remove('hidden');
        el('repair-msg').textContent = s.lastError || 'Sessão inválida.';
      } else {
        pill.textContent = 'WhatsApp: escaneie o QR';
        pill.className = 'status-pill rascunho';
        st.className = 'assist-message error';
        st.textContent = (s.lastError ? s.lastError + ' ' : '') + 'Desconectado. Escaneie o QR para conectar sua conta.';
        el('repair-wrap').classList.add('hidden');
        if (s.qr) { el('qr-img').src = s.qr; el('qr-wrap').classList.remove('hidden'); }
        else el('qr-wrap').classList.add('hidden');
      }
    } catch {
      el('wa-status').textContent = 'Servidor indisponível.';
    }
  }
  let lastGroupsSig = '';
  let groupsFirstLoad = true;
  const draftGroups = (() => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return Array.isArray(d?.groups) ? d.groups : null; } catch { return null; } })();
  async function loadGroups(force = true) {
    const box = el('groups-list');
    try {
      const r = await fetch('/api/wa/groups' + (force ? '?refresh=1' : ''), {cache: 'no-store'});
      const d = await r.json();
      const groups = d.groups || [];
      const sig = groups.map(g => g.id).join('|');
      if (!force && sig === lastGroupsSig) return;
      const keep = new Set([...document.querySelectorAll('[data-group]:checked')].map(i => i.dataset.group));
      lastGroupsSig = sig;
      box.innerHTML = groups.length ? groups.map(g => {
        const checked = groupsFirstLoad ? (draftGroups ? draftGroups.includes(g.id) : true) : keep.has(g.id);
        return '<label class="publish-item"><input type="checkbox" data-group="' + html(g.id) + '"' + (checked ? ' checked' : '') + '> <div style="min-width:0"><h4>' +
        html(g.name) + '</h4><p>' + g.size + ' participantes</p></div></label>';}).join('')
        : '<div class="empty"><strong>Nenhum grupo encontrado</strong><p>Conecte o WhatsApp e atualize.</p></div>';
      groupsFirstLoad = false;
    } catch { box.innerHTML = '<div class="empty"><strong>Falha ao listar grupos</strong></div>'; }
  }
  function selectedGroups() {
    return [...document.querySelectorAll('[data-group]:checked')].map(i => i.dataset.group);
  }
  async function sendNow() {
    const msg = el('message').value.trim();
    const groups = selectedGroups();
    if (!msg) return toast('Gere a mensagem primeiro.', true);
    if (!groups.length) return toast('Selecione ao menos 1 grupo.', true);
    const btn = el('send-btn');
    btn.disabled = true; btn.textContent = 'Replicando…';
    try {
      const r = await fetch('/api/wa/send', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({message: msg, groupIds: groups, imageUrl: el('f-image').value.trim()})});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha no envio.');
      toast('Replicado em ' + d.sent + '/' + d.total + ' grupos.');
    } catch (e) { toast(e.message || 'Falha no envio.', true); }
    finally { btn.disabled = false; btn.textContent = 'Replicar agora ↗'; }
  }
  el('today-label').textContent = new Date().toLocaleDateString('pt-BR', {day: '2-digit', month: 'long', year: 'numeric'});
  document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-step]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const t = {0: 'step-conexoes', 1: 'step-anuncio', 2: 'step-mensagem', 3: 'step-grupos'}[b.dataset.step];
    document.getElementById(t)?.scrollIntoView({behavior: 'smooth'});
  }));
  ['f-platform', 'f-title', 'f-price', 'f-old', 'f-coupon', 'f-link', 'f-image'].forEach(id => el(id).addEventListener('input', () => { buildMessage(); saveDraft(); }));
  el('ad-url').addEventListener('input', () => { syncPlatformFromLink(); saveDraft(); scheduleAutoImport(); });
  el('message').addEventListener('input', saveDraft);
  el('f-image').addEventListener('input', () => { updatePhotoPreview(); saveDraft(); });
  document.addEventListener('change', e => { if (e.target?.matches?.('[data-group]')) saveDraft(); });
  el('fetch-btn').addEventListener('click', fetchPreview);
  el('ad-url').addEventListener('input', syncPlatformFromLink);
  el('ad-url').addEventListener('keydown', e => { if (e.key === 'Enter') fetchPreview(); });
  el('build-btn').addEventListener('click', () => { buildMessage(); toast('Mensagem pronta.'); document.getElementById('step-mensagem').scrollIntoView({behavior: 'smooth'}); });
  el('copy-btn').addEventListener('click', copyText);
  el('to-groups-btn').addEventListener('click', () => document.getElementById('step-grupos').scrollIntoView({behavior: 'smooth'}));
  el('wa-refresh').addEventListener('click', async () => { await waRefresh(); await loadGroups(true); });
  el('select-all').addEventListener('click', () => document.querySelectorAll('[data-group]').forEach(i => i.checked = true));
  el('select-none').addEventListener('click', () => document.querySelectorAll('[data-group]').forEach(i => i.checked = false));
  el('send-btn').addEventListener('click', sendNow);
  el('wa-logout').addEventListener('click', async () => {
    await fetch('/api/wa/logout', {method: 'POST'}).catch(() => {});
    toast('WhatsApp desconectado.');
    waRefresh();
  });
  el('pair-btn').addEventListener('click', async () => {
    const phone = el('pair-phone').value.replace(/\D/g, '');
    if (!phone) return toast('Digite seu número com DDI+DDD.', true);
    try {
      const r = await fetch('/api/wa/pair', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({phone})});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha.');
      el('pair-code').className = 'assist-message success';
      el('pair-code').textContent = 'Seu código: ' + d.code;
      toast('Código gerado. Digite no WhatsApp.');
    } catch (e) { toast(e.message || 'Falha ao gerar código.', true); }
  });
  el('newqr-btn').addEventListener('click', async () => {
    await fetch('/api/wa/logout', {method: 'POST'}).catch(() => {});
    el('repair-wrap').classList.add('hidden');
    toast('Sessão limpa. Aguarde o QR novo.');
    setTimeout(waRefresh, 2500);
  });
  el('ml-connect').addEventListener('click', async () => {
    const mine = mlCreds();
    if (!mine) { window.location.assign('/api/ml/start'); return; }
    const btn = el('ml-connect');
    btn.disabled = true; btn.textContent = 'Conectando…';
    try {
      const r = await fetch('/api/ml/start', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({clientId: mine.id, clientSecret: mine.secret})});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha.');
      window.location.assign(d.url);
    } catch (e) { toast(e.message || 'Falha ao iniciar.', true); btn.disabled = false; btn.textContent = 'Conectar'; }
  });
  const ML_CREDS = 'ml-creds-v1';
  function mlCreds() {
    try {
      const c = JSON.parse(localStorage.getItem(ML_CREDS) || 'null');
      if (c && /^\d{4,20}$/.test(String(c.id || '')) && String(c.secret || '').length >= 8) return {id: String(c.id), secret: String(c.secret)};
    } catch {}
    return null;
  }
  el('ml-save').addEventListener('click', () => {
    const id = el('ml-client-id').value.trim(), secret = el('ml-client-secret').value.trim();
    if (!/^\d{4,20}$/.test(id)) return toast('App ID inválido (só números).', true);
    if (secret.length < 8 || secret.length > 256) return toast('Client Secret inválido.', true);
    try { localStorage.setItem(ML_CREDS, JSON.stringify({id, secret})); } catch {}
    el('ml-client-secret').value = '';
    toast('Chaves ML salvas neste navegador. Clique Conectar.');
    mlConnectionStatus();
  });
  el('ml-forget').addEventListener('click', () => {
    try { localStorage.removeItem(ML_CREDS); } catch {}
    el('ml-client-id').value = ''; el('ml-client-secret').value = '';
    toast('Chaves ML apagadas.');
    mlConnectionStatus();
  });
  (function fillMlFields() {
    try {
      const c = JSON.parse(localStorage.getItem(ML_CREDS) || 'null');
      if (c?.id) el('ml-client-id').value = c.id;
    } catch {}
  })();
  el('ml-disconnect').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/ml/disconnect', {method: 'POST', credentials: 'same-origin'});
      if (!r.ok) throw new Error();
      toast('Mercado Livre desconectado.');
    } catch { toast('Não foi possível desconectar.', true); }
    mlConnectionStatus();
  });
  const SHOPEE_CREDS = 'shopee-creds-v1';
  const TIKTOK_CREDS = 'tiktok-creds-v1';
  function readCreds(key) { try { return JSON.parse(localStorage.getItem(key) || 'null') || null; } catch { return null; } }
  function shopeeCreds() {
    const c = readCreds(SHOPEE_CREDS);
    if (c && /^\d{3,32}$/.test(String(c.id || '')) && String(c.secret || '').length >= 8) return {id: String(c.id), secret: String(c.secret)};
    return null;
  }
  function refreshShopeeStatus(server) {
    const mine = shopeeCreds();
    el('shopee-status').textContent = mine
      ? 'Conectado com SUA chave neste navegador.'
      : server ? 'Conectado via chave do servidor.' : 'Sem chave: preços Shopee sem confirmação oficial.';
  }
  el('shopee-save').addEventListener('click', () => {
    const id = el('shopee-id').value.trim(), secret = el('shopee-secret').value.trim();
    if (!/^\d{3,32}$/.test(id)) return toast('App ID inválido (só números).', true);
    if (secret.length < 8 || secret.length > 256) return toast('App Secret inválido.', true);
    try { localStorage.setItem(SHOPEE_CREDS, JSON.stringify({id, secret})); } catch {}
    el('shopee-secret').value = '';
    toast('Chaves Shopee salvas neste navegador.');
    refreshShopeeStatus(el('shopee-status').dataset.server === '1');
  });
  el('shopee-clear').addEventListener('click', () => {
    try { localStorage.removeItem(SHOPEE_CREDS); } catch {}
    el('shopee-id').value = ''; el('shopee-secret').value = '';
    toast('Chaves Shopee apagadas.');
    refreshShopeeStatus(el('shopee-status').dataset.server === '1');
  });
  el('tiktok-save').addEventListener('click', () => {
    const key = el('tiktok-key').value.trim(), secret = el('tiktok-secret').value.trim();
    if (!key || secret.length < 8) return toast('Preencha App Key e um Secret válido.', true);
    try { localStorage.setItem(TIKTOK_CREDS, JSON.stringify({key, secret})); } catch {}
    el('tiktok-secret').value = '';
    el('tiktok-status').textContent = 'Chaves salvas neste navegador. Ativação na API oficial do TikTok.';
    toast('Chaves TikTok salvas neste navegador.');
  });
  el('tiktok-clear').addEventListener('click', () => {
    try { localStorage.removeItem(TIKTOK_CREDS); } catch {}
    el('tiktok-key').value = ''; el('tiktok-secret').value = '';
    el('tiktok-status').textContent = 'Extração direta da página, sempre ativa.';
    toast('Chaves TikTok apagadas.');
  });
  (function fillCredFields() {
    const s = readCreds(SHOPEE_CREDS);
    if (s?.id) el('shopee-id').value = s.id;
    const t = readCreds(TIKTOK_CREDS);
    if (t?.key) { el('tiktok-key').value = t.key; el('tiktok-status').textContent = 'Chaves salvas neste navegador. Ativação na API oficial do TikTok.'; }
  })();
  async function mlConnectionStatus() {
    const st = el('ml-status'), c = el('ml-connect'), d = el('ml-disconnect');
    const mine = (typeof mlCreds === 'function') ? mlCreds() : null;
    try {
      const r = await fetch('/api/ml/status', {credentials: 'same-origin', cache: 'no-store'});
      if (!r.ok) throw new Error();
      const s = await r.json();
      const cb = el('ml-callback-url');
      if (cb && s.redirectUri) cb.textContent = s.redirectUri;
      const canConnect = Boolean(s.connected) ? false : Boolean(mine || s.configured);
      c.disabled = s.connected || !canConnect;
      d.disabled = !s.connected;
      st.textContent = s.connected
        ? 'Conectado. Preços oficiais ativos.'
        : mine
          ? 'Suas chaves salvas. Clique em Conectar.'
          : s.configured
            ? 'App do servidor configurado. Clique em Conectar.'
            : 'Cole seu App ID + Secret acima e clique Salvar.';
    } catch {
      st.textContent = 'Não foi possível verificar.';
      c.disabled = true; d.disabled = true;
    }
    try {
      const r = await fetch('/api/integration-status', {cache: 'no-store'});
      const s = await r.json();
      const server = Boolean(s.shopee?.appIdConfigured && s.shopee?.appSecretConfigured);
      el('shopee-status').dataset.server = server ? '1' : '';
      refreshShopeeStatus(server);
    } catch { el('shopee-status').textContent = 'Não foi possível verificar.'; }
  }
  el('clear-btn').addEventListener('click', () => {
    ['ad-url', 'f-title', 'f-price', 'f-old', 'f-coupon', 'f-link', 'f-image'].forEach(id => el(id).value = '');
    el('f-platform').selectedIndex = 0;
    updatePhotoPreview();
    clearDraft(); buildMessage(); saveDraft();
    toast('Campos limpos.');
  });
  if (new URLSearchParams(window.location.search).get('ml') === 'connected') toast('Mercado Livre conectado para buscar preços.');
  if (new URLSearchParams(window.location.search).get('ml') === 'error') {
    const qs = new URLSearchParams(window.location.search);
    const reason = qs.get('reason'), detail = qs.get('detail') || '';
    const msg = reason !== 'token' ? 'Falha ao conectar o Mercado Livre. Tente de novo.'
      : detail === 'invalid_client' ? 'Client Secret incorreto: copie de novo o Secret do seu app no painel de desenvolvedores ML e salve aqui.'
      : detail === 'invalid_grant' ? 'Código expirado ou já usado: clique em Conectar e autorize em seguida, sem demora.'
      : 'O Mercado Livre recusou sem detalhar (HTTP 400). Confira o Secret e o redirect EXATO no seu app ML, tente de novo e me mande a linha [ML_OAUTH] do log no Render.';
    toast(msg, true);
    el('fetch-status').className = 'assist-message error';
    el('fetch-status').textContent = 'Conexão ML falhou (' + (detail || reason) + '). Sem ela, o preço de links de vitrine/perfil precisa ser manual.';
  }
  const hadDraft = restoreDraft();
  if (!hadDraft || !el('message').value) buildMessage(); else saveDraft();
  updatePhotoPreview();
  mlConnectionStatus();
  waRefresh();
  clearInterval(waTimer);
  waTimer = setInterval(waRefresh, 5000);
})();
