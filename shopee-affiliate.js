import {createHash} from 'node:crypto';
import {extractProduct, parseBRLPrice} from './product-parser.js';

export const SHOPEE_GRAPHQL='https://open-api.affiliate.shopee.com.br/graphql';
function cleanId(value){
  const n=String(value ?? '').trim();
  return /^\d{4,20}$/.test(n)?n:'';
}
export function parseShopeeIds(raw) {
  let u;try{u=new URL(raw)}catch{return null;}
  const host=u.hostname.toLowerCase();
  if (!['shopee.com.br','shopee.com'].some(h=>host===h||host.endsWith('.'+h)))return null;
  let shopId='',itemId='';
  const m=u.pathname.match(/\/(?:product|opaanlp)\/(\d{4,20})\/(\d{4,20})/i)
    || u.pathname.match(/-i\.(\d{4,20})\.(\d{4,20})(?:$|[/?#])/i);
  if(m){shopId=m[1];itemId=m[2];}
  if(!itemId) {
    shopId=u.searchParams.get('shopid') || u.searchParams.get('shop_id') || '';
    itemId=u.searchParams.get('itemid') || u.searchParams.get('item_id') || '';
  }
  shopId=cleanId(shopId);itemId=cleanId(itemId);
  return itemId ? {shopId,itemId} : null;
}
export function signShopee(appId, secret, payload, epochSec) {
  const timestamp=String(epochSec ?? Math.floor(Date.now()/1000));
  const signature=createHash('sha256').update(String(appId)+timestamp+payload+secret,'utf8').digest('hex');
  return 'SHA256 Credential='+appId+', Timestamp='+timestamp+', Signature='+signature;
}
export function buildProductQuery(ids) {
  if (!ids || !cleanId(ids.itemId)) throw Error('itemId inválido.');
  const args=['itemId:'+ids.itemId];
  if(cleanId(ids.shopId)) args.push('shopId:'+ids.shopId);
  args.push('limit:5');
  return '{productOfferV2('+args.join(',')+'){nodes{itemId shopId productName imageUrl productLink offerLink priceMin priceMax}}}';
}
export function parseShopeeOffer(json, ids) {
  const nodes=json?.data?.productOfferV2?.nodes;
  if(!Array.isArray(nodes))return null;
  const item=nodes.find(n=>n && String(n.itemId)===String(ids.itemId)
    && (!ids.shopId || String(n.shopId)===String(ids.shopId)));
  if(!item)return null;
  const title=String(item.productName||'').trim().slice(0,180);
  if(!title)return null;
  let image='';
  try {const parsed=new URL(item.imageUrl);if(parsed.protocol==='https:')image=parsed.href;}catch{}
  const low=parseBRLPrice(item.priceMin);
  const high=parseBRLPrice(item.priceMax);
  // Variantes com valores distintos não possuem preço único confirmado.
  const range=low!==null && high!==null && low!==high;
  const price=range?null:(low??high);
  const category=extractProduct('<meta property="og:title" content="'+title.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">','https://shopee.com.br/product/1/1').category;
  return {title,image,price,category,categorySource:category?'Sugestão pelo título':'',
    priceSource:price!==null?'API oficial Shopee Afiliados':'',
    priceNote:range?'Produto com variações de preço na Shopee. Confira a variação selecionada antes de divulgar.'
      :price!==null?'Preço encontrado na API oficial Shopee. Confirme a variação e frete antes de divulgar.'
      :'API Shopee identificou o produto, mas não confirmou o preço. Confira na loja.',
    source:'Shopee Affiliate Open API'};
}
export async function officialShopeeProduct(ids,opts={}){
  const appId=opts.appId??process.env.SHOPEE_APP_ID;
  const secret=opts.secret??process.env.SHOPEE_APP_SECRET;
  if(!appId||!secret||!ids?.itemId)return null;
  const requester=opts.request??fetch;
  const payload=JSON.stringify({query:buildProductQuery(ids)});
  try{
    const response=await requester(SHOPEE_GRAPHQL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':signShopee(appId,secret,payload,opts.timestamp)},
      body:payload,signal:AbortSignal.timeout(10000),redirect:'error'
    });
    if(!response.ok)return null;
    const result=await response.json();
    if(result?.errors?.length)return null;
    return parseShopeeOffer(result,ids);
  }catch{return null;}
}
