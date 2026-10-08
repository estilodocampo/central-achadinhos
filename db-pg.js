let PoolRef=null;
let pool=null;
let ready=null;
function connString(){return String(process.env.DATABASE_URL||"").trim();}
export function pgConfigured(){return Boolean(connString());}
async function pgPool(){
  if(pool)return pool;
  if(!PoolRef){
    const mod=await import("pg");
    PoolRef=mod.Pool ?? mod.default?.Pool;
  }
  const cs=connString();
  const needsSSL=/render\.com|neon\.tech|supabase\.co|amazonaws\.com/i.test(cs) || process.env.PGSSL==="1";
  pool=new PoolRef({connectionString:cs,max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:8000,
    ssl:needsSSL?{rejectUnauthorized:false}:undefined});
  pool.on("error",()=>{});
  return pool;
}
const SCHEMA=`
 CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT 'public',
  title TEXT NOT NULL, platform TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  price DOUBLE PRECISION NOT NULL, oldprice DOUBLE PRECISION,
  coupon TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'rascunho', createdat TEXT NOT NULL, updatedat TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_offers_owner ON offers(owner, updatedat);
 CREATE TABLE IF NOT EXISTS kv_settings (owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner, key));
 CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, createdat TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, expiresat BIGINT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);
`;
export async function pgReady(){
  if(ready)return ready;
  ready=(async()=>{
    const p=await pgPool();
    await p.query(SCHEMA);
    return p;
  })();
  try{await ready;}
  catch(e){ready=null;throw e;}
  return ready;
}
function rowToOffer(r){
  if(!r)return null;
  return {id:String(r.id),title:String(r.title),platform:String(r.platform),category:String(r.category||""),
    price:Number(r.price),oldPrice:r.oldprice===null||r.oldprice===undefined?null:Number(r.oldprice),
    coupon:String(r.coupon||""),url:String(r.url),image:String(r.image||""),
    status:String(r.status||"rascunho"),createdAt:String(r.createdat),updatedAt:String(r.updatedat)};
}
function cleanOffer(offer){
  const o={id:String(offer.id),title:String(offer.title||"").slice(0,180),platform:String(offer.platform||""),
    category:String(offer.category||"").slice(0,60),price:Number(offer.price),
    oldPrice:offer.oldPrice===null||offer.oldPrice===undefined?null:Number(offer.oldPrice),
    coupon:String(offer.coupon||"").slice(0,70),url:String(offer.url||""),image:String(offer.image||""),
    status:String(offer.status||"rascunho"),createdAt:String(offer.createdAt||new Date().toISOString()),
    updatedAt:String(offer.updatedAt||new Date().toISOString())};
  if(!o.id||!o.title||!Number.isFinite(o.price)||o.price<=0||!o.url)throw Error("Oferta inválida.");
  return o;
}
export async function pgListOffers(owner="public"){
  const p=await pgReady();
  const r=await p.query("SELECT * FROM offers WHERE owner=$1 ORDER BY updatedat DESC LIMIT 3000",[owner]);
  return r.rows.map(rowToOffer);
}
export async function pgGetOffer(id,owner="public"){
  const p=await pgReady();
  const r=await p.query("SELECT * FROM offers WHERE id=$1 AND owner=$2",[String(id),owner]);
  return rowToOffer(r.rows[0]||null);
}
export async function pgUpsertOffer(offer,owner="public"){
  const o=cleanOffer(offer);
  const p=await pgReady();
  await p.query(`INSERT INTO offers (id,owner,title,platform,category,price,oldprice,coupon,url,image,status,createdat,updatedat)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
   ON CONFLICT(id) DO UPDATE SET owner=EXCLUDED.owner,title=EXCLUDED.title,platform=EXCLUDED.platform,
   category=EXCLUDED.category,price=EXCLUDED.price,oldprice=EXCLUDED.oldprice,coupon=EXCLUDED.coupon,
   url=EXCLUDED.url,image=EXCLUDED.image,status=EXCLUDED.status,createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat`,
   [o.id,owner,o.title,o.platform,o.category,o.price,o.oldPrice,o.coupon,o.url,o.image,o.status,o.createdAt,o.updatedAt]);
  return o;
}
export async function pgDeleteOffer(id,owner="public"){
  const p=await pgReady();
  const r=await p.query("DELETE FROM offers WHERE id=$1 AND owner=$2",[String(id),owner]);
  return r.rowCount>0;
}
export async function pgCountOffers(owner="public"){
  const p=await pgReady();
  const r=await p.query("SELECT COUNT(*)::int AS n FROM offers WHERE owner=$1",[owner]);
  return r.rows[0]?.n ?? 0;
}
export async function pgGetSettings(owner="public"){
  const p=await pgReady();
  const r=await p.query("SELECT key,value FROM kv_settings WHERE owner=$1",[owner]);
  const out={};
  for(const row of r.rows)out[row.key]=row.value;
  return out;
}
export async function pgSaveSettings(obj,owner="public"){
  const p=await pgReady();
  const entries=Object.entries(obj||{}).slice(0,50).map(([k,v])=>[String(k).slice(0,80),String(v??"").slice(0,2000)]);
  for(const [k,v] of entries)
    await p.query("INSERT INTO kv_settings (owner,key,value) VALUES ($1,$2,$3) ON CONFLICT(owner,key) DO UPDATE SET value=EXCLUDED.value",[owner,k,v]);
  return pgGetSettings(owner);
}
export async function pgListUsers(){
  const p=await pgReady();
  const r=await p.query("SELECT username, createdat AS \"createdAt\" FROM users ORDER BY createdat");
  return r.rows;
}
export async function pgGetUser(username){
  const p=await pgReady();
  const r=await p.query("SELECT username, salt, hash, createdat AS \"createdAt\" FROM users WHERE lower(username)=lower($1) LIMIT 1",[String(username||"")]);
  const u=r.rows[0];
  if(!u)return null;
  return {username:u.username,salt:u.salt,hash:u.hash,createdAt:u.createdAt};
}
export async function pgInsertUser(username,salt,hash){
  username=String(username||"").trim().toLowerCase().slice(0,40);
  if(!/^[a-z0-9._-]{3,40}$/.test(username))throw Error("Usuário inválido (3-40 letras/números).");
  const createdAt=new Date().toISOString();
  const p=await pgReady();
  try{
    await p.query("INSERT INTO users (username,salt,hash,createdat) VALUES ($1,$2,$3,$4)",[username,salt,hash,createdAt]);
  }catch(e){
    if(String(e?.code)==="23505")throw Error("Usuário já existe.");
    throw e;
  }
  return {username,createdAt};
}
export async function pgCreateSession(token,username,expiresAt){
  const p=await pgReady();
  await p.query("INSERT INTO sessions (token,username,expiresat) VALUES ($1,$2,$3)",[String(token),String(username).toLowerCase(),Number(expiresAt)]);
}
export async function pgGetSession(token){
  const p=await pgReady();
  const r=await p.query("SELECT token,username,expiresat AS \"expiresAt\" FROM sessions WHERE token=$1",[String(token||"")]);
  const row=r.rows[0];
  if(!row)return null;
  if(Number(row.expiresAt)<Date.now()){await pgDeleteSession(row.token).catch(()=>{});return null;}
  return row;
}
export async function pgDeleteSession(token){
  const p=await pgReady();
  await p.query("DELETE FROM sessions WHERE token=$1",[String(token||"")]);
}
export async function pgPruneSessions(){
  const p=await pgReady();
  await p.query("DELETE FROM sessions WHERE expiresat<$1",[Date.now()]);
}
export async function pgClose(){try{await pool?.end?.();}catch{}pool=null;ready=null;}
