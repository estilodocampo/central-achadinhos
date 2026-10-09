import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSalePrice,officialMLPrice,decodePublicItem,publicMLPrice} from './mercadolivre-price.js';

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
test('item público em BRL com título e original_price',()=>{
  const data=decodePublicItem({title:'Calça Country Feminina Jeans',price:49.9,original_price:79.9,currency_id:'BRL'});
  assert.equal(data.price,49.9);
  assert.equal(data.oldPrice,79.9);
  assert.match(data.priceSource,/pública/);
});
test('item público rejeita USD, sem título e sem preço',()=>{
  assert.equal(decodePublicItem({title:'X',price:10,currency_id:'USD'}),null);
  assert.equal(decodePublicItem({price:10,currency_id:'BRL'}),null);
  assert.equal(decodePublicItem({title:'X',price:'12x',currency_id:'BRL'}),null);
});
test('publicMLPrice consulta sem Authorization e trata 404 como null',async()=>{
  let checked=false;
  const ok=await publicMLPrice('MLB4217104989',async(url,init)=>{
    assert.match(url,/\/items\/MLB4217104989$/);
    assert.ok(!('Authorization' in (init.headers||{})));
    checked=true;
    return {ok:true,json:async()=>({title:'Calça Country',price:49.9,currency_id:'BRL'})};
  });
  assert.equal(checked,true);
  assert.equal(ok.price,49.9);
  const nf=await publicMLPrice('MLB4217104989',async()=>({ok:false,status:404}));
  assert.equal(nf,null);
  const bad=await publicMLPrice('123',async()=>{throw Error('não deve chamar');});
  assert.equal(bad,null);
});
