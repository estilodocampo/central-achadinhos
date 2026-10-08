// Extrai somente dados públicos atribuídos ao produto; nunca estima preço.
function normalize(s) {
  return String(s ?? '').replace(/&(?:amp|quot|apos|lt|gt|nbsp|#(\d+)|#x([a-f0-9]+));/gi, (found, dec, hex) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (named[found.toLowerCase()]) return named[found.toLowerCase()];
    const cp = parseInt(dec || hex, dec ? 10 : 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : found;
  }).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function attrs(tag) {
  const result = Object.create(null);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  }
  return result;
}
function readMeta(html) {
  const entries = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content && !entries.has(key)) entries.set(key, normalize(a.content));
  }
  return entries;
}
function jsonld(html) {
  const nodes = [];
  for (const script of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    const start = script[0].slice(0,script[0].indexOf('>')+1);
    if (!/application\/ld\+json/i.test(attrs(start).type || '')) continue;
    try {
      const body = script[0].slice(start.length).replace(/<\/script>$/i,'').trim();
      const stack = [JSON.parse(body)];
      let steps = 0;
      while (stack.length && steps++ < 250) {
        const entry = stack.pop();
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry)) { stack.push(...entry.slice(0,80)); continue; }
        nodes.push(entry);
        if (entry['@graph']) stack.push(entry['@graph']);
      }
    } catch { /* marcação malformada: ignorar sem quebrar o cadastro */ }
  }
  return nodes;
}
function isType(node, type) {
  const kinds = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return kinds.some(kind => typeof kind === 'string' && new RegExp('(?:^|[/#])' + type + '$','i').test(kind));
}
export function parseBRLPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= 10000000 ? Math.round(value * 100) / 100 : null;
  let text = String(value ?? '').trim().replace(/^(?:R\$|BRL)\s*/i,'').replace(/\s/g,'');
  if (!text) return null;
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g,'').replace(',','.');
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(text)) text = text.replace(/,/g,'');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',','.');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null;
}
function currencyOK(code, brazil) {
  const currency = String(code ?? '').trim().toUpperCase();
  return currency === 'BRL' || (!currency && brazil);
}
function validCategory(value) {
  const text = normalize(value).replace(/^[›>/\s]+|[›>/\s]+$/g,'').slice(0,60);
  if (!text || text.length < 3 || /^[A-Z]{2,5}\d{2,}$/i.test(text) || /^\d+$/.test(text)) return '';
  if (/(^| )(?:(?:início|home|página inicial|mercado livre|shopee|tiktok shop|todos os produtos|ofertas|loja|departamentos))$/i.test(text)) return '';
  return text;
}
function inference(title) {
  const t = normalize(title).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const rules = [
    ['Moda', /\b(calca|jeans|camiseta|blusa|vestido|shorts|saia|roupa|body|jaqueta|camisa|tenis|bota|sandalia|cropped|legging|moda|cowgirl|country|rodeio|bolsa|biquini|sunga|chinelo|oculos|relogio)\b/],
    ['Eletrônicos', /\b(fone|smartphone|celular|notebook|fone bluetooth|smartwatch|teclado|monitor|computador|tablet|carregador|power bank|caixa de som|echo|alexa|ring light|tripe|microfone|webcam|lampada smart)\b/],
    ['Casa e Decoração', /\b(panela|tapete|almofada|cortina|cama|mesa|cadeira|luminaria|cozinha|organizador|copos|jarra|edredom|caneca|garrafa termica|aspirador|ventilador|umidificador|difusor|vela)\b/],
    ['Beleza', /\b(perfume|maquiagem|batom|cosmetico|hidratante|shampoo|secador de cabelo|unha|skincare|serum|protetor solar|escova|chapinha|base|paleta)\b/],
    ['Ferramentas', /\b(furadeira|parafusadeira|chave de fenda|martelete|serra circular|alicate|broca|ferramenta|multimetro)\b/],
    ['Automotivo', /\b(automotivo|carro|moto|pneu|farol|retrovisor|capacete|suporte veicular)\b/],
    ['Esportes', /\b(bicicleta|musculacao|academia|halter|futebol|esporte|raquete|esteira|corda|luva|garrafa esportiva)\b/],
    ['Infantil', /\b(brinquedo|bebe|infantil|mamadeira|boneca|carrinho de bebe|fralda|chupeta)\b/],
    ['Pet Shop', /\b(cachorro|gato|coleira|pet shop|racao|arranhador|petisco)\b/],
    ['Papelaria', /\b(caderno|caneta|lapis|papelaria|adesivo|planner|marca-texto|mochila|estojo)\b/]
  ];
  return rules.find(([,pattern])=>pattern.test(t))?.[0] || '';
}
function nodesFromProduct(node) {
  return Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : [];
}
function breadcrumbCategory(nodes, title) {
  for (const node of nodes) {
    if (!isType(node,'BreadcrumbList') || !Array.isArray(node.itemListElement)) continue;
    const named = node.itemListElement.map(x=>normalize(x?.name || x?.item?.name || '')).filter(Boolean);
    const useful = named.filter(x=>validCategory(x) && x.toLocaleLowerCase('pt-BR') !== normalize(title).toLocaleLowerCase('pt-BR'));
    if (useful.length) return validCategory(useful.at(-1));
  }
  return '';
}
// Mercado Livre apresenta o preço principal em um bloco distinto do valor
// riscado e dos parcelamentos. Nunca vasculhar números indiscriminadamente.
export function mercadolivreItemId(input) {
  const value = String(input || '');
  // Não aceitar números soltos para evitar relacionar anúncios diferentes.
  const found = value.match(/\bMLB[-_]?(\d{7,14})\b/i);
  return found ? 'MLB'+found[1] : '';
}
// Preço principal da PDP, excluindo riscos e parcelas.
export function visibleMercadoLivrePrice(html) {
  const values=[];
  const markers=['ui-pdp-price__second-line','ui-pdp-price__main-container','ui-pdp-price__part'];
  for (const marker of markers) {
    let pos=0;
    for(let i=0;i<5;i++){
      const start=html.indexOf(marker,pos);
      if(start<0)break;
      pos=start+marker.length;
      const window=html.slice(pos,pos+10000);
      // Preço aparece em elementos filhos; não parar na primeira </div>.
      const fraction=window.match(/class=["'][^"']*(?:andes-money-amount__fraction|price-tag-fraction)[^"']*["'][^>]*>\s*([\d.,]+)/i);
      if(!fraction)continue;
      const cents=window.slice(fraction.index+fraction[0].length,fraction.index+fraction[0].length+650)
        .match(/class=["'][^"']*(?:andes-money-amount__cents|price-tag-cents)[^"']*["'][^>]*>\s*(\d{1,2})/i);
      const whole=fraction[1].replace(/\D/g,'');
      const amount=parseBRLPrice(whole+(cents?'.'+cents[1].padStart(2,'0'):''));
      if(amount!==null) values.push(amount);
      // Só considerar o primeiro preço visível em cada bloco.
      break;
    }
  }
  return new Set(values).size===1 ? values[0] : null;
}

// Fallback para páginas sociais dos links meli.la: o bloco do produto
// compartilhado pode trazer current_price sem metadados og:price.
export function extractMercadoLivreSocial(html) {
  const page = String(html || '').slice(0,1500000)
    .replace(/\\u([0-9a-fA-F]{4})/g,(_,code)=>String.fromCharCode(parseInt(code,16)))
    .replace(/\\"/g,'"')
    .replace(/&quot;|&#34;|&#x22;/gi,'"');
  const title=readMeta(page).get('og:title');
  if(!title)return null;
  const normalized=normalize(title).toLocaleLowerCase('pt-BR');
  const anchors=[...page.matchAll(/"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,250})"/g)]
    .filter(m=>normalize(m[1]).toLocaleLowerCase('pt-BR')===normalized);
  if(anchors.length!==1)return null;
  // Limita a busca ao card compartilhado para não usar preços de recomendações.
  const tail=page.slice(anchors[0].index,anchors[0].index+10000);
  const nextTitle=/"title"\s*:\s*\{\s*"text"\s*:\s*"[^"]{4,250}"/g;
  nextTitle.lastIndex=anchors[0][0].length;
  const next=nextTitle.exec(tail);
  const window=next ? tail.slice(0,next.index) : tail;
  const candidates=[...window.matchAll(/"current_price"\s*:\s*\{\s*"value"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/g)];
  if(candidates.length!==1)return null;
  const candidate=candidates[0];
  const currency=window.slice(candidate.index,candidate.index+350).match(/"currency"\s*:\s*"([A-Z]{3})"/);
  if(currency && currency[1]!=='BRL')return null;
  const price=parseBRLPrice(candidate[1]);
  if(price===null)return null;
  const prior=window.slice(0,candidate.index+350).match(/"previous_price"\s*:\s*\{\s*"value"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/);
  const oldPrice=prior?parseBRLPrice(prior[1]):null;
  return {price,oldPrice:oldPrice !== null && oldPrice>price?oldPrice:null};
}

export function extractTikTokPrice(html, title='') {
  const page = String(html||'').slice(0,1500000)
    .replace(/\\u([0-9a-fA-F]{4})/g,(_,code)=>String.fromCharCode(parseInt(code,16)))
    .replace(/\\"/g,'"').replace(/&quot;|&#34;|&#x22;/gi,'"');
  const normTitle = normalize(title).toLocaleLowerCase('pt-BR');
  const keys = ['"salePrice"','"discountPrice"','"price"','"minPrice"','"originPrice"'];
  // Se houver título, exigir proximidade com o card do produto para não usar recomendações.
  let window = page;
  if (normTitle) {
    const idx = page.toLocaleLowerCase('pt-BR').indexOf(normTitle.slice(0,40).toLocaleLowerCase('pt-BR'));
    if (idx < 0) return null;
    window = page.slice(Math.max(0, idx - 2000), idx + 12000);
  }
  const candidates = [];
  for (const key of keys) {
    const re = new RegExp(key+'\\s*:\\s*(?:\\{[^}]{0,400}?"(?:price|value|amount)"\\s*:\\s*"?([0-9]+(?:\\.[0-9]{1,2})?)"?|"?([0-9]+(?:\\.[0-9]{1,2})?)"?)','g');
    for (const m of window.matchAll(re)) candidates.push(m[1]||m[2]);
  }
  const prices = [...new Set(candidates.map(parseBRLPrice).filter(v=>v!==null))];
  if (prices.length !== 1) return null;
  // Recusar USD explícito próximo ao preço.
  const near = window.slice(0,12000);
  if (/"currency"\s*:\s*"USD"/i.test(near) || /\$\s*\d/.test(near.slice(0,500))) {
    if (!/BRL|R\$/i.test(near.slice(0,2000))) return null;
  }
  return prices[0];
}

export function extractProduct(html, url) {
  const page = new URL(url);
  const host = page.hostname.toLowerCase();
  const isTikTok = /(^|\.)tiktok\.com$|(^|\.)tiktokshop\.com$/i.test(host);
  const brazil = /(?:^|\.)mercadolivre\.com\.br$|(?:^|\.)shopee\.com\.br$/i.test(page.hostname) || isTikTok;
  const tags = readMeta(html);
  const nodes = jsonld(html);
  const product = nodes.find(node=>isType(node,'Product'));
  const rawTitle = normalize(product?.name || tags.get('og:title') || tags.get('twitter:title') || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const title = rawTitle.replace(/\s*[|\-–—]\s*(TikTok\s*Shop|TikTok|Shopee|Mercado\s*Livre).*$/i,'').trim().slice(0,180) || rawTitle.slice(0,180);
  let image = '';
  const imageCandidate = (Array.isArray(product?.image) ? product.image[0] : product?.image) || tags.get('og:image') || tags.get('twitter:image');
  try {
    const img = new URL(typeof imageCandidate === 'string' ? imageCandidate : imageCandidate?.url, page);
    if (img.protocol === 'https:') image = img.href;
  } catch {}
  let price = null;
  let priceSource = '';
  const currency = tags.get('product:price:currency') || tags.get('og:price:currency') || tags.get('pricecurrency');
  const metaPrice = tags.get('product:price:amount') || tags.get('og:price:amount') || tags.get('price');
  if (currencyOK(currency, brazil)) {
    const n = parseBRLPrice(metaPrice);
    if (n != null) {price = n; priceSource = 'Metadados públicos da loja';}
  }
  if (price === null && /(?:^|\.)mercadolivre\.com\.br$/i.test(page.hostname)) {
    const visible = visibleMercadoLivrePrice(html);
    if (visible !== null) { price = visible; priceSource = 'Preço principal exibido no anúncio'; }
  }
  if (price === null && product) {
    const values = nodesFromProduct(product).filter(offer=>currencyOK(offer?.priceCurrency || offer?.priceSpecification?.priceCurrency || product?.priceCurrency, brazil))
      .map(offer=>parseBRLPrice(offer?.price ?? offer?.priceSpecification?.price)).filter(x=>x !== null);
    const distinct = [...new Set(values)];
    if (distinct.length === 1) {price = distinct[0];priceSource = 'Oferta estruturada do produto';}
  }
  let oldPrice = null;
  if (price === null && brazil && !isTikTok) {
    const social = extractMercadoLivreSocial(html);
    if (social) {
      price = social.price;
      oldPrice = social.oldPrice;
      priceSource = 'Bloco de preço do produto compartilhado no Mercado Livre';
    }
  }
  if (price === null && isTikTok) {
    // TikTok raramente expõe og:price; tentar JSON embutido próximo ao título, sem inventar valor.
    const tt = extractTikTokPrice(html, title);
    if (tt !== null) { price = tt; priceSource = 'Dados embutidos da página TikTok Shop (confirmar variação)'; }
  }
  const categoryDirect = validCategory(product?.category || tags.get('product:category') || tags.get('og:category') || tags.get('article:section'));
  const categoryBreadcrumb = breadcrumbCategory(nodes,title);
  const category = categoryDirect || categoryBreadcrumb || inference(title);
  const categorySource = categoryDirect ? 'Loja' : categoryBreadcrumb ? 'Navegação da loja' : category ? 'Sugestão pelo título' : '';
  const canonical = tags.get('og:url') || '';
  const itemId = mercadolivreItemId(page.pathname) || mercadolivreItemId(canonical) || mercadolivreItemId(html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i)?.[0] || '');
  return {title,image,price,oldPrice,category,categorySource,priceSource,itemId};
}
