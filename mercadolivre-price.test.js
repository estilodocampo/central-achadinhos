import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSalePrice,officialMLPrice} from './mercadolivre-price.js';

test('preço de venda oficial em BRL, com preço anterior',()=>{
  const data=decodeSalePrice({amount:65.7,regular_amount:76.9,currency_id:'BRL'});
  assert.deepEqual(data,{price:65.7,oldPrice:76.9,priceSource:'API oficial Mercado Livre /sale_price'});
});
test('rejeita moeda distinta de BRL e valor inválido',()=>{
  assert.equal(decodeSalePrice({amount:65.7,currency_id:'USD'}),null);
  assert.equal(decodeSalePrice({amount:'12 parcelas',currency_id:'BRL'}),null);
});
test('sem token, nunca consulta a API',async()=>{
  let called=false;
  const result=await officialMLPrice('MLB4217104989','',async()=>{called=true;});
  assert.equal(result,null);
  assert.equal(called,false);
});
test('consulta a API pelo ID exato com Bearer, sem redirecionar',async()=>{
  let checked=false;
  const result=await officialMLPrice('MLB4217104989','test-token',async(url,init)=>{
    assert.match(url,/\/items\/MLB4217104989\/sale_price\?context=channel_marketplace$/);
    assert.equal(init.headers.Authorization,'Bearer test-token');
    assert.equal(init.redirect,'error');checked=true;
    return {ok:true,json:async()=>({amount:65.7,regular_amount:null,currency_id:'BRL'})};
  });
  assert.equal(checked,true);
  assert.equal(result.price,65.7);
  assert.equal(result.oldPrice,null);
});
