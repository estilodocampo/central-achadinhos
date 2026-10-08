import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('restringe importador e painel com credenciais habilitadas', {timeout:12000}, async()=>{
 const port=21000+Math.floor(Math.random()*15000);
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),
  env:{...process.env,PORT:String(port),SHOPEE_APP_ID:'demo',SHOPEE_APP_SECRET:'demo',CENTRAL_ADMIN_PASSWORD:'SenhaDeTeste-123'},
  stdio:'ignore'});
 try {
  let up=false;
  for(let i=0;i<50;i++){
   try{const r=await fetch(base+'/health');if(r.status===200){up=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(up,'servidor iniciou');
  const publicPage=await fetch(base+'/');
  assert.equal(publicPage.status,401);
  assert.match(publicPage.headers.get('www-authenticate'),/Basic/);
  const noAuth=await fetch(base+'/api/preview',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({url:'https://shopee.com.br/product/123456789/987654321'})});
  assert.equal(noAuth.status,401);
  const auth='Basic '+Buffer.from('admin:SenhaDeTeste-123').toString('base64');
  const privatePage=await fetch(base+'/',{headers:{authorization:auth}});
  assert.equal(privatePage.status,200);
  assert.match(await privatePage.text(),/Central de Achadinhos/);
 }finally{child.kill();}
});
