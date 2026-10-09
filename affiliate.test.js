import test from 'node:test';
import assert from 'node:assert/strict';
import {validMLAffiliate, applyMLAffiliate, rewriteLinksInText} from './affiliate.js';

test('validMLAffiliate aceita tool numérico e word simples', () => {
  assert.deepEqual(validMLAffiliate('46883572', 'minhalojaofertas'), {tool: '46883572', word: 'minhalojaofertas'});
  assert.throws(() => validMLAffiliate('abc', 'loja'), /matt_tool/);
  assert.throws(() => validMLAffiliate('1234', 'x'), /matt_word/);
});
test('applyMLAffiliate injeta matt em URL de produto e troca o antigo', () => {
  const cfg = {tool: '1111', word: 'minha'};
  const r = applyMLAffiliate('https://produto.mercadolivre.com.br/MLB-123?matt_tool=999&matt_word=outra', cfg);
  assert.equal(r.applied, true);
  assert.match(r.url, /matt_tool=1111/);
  assert.match(r.url, /matt_word=minha/);
  assert.ok(!r.url.includes('matt_tool=999'));
});
test('applyMLAffiliate ignora fora do ML e sem config', () => {
  assert.equal(applyMLAffiliate('https://shopee.com.br/product/1/1', {tool: '1', word: 'a'}).applied, false);
  assert.equal(applyMLAffiliate('https://meli.la/abc', {tool: '111', word: 'minha'}).applied, false);
  assert.equal(applyMLAffiliate('https://produto.mercadolivre.com.br/MLB-1', null).applied, false);
});
test('rewriteLinksInText troca só links ML e preserva pontuação', () => {
  const cfg = {tool: '1111', word: 'minha'};
  const r = rewriteLinksInText('Veja https://produto.mercadolivre.com.br/MLB-123 e https://shopee.com.br/x.', cfg);
  assert.equal(r.replaced, 1);
  assert.match(r.text, /matt_tool=1111/);
  assert.ok(r.text.includes('https://shopee.com.br/x'));
});
