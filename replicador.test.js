import test from 'node:test';
import assert from 'node:assert/strict';
import {isGroupJid, normalizeGroupIds, validateSend} from './wa-gateway.js';

test('jid de grupo válido e inválido', () => {
  assert.equal(isGroupJid('120363123456@g.us'), true);
  assert.equal(isGroupJid('5511999998888@s.whatsapp.net'), false);
  assert.equal(isGroupJid('grupo com espaco@g.us'), false);
  assert.equal(isGroupJid(''), false);
  assert.equal(isGroupJid(null), false);
});

test('normaliza ids: dedup, filtra e limita a 20', () => {
  const ids = ['120363000001@g.us', '120363000001@g.us', '5511@s.whatsapp.net', ' 120363000002@g.us '];
  assert.deepEqual(normalizeGroupIds(ids), ['120363000001@g.us', '120363000002@g.us']);
  const many = Array.from({length: 30}, (_, i) => '120363' + String(i).padStart(6, '0') + '@g.us');
  assert.equal(normalizeGroupIds(many).length, 20);
});

test('validateSend recusa mensagem vazia, longa ou sem grupo', () => {
  assert.equal(validateSend('', ['120363000001@g.us']).ok, false);
  assert.equal(validateSend('x'.repeat(2001), ['120363000001@g.us']).ok, false);
  assert.equal(validateSend('Oferta!', []).ok, false);
  assert.equal(validateSend('Oferta!', ['invalido']).ok, false);
  const ok = validateSend('  Oferta!  ', ['120363000001@g.us']);
  assert.equal(ok.ok, true);
  assert.equal(ok.message, 'Oferta!');
  assert.deepEqual(ok.groups, ['120363000001@g.us']);
});
