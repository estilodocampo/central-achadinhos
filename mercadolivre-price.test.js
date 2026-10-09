import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSalePrice,officialMLPrice,decodePublicItem,publicMLPrice,matchPublicPriceByTitle} from './mercadolivre-price.js';

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
test('matchPublicPriceByTitle usa só o ID com título correspondente',async()=>{
  const calls=[];
  const req=async(url)=>{
    const id=url.match(/items\/(MLB\d+)/)[1];
    calls.push(id);
    const titles={'MLB1111111111':'Outro Produto Qualquer Diferente','MLB4217104989':'Calça Country Feminina Cowgirl Rodeio Jeans'};
    return {ok:true,json:async()=>({title:titles[id]||'X',price:49.9,currency_id:'BRL'})};
  };
  const isMatch=(a,b)=>{
    const wa=new Set(String(a).toLowerCase().split(/\s+/)),wb=new Set(String(b).toLowerCase().split(/\s+/));
    return [...wa].filter(w=>wb.has(w)).length>=3;
  };
  const html='anuncio MLB1111111111 e tambem MLB4217104989 fim';
  const out=await matchPublicPriceByTitle(html,'Calça Country Feminina Cowgirl Rodeio Jeans',isMatch,req);
  assert.equal(out.price,49.9);
  assert.equal(out.itemId,'MLB4217104989');
  assert.deepEqual(calls,['MLB1111111111','MLB4217104989']);
});
test('matchPublicPriceByTitle recusa tudo sem correspondência e limita candidatos',async()=>{
  let n=0;
  const req=async()=>{n++;return {ok:true,json:async()=>({title:'Totalmente Outro Item Sem Relação',price:9.9,currency_id:'BRL'})};};
  const ids=Array.from({length:10},(_,i)=>'MLB'+(4200000000+i)).join(' ');
  const out=await matchPublicPriceByTitle(ids,'Calça Country Feminina Cowgirl Rodeio Jeans',()=>false,req);
  assert.equal(out,null);
  assert.equal(n,6);
  assert.equal(await matchPublicPriceByTitle('sem ids aqui','Algum Título',()=>true,req),null);
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
