import {
  createHash, createHmac, createCipheriv, createDecipheriv,
  randomBytes, timingSafeEqual
} from 'node:crypto';

export const ML_REDIRECT_URI='https://central-achadinhos.onrender.com/api/ml/callback';
export const DEFAULT_ML_REDIRECT_URI=ML_REDIRECT_URI;
export function resolveRedirectUri(reqLike={}, env=process.env){
  const configured=String(env.ML_REDIRECT_URI||'').trim();
  if(/^https:\/\/[A-Za-z0-9.-]+(\/.*)?$/.test(configured)) return configured;
  try{
    const headers=reqLike?.headers||{};
    const host=String(headers.host||headers['x-forwarded-host']||'').split(',')[0].trim();
    if(!host) return ML_REDIRECT_URI;
    if(/^localhost(:\d+)?$/i.test(host)||/^127\.0\.0\.1(:\d+)?$/.test(host)){
      return `http://${host}/api/ml/callback`;
    }
    const proto=String(headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase()==='http'?'http':'https';
    if(!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return ML_REDIRECT_URI;
    return `${proto}://${host}/api/ml/callback`;
  }catch{return ML_REDIRECT_URI;}
}
const AUTH_URL='https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL='https://api.mercadolibre.com/oauth/token';
const SESSION_COOKIE='ml_oauth_session';
const STATE_COOKIE='ml_oauth_state';
const SIX_MONTHS=15552000;

export function hasOAuthConfig(env=process.env){
  return Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET && env.CENTRAL_ADMIN_PASSWORD);
}
const secretKey=env=>createHash('sha256').update(
  'central-achadinhos:mercadolivre:session:v1:'+env.CENTRAL_ADMIN_PASSWORD+':'+env.ML_CLIENT_SECRET
).digest();

function seal(value,env){
  if(!hasOAuthConfig(env))throw Error('Configuração OAuth incompleta');
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',secretKey(env),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
function unseal(value,env){
  if(!value||!hasOAuthConfig(env))return null;
  try{
    const [iv,tag,body,...rest]=value.split('.');
    if(rest.length||!iv||!tag||!body)return null;
    const decipher=createDecipheriv('aes-256-gcm',secretKey(env),Buffer.from(iv,'base64url'));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    const json=Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8');
    return JSON.parse(json);
  }catch{return null;}
}
export function getCookie(header,name){
  for(const part of String(header||'').split(';')){
    const [key,...pieces]=part.trim().split('=');
    if(key===name)return pieces.join('=');
  }
  return '';
}
function cookie(name,value,maxAge,path='/'){
  return name+'='+value+'; Path='+path+'; Secure; HttpOnly; SameSite=Lax; Max-Age='+maxAge;
}
function safeEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}
export function createAuthorization(env=process.env, redirectUriOverride=''){
  if(!hasOAuthConfig(env))throw Error('ML_CLIENT_ID, ML_CLIENT_SECRET e senha administrativa são obrigatórios');
  const redirectUri=String(redirectUriOverride||env.ML_REDIRECT_URI||ML_REDIRECT_URI).trim()||ML_REDIRECT_URI;
  const state=randomBytes(32).toString('base64url');
  const pending={state,issuedAt:Date.now(),redirectUri};
  const url=new URL(AUTH_URL);
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',env.ML_CLIENT_ID);
  url.searchParams.set('redirect_uri',redirectUri);
  url.searchParams.set('state',state);
  if(env.ML_OAUTH_PKCE==='true'){
    const verifier=randomBytes(48).toString('base64url');
    pending.verifier=verifier;
    url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method','S256');
  }
  return {url:url.toString(),cookie:cookie(STATE_COOKIE,seal(pending,env),600,'/api/ml/callback')};
}
export const clearStateCookie=()=>cookie(STATE_COOKIE,'',0,'/api/ml/callback');
export const clearSessionCookie=()=>cookie(SESSION_COOKIE,'',0);

function readSession(cookieHeader,env=process.env){
  const s=unseal(getCookie(cookieHeader,SESSION_COOKIE),env);
  if(!s||typeof s.accessToken!=='string'||typeof s.refreshToken!=='string'
    ||!Number.isSafeInteger(s.expiresAt)||s.issuedAt+SIX_MONTHS*1000<Date.now())return null;
  return s;
}
export function sessionStatus(cookieHeader,env=process.env){
  const session=readSession(cookieHeader,env);
  return {configured:hasOAuthConfig(env),connected:Boolean(session),
    expiresSoon:session?session.expiresAt<=Date.now()+120000:false,
    storage:'encrypted_http_only_browser_cookie'};
}
function asSession(json,now=Date.now()){
  if(!json||typeof json.access_token!=='string'||json.access_token.length<12 ||
      typeof json.refresh_token!=='string'||json.refresh_token.length<12 ||
      !Number.isFinite(Number(json.expires_in))||Number(json.expires_in)<=0)return null;
  return {accessToken:json.access_token,refreshToken:json.refresh_token,
    expiresAt:now+Number(json.expires_in)*1000,issuedAt:now};
}
async function callToken(form,request=fetch){
  const response=await request(TOKEN_URL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},
    body:new URLSearchParams(form).toString()
  });
  if(!response.ok){
    // Nunca registrar response body, authorization code, tokens ou credenciais.
    const status=Number(response.status);
    const category=status===400?'bad_request':status===401?'unauthorized':
      status===403?'forbidden':status===429?'rate_limited':
      status>=500?'upstream_error':'other';
    throw Error('Mercado Livre recusou a autorização (HTTP '+status+', categoria='+category+').');
  }
  const result=asSession(await response.json());
  if(!result)throw Error('Resposta de tokens inválida ou incompleta.');
  return result;
}
export async function completeAuthorization(query,cookieHeader,env=process.env,request=fetch){
  const pending=unseal(getCookie(cookieHeader,STATE_COOKIE),env);
  if(!pending||typeof pending.state!=='string'||!Number.isSafeInteger(pending.issuedAt)
    ||Date.now()-pending.issuedAt>600000 || pending.issuedAt>Date.now()+30000
    ||!safeEqual(query.state,pending.state))throw Error('Solicitação expirou ou o código de segurança não confere. Reinicie a conexão.');
  if(query.error)throw Error('Autorização não foi concluída no Mercado Livre.');
  if(typeof query.code!=='string'||query.code.length<8||query.code.length>1500)
    throw Error('Código de autorização ausente ou inválido.');
  const form={grant_type:'authorization_code',client_id:env.ML_CLIENT_ID,
    client_secret:env.ML_CLIENT_SECRET,code:query.code,redirect_uri:pending.redirectUri||env.ML_REDIRECT_URI||ML_REDIRECT_URI};
  if(pending.verifier)form.code_verifier=pending.verifier;
  const session=await callToken(form,request);
  return {cookie:cookie(SESSION_COOKIE,seal(session,env),SIX_MONTHS),
    clearState:clearStateCookie()};
}
export async function getAuthorizedToken(cookieHeader,env=process.env,request=fetch){
  const current=readSession(cookieHeader,env);
  if(!current)return {token:null,cookie:null,status:'disconnected'};
  if(current.expiresAt>Date.now()+120000)return {token:current.accessToken,cookie:null,status:'ok'};
  try{
    const next=await callToken({grant_type:'refresh_token',client_id:env.ML_CLIENT_ID,
      client_secret:env.ML_CLIENT_SECRET,refresh_token:current.refreshToken},request);
    // Refresh token é de uso único; o novo par substitui o anterior no cookie criptografado.
    return {token:next.accessToken,cookie:cookie(SESSION_COOKIE,seal(next,env),SIX_MONTHS),status:'refreshed'};
  }catch{return {token:null,cookie:null,status:'refresh_failed'};}
}
