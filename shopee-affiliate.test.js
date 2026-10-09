import test from 'node:test';
import assert from 'node:assert/strict';
import {parseShopeeIds,buildProductQuery,parseShopeeOffer,officialShopeeProduct,signShopee,userShopeeCreds} from './shopee-affiliate.js';

const IDS={shopId:'123456789',itemId:'987654321'};
test('extrai IDs de URLs de produto, opaanlp e links com query string',()=>{
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/product/123456789/987654321'),IDS);
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/opaanlp/123456789/987654321'),IDS);
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/calca-jeans-i.123456789.987654321'),IDS);
  assert.deepEqual(parseShopeeIds('https://shopee.com.br/abc?shopid=123456789&itemid=987654321'),IDS);
  assert.equal(parseShopeeIds('https://evil.com/product/123456789/987654321'),null);
});
test('a consulta inclui os IDs de Shopee e item',()=>{
  assert.match(buildProductQuery(IDS),/shopId:123456789/);
  assert.match(buildProductQuery(IDS),/itemId:987654321/);
});
test('não mistura preço de anúncios com ID diferente',()=>{
  const data={data:{productOfferV2:{nodes:[{itemId:'222',shopId:'123456789',productName:'Outro',priceMin:'19.90'}]}}};
  assert.equal(parseShopeeOffer(data,IDS),null);
});
test('aceita somente o produto e a loja solicitados, atribuindo categoria',()=>{
  const data={data:{productOfferV2:{nodes:[
   {itemId:IDS.itemId,shopId:IDS.shopId,productName:'Calça Country Feminina',imageUrl:'https://img.shopee.com.br/1.jpg',priceMin:'89.90',priceMax:'89.90'}
  ]}}};
  const p=parseShopeeOffer(data,IDS);
  assert.equal(p.price,89.9);
  assert.equal(p.category,'Moda');
  assert.equal(p.image,'https://img.shopee.com.br/1.jpg');
});
test('preços diferentes de variações não viram preço exato',()=>{
  const data={data:{productOfferV2:{nodes:[{...IDS,productName:'Tênis Esportivo',priceMin:'89.90',priceMax:'129.90'}]}}};
  const p=parseShopeeOffer(data,IDS);
  assert.equal(p.price,null);
  assert.match(p.priceNote,/variações/);
});
test('sem AppId/Secret não envia solicitações',async()=>{
  let called=false;
  const result=await officialShopeeProduct(IDS,{appId:'',secret:'',request:async()=>{called=true;}});
  assert.equal(result,null);
  assert.equal(called,false);
});
test('assina requisição usando payload idêntico ao enviado',async()=>{
  let called=false;
  const product={itemId:IDS.itemId,shopId:IDS.shopId,productName:'Calça Country',priceMin:'79.90',priceMax:'79.90'};
  const result=await officialShopeeProduct(IDS,{
   appId:'123456',secret:'secret',
   timestamp:1700000000,
   request:async(url,options)=>{
    assert.equal(url,'https://open-api.affiliate.shopee.com.br/graphql');
    assert.equal(options.headers.Authorization,signShopee('123456','secret',options.body,1700000000));
    assert.equal(options.redirect,'error');
    called=true;
    return {ok:true,json:async()=>({data:{productOfferV2:{nodes:[product]}}})};
   }
  });
  assert.equal(called,true);
  assert.equal(result.price,79.9);
});
test('userShopeeCreds valida chaves do painel',()=>{
  assert.deepEqual(userShopeeCreds({}),null);
  assert.deepEqual(userShopeeCreds(null),null);
  assert.deepEqual(userShopeeCreds({shopeeAppId:'12345678',shopeeAppSecret:'segredo-forte-123'}),{appId:'12345678',secret:'segredo-forte-123'});
  assert.throws(()=>userShopeeCreds({shopeeAppId:'abc',shopeeAppSecret:'segredo-forte-123'}),/App ID/);
  assert.throws(()=>userShopeeCreds({shopeeAppId:'123',shopeeAppSecret:'curto'}),/Secret/);
  assert.throws(()=>userShopeeCreds({shopeeAppId:'12345678',shopeeAppSecret:'com espaço x'}),/Secret/);
});
test('officialShopeeProduct usa credenciais do usuário quando informadas',async()=>{
  let auth='';
  const product={itemId:IDS.itemId,shopId:IDS.shopId,productName:'Calça Country',priceMin:'79.90',priceMax:'79.90'};
  const result=await officialShopeeProduct(IDS,{appId:'999',secret:'s3cr3t-user',timestamp:1700000000,
    request:async(url,options)=>{auth=options.headers.Authorization;return {ok:true,json:async()=>({data:{productOfferV2:{nodes:[product]}}})};}});
  assert.match(auth,/Credential=999/);
  assert.equal(result.price,79.9);
});
