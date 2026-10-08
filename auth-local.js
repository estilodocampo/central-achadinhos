import {randomBytes, pbkdf2Sync, timingSafeEqual} from "node:crypto";
import {getUser, insertUser, createSessionRow, getSessionRow, deleteSessionRow, listUsers} from "./db.js";
export const SESSION_COOKIE="central_session";
const THIRTY_DAYS=30*24*3600*1000;
function hashPassword(password, salt) {
 return pbkdf2Sync(String(password), salt, 100000, 32, "sha256").toString("hex");
}
export function validUsername(u) {return /^[a-z0-9._-]{3,40}$/i.test(String(u||"").trim());}
export function registerUser(username, password) {
 username=String(username||"").trim().toLowerCase();
 password=String(password||"");
 if(!validUsername(username)) throw Error("Usuário inválido.");
 if(password.length<8||password.length>200) throw Error("Senha deve ter 8-200 caracteres.");
 if(getUser(username)) throw Error("Usuário já existe.");
 const salt=randomBytes(16).toString("hex");
 const hash=hashPassword(password,salt);
 return insertUser(username,salt,hash);
}
export function verifyUser(username, password) {
 const u=getUser(username);
 if(!u) return null;
 const salt=u.salt ?? u.Salt ?? "";
 const expected=u.hash ?? u.Hash ?? "";
 if(!salt||!expected) return null;
 let ok=false;
 try {
  const got=Buffer.from(hashPassword(password,salt),"hex");
  const want=Buffer.from(expected,"hex");
  ok=got.length===want.length && timingSafeEqual(got,want);
 } catch { ok=false; }
 return ok ? {username:u.username ?? u.Username, createdAt:u.createdAt ?? u.CreatedAt} : null;
}
export function issueSession(username) {
 const token=randomBytes(32).toString("base64url");
 const expiresAt=Date.now()+THIRTY_DAYS;
 createSessionRow(token,String(username).toLowerCase(),expiresAt);
 return {token,expiresAt};
}
export function readSession(cookieHeader) {
 const token=getCookie(cookieHeader,SESSION_COOKIE);
 if(!token) return null;
 const row=getSessionRow(token);
 return row ? {username:row.username, token} : null;
}
export function sessionCookie(token, maxAgeSec=30*24*3600) {
 return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
export function clearSessionCookieLocal() {return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;}
export function getCookie(header, name) {
 for(const part of String(header||"").split(";")) {
  const [k,...pieces]=part.trim().split("=");
  if(k===name) return pieces.join("=");
 }
 return "";
}
export function userCount() {try {return listUsers().length;} catch {return 0;}}
export function destroySession(cookieHeader) {
 const token=getCookie(cookieHeader,SESSION_COOKIE);
 if(token) deleteSessionRow(token);
}
