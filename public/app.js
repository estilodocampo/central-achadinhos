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
      if (/(^|\.)tiktok\.com$|(^|\.)tiktokshop\.com$/.test(h)) return 'TikTok Shop';
    } catch {}
    return '';
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
  async function fetchPreview() {
    const url = el('ad-url').value.trim();
    if (!url) return toast('Cole o link do anúncio.', true);
    const btn = el('fetch-btn');
    btn.disabled = true; btn.textContent = 'Buscando…';
    el('fetch-status').className = 'assist-message';
    el('fetch-status').textContent = 'Consultando dados públicos…';
    try {
      const r = await fetch('/api/preview', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({url})});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Prévia indisponível.');
      const p = platformForLink(url);
      if (p) el('f-platform').value = p;
      if (d.title) el('f-title').value = d.title;
      if (typeof d.price === 'number' && d.price > 0) el('f-price').value = d.price.toFixed(2).replace('.', ',');
      if (typeof d.oldPrice === 'number' && d.oldPrice > (d.price || 0)) el('f-old').value = d.oldPrice.toFixed(2).replace('.', ',');
      if (d.image) el('f-image').value = d.image;
      if (!el('f-link').value) el('f-link').value = url;
      el('fetch-status').className = 'assist-message ' + (d.price != null ? 'success' : 'error');
      el('fetch-status').textContent = (d.priceNote || 'Confira o preço na loja.');
      buildMessage();
      toast(d.price != null ? 'Dados puxados. Revise e replique.' : 'Sem preço confirmado — complete manualmente.', d.price == null);
    } catch (e) {
      el('f-link').value = el('f-link').value || url;
      el('fetch-status').className = 'assist-message error';
      el('fetch-status').textContent = (e.message || 'Falha.') + ' Preencha manualmente.';
      toast('A loja não liberou os dados.', true);
    } finally { btn.disabled = false; btn.textContent = 'Buscar dados'; }
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
        await loadGroups(false);
      } else {
        pill.textContent = 'WhatsApp: escaneie o QR';
        pill.className = 'status-pill rascunho';
        st.className = 'assist-message error';
        st.textContent = 'Desconectado. Escaneie o QR para conectar sua conta.';
        if (s.qr) { el('qr-img').src = s.qr; el('qr-wrap').classList.remove('hidden'); }
        else el('qr-wrap').classList.add('hidden');
      }
    } catch {
      el('wa-status').textContent = 'Servidor indisponível.';
    }
  }
  let lastGroupsSig = '';
  let groupsFirstLoad = true;
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
        const checked = groupsFirstLoad ? true : keep.has(g.id);
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
    const t = {1: 'step-anuncio', 2: 'step-mensagem', 3: 'step-grupos'}[b.dataset.step];
    document.getElementById(t)?.scrollIntoView({behavior: 'smooth'});
  }));
  ['f-platform', 'f-title', 'f-price', 'f-old', 'f-coupon', 'f-link'].forEach(id => el(id).addEventListener('input', buildMessage));
  el('fetch-btn').addEventListener('click', fetchPreview);
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
  el('ml-connect').addEventListener('click', () => window.location.assign('/api/ml/start'));
  if (new URLSearchParams(window.location.search).get('ml') === 'connected') toast('Mercado Livre conectado para buscar preços.');
  buildMessage();
  waRefresh();
  clearInterval(waTimer);
  waTimer = setInterval(waRefresh, 5000);
})();
