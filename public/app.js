(() => {
  'use strict';
  const KEY = 'central-achadinhos-offers-v1';
  const SETTINGS = 'central-achadinhos-settings-v1';
  const CATEGORIES = 'central-achadinhos-categories-v1';
  const DEFAULT_SETTINGS = { name: 'Achadinhos VIP | Ofertas do Dia', group: '', channel: '', invite: '🛍️ Entre para o nosso grupo VIP de achadinhos! Ofertas da Shopee, Mercado Livre e TikTok Shop todos os dias. 🔥' };
  const platforms = ['Shopee', 'Mercado Livre', 'TikTok Shop'];
  const statuses = ['rascunho', 'pronta', 'publicada'];
  const state = { offers: load(KEY, []), categories: load(CATEGORIES, []), settings: { ...DEFAULT_SETTINGS, ...load(SETTINGS, {}) }, selected: null, editing: null, currentView: 'inicio', deleting: null, serverUser: null, serverOwner: null };
  async function api(path, options={}) {
    const r = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  async function refreshAuth(silent=false) {
    const status = el('auth-status');
    try {
      const me = await api('/api/auth/me');
      state.serverUser = me.user || null;
      state.serverOwner = me.owner || null;
      if (status) {
        status.className = 'assist-message ' + (me.user ? 'success' : '');
        status.textContent = me.user
          ? ('Logado como ' + me.user + ' (' + me.owner + '). Sync ativo no servidor.')
          : (me.users > 0 ? 'Sessão local. Faça login para sincronizar entre aparelhos.' : 'Nenhuma conta ainda. Crie a primeira conta para ativar o sync.');
      }
      const mlUrl = document.getElementById('ml-callback-url');
      try {
        const st = await fetch('/api/ml/status', { credentials: 'same-origin' }).then(x => x.json());
        if (mlUrl && st.redirectUri) mlUrl.textContent = st.redirectUri;
      } catch {}
      return me;
    } catch {
      if (status && !silent) { status.className = 'assist-message error'; status.textContent = 'Servidor indisponível. Modo somente local.'; }
      return null;
    }
  }
  async function pullServer() {
    try {
      const me = await refreshAuth(true);
      if (!me?.owner) return false;
      const [o, s] = await Promise.all([
        api('/api/offers').catch(() => null),
        api('/api/settings').catch(() => null)
      ]);
      let changed = false;
      if (o?.offers) {
        const byId = new Map(state.offers.map(x => [x.id, x]));
        for (const srv of o.offers) {
          const loc = byId.get(srv.id);
          if (!loc || Date.parse(srv.updatedAt) > Date.parse(loc.updatedAt)) { byId.set(srv.id, srv); changed = true; }
        }
        // Enviar locais ausentes no servidor
        const srvIds = new Set(o.offers.map(x => x.id));
        for (const loc of state.offers) {
          if (!srvIds.has(loc.id)) fetch('/api/offers', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(loc) }).catch(() => {});
        }
        if (changed) {
          state.offers = [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
          for (const c of state.offers.map(x => x.category)) rememberCategory(c);
          save();
        }
      }
      if (s?.settings && (s.settings.name || s.settings.group || s.settings.channel || s.settings.invite)) {
        state.settings = { ...state.settings, ...s.settings };
        save();
      }
      await refreshAuth(true);
      return changed;
    } catch { return false; }
  }
  function pushOffer(offer) {
    if (!state.serverOwner) return;
    fetch('/api/offers', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(offer) }).catch(() => {});
  }
  function pushDelete(id) {
    if (!state.serverOwner) return;
    fetch('/api/offers/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
  }
  function pushSettings() {
    if (!state.serverOwner) return;
    fetch('/api/settings', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: state.settings }) }).catch(() => {});
  }
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const el = id => document.getElementById(id);
  function load(key, fallback) { try { const raw = JSON.parse(localStorage.getItem(key) || 'null'); return raw ?? fallback; } catch { return fallback; } }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state.offers)); localStorage.setItem(SETTINGS, JSON.stringify(state.settings)); localStorage.setItem(CATEGORIES, JSON.stringify(state.categories)); return true; }
    catch { toast('Sem espaço no armazenamento. Exporte um backup e libere espaço.', true); return false; }
  }
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const plainNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
    let x = String(value ?? '').trim().replace(/\s|R\$/gi, '');
    if (!x) return NaN;
    if (x.includes(',') && x.includes('.')) x = x.replace(/\./g, '').replace(',', '.');
    else x = x.replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(x)) return NaN;
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  function safeHttp(value, onlyHttps = false) {
    try { const u = new URL(String(value)); return (onlyHttps ? u.protocol === 'https:' : ['https:', 'http:'].includes(u.protocol)) && !u.username && !u.password ? u.href : ''; }
    catch { return ''; }
  }
  function validOffer(item) {
    return item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim() && platforms.includes(item.platform) && Number.isFinite(item.price) && item.price > 0 && safeHttp(item.url);
  }
  function parseOffer(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {
      id: String(raw.id || crypto.randomUUID()).slice(0, 75),
      title: String(raw.title || '').trim().slice(0, 180),
      platform: String(raw.platform || ''),
      category: String(raw.category || '').trim().slice(0, 60),
      price: Number(raw.price), oldPrice: raw.oldPrice ? Number(raw.oldPrice) : null,
      coupon: String(raw.coupon || '').trim().slice(0, 70),
      url: safeHttp(raw.url), image: safeHttp(raw.image, true),
      status: statuses.includes(raw.status) ? raw.status : 'rascunho',
      createdAt: String(raw.createdAt || new Date().toISOString()),
      updatedAt: String(raw.updatedAt || new Date().toISOString())
    };
    if (!validOffer(clean)) return null;
    if (!Number.isFinite(clean.oldPrice) || clean.oldPrice <= clean.price) clean.oldPrice = null;
    return clean;
  }
  state.offers = Array.isArray(state.offers) ? state.offers.slice(0, 3000).map(parseOffer).filter(Boolean) : [];
  const normalizeCategory = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const cleanCategory = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0,60);
  const loadedCategories = Array.isArray(state.categories) ? state.categories.slice(0,500) : [];
  state.categories = [];
  for (const original of [...loadedCategories,...state.offers.map(o => o.category)]) {
    const name = cleanCategory(original);
    if (name && !state.categories.some(existing => normalizeCategory(existing)===normalizeCategory(name))) state.categories.push(name);
  }
  function renderCategorySuggestions() {
    const list = el('category-options');
    if (list) list.innerHTML = [...state.categories].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(name=>'<option value="'+html(name)+'"></option>').join('');
    const count = el('category-count');
    if (count) count.textContent = state.categories.length
      ? state.categories.length + ' categorias salvas. Categorias iguais são reutilizadas.'
      : 'Ao importar ou salvar, a nova categoria será adicionada automaticamente.';
  }
  function rememberCategory(value, persist = false) {
    const category = cleanCategory(value);
    if (!category) return '';
    const found = state.categories.find(name => normalizeCategory(name)===normalizeCategory(category));
    if (found) return found;
    state.categories.push(category);
    renderCategorySuggestions();
    if (persist) save();
    return category;
  }
  renderCategorySuggestions();
  const platformClass = platform => platform === 'Mercado Livre' ? 'ml' : platform === 'TikTok Shop' ? 'tt' : '';
  const discount = offer => offer.oldPrice > offer.price ? Math.round((1 - offer.price / offer.oldPrice) * 100) : 0;
  const statusName = status => ({ publicada: 'Publicada', pronta: 'Pronta', rascunho: 'Rascunho' })[status] || status;
  const platformIcon = platform => ({ 'Shopee': '🧡', 'Mercado Livre': '💛', 'TikTok Shop': '🎵' })[platform] || '🛍️';
  const get = id => state.offers.find(o => o.id === id);
  let toastTimer;
  function toast(message, error = false) {
    const node = el('toast'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 3500);
  }
  function navigate(view) {
    if (!['inicio', 'ofertas', 'nova', 'publicacoes', 'config'].includes(view)) return;
    state.currentView = view;
    $$('.view').forEach(e => e.classList.toggle('hidden', e.id !== `view-${view}`));
    $$('.nav-btn').forEach(e => e.classList.toggle('active', e.dataset.view === view));
    el('current-section').textContent = ({ inicio: 'Visão geral', ofertas: 'Minhas ofertas', nova: 'Nova oferta', publicacoes: 'Publicações', config: 'Configurações' })[view];
    if (view === 'ofertas') renderOffers();
    if (view === 'inicio') renderDashboard();
    if (view === 'publicacoes') renderPublishing();
    if (view === 'config') renderSettings();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function imageMarkup(item, klass) {
    return item.image ? `<div class="${klass}"><img loading="lazy" alt="Foto de ${html(item.title)}" src="${html(item.image)}"></div>` : `<div class="${klass}" aria-label="Sem foto">${platformIcon(item.platform)}</div>`;
  }
  function renderDashboard() {
    const items = state.offers;
    const stats = [
      ['Total de ofertas', items.length, 'Cadastradas no painel', '▣'],
      ['Prontas para enviar', items.filter(o => o.status === 'pronta').length, 'Aguardando divulgação', '↗'],
      ['Marcadas como publicadas', items.filter(o => o.status === 'publicada').length, 'Marcação manual', '✓'],
      ['Plataformas', new Set(items.map(o => o.platform)).size, 'Com produtos cadastrados', '◈']
    ];
    el('metrics').innerHTML = stats.map(([label, value, sub, icon]) => `<div class="metric"><div class="metric-top"><span>${label}</span><div class="metric-icon">${icon}</div></div><span class="metric-value">${value}</span><span class="metric-detail">${sub}</span></div>`).join('');
    const recent = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);
    el('recent-offers').innerHTML = recent.length ? recent.map(o => `<div class="recent-item">${imageMarkup(o, 'thumbnail')}<div class="recent-info"><h4>${html(o.title)}</h4><p>${html(o.platform)} · ${statusName(o.status)}</p></div><span class="recent-price">${money(o.price)}</span></div>`).join('') : `<div class="empty"><span class="empty-icon">🛍️</span><strong>Seu catálogo começa aqui</strong><p>Cadastre o primeiro achadinho e prepare a mensagem para o WhatsApp.</p><button type="button" class="btn btn-primary" data-action="new-offer">+ Minha primeira oferta</button></div>`;
  }
  function renderOffers() {
    const query = el('offer-search').value.toLocaleLowerCase('pt-BR').trim();
    const platform = el('platform-filter').value;
    const status = el('status-filter').value;
    const items = state.offers.filter(o => (!query || `${o.title} ${o.category} ${o.coupon}`.toLocaleLowerCase('pt-BR').includes(query)) && (!platform || o.platform === platform) && (!status || o.status === status)).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    el('offer-grid').innerHTML = items.length ? items.map(o => `<article class="offer-card">
      <div class="card-picture">${o.image ? `<img loading="lazy" alt="${html(o.title)}" src="${html(o.image)}">` : platformIcon(o.platform)}<span class="platform-tag ${platformClass(o.platform)}">${html(o.platform)}</span></div>
      <div class="offer-card-body"><span class="category-label">${html(o.category || 'Achadinho especial')}</span><h3 title="${html(o.title)}">${html(o.title)}</h3><div><strong class="offer-price">${money(o.price)}</strong>${o.oldPrice ? `<span class="offer-old">${money(o.oldPrice)}</span>` : ''}${discount(o) ? `<span class="offer-discount">−${discount(o)}%</span>` : ''}</div><div class="offer-badges"><span class="status-pill ${o.status}">${statusName(o.status)}</span>${o.coupon ? `<span class="category-label" title="${html(o.coupon)}">🎟 ${html(o.coupon)}</span>` : ''}</div></div>
      <div class="card-buttons"><button type="button" data-action="publish" data-id="${html(o.id)}" class="act-primary">Divulgar</button><button type="button" data-action="edit" data-id="${html(o.id)}">Editar</button><button type="button" data-action="delete" data-id="${html(o.id)}" class="act-delete" aria-label="Excluir oferta">✕</button></div>
    </article>`).join('') : `<div class="panel empty" style="grid-column:1/-1"><span class="empty-icon">🔍</span><strong>Nenhuma oferta encontrada</strong><p>Cadastre uma oferta ou altere seus filtros de busca.</p><button type="button" class="btn btn-primary" data-action="new-offer">+ Cadastrar oferta</button></div>`;
  }
  const inputIds = ['form-platform', 'form-category', 'form-title-input', 'form-price', 'form-old-price', 'form-coupon', 'form-status', 'form-link', 'form-image'];
  function beginOffer(id = null) {
    state.editing = id;
    clearTimeout(importTimer);
    importSerial += 1;
    previewAbort?.abort();
    el('preview-button').disabled = false;
    el('preview-button').textContent = 'Buscar dados';
    el('offer-form').reset(); el('preview-url').value = ''; el('lookup-url').value = ''; el('lookup-wrap').classList.add('hidden');
    el('preview-status').textContent = 'Cole um link. O sistema buscará título, imagem, preço e categoria disponíveis.';
    el('preview-status').className = 'assist-message';
    const o = id ? get(id) : null;
    el('form-title').textContent = o ? 'Editar oferta' : 'Adicionar oferta';
    el('save-offer').textContent = o ? 'Salvar alterações' : 'Salvar oferta';
    if (o) {
      el('form-platform').value = o.platform; el('form-category').value = o.category;
      el('form-title-input').value = o.title; el('form-price').value = o.price.toFixed(2).replace('.', ',');
      el('form-old-price').value = o.oldPrice ? o.oldPrice.toFixed(2).replace('.', ',') : '';
      el('form-coupon').value = o.coupon; el('form-status').value = o.status;
      el('form-link').value = o.url; el('form-image').value = o.image; el('preview-url').value = o.url;
    }
    updateLivePreview(); navigate('nova');
  }
  function updateLivePreview() {
    el('live-title').textContent = el('form-title-input').value.trim() || 'Nome do produto';
    el('live-platform').textContent = el('form-platform').value;
    const price = plainNumber(el('form-price').value);
    el('live-price').textContent = Number.isNaN(price) || price <= 0 ? 'Preço não informado' : money(price);
    const image = safeHttp(el('form-image').value, true);
    el('live-image').innerHTML = image ? `<img src="${html(image)}" alt="Prévia do produto">` : '<span>🛍️</span>';
  }
  function submitOffer(event) {
    event.preventDefault();
    const price = plainNumber(el('form-price').value);
    const oldText = el('form-old-price').value.trim();
    const oldPrice = oldText ? plainNumber(oldText) : null;
    const url = safeHttp(el('form-link').value);
    const image = el('form-image').value.trim() ? safeHttp(el('form-image').value, true) : '';
    if (!el('form-title-input').value.trim()) return toast('Preencha o nome do produto.', true);
    if (Number.isNaN(price) || price <= 0 || price > 10000000) return toast('Informe um preço válido, maior que zero.', true);
    if (oldText && (Number.isNaN(oldPrice) || oldPrice <= price || oldPrice > 10000000)) return toast('O preço anterior deve ser maior que o preço atual.', true);
    if (!url) return toast('Informe um link válido do produto ou afiliado.', true);
    if (el('form-image').value.trim() && !image) return toast('A foto precisa ter uma URL HTTPS válida.', true);
    const now = new Date().toISOString();
    const old = state.editing ? get(state.editing) : null;
    const data = {
      id: old?.id || crypto.randomUUID(), createdAt: old?.createdAt || now, updatedAt: now,
      platform: el('form-platform').value, category: rememberCategory(el('form-category').value),
      title: el('form-title-input').value.trim(), price, oldPrice,
      coupon: el('form-coupon').value.trim(), url, image, status: el('form-status').value
    };
    if (old) state.offers = state.offers.map(o => o.id === old.id ? data : o);
    else state.offers.unshift(data);
    if (!save()) return;
    pushOffer(data);
    state.selected = data.id;
    state.editing = null;
    toast(old ? 'Oferta atualizada com sucesso.' : 'Oferta cadastrada com sucesso.');
    navigate('ofertas');
  }
  let importTimer = null;
  let importSerial = 0;
  let previewAbort = null;
  function platformForLink(link) {
    try {
      const host = new URL(link).hostname.toLowerCase();
      if (/(^|\.)shopee\.com(\.br)?$|(^|\.)shope\.ee$/.test(host)) return 'Shopee';
      if (/(^|\.)mercadolivre\.com(\.br)?$|(^|\.)mercadolibre\.com$|(^|\.)meli\.la$/.test(host)) return 'Mercado Livre';
      if (/(^|\.)tiktok\.com$|(^|\.)tiktokshop\.com$/.test(host)) return 'TikTok Shop';
    } catch {}
    return '';
  }
  function scheduleImport(fieldId = 'preview-url') {
    clearTimeout(importTimer);
    ++importSerial;
    previewAbort?.abort();
    const url = safeHttp(el(fieldId).value.trim(), true);
    if (!url || !platformForLink(url)) return;
    if (fieldId === 'preview-url') el('form-link').value = url;
    else el('preview-url').value = url;
    const status = el('preview-status');
    status.className = 'assist-message';
    status.textContent = 'Link reconhecido. Buscando título, imagem, preço e categoria…';
    importTimer = setTimeout(() => importPreview(url), 550);
  }
  async function importPreview(urlOverride = '', preserveAffiliate = false) {
    clearTimeout(importTimer);
    const url = safeHttp(urlOverride || el('preview-url').value, true);
    if (!url || !platformForLink(url)) return toast('Cole um link HTTPS da Shopee, Mercado Livre ou TikTok Shop.', true);
    const serial = ++importSerial;
    previewAbort?.abort();
    const controller = new AbortController();
    previewAbort = controller;
    const status = el('preview-status');
    status.className = 'assist-message';
    status.textContent = 'Consultando dados públicos do produto…';
    const button = el('preview-button');
    button.disabled = true;
    button.textContent = 'Buscando…';
    try {
      const response = await fetch('/api/preview', {
        method:'POST', headers: {'content-type':'application/json'},
        body:JSON.stringify({url}), signal:controller.signal
      });
      const data = await response.json();
      if (serial !== importSerial) return;
      if (!response.ok) throw new Error(data.error || 'Prévia indisponível.');
      const platform = platformForLink(url);
      if (platform) el('form-platform').value = platform;
      if (data.title) el('form-title-input').value = data.title;
      if (data.image) el('form-image').value = data.image;
      if (typeof data.price === 'number' && Number.isFinite(data.price) && data.price > 0) {
        el('form-price').value = data.price.toFixed(2).replace('.', ',');
        el('form-old-price').value = typeof data.oldPrice === 'number' && Number.isFinite(data.oldPrice) && data.oldPrice > data.price
          ? data.oldPrice.toFixed(2).replace('.', ',') : '';
      } else {
        el('form-price').value = '';
        el('form-old-price').value = '';
      }
      if (data.category) el('form-category').value = rememberCategory(data.category,true);
      if(!preserveAffiliate) {el('form-link').value = url; el('preview-url').value = url;}
      const categoryText = data.category
        ? 'Categoria: ' + el('form-category').value + ' (' + (data.categorySource || 'encontrada') + ').'
        : 'Categoria não identificada. Você pode cadastrá-la manualmente.';
      const diagnostic = data.importDiagnostic;
      let details = '';
      if (diagnostic && data.price == null) {
        const idLabel = {item:'anúncio identificado',catalog:'catálogo identificado',unknown:'ID do anúncio não identificado'}[diagnostic.identifier] || '';
        const apiLabel = {unauthorized:'token recusado (401)',forbidden:'API sem permissão (403)',
          not_found:'ID não encontrado',no_buy_box:'sem oferta vencedora',network_error:'falha de conexão',
          unavailable:'consulta sem preço confirmado',price_unavailable:'sem preço confirmado',
          not_attempted:'consulta não efetuada'}[diagnostic.api] || 'consulta realizada';
        details = ' Diagnóstico: '+(diagnostic.tokenConfigured ? 'API configurada' : 'token não configurado')+
          '; '+idLabel+'; '+apiLabel+'.';
      }
      status.textContent = (data.priceNote || 'Confira o preço na loja.') + ' ' + categoryText + details;
      if(platform === 'Mercado Livre') el('lookup-wrap').classList.toggle('hidden',data.price != null);
      status.className = data.price == null ? 'assist-message error' : 'assist-message success';
      updateLivePreview();
      toast(data.price != null ? 'Dados importados. Confira o valor antes de publicar.' : 'Produto identificado, porém sem preço confirmado.',data.price == null);
    } catch (error) {
      if (serial !== importSerial || error?.name === 'AbortError') return;
      if(!preserveAffiliate) el('form-link').value = url;
      status.textContent = error.message + ' Link preservado; confira os campos faltantes manualmente.';
      status.className = 'assist-message error';
      toast('A loja não liberou todos os dados do produto.', true);
    } finally {
      if (serial === importSerial) {
        button.disabled = false;
        button.textContent = 'Buscar dados';
      }
    }
  }
  function caption(o) {
    if (!o) return 'Cadastre e selecione uma oferta para preparar a mensagem.';
    let message = `🛍️ *ACHADINHO ${o.platform.toUpperCase()}*\n\n🔥 *${o.title}*\n\n💰 *Preço: ${money(o.price)}*`;
    if (o.oldPrice && o.oldPrice > o.price) message += `\n🏷️ Antes: ${money(o.oldPrice)}${discount(o) ? ` · ${discount(o)}% OFF` : ''}`;
    if (o.coupon) message += `\n🎟️ Cupom: ${o.coupon}`;
    message += `\n\n🛒 *Veja a oferta:*\n${o.url}\n\n⚠️ Preço e disponibilidade sujeitos a alteração.\n🔗 Link de afiliado.`;
    return message;
  }
  function renderPublishing() {
    const items = [...state.offers].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt));
    if (!items.some(o => o.id === state.selected)) state.selected = items[0]?.id || null;
    const selected = get(state.selected);
    el('publish-list').innerHTML = items.length ? items.map(o => `<button type="button" class="publish-item ${o.id === state.selected ? 'active' : ''}" data-action="select-post" data-id="${html(o.id)}">${imageMarkup(o,'thumbnail')}<div style="min-width:0"><h4>${html(o.title)}</h4><p>${html(o.platform)} · ${money(o.price)}</p></div></button>`).join('') : `<div class="empty"><span class="empty-icon">🛍️</span><strong>Sem ofertas para divulgar</strong><p>Cadastre seu primeiro produto.</p><button class="btn btn-primary" data-action="new-offer">+ Nova oferta</button></div>`;
    el('post-message').value = caption(selected);
    ['copy-post', 'share-whatsapp', 'mark-published'].forEach(id => el(id).disabled = !selected);
    el('mark-published').textContent = selected?.status === 'publicada' ? '✓ Já marcada como publicada' : '✓ Marcar como publicada';
    el('mark-published').disabled = !selected || selected.status === 'publicada';
  }
  async function copy(value) {
    if (!value) return toast('Nada para copiar.', true);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.left = '-9999px'; document.body.appendChild(input); input.select();
        if (!document.execCommand('copy')) throw new Error('Cópia não autorizada.');
        input.remove();
      }
      toast('Texto copiado!');
    } catch { toast('Seu navegador bloqueou a cópia automática. Selecione e copie o texto.', true); }
  }
  function whatsappShare() {
    const o = get(state.selected);
    if (!o) return toast('Escolha uma oferta.', true);
    const target = `https://wa.me/?text=${encodeURIComponent(caption(o))}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }
  function markPublished() {
    const o = get(state.selected);
    if (!o) return;
    o.status = 'publicada'; o.updatedAt = new Date().toISOString();
    if (save()) { pushOffer(o); toast('Oferta marcada como publicada (confirmação manual).'); renderPublishing(); }
  }
  function renderSettings() {
    el('setting-name').value = state.settings.name;
    el('setting-group').value = state.settings.group;
    el('setting-channel').value = state.settings.channel;
    el('setting-invite').value = state.settings.invite;
  }
  function settingsSubmit(event) {
    event.preventDefault();
    const group = el('setting-group').value.trim();
    const channel = el('setting-channel').value.trim();
    if (group && !safeHttp(group, true)) return toast('O link do grupo precisa ser HTTPS válido.', true);
    if (channel && !safeHttp(channel, true)) return toast('O link do canal precisa ser HTTPS válido.', true);
    state.settings = { name: el('setting-name').value.trim().slice(0,100) || DEFAULT_SETTINGS.name, group, channel, invite: el('setting-invite').value.trim().slice(0,500) };
    if (save()) { pushSettings(); toast('Configurações salvas.'); }
  }
  function inviteCopy() {
    const parts = [state.settings.invite || DEFAULT_SETTINGS.invite];
    if (state.settings.group) parts.push(`👥 Grupo VIP: ${state.settings.group}`);
    if (state.settings.channel) parts.push(`📣 Canal: ${state.settings.channel}`);
    copy(parts.join('\n\n'));
  }
  function download(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  const dateFile = () => new Date().toLocaleDateString('sv-SE');
  function exportJson() {
    download(`central-achadinhos-${dateFile()}.json`, 'application/json;charset=utf-8', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: state.settings, categories: state.categories, offers: state.offers }, null, 2));
    toast('Backup JSON gerado. Guarde em local seguro.');
  }
  function exportCsv() {
    const header = ['Plataforma','Produto','Categoria','Preço atual','Preço anterior','Cupom','Status','Link afiliado','Imagem','Criado em'];
    const rows = state.offers.map(o => [o.platform,o.title,o.category,o.price.toFixed(2),o.oldPrice?.toFixed(2) || '',o.coupon,o.status,o.url,o.image,o.createdAt]);
    const csv = [header,...rows].map(r => r.map(v => `"${String(v ?? '').replace(/^[\s]*([=+\-@])/, "'$1").replace(/"/g,'""')}"`).join(';')).join('\r\n');
    download(`ofertas-${dateFile()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + csv);
    toast('Planilha CSV gerada.');
  }
  async function restoreJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5_000_000) return toast('Arquivo grande demais (limite de 5 MB).', true);
    try {
      const data = JSON.parse(await file.text());
      if (data?.version !== 1 || !Array.isArray(data.offers) || data.offers.length > 3000) throw new Error('Arquivo de backup inválido.');
      const all = data.offers.map(parseOffer);
      if (all.some(o => !o)) throw new Error('O backup contém ofertas inválidas.');
      if (!window.confirm(`Restaurar ${all.length} ofertas? Isso substitui as informações atuais deste navegador.`)) return;
      state.offers = all;
      state.categories = [];
      for (const category of [...(Array.isArray(data.categories) ? data.categories.slice(0,500) : []), ...all.map(o=>o.category)]) {
        rememberCategory(category);
      }
      renderCategorySuggestions();
      const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
      state.settings = {
        name: String(s.name || DEFAULT_SETTINGS.name).slice(0,100),
        group: safeHttp(s.group, true), channel: safeHttp(s.channel, true),
        invite: String(s.invite || DEFAULT_SETTINGS.invite).slice(0,500)
      };
      if (save()) { state.selected = null; renderSettings(); toast(`${all.length} ofertas restauradas.`);
        for (const o of all.slice(0, 200)) pushOffer(o);
        pushSettings();
      }
    } catch(error) { toast(error.message || 'Não foi possível restaurar o arquivo.', true); }
  }
  function deleteOffer(id) {
    state.deleting = id;
    el('confirm-modal').classList.remove('hidden');
  }
  function finishDelete() {
    const id = state.deleting;
    state.offers = state.offers.filter(o => o.id !== id);
    if (state.selected === id) state.selected = null;
    state.deleting = null; el('confirm-modal').classList.add('hidden');
    if (save()) { pushDelete(id); renderOffers(); toast('Oferta excluída.'); }
  }
  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { if (nav.dataset.view === 'nova') beginOffer(); else navigate(nav.dataset.view); return; }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const { id } = action.dataset;
    switch (action.dataset.action) {
      case 'new-offer': beginOffer(); break;
      case 'cancel-edit': state.editing = null; navigate('ofertas'); break;
      case 'edit': beginOffer(id); break;
      case 'delete': deleteOffer(id); break;
      case 'publish': state.selected = id; navigate('publicacoes'); break;
      case 'select-post': state.selected = id; renderPublishing(); break;
    }
  });
  el('today-label').textContent = new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  ['offer-search','platform-filter','status-filter'].forEach(id => el(id).addEventListener(id==='offer-search' ? 'input' : 'change', renderOffers));
  inputIds.forEach(id => el(id).addEventListener('input', updateLivePreview));
  el('preview-url').addEventListener('input', () => scheduleImport('preview-url'));
  el('form-link').addEventListener('input', () => scheduleImport('form-link'));
  el('form-category').addEventListener('blur', () => {
    const value = cleanCategory(el('form-category').value);
    const found = state.categories.find(category => normalizeCategory(category)===normalizeCategory(value));
    if (found) el('form-category').value = found;
  });
  el('offer-form').addEventListener('submit', submitOffer);
  el('preview-button').addEventListener('click', () => importPreview());
  el('lookup-button').addEventListener('click', () => {
    const original = safeHttp(el('lookup-url').value,true);
    if(!original) return toast('Cole a URL HTTPS original do anúncio.',true);
    if(platformForLink(original)!=='Mercado Livre')return toast('Use uma URL completa do Mercado Livre.',true);
    importPreview(original,true);
  });
  el('copy-post').addEventListener('click', () => copy(caption(get(state.selected))));
  el('share-whatsapp').addEventListener('click', whatsappShare);
  el('mark-published').addEventListener('click', markPublished);
  async function mlConnectionStatus() {
    const status=el('ml-oauth-status');
    const connect=el('ml-connect'),disconnect=el('ml-disconnect');
    try {
      const response=await fetch('/api/ml/status',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Não foi possível verificar a integração.');
      const data=await response.json();
      connect.disabled=!data.configured || data.connected;
      disconnect.disabled=!data.connected;
      status.className='assist-message '+(data.connected?'success':'');
      status.textContent=data.connected
        ? 'Conta Mercado Livre conectada. A importação consultará o preço oficial quando o anúncio puder ser identificado.'
        : data.configured
          ? 'Aplicativo configurado. Clique em Conectar Mercado Livre para autorizar sua conta.'
          : 'Cadastre ML_CLIENT_ID e ML_CLIENT_SECRET no Render e depois clique em Conectar Mercado Livre.';
    }catch {
      status.className='assist-message error';
      status.textContent='Não foi possível verificar a conexão. Atualize a página.';
      connect.disabled=true;
      disconnect.disabled=true;
    }
  }
  el('ml-connect').addEventListener('click',()=>{window.location.assign('/api/ml/start');});
  el('ml-disconnect').addEventListener('click',async()=>{
    try{
      const response=await fetch('/api/ml/disconnect',{method:'POST',credentials:'same-origin'});
      if(!response.ok)throw Error();
      await mlConnectionStatus();
      toast('Conta Mercado Livre desconectada deste navegador.');
    }catch {toast('Não foi possível desconectar. Tente novamente.',true);}
  });
  mlConnectionStatus();
  async function authAction(kind) {
    const u = el('auth-username').value.trim().toLowerCase();
    const p = el('auth-password').value;
    if (!u || !p) return toast('Informe usuário e senha.', true);
    try {
      const r = await api('/api/auth/' + kind, { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      el('auth-password').value = '';
      toast(kind === 'login' ? ('Bem-vindo, ' + r.user + '!') : ('Conta ' + r.user + ' criada e logada!'));
      await pullServer();
      renderSettings(); navigate(state.currentView);
    } catch (e) { toast(e.message || 'Falha de autenticação.', true); }
  }
  el('auth-login').addEventListener('click', () => authAction('login'));
  el('auth-register').addEventListener('click', () => authAction('register'));
  el('auth-logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.serverUser = null; state.serverOwner = null;
    await refreshAuth();
    toast('Sessão encerrada neste navegador.');
  });
  el('auth-sync').addEventListener('click', async () => {
    const changed = await pullServer();
    renderSettings(); navigate(state.currentView);
    toast(changed ? 'Sincronizado com o servidor.' : 'Já está atualizado.');
  });
  pullServer().then(() => { renderSettings(); if (state.currentView === 'inicio') renderDashboard(); });
  if(new URLSearchParams(window.location.search).get('ml')==='connected') toast('Mercado Livre conectado com sucesso!');
  if(new URLSearchParams(window.location.search).get('ml')==='error') {
    const reason=new URLSearchParams(window.location.search).get('reason');
    const hints={state:'A sessão de autorização expirou ou o cookie foi bloqueado.',token:'O Mercado Livre recusou a troca do código pelo token. Confira credenciais, URL e permissões.',response:'A API retornou tokens incompletos.',code:'O código de autorização veio ausente ou inválido.',denied:'O Mercado Livre não concluiu a autorização.',unknown:'Não foi possível concluir a autorização.'};
    toast(hints[reason]||hints.unknown,true);
    el('ml-oauth-status').textContent='Falha na conexão ('+(reason||'unknown')+'): '+(hints[reason]||hints.unknown);
  }

  el('settings-form').addEventListener('submit', settingsSubmit);
  el('copy-invite').addEventListener('click', inviteCopy);
  el('export-json').addEventListener('click', exportJson);
  el('export-csv').addEventListener('click', exportCsv);
  el('import-json-button').addEventListener('click', () => el('import-json').click());
  el('import-json').addEventListener('change', restoreJson);
  el('modal-cancel').addEventListener('click', () => {state.deleting=null;el('confirm-modal').classList.add('hidden');});
  el('modal-confirm').addEventListener('click', finishDelete);
  el('confirm-modal').addEventListener('click', event => {if(event.target===el('confirm-modal'))el('modal-cancel').click();});
  document.addEventListener('keydown', event => {if(event.key==='Escape' && !el('confirm-modal').classList.contains('hidden')) el('modal-cancel').click();});
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) event.target.replaceWith(document.createTextNode('🛍️'));
  }, true);
  navigate('inicio');
})();
