import test from 'node:test';
import assert from 'node:assert/strict';
import {extractProduct,parseBRLPrice} from './product-parser.js';
test('og:image com D_NQ_NP revela o ID do anúncio',()=>{
  const html='<meta property="og:title" content="Calça Country Feminina">'
    +'<meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_761916-MLB93107766867_092025-O.webp">';
  const p=extractProduct(html,'https://www.mercadolivre.com.br/social/loja123');
  assert.equal(p.itemId,'MLB93107766867');
  assert.equal(p.itemIdSource,'og:image');
});
test('og:image de logo não inventa ID',()=>{
  const html='<meta property="og:title" content="Loja X">'
    +'<meta property="og:image" content="https://example.com/logo.png">';
  const p=extractProduct(html,'https://www.mercadolivre.com.br/social/loja123');
  assert.equal(p.itemId,'');
});
test('identifica preço em reais com pontuação brasileira',()=>{
  assert.equal(parseBRLPrice('R$ 1.234,90'),1234.9);
  assert.equal(parseBRLPrice('249,99'),249.99);
  assert.equal(parseBRLPrice(150),150);
  assert.equal(parseBRLPrice('12x de 40'),null);
  assert.equal(parseBRLPrice('Não disponível'),null);
});
test('metadados de produto fornecem título, foto, categoria e preço',()=>{
 const html = '<html><head><meta property="og:title" content="Calça Country Feminina"><meta property="og:image" content="https://example.com/p.jpg"><meta property="product:price:amount" content="189.90"><meta property="product:price:currency" content="BRL"><meta property="product:category" content="Moda"></head></html>';
 const data=extractProduct(html,'https://www.mercadolivre.com.br/roupa');
 assert.equal(data.price,189.9);
 assert.equal(data.category,'Moda');
 assert.equal(data.title,'Calça Country Feminina');
 assert.equal(data.image,'https://example.com/p.jpg');
});
test('busca preço em JSON-LD de oferta válida BRL',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({"@context":"https://schema.org","@type":"Product",name:"Camiseta Feminina",category:"Moda",offers:{"@type":"Offer",price:"129.90",priceCurrency:"BRL"}})+'</script>';
 const data=extractProduct(html,'https://www.mercadolivre.com.br/anuncio');
 assert.equal(data.price,129.9);
 assert.equal(data.category,'Moda');
 assert.equal(data.categorySource,'Loja');
});
test('não utiliza preços declarados em outra moeda',()=>{
 const html='<meta property="product:price:amount" content="599"><meta property="product:price:currency" content="USD">';
 const data=extractProduct(html,'https://www.mercadolivre.com.br/anuncio');
 assert.equal(data.price,null);
});
test('sem preço confirmado permanece vazio e sugere categoria pelo nome',()=>{
 const html='<meta property="og:title" content="Calça Country Feminina Cowgirl Rodeio Jeans">';
 const data=extractProduct(html,'https://www.mercadolivre.com.br/anuncio');
 assert.equal(data.price,null);
 assert.equal(data.category,'Moda');
 assert.equal(data.categorySource,'Sugestão pelo título');
});
test('ofertas estruturadas conflitantes não geram preço inventado',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({"@type":"Product",name:"Item",offers:[{price:150,priceCurrency:"BRL"},{price:189,priceCurrency:"BRL"}]})+'</script>';
 assert.equal(extractProduct(html,'https://www.mercadolivre.com.br/anuncio').price,null);
});
test('categoria pode vir de breadcrumb de produto',()=>{
 const nodes=[
 {"@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",name:"Início"},{"@type":"ListItem",name:"Moda"},{"@type":"ListItem",name:"Calças"}]},
 {"@type":"Product",name:"Calça Country"}
 ];
 const html=nodes.map(x=>'<script type="application/ld+json">'+JSON.stringify(x)+'</script>').join('');
 assert.equal(extractProduct(html,'https://www.mercadolivre.com.br/anuncio').category,'Calças');
});

test('meli.la: usa preço do bloco compartilhado quando a página não tem og:price',()=>{
 const html='<html><head><meta property="og:title" content="Calça Country Feminina"/></head><body>'
   +'{"components":[{"type":"title","title":{"text":"Calça Country Feminina"}},'
   +'{"type":"price","price":{"previous_price":{"value":199.90,"currency":"BRL"},'
   +'"current_price":{"value":139.90,"currency":"BRL"}}}]}</body></html>';
 const p=extractProduct(html,'https://www.mercadolivre.com.br/social/x');
 assert.equal(p.price,139.9);
 assert.equal(p.oldPrice,199.9);
 assert.match(p.priceSource,/compartilhado/);
});
test('não aceita preço de recomendação de outro anúncio',()=>{
 const html='<meta property="og:title" content="Calça Country Feminina">'
   +'{"components":[{"title":{"text":"Outra oferta"}},{"current_price":{"value":19.90,"currency":"BRL"}}]}';
 const p=extractProduct(html,'https://www.mercadolivre.com.br/social/x');
 assert.equal(p.price,null);
});
test('não usa USD como preço de anúncio social Mercado Livre',()=>{
 const html='<meta property="og:title" content="Calça Country Feminina">'
  +'{"components":[{"title":{"text":"Calça Country Feminina"}},{"current_price":{"value":80.00,"currency":"USD"}}]}';
 const p=extractProduct(html,'https://www.mercadolivre.com.br/social/x');
 assert.equal(p.price,null);
});

test('preço principal com divs aninhadas na página de produto', async()=>{
 const { visibleMercadoLivrePrice } = await import('./product-parser.js');
 const html='<div class="ui-pdp-price__main-container"><div><div class="ui-pdp-price__second-line"><div>'
 +'<span class="andes-money-amount__currency-symbol">R$</span>'
 +'<span class="andes-money-amount__fraction">65</span>'
 +'<span class="andes-money-amount__cents">70</span></div></div></div>';
 assert.equal(visibleMercadoLivrePrice(html),65.7);
});
test('preço social com caracteres escapados e espaços no JSON',()=>{
 const html='<meta property="og:title" content="Calça Jeans Country Feminina">'
 + '{\\"title\\": {\\"text\\": \\"Calça Jeans Country Feminina\\"}, \\"current_price\\": {\\"value\\": \\"65.70\\", \\"currency\\": \\"BRL\\"}}';
 const p=extractProduct(html,'https://www.mercadolivre.com.br/social/produto');
 assert.equal(p.price,65.7);
});

test('página social com recomendação posterior não troca preço',()=>{
 const html='<meta property="og:title" content="Calça Country Feminina">'
  +'{"title":{"text":"Calça Country Feminina"},"current_price":{"value":139.90,"currency":"BRL"}}'
  +'{"title":{"text":"Outra oferta"},"current_price":{"value":19.90,"currency":"BRL"}}';
 assert.equal(extractProduct(html,'https://www.mercadolivre.com.br/social/x').price,139.9);
});
test('página social com preços conflitantes no card não usa valor incerto',()=>{
 const html='<meta property="og:title" content="Calça Country Feminina">'
  +'{"title":{"text":"Calça Country Feminina"},"current_price":{"value":139.90,"currency":"BRL"},'
  +'"other":{"current_price":{"value":19.90,"currency":"BRL"}}}';
 assert.equal(extractProduct(html,'https://www.mercadolivre.com.br/social/x').price,null);
});
