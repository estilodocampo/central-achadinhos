// Resolve identificadores de anúncio e de catálogo do Mercado Livre.
// Nunca trata um ID /p/MLB... como se fosse /items/MLB...
import {parseBRLPrice} from './product-parser.js';

const ID=/\bMLB-?(\d{7,14})\b/i;
const valid=id=>/^MLB\d{7,14}$/.test(String(id||''));
const normal=id=>{const m=String(id||'').match(ID);return m?'MLB'+m[1]:'';};
const normalizeText=str=>String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function decodeJSONEscapes(s) {
  return String(s||'').replace(/\\u([a-f0-9]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))
    .replace(/\\"/g,'"').replace(/&quot;|&#34;|&#x22;/gi,'"');
}
function supported(u){
  try{const x=new URL(u);return x.protocol==='https:' && /(^|\.)mercadolivre\.com(\.br)?$|(^|\.)mercadolibre\.com$|(^|\.)meli\.la$/i.test(x.hostname);}
  catch{return false;}
}
function paramsOf(url){
  try {
    const u=new URL(url);
    const filter=u.searchParams.get('pdp_filters')||'';
    const itemFilter=filter.match(/item_id\s*:\s*(MLB-?\d{7,14})/i);
    if(itemFilter)return normal(itemFilter[1]);
    for(const key of ['item_id','itemId','itm','item','id']){
      const id=normal(u.searchParams.get(key));
      if(id)return id;
    }
  }catch{}
  return '';
}
function explicitId(raw){
  try {
    const u=new URL(raw);
    const query=paramsOf(raw);if(query)return {itemId:query,catalogId:'',evidence:'Query item_id'};
    const isCatalog=/\/p\/MLB-?\d{7,14}(?:\/|$)/i.test(u.pathname);
    const isListing=/(?:^|\/)MLB-?\d{7,14}(?:-|\/|$)/i.test(u.pathname);
    const id=normal(u.pathname);
    if(isCatalog&&id)return {itemId:'',catalogId:id,evidence:'URL de catálogo'};
    if(isListing&&id)return {itemId:id,catalogId:'',evidence:'URL de anúncio'};
  }catch{}
  return null;
}
export function mercadoIdsFromPage(html, url, redirects=[]) {
  const original=[url,...redirects].filter(supported);
  for (const link of original) {
    const id=explicitId(link);
    if(id)return id;
  }
  const page=decodeJSONEscapes(String(html||'').slice(0,1500000));
  const meta=(key)=>{
    const tags=page.match(/<meta\b[^>]*>/gi)||[];
    for(const tag of tags){
      const p=tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
      const v=tag.match(/content\s*=\s*["']([^"']+)["']/i);
      if(p?.[1]?.toLowerCase()===key && v?.[1])return v[1];
    }
    return '';
  };
  for(const ref of [meta('og:url'),meta('twitter:url'),...original]){
    const direct=explicitId(ref);if(direct)return direct;
  }
  // Se uma PDP direta possui metadata explícita, usar identificador único.
  const title=meta('og:title')||meta('twitter:title');
  if(!title)return {itemId:'',catalogId:'',evidence:'Sem metadados de produto'};
  // Filtrar para o card que corresponde ao título do anúncio compartilhado.
  const target=normalizeText(title);
  const anchors=[];
  for(const m of page.matchAll(/"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,240})"/g)){
    if(normalizeText(m[1])===target)anchors.push(m.index);
  }
  if(anchors.length!==1) {
    // Em páginas sociais, o HTML pode trazer IDs dentro do estado da aplicação,
    // mesmo sem o componente title/text. Só admitir identificadores únicos.
    const fieldIds=(key)=>{
      const regex=new RegExp('["\\x27]'+key+'["\\x27]\\s*:\\s*["\\x27]?(MLB-?\\d{7,14})','gi');
      return [...new Set([...page.matchAll(regex)].map(m=>normal(m[1])))];
    };
    const itemIds=fieldIds('item_id');
    const catalogIds=fieldIds('product_id');
    if(itemIds.length===1)return {itemId:itemIds[0],catalogId:catalogIds.length===1?catalogIds[0]:'',evidence:'ID único em metadados sociais (exige verificar título)'};
    if(catalogIds.length===1)return {itemId:'',catalogId:catalogIds[0],evidence:'Catálogo único em metadados sociais (exige verificar título)'};
    return {itemId:'',catalogId:'',evidence:'IDs múltiplos ou indisponíveis'};
  }
  const start=anchors[0];
  const context=page.slice(Math.max(0,start-4500),start+8500);
  // No card Mercado Livre, product_id indica catálogo, item_id identifica publicação.
  const candidates=(key)=>[...context.matchAll(new RegExp('"'+key+'"\\s*:\\s*"(MLB-?\\d{7,14})"','gi'))]
    .map(x=>normal(x[1]));
  const itemIds=[...new Set(candidates('item_id'))];
  const catalogIds=[...new Set(candidates('product_id'))];
  if(itemIds.length===1)return {itemId:itemIds[0],catalogId:catalogIds.length===1?catalogIds[0]:'',evidence:'Item do card vinculado ao título'};
  if(catalogIds.length===1)return {itemId:'',catalogId:catalogIds[0],evidence:'Catálogo do card vinculado ao título'};
  return {itemId:'',catalogId:'',evidence:'Nenhum identificador inequívoco'};
}
export function matchingTitle(pageTitle,officialTitle) {
  const original=normalizeText(pageTitle).replace(/\b(mercado livre|mercadolivre)\b/g,'').trim();
  const official=normalizeText(officialTitle).replace(/\b(mercado livre|mercadolivre)\b/g,'').trim();
  if(!original||!official)return false;
  if(original===official)return true;
  const x=new Set(original.split(' ').filter(w=>w.length>2));
  const y=new Set(official.split(' ').filter(w=>w.length>2));
  if(x.size<3||y.size<3)return false;
  const shared=[...x].filter(w=>y.has(w)).length;
  return shared/Math.max(x.size,y.size) >= .8;
}
export async function verifyItem(itemId,pageTitle,token=process.env.ML_ACCESS_TOKEN,request=fetch) {
  if(!valid(itemId)||!token||!pageTitle)return {status:'invalid',verified:false};
  try {
    const response=await request('https://api.mercadolibre.com/items/'+encodeURIComponent(itemId),{
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(6500)
    });
    if(!response.ok)return {status:response.status===401?'unauthorized':response.status===403?'forbidden':'http_error',verified:false};
    const data=await response.json();
    return {status:matchingTitle(pageTitle,data?.title)?'ok':'title_mismatch',verified:matchingTitle(pageTitle,data?.title)};
  }catch{return {status:'network_error',verified:false};}
}

export function parseCatalogResponse(body,requestedCatalog,expectedTitle='') {
  const catalog=normal(body?.id);
  if(!valid(catalog)||catalog!==requestedCatalog||body?.status==='inactive')return null;
  if(expectedTitle&&!matchingTitle(expectedTitle,body?.name||body?.family_name))return null;
  const win=body.buy_box_winner;
  const itemId=normal(win?.item_id);
  if(!valid(itemId))return null;
  const amount=parseBRLPrice(win?.price);
  if(win?.currency_id!=='BRL')return null;
  return {itemId,catalogId:catalog,price:amount};
}
export async function resolveCatalog(catalogId,token=process.env.ML_ACCESS_TOKEN,request=fetch,expectedTitle=''){
  if(!valid(catalogId))return {status:'invalid_id',value:null};
  if(!token)return {status:'not_configured',value:null};
  try{
    const res=await request('https://api.mercadolibre.com/products/'+encodeURIComponent(catalogId),{
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(6500)
    });
    if(!res.ok)return {status:res.status===401?'unauthorized':res.status===403?'forbidden':res.status===404?'not_found':'http_error',value:null};
    const data=await res.json();
    const value=parseCatalogResponse(data,catalogId,expectedTitle);
    return {status:value?'ok':'no_buy_box',value};
  }catch{return {status:'network_error',value:null};}
}
