import test from 'node:test';
import assert from 'node:assert/strict';
import {__forceMemory,upsertOffer,listOffers,getOffer,deleteOffer,getSettings,saveSettings,insertUser,listUsers} from './db.js';
import {registerUser,verifyUser,issueSession,readSession,validUsername} from './auth-local.js';
import {resolveRedirectUri,ML_REDIRECT_URI} from './ml-oauth.js';
import {extractTikTokPrice,extractProduct} from './product-parser.js';

test('db memória: CRUD de ofertas isolado por dono',()=>{
  __forceMemory();
  const base={id:'t1',title:'Fone bluetooth',platform:'Shopee',category:'Eletrônicos',price:99.9,oldPrice:null,coupon:'',url:'https://shopee.com.br/product/1/1',image:'',status:'pronta',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  upsertOffer(base,'ana');
  assert.equal(listOffers('ana').length,1);
  assert.equal(listOffers('bia').length,0);
  assert.equal(getOffer('t1','ana').title,'Fone bluetooth');
  assert.ok(deleteOffer('t1','ana'));
  assert.equal(listOffers('ana').length,0);
});
test('db memória: oferta inválida é rejeitada',()=>{
  __forceMemory();
  assert.throws(()=>upsertOffer({id:'x',title:'',platform:'Shopee',price:10,url:'https://shopee.com.br/product/1/1'},'ana'),/inválida/);
});
test('db memória: settings por dono',()=>{
  __forceMemory();
  saveSettings({name:'Loja A',group:'https://chat.whatsapp.com/abc'},'ana');
  assert.equal(getSettings('ana').name,'Loja A');
  assert.equal(getSettings('bia').name,undefined);
});
test('auth-local: registro, login e sessão',()=>{
  __forceMemory();
  assert.equal(validUsername('equipe1'),true);
  assert.equal(validUsername('ab'),false);
  registerUser('equipe1','SenhaForte123');
  assert.throws(()=>registerUser('equipe1','outraSenha123'),/existe/);
  assert.ok(verifyUser('EQUIPE1','SenhaForte123'));
  assert.equal(verifyUser('equipe1','errada'),null);
  const sess=issueSession('equipe1');
  const back=readSession('central_session='+sess.token);
  assert.equal(back?.username,'equipe1');
  assert.equal(listUsers().length,1);
});
test('auth-local: senha curta é rejeitada',()=>{
  __forceMemory();
  assert.throws(()=>registerUser('curto1','123'),/8-200/);
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
