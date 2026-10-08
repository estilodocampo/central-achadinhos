import test from 'node:test';
import assert from 'node:assert/strict';
import {mercadoIdsFromPage,parseCatalogResponse,resolveCatalog,verifyItem,matchingTitle} from './mercadolivre-catalog.js';

const item='MLB4312345678',product='MLB65987654';
test('distingue item e produto de catálogo em URLs oficiais',()=>{
 assert.deepEqual(mercadoIdsFromPage('','https://produto.mercadolivre.com.br/MLB-4312345678-calca-_JM'),
  {itemId:item,catalogId:'',evidence:'URL de anúncio'});
 assert.deepEqual(mercadoIdsFromPage('','https://www.mercadolivre.com.br/calca/p/MLB65987654'),
  {itemId:'',catalogId:product,evidence:'URL de catálogo'});
 assert.equal(mercadoIdsFromPage('','https://www.mercadolivre.com.br/calca/p/MLB65987654?pdp_filters=item_id%3AMLB4312345678').itemId,item);
});
test('identifica catálogo somente no card com título correspondente',()=>{
 const body='<meta property="og:title" content="Calça Country Feminina">'+
   '{"components":{"1":{"title":{"text":"Calça Country Feminina"}}},"metadata":{"product_id":"MLB65987654"}}';
 const r=mercadoIdsFromPage(body,'https://www.mercadolivre.com.br/social/country',['https://meli.la/2v48pY7']);
 assert.equal(r.catalogId,product);
 assert.equal(r.itemId,'');
});
test('identifica ID social sem title/text, exigindo confirmação pela API',()=>{
 const body='<meta property="og:title" content="Calça Country Feminina">'+
   '{"components":{"1":{"title":{"name":"Outra Calça"}}},"metadata":{"product_id":"MLB65987654"}}';
 const r=mercadoIdsFromPage(body,'https://www.mercadolivre.com.br/social/country');
 assert.equal(r.catalogId,product);
 assert.match(r.evidence,/exige verificar título/);
});
test('valida moeda BRL e correspondência do catálogo na resposta',()=>{
 const data={id:product,status:'active',buy_box_winner:{item_id:item,price:159.9,currency_id:'BRL'}};
 assert.deepEqual(parseCatalogResponse(data,product),{itemId:item,catalogId:product,price:159.9});
 assert.equal(parseCatalogResponse({...data,id:'MLB65222222'},product),null);
 assert.equal(parseCatalogResponse({...data,buy_box_winner:{...data.buy_box_winner,currency_id:'USD'}},product),null);
});
test('sem token a API do catálogo não recebe requisições',async()=>{
 let called=false;
 const r=await resolveCatalog(product,'',async()=>{called=true;});
 assert.equal(r.status,'not_configured');
 assert.equal(called,false);
});
test('com token consulta catálogo oficial e obtém identificador da oferta',async()=>{
 const r=await resolveCatalog(product,'testing',async(url,options)=>{
  assert.equal(url,'https://api.mercadolibre.com/products/'+product);
  assert.equal(options.headers.Authorization,'Bearer testing');
  return {ok:true,json:async()=>({id:product,status:'active',buy_box_winner:{item_id:item,price:149.5,currency_id:'BRL'}})};
 });
 assert.equal(r.status,'ok');
 assert.equal(r.value.price,149.5);
 assert.equal(r.value.itemId,item);
});
test('resposta 401 é sinalizada sem expor a credencial',async()=>{
 const r=await resolveCatalog(product,'private',async()=>({ok:false,status:401}));
 assert.equal(r.status,'unauthorized');
 assert.equal(r.value,null);
});

test('confirma título oficial de anúncio social antes de buscar preço',async()=>{
 const verified=await verifyItem(item,'Calça Country Feminina','token',async()=>
   ({ok:true,json:async()=>({title:'Calça Country Feminina'})}));
 assert.equal(verified.verified,true);
 const wrong=await verifyItem(item,'Calça Country Feminina','token',async()=>
   ({ok:true,json:async()=>({title:'Smartphone Android 128GB'})}));
 assert.equal(wrong.verified,false);
 assert.equal(wrong.status,'title_mismatch');
});
test('não permite preencher catálogo social sem nome correspondente',async()=>{
 const r=await resolveCatalog(product,'token',async()=>({ok:true,json:async()=>({
  id:product,name:'Smartphone Android 128GB',status:'active',
  buy_box_winner:{item_id:item,price:59.9,currency_id:'BRL'}
 })}),'Calça Country Feminina');
 assert.equal(r.value,null);
 assert.equal(r.status,'no_buy_box');
});
test('normalização de títulos aceita pontuação sem permitir produto diferente',()=>{
 assert.equal(matchingTitle('Calça Country Feminina Cowgirl Rodeio Jeans Feminino Lycra',
 'Calça Country Feminina Cowgirl Rodeio Jeans Feminino Lycra'),true);
 assert.equal(matchingTitle('Calça Country Feminina Cowgirl Rodeio Jeans Feminino Lycra',
 'Bota Couro Country Masculina'),false);
});
