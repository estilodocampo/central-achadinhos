import {mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
const dir = fileURLToPath(import.meta.url);
let DatabaseSync=null;
try {
 const sqlite=await import("node:sqlite");
 DatabaseSync=sqlite.DatabaseSync;
} catch { DatabaseSync=null; }
const DATA_DIR=process.env.DATA_DIR || resolve(dirname(dir), "data");
const DB_PATH=process.env.SQLITE_PATH || resolve(DATA_DIR, "central.db");
const hasDatabaseUrl=()=>Boolean(String(process.env.DATABASE_URL||"").trim());
let forcedMemory=false;
let db=null;
let memory={offers:new Map(),settings:new Map(),users:new Map(),sessions:new Map()};
let pgInitFailed=false;
function connect(path=DB_PATH) {
 if(!DatabaseSync) return null;
 try {
  mkdirSync(dirname(path), {recursive:true});
  const handle=new DatabaseSync(path);
  handle.exec(`
   CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT 'public',
    title TEXT NOT NULL, platform TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL, oldPrice REAL, coupon TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'rascunho',
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_offers_owner ON offers(owner, updatedAt);
   CREATE TABLE IF NOT EXISTS kv_settings (owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner, key));
   CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, createdAt TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, expiresAt INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);
  `);
  return handle;
 } catch { return null; }
}
if(process.env.NODE_ENV!=="test")db=connect();
export function dbMode(){
  if(forcedMemory)return "memory";
  if(hasDatabaseUrl())return pgInitFailed?"postgres_unavailable:fallback":"postgres";
  return db ? "sqlite:"+DB_PATH : "memory";
}
export function isSqlite(){return Boolean(db)&&!hasDatabaseUrl()&&!forcedMemory;}
export function isPostgres(){return hasDatabaseUrl()&&!forcedMemory&&!pgInitFailed;}
async function pg(){
  if(forcedMemory||pgInitFailed)return null;
  if(!hasDatabaseUrl())return null;
  try{
    const mod=await import("./db-pg.js");
    await mod.pgReady();
    return mod;
  }catch(e){
    pgInitFailed=true;
    console.warn("[DB] Postgres indisponível, usando fallback local. Detalhe oculto.");
    return null;
  }
}
function rowToOffer(r) {
 if(!r) return null;
 return {id:String(r.id),title:String(r.title),platform:String(r.platform),category:String(r.category||""),
  price:Number(r.price),oldPrice:r.oldPrice===null||r.oldPrice===undefined?null:Number(r.oldPrice),
  coupon:String(r.coupon||""),url:String(r.url),image:String(r.image||""),
  status:String(r.status||"rascunho"),createdAt:String(r.createdAt),updatedAt:String(r.updatedAt)};
}
function cleanOffer(offer){
  const o={id:String(offer.id),title:String(offer.title||"").slice(0,180),platform:String(offer.platform||""),
   category:String(offer.category||"").slice(0,60),price:Number(offer.price),
   oldPrice:offer.oldPrice===null||offer.oldPrice===undefined?null:Number(offer.oldPrice),
   coupon:String(offer.coupon||"").slice(0,70),url:String(offer.url||""),image:String(offer.image||""),
   status:String(offer.status||"rascunho"),createdAt:String(offer.createdAt||new Date().toISOString()),
   updatedAt:String(offer.updatedAt||new Date().toISOString())};
  if(!o.id||!o.title||!Number.isFinite(o.price)||o.price<=0||!o.url) throw Error("Oferta inválida.");
  return o;
}
export async function listOffers(owner="public") {
 const m=await pg();if(m)return m.pgListOffers(owner);
 if(db) return db.prepare("SELECT * FROM offers WHERE owner=? ORDER BY updatedAt DESC LIMIT 3000").all(owner).map(rowToOffer);
 return [...memory.offers.values()].filter(o=>o._owner===owner).map(({_owner,...o})=>o).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,3000);
}
export async function getOffer(id, owner="public") {
 const m=await pg();if(m)return m.pgGetOffer(id,owner);
 if(db) return rowToOffer(db.prepare("SELECT * FROM offers WHERE id=? AND owner=?").get(String(id),owner));
 const o=memory.offers.get(String(id)+"::"+owner);
 if(!o) return null;
 const {_owner,...rest}=o;
 return rest;
}
export async function upsertOffer(offer, owner="public") {
 const m=await pg();if(m)return m.pgUpsertOffer(offer,owner);
 const o=cleanOffer(offer);
 if(db) {
  db.prepare(`INSERT INTO offers (id,owner,title,platform,category,price,oldPrice,coupon,url,image,status,createdAt,updatedAt)
   VALUES (@id,@owner,@title,@platform,@category,@price,@oldPrice,@coupon,@url,@image,@status,@createdAt,@updatedAt)
   ON CONFLICT(id) DO UPDATE SET owner=@owner,title=@title,platform=@platform,category=@category,price=@price,
   oldPrice=@oldPrice,coupon=@coupon,url=@url,image=@image,status=@status,createdAt=@createdAt,updatedAt=@updatedAt`).run({...o,owner,oldPrice:o.oldPrice});
  return o;
 }
 memory.offers.set(o.id+"::"+owner,{...o,_owner:owner});
 return o;
}
export async function deleteOffer(id, owner="public") {
 const m=await pg();if(m)return m.pgDeleteOffer(id,owner);
 if(db) {const r=db.prepare("DELETE FROM offers WHERE id=? AND owner=?").run(String(id),owner);return r.changes>0;}
 return memory.offers.delete(String(id)+"::"+owner);
}
export async function countOffers(owner="public") {
 const m=await pg();if(m)return m.pgCountOffers(owner);
 if(db) return db.prepare("SELECT COUNT(*) AS n FROM offers WHERE owner=?").get(owner)?.n ?? 0;
 let n=0;
 for(const v of memory.offers.values()) if(v._owner===owner) n++;
 return n;
}
export async function getSettings(owner="public") {
 const m=await pg();if(m)return m.pgGetSettings(owner);
 if(db) {
  const rows=db.prepare("SELECT key,value FROM kv_settings WHERE owner=?").all(owner);
  const out={};
  for(const r of rows) out[r.key]=r.value;
  return out;
 }
 const out={};
 for(const [k,v] of memory.settings) {const idx=k.indexOf("::");const o=k.slice(0,idx),key=k.slice(idx+2);if(o===owner) out[key]=v;}
 return out;
}
export async function saveSettings(obj, owner="public") {
 const m=await pg();if(m)return m.pgSaveSettings(obj,owner);
 const entries=Object.entries(obj||{}).slice(0,50).map(([k,v])=>[String(k).slice(0,80),String(v??"").slice(0,2000)]);
 if(db) {
  const stmt=db.prepare("INSERT INTO kv_settings (owner,key,value) VALUES (?,?,?) ON CONFLICT(owner,key) DO UPDATE SET value=excluded.value");
  for(const [k,v] of entries) stmt.run(owner,k,v);
 } else for(const [k,v] of entries) memory.settings.set(owner+"::"+k,v);
 return getSettings(owner);
}
export async function listUsers() {
 const m=await pg();if(m)return m.pgListUsers();
 if(db) return db.prepare("SELECT username,createdAt FROM users ORDER BY createdAt").all();
 return [...memory.users.values()].map(u=>({username:u.username,createdAt:u.createdAt}));
}
export async function getUser(username) {
 const m=await pg();if(m)return m.pgGetUser(username);
 username=String(username||"").toLowerCase();
 if(db) return db.prepare("SELECT * FROM users").all().find(u=>u.username.toLowerCase()===username) || null;
 for(const u of memory.users.values()) if(u.username.toLowerCase()===username) return u;
 return null;
}
export async function insertUser(username, salt, hash) {
 const m=await pg();if(m)return m.pgInsertUser(username,salt,hash);
 username=String(username||"").trim().toLowerCase().slice(0,40);
 if(!/^[a-z0-9._-]{3,40}$/.test(username)) throw Error("Usuário inválido (3-40 letras/números).");
 const createdAt=new Date().toISOString();
 if(db) {
  try{db.prepare("INSERT INTO users (username,salt,hash,createdAt) VALUES (?,?,?,?)").run(username,salt,hash,createdAt);}
  catch{throw Error("Usuário já existe.");}
  return {username,createdAt};
 }
 if(memory.users.has(username)) throw Error("Usuário já existe.");
 memory.users.set(username,{username,salt,hash,createdAt});
 return {username,createdAt};
}
export async function createSessionRow(token, username, expiresAt) {
 const m=await pg();if(m)return m.pgCreateSession(token,username,expiresAt);
 if(db) db.prepare("INSERT INTO sessions (token,username,expiresAt) VALUES (?,?,?)").run(token,username,expiresAt);
 else memory.sessions.set(token,{token,username,expiresAt});
}
export async function getSessionRow(token) {
 const m=await pg();if(m)return m.pgGetSession(token);
 let row=null;
 if(db) row=db.prepare("SELECT * FROM sessions WHERE token=?").get(String(token||""));
 else row=memory.sessions.get(String(token||"")) || null;
 if(!row) return null;
 if(Number(row.expiresAt)<Date.now()) {await deleteSessionRow(row.token);return null;}
 return row;
}
export async function deleteSessionRow(token) {
 const m=await pg();if(m)return m.pgDeleteSession(token);
 if(db) db.prepare("DELETE FROM sessions WHERE token=?").run(String(token||""));
 else memory.sessions.delete(String(token||""));
}
export async function pruneSessions() {
 try {
  const m=await pg();if(m)return m.pgPruneSessions();
  if(db) db.prepare("DELETE FROM sessions WHERE expiresAt<?").run(Date.now());
  else for(const [k,v] of memory.sessions) if(v.expiresAt<Date.now()) memory.sessions.delete(k);
 } catch {}
}
setInterval(()=>{pruneSessions().catch(()=>{});}, 3600000).unref?.();
export function _resetMemory() {memory={offers:new Map(),settings:new Map(),users:new Map(),sessions:new Map()};}
export function __forceMemory(){forcedMemory=true;pgInitFailed=false;try{db?.close?.();}catch{}db=null;_resetMemory();return true;}
