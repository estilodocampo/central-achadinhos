import test from 'node:test';
import assert from 'node:assert/strict';
import {__forceMemory,upsertOffer,listOffers,getOffer,deleteOffer,getSettings,saveSettings,listUsers,dbMode} from './db.js';
import {registerUser,verifyUser,issueSession,readSession,validUsername} from './auth-local.js';
import {pgConfigured} from './db-pg.js';
import {resolveRedirectUri,ML_REDIRECT_URI} from './ml-oauth.js';
import {extractTikTokPrice,extractProduct} from './product-parser.js';

test('db memória: CRUD de ofertas isolado por dono',async()=>{
  __forceMemory();
  const base={id:'t1',title:'Fone bluetooth',platform:'Shopee',category:'Eletrônicos',price:99.9,oldPrice:null,coupon:'',url:'https://shopee.com.br/product/1/1',image:'',status:'pronta',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await upsertOffer(base,'ana');
  assert.equal((await listOffers('ana')).length,1);
  assert.equal((await listOffers('bia')).length,0);
  assert.equal((await getOffer('t1','ana')).title,'Fone bluetooth');
  assert.ok(await deleteOffer('t1','ana'));
  assert.equal((await listOffers('ana')).length,0);
});
test('db memória: oferta inválida é rejeitada',async()=>{
  __forceMemory();
  await assert.rejects(()=>upsertOffer({id:'x',title:'',platform:'Shopee',price:10,url:'https://shopee.com.br/product/1/1'},'ana'),/inválida/);
});
test('db memória: settings por dono',async()=>{
  __forceMemory();
  await saveSettings({name:'Loja A',group:'https://chat.whatsapp.com/abc'},'ana');
  assert.equal((await getSettings('ana')).name,'Loja A');
  assert.equal((await getSettings('bia')).name,undefined);
});
test('auth-local: registro, login e sessão',async()=>{
  __forceMemory();
  assert.equal(validUsername('equipe1'),true);
  assert.equal(validUsername('ab'),false);
  await registerUser('equipe1','SenhaForte123');
  await assert.rejects(()=>registerUser('equipe1','outraSenha123'),/existe/);
  assert.ok(await verifyUser('EQUIPE1','SenhaForte123'));
  assert.equal(await verifyUser('equipe1','errada'),null);
  const sess=await issueSession('equipe1');
  const back=await readSession('central_session='+sess.token);
  assert.equal(back?.username,'equipe1');
  assert.equal((await listUsers()).length,1);
});
test('auth-local: senha curta é rejeitada',async()=>{
  __forceMemory();
  await assert.rejects(()=>registerUser('curto1','123'),/8-200/);
});
test('db: sem DATABASE_URL usa fallback local e pgConfigured=false',()=>{
  __forceMemory();
  delete process.env.DATABASE_URL;
  assert.equal(pgConfigured(),false);
  assert.equal(dbMode(),'memory');
});
test('ml-oauth: redirect dinâmico respeita override e host',()=>{
  assert.equal(ML_REDIRECT_URI,'https://central-achadinhos.onrender.com/api/ml/callback');
  assert.equal(resolveRedirectUri({}, {ML_REDIRECT_URI:'https://loja.exemplo.com/api/ml/callback'}),'https://loja.exemplo.com/api/ml/callback');
  assert.equal(resolveRedirectUri({headers:{host:'minhaloja.onrender.com','x-forwarded-proto':'https'}},{}),'https://minhaloja.onrender.com/api/ml/callback');
  assert.equal(resolveRedirectUri({headers:{host:'localhost:3000'}},{}),'http://localhost:3000/api/ml/callback');
  assert.equal(resolveRedirectUri({},{}),ML_REDIRECT_URI);
});
test('tiktok: extrai preço único próximo ao título',()=>{
  const html='<meta property="og:title" content="Caneca Térmica Inox">'
    +'<div>{"product":{"title":"Caneca Térmica Inox","salePrice":{"price":"49.90","currency":"BRL"}}}</div>';
  const p=extractProduct(html,'https://www.tiktok.com/@loja/product/123');
  assert.equal(p.title,'Caneca Térmica Inox');
  assert.equal(p.price,49.9);
  assert.match(p.priceSource,/TikTok/);
});
test('tiktok: preços conflitantes não viram preço',()=>{
  const html='<meta property="og:title" content="Caneca">'
    +'{"salePrice":"10.00","other":{"salePrice":"99.00"}}';
  assert.equal(extractTikTokPrice(html,'Caneca'),null);
});
test('tiktok: título limpa sufixo da loja',()=>{
  const html='<meta property="og:title" content="Kit 3 Camisetas | TikTok Shop">';
  const p=extractProduct(html,'https://www.tiktok.com/@loja/product/1');
  assert.equal(p.title,'Kit 3 Camisetas');
  assert.equal(p.category,'Moda');
});
