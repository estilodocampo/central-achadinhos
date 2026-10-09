import test from 'node:test';
import assert from 'node:assert/strict';
import {isGroupJid, normalizeGroupIds, validateSend, classifyClose, backoffFor, shouldClone} from './wa-gateway.js';

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

test('classifyClose: 515 pede retry rápido, sessão morta pede reparo', () => {
  assert.equal(classifyClose(515), 'retry');
  assert.equal(classifyClose(401), 'repair');
  assert.equal(classifyClose(403), 'repair');
  assert.equal(classifyClose(411), 'repair');
  assert.equal(classifyClose(500), 'repair');
  assert.equal(classifyClose(428), 'retry');
  assert.equal(classifyClose(0), 'retry');
});

test('backoffFor: 5s, 15s, 30s, 60s, 5min com teto', () => {
  assert.deepEqual([backoffFor(0), backoffFor(1), backoffFor(2), backoffFor(3), backoffFor(4)], [5000, 15000, 30000, 60000, 300000]);
  assert.equal(backoffFor(99), 300000);
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


test('shouldClone aceita texto e foto do grupo origem',()=>{
  const cfg={enabled:true,from:'120363000001@g.us',to:'120363000002@g.us'};
  assert.deepEqual(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:' Promo '}},cfg),{kind:'text',text:' Promo '});
  const img=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{imageMessage:{caption:'Oferta'}}},cfg);
  assert.equal(img.kind,'image');
  assert.equal(img.caption,'Oferta');
});
test('shouldClone barra loop, outro grupo e tipos do sistema',()=>{
  const cfg={enabled:true,from:'120363000001@g.us',to:'120363000002@g.us'};
  assert.equal(shouldClone({key:{fromMe:true,remoteJid:'120363000001@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000009@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{protocolMessage:{}}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{stickerMessage:{}}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'x'}},{...cfg,enabled:false}),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'x'}},{enabled:true,from:'120363000001@g.us',to:'120363000001@g.us'}),null);
});
