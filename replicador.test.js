import test from 'node:test';
import assert from 'node:assert/strict';
import {isGroupJid, normalizeGroupIds, validateSend, classifyClose, backoffFor, shouldClone, matchPairs, pairTargets} from './wa-gateway.js';

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


test('shouldClone aceita texto e foto e devolve alvos (hub+destinos)',()=>{
  const cfg={pairs:[{id:'p1',from:'120363000001@g.us',hub:'120363000009@g.us',dests:['120363000002@g.us','120363000003@g.us'],enabled:true}]};
  const job=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:' Promo '}},cfg);
  assert.equal(job.kind,'text');
  assert.equal(job.text,' Promo ');
  assert.deepEqual(job.targets,['120363000009@g.us','120363000002@g.us','120363000003@g.us']);
  const img=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{imageMessage:{caption:'Oferta'}}},cfg);
  assert.equal(img.kind,'image');
  assert.equal(img.caption,'Oferta');
});
test('shouldClone barra loop, outro grupo e tipos do sistema',()=>{
  const cfg={pairs:[{id:'p1',from:'120363000001@g.us',dests:['120363000002@g.us'],enabled:true}]};
  assert.equal(shouldClone({key:{fromMe:true,remoteJid:'120363000001@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000009@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{protocolMessage:{}}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{stickerMessage:{}}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'x'}},{pairs:[{id:'p1',from:'120363000001@g.us',dests:['120363000002@g.us'],enabled:false}]}),null);
  // destino == origem: par desligado
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000002@g.us'},message:{conversation:'x'}},{pairs:[{id:'p1',from:'120363000002@g.us',dests:['120363000002@g.us'],enabled:true}]}),null);
});
test('pares independentes: cada origem vai ao próprio destino',()=>{
  const cfg={pairs:[
    {id:'p1',from:'120363000001@g.us',dests:['120363000002@g.us'],enabled:true},
    {id:'p2',from:'120363000003@g.us',dests:['120363000004@g.us'],enabled:false},
  ]};
  const j1=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'oi'}},cfg);
  assert.equal(j1.pairId,'p1');
  assert.deepEqual(j1.targets,['120363000002@g.us']);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000003@g.us'},message:{conversation:'oi'}},cfg),null);
  assert.deepEqual(matchPairs({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{}},cfg).map(p=>p.id),['p1']);
});
test('Grupo 2 (distribuidor) + Grupo 3 (vários destinos)',()=>{
  const cfg={pairs:[{id:'p1',from:'120363000001@g.us',hub:'120363000010@g.us',dests:['120363000002@g.us','120363000003@g.us','120363000004@g.us'],enabled:true}]};
  const job=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'oi'}},cfg);
  assert.deepEqual(job.targets,['120363000010@g.us','120363000002@g.us','120363000003@g.us','120363000004@g.us']);
  assert.deepEqual(pairTargets(cfg.pairs[0]),['120363000010@g.us','120363000002@g.us','120363000003@g.us','120363000004@g.us']);
});
test('pairTargets dedup: hub repetido nos destinos não duplica',()=>{
  assert.deepEqual(pairTargets({hub:'120363000009@g.us',dests:['120363000009@g.us','120363000002@g.us']}),['120363000009@g.us','120363000002@g.us']);
  assert.deepEqual(pairTargets({hub:'',dests:['120363000002@g.us','120363000002@g.us']}),['120363000002@g.us']);
});
test('duas origens por par: ambas vão para o mesmo destino',()=>{
  const cfg={pairs:[
    {id:'p1',from:'120363000001@g.us',from2:'120363000003@g.us',dests:['120363000002@g.us'],enabled:true},
  ]};
  const a=shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'oi'}},cfg);
  const b=shouldClone({key:{fromMe:false,remoteJid:'120363000003@g.us'},message:{conversation:'oi'}},cfg);
  assert.deepEqual(a.targets,['120363000002@g.us']);
  assert.deepEqual(b.targets,['120363000002@g.us']);
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000003@g.us'},message:{}},cfg).length,1);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000009@g.us'},message:{conversation:'oi'}},cfg),null);
});
test('todos os grupos: origem = todos exceto hub/destinos',()=>{
  const cfg={pairs:[{id:'p1',fromAll:true,hub:'120363000010@g.us',dests:['120363000002@g.us','120363000003@g.us'],enabled:true}]};
  const ok=shouldClone({key:{fromMe:false,remoteJid:'120363011111@g.us'},message:{conversation:'oi'}},cfg);
  assert.deepEqual(ok.targets,['120363000010@g.us','120363000002@g.us','120363000003@g.us']);
  // hub e destinos NUNCA são origem (anti-loop)
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000010@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000002@g.us'},message:{conversation:'x'}},cfg),null);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000003@g.us'},message:{conversation:'x'}},cfg),null);
});
test('origem 2 igual à 1 ou ao hub é descartada',()=>{
  const dup={pairs:[{id:'p1',from:'120363000001@g.us',from2:'120363000001@g.us',dests:['120363000002@g.us'],enabled:true}]};
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{}},dup).length,1);
  // from2 igual ao hub é removida: mensagem do hub não é mais origem.
  const asHub={pairs:[{id:'p1',from:'120363000001@g.us',from2:'120363000010@g.us',hub:'120363000010@g.us',dests:['120363000002@g.us'],enabled:true}]};
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000010@g.us'},message:{}},asHub).length,0);
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{}},asHub).length,1);
});
test('par ligado sem nenhum destino ou origem fica desligado',()=>{
  const noDest={pairs:[{id:'p1',from:'120363000001@g.us',dests:[],enabled:true}]};
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{}},noDest).length,0);
  const noOrig={pairs:[{id:'p1',from:'',from2:'',fromAll:false,dests:['120363000002@g.us'],enabled:true}]};
  assert.equal(matchPairs({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{}},noOrig).length,0);
  assert.equal(shouldClone({key:{fromMe:false,remoteJid:'120363000001@g.us'},message:{conversation:'oi'}},noOrig),null);
});
