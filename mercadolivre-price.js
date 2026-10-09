// Integração opcional com a API oficial de preço de venda do Mercado Livre.
// Nunca grava o token em arquivos públicos ou na resposta HTTP.
import { parseBRLPrice, mercadolivreItemId } from './product-parser.js';

export function decodeSalePrice(data) {
  if (!data || typeof data!=='object' || data.currency_id!=='BRL')return null;
  const price=parseBRLPrice(data.amount);
  if(price===null)return null;
  const old=parseBRLPrice(data.regular_amount);
  return {price,oldPrice:old!==null&&old>price?old:null,priceSource:'API oficial Mercado Livre /sale_price'};
}
// Fallback público (sem token): o endpoint de item aceita consulta anônima
// para dados básicos. Exige conferir o título antes de usar o preço.
export function decodePublicItem(data) {
  if (!data || typeof data !== 'object') return null;
  const title = String(data.title || '').trim().slice(0, 180);
  if (!title) return null;
  if (String(data.currency_id || '').toUpperCase() !== 'BRL') return null;
  const price = parseBRLPrice(data.price);
  if (price === null) return null;
  const old = parseBRLPrice(data.original_price);
  return {title, price, oldPrice: old !== null && old > price ? old : null,
    priceSource: 'API pública Mercado Livre (confira a variação)'};
}
export async function publicMLPrice(itemId, request = fetch) {
  if (!itemId || mercadolivreItemId(itemId) !== itemId) return null;
  try {
    const response = await request('https://api.mercadolibre.com/items/' + encodeURIComponent(itemId), {
      headers: {'Accept': 'application/json'},
      signal: AbortSignal.timeout(6500),
      redirect: 'error'
    });
    if (!response.ok) return null;
    return decodePublicItem(await response.json());
  } catch { return null; }
}
export async function officialMLPrice(itemId,token=process.env.ML_ACCESS_TOKEN,request=fetch){
  if(!token||!itemId||mercadolivreItemId(itemId)!==itemId)return null;
  try {
    const url='https://api.mercadolibre.com/items/'+encodeURIComponent(itemId)+'/sale_price?context=channel_marketplace';
    const response=await request(url,{
      headers:{'Authorization':'Bearer '+token,'Accept':'application/json'},
      signal:AbortSignal.timeout(6500),
      redirect:'error'
    });
    if(!response.ok)return null;
    return decodeSalePrice(await response.json());
  }catch{return null;}
}
// Vitrine/perfil (ex: meli.la de vendedor): a página lista vários anúncios
// sem ID único. Confere cada candidato pela API pública e só usa o preço
// quando o título oficial bate com o da página. Nunca chuta.
export async function matchPublicPriceByTitle(html, pageTitle, isMatch, request = fetch, limit = 6) {
  const seen = new Set();
  const ids = [];
  for (const m of String(html || '').matchAll(/\bMLB-?(\d{7,14})\b/gi)) {
    const id = 'MLB' + m[1];
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
    if (ids.length >= limit) break;
  }
  if (!ids.length || !pageTitle) return null;
  const found = await Promise.all(ids.map((id) => publicMLPrice(id, request)));
  for (let i = 0; i < found.length; i++) {
    const pub = found[i];
    if (pub && isMatch(pageTitle, pub.title)) {
      return {price: pub.price, oldPrice: pub.oldPrice, priceSource: pub.priceSource, itemId: ids[i]};
    }
  }
  return null;
}
