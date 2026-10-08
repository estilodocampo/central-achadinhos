import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ML_REDIRECT_URI,hasOAuthConfig,createAuthorization,completeAuthorization,
  getAuthorizedToken,sessionStatus
} from './ml-oauth.js';
const env={ML_CLIENT_ID:'12345',ML_CLIENT_SECRET:'hidden-private-secret',CENTRAL_ADMIN_PASSWORD:'LongTestPassword#987'};
const fakeTokens={access_token:'APP_USR-TEST_ACCESS_123456',refresh_token:'TG-TEST_REFRESH_987654',expires_in:21600};
const shortTokens={...fakeTokens,expires_in:45};
function cookieValue(cookie){return cookie.split(';')[0];}
const mocked=requestResult=>async(url,opts)=>{
 assert.equal(url,'https://api.mercadolibre.com/oauth/token');
 assert.equal(opts.method,'POST');
 assert.equal(opts.redirect,'error');
 const form=new URLSearchParams(opts.body);
 assert.equal(form.get('client_id'),env.ML_CLIENT_ID);
 assert.equal(form.get('client_secret'),env.ML_CLIENT_SECRET);
 return {ok:true,json:async()=>requestResult};
};
test('requer configurações completas e cria redirect URI idêntica',()=>{
 assert.equal(hasOAuthConfig(env),true);
 assert.equal(hasOAuthConfig({...env,ML_CLIENT_SECRET:''}),false);
 assert.equal(ML_REDIRECT_URI,'https://central-achadinhos.onrender.com/api/ml/callback');
 const first=createAuthorization(env),second=createAuthorization(env);
 const u=new URL(first.url);
 assert.equal(u.host,'auth.mercadolivre.com.br');
 assert.equal(u.searchParams.get('redirect_uri'),ML_REDIRECT_URI);
 assert.ok(u.searchParams.get('state'));
 assert.notEqual(first.url,second.url);
 assert.match(first.cookie,/Secure; HttpOnly; SameSite=Lax/);
 assert.ok(!first.cookie.includes(env.ML_CLIENT_SECRET));
});
test('state inválido recusa troca antes de acessar API',async()=>{
 const begin=createAuthorization(env);
 let called=false;
 await assert.rejects(()=>completeAuthorization(
  {state:'invalid',code:'ML-CODE-123456789'},cookieValue(begin.cookie),env,async()=>{called=true;}
 ),/código de segurança/);
 assert.equal(called,false);
});
test('callback autorizado grava token criptografado com HttpOnly',async()=>{
 const begin=createAuthorization(env),url=new URL(begin.url);
 const state=url.searchParams.get('state');
 const done=await completeAuthorization(
   {state,code:'ML-CODE-123456789'},cookieValue(begin.cookie),env,mocked(fakeTokens));
 assert.match(done.cookie,/ml_oauth_session=/);
 assert.match(done.cookie,/Secure; HttpOnly; SameSite=Lax/);
 assert.ok(!done.cookie.includes(fakeTokens.access_token));
 assert.ok(!done.cookie.includes(fakeTokens.refresh_token));
 assert.equal(sessionStatus(cookieValue(done.cookie),env).connected,true);
 const result=await getAuthorizedToken(cookieValue(done.cookie),env);
 assert.equal(result.token,fakeTokens.access_token);
 assert.equal(result.status,'ok');
});
test('renova token apenas quando o acesso estiver perto de expirar',async()=>{
 const begin=createAuthorization(env),state=new URL(begin.url).searchParams.get('state');
 const done=await completeAuthorization({state,code:'ML-CODE-123456789'},
   cookieValue(begin.cookie),env,mocked(shortTokens));
 let refreshed=false;
 const request=async(url,options)=>{
  const data=new URLSearchParams(options.body);
  assert.equal(data.get('grant_type'),'refresh_token');
  assert.equal(data.get('refresh_token'),shortTokens.refresh_token);
  refreshed=true;
  return {ok:true,json:async()=>({access_token:'APP_USR-NEW_ACCESS_654321',refresh_token:'TG-NEW_REFRESH_654321',expires_in:21600})};
 };
 const result=await getAuthorizedToken(cookieValue(done.cookie),env,request);
 assert.equal(refreshed,true);
 assert.equal(result.status,'refreshed');
 assert.equal(result.token,'APP_USR-NEW_ACCESS_654321');
 assert.ok(!result.cookie.includes('TG-NEW_REFRESH'));
 const next=await getAuthorizedToken(cookieValue(result.cookie),env);
 assert.equal(next.status,'ok');
});
test('PKCE opcional adiciona S256 e code_verifier correspondente',async()=>{
 const envPKCE={...env,ML_OAUTH_PKCE:'true'};
 const begin=createAuthorization(envPKCE),u=new URL(begin.url);
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 let withVerifier=false;
 await completeAuthorization({state:u.searchParams.get('state'),code:'ML-CODE-123456789'},
   cookieValue(begin.cookie),envPKCE,async(_url,options)=>{
     withVerifier=Boolean(new URLSearchParams(options.body).get('code_verifier'));
     return {ok:true,json:async()=>fakeTokens};
   });
 assert.equal(withVerifier,true);
});
test('sessão copiada e modificada não pode ser descriptografada',async()=>{
 const begin=createAuthorization(env),state=new URL(begin.url).searchParams.get('state');
 const done=await completeAuthorization({state,code:'ML-CODE-123456789'},
   cookieValue(begin.cookie),env,mocked(fakeTokens));
 const tampered=cookieValue(done.cookie).replace(/.$/,'0');
 const status=sessionStatus(tampered,env);
 assert.equal(status.connected,false);
});
