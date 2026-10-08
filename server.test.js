import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('servidor responde e restringe URLs de prévia', {timeout:12000}, async () => {
  const port = 23000 + Math.floor(Math.random() * 15000);
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.js'], {
    // Isolar o teste público das credenciais reais injetadas durante o build no Render.
    cwd: process.cwd(), env: {...process.env, PORT:String(port), ML_ACCESS_TOKEN:'', ML_CLIENT_ID:'', ML_CLIENT_SECRET:'', SHOPEE_APP_ID:'', SHOPEE_APP_SECRET:'', CENTRAL_ADMIN_PASSWORD:''}, stdio:'ignore'
  });
  try {
    let alive = false;
    for (let i=0;i<45;i++) {
      if (child.exitCode !== null) throw Error('Servidor encerrou inesperadamente.');
      try {const r = await fetch(base+'/health');if (r.ok){alive=true;break;}} catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(alive, 'Servidor iniciou e respondeu ao health check');
    let response = await fetch(base+'/');
    assert.equal(response.status,200);
    assert.match(await response.text(),/Central de Achadinhos/);
    response = await fetch(base+'/styles.css');
    assert.equal(response.status,200);
    assert.match(await response.text(),/offer-card/);
    response = await fetch(base+'/app.js');
    assert.equal(response.status,200);
    response = await fetch(base+'/api/preview', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1:1234/private'})});
    assert.equal(response.status,422);
    assert.match((await response.json()).error,/HTTPS|link/i);
    response = await fetch(base+'/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,400);
    response = await fetch(base+'/arquivo-inexistente');
    assert.equal(response.status,404);
  } finally {child.kill();}
});
