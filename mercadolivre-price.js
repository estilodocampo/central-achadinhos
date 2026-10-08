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
