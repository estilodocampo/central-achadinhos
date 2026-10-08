// wa-gateway.js — WhatsApp como aparelho vinculado (envio automático).
// Sessão de login persiste via wa-store (Postgres no Render, arquivos no PC).
// Ofertas, mensagens e grupos NUNCA são salvos.
import {DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, makeWASocket} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import {loadAuthState, clearAuthState, storeMode} from "./wa-store.js";

const MAX_GROUPS_PER_SEND = 20;
const MAX_MESSAGE = 2000;
const TERMINAL_CODES = new Set([401, 403, 411, 500]);
const BACKOFF = [5000, 15000, 30000, 60000, 300000];

let sock = null;
let connected = false;
let connecting = false;
let connectingSince = 0;
let retryTimer = null;
let retries = 0;
let needsRepair = false;
let lastError = "";
let lastErrorAt = 0;
let lastQr = "";
let lastQrAt = 0;
let pairCode = null;
let pairCodeAt = 0;
let phoneUser = null;
let groupsCache = [];
let groupsAt = 0;
let waVersionUsed = "";
const bootAt = Date.now();

export function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us") && jid.length > 10 && !jid.includes(" ");
}

export function normalizeGroupIds(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const clean = [];
  for (const raw of list) {
    const jid = String(raw || "").trim();
    if (isGroupJid(jid) && !clean.includes(jid)) clean.push(jid);
  }
  return clean.slice(0, MAX_GROUPS_PER_SEND);
}

export function validateSend(message, groupIds) {
  const text = String(message || "").trim();
  if (!text) return {ok: false, error: "Mensagem vazia."};
  if (text.length > MAX_MESSAGE) return {ok: false, error: "Mensagem excede 2000 caracteres."};
  const groups = normalizeGroupIds(groupIds);
  if (!groups.length) return {ok: false, error: "Selecione ao menos 1 grupo."};
  return {ok: true, message: text, groups};
}

// Puro/testável: decide o que fazer ao fechar a conexão.
export function classifyClose(code) {
  if (TERMINAL_CODES.has(code)) return "repair";
  return "retry";
}

export function backoffFor(attempt) {
  return BACKOFF[Math.min(Math.max(0, attempt), BACKOFF.length - 1)];
}

function errCode(err) {
  try {
    if (!err) return 0;
    if (err.output?.statusCode) return Number(err.output.statusCode) || 0;
    if (err.statusCode) return Number(err.statusCode) || 0;
    if (err.code && /^\d+$/.test(String(err.code))) return Number(err.code);
    if (err.data?.statusCode) return Number(err.data.statusCode) || 0;
  } catch {}
  return 0;
}

function scheduleRetry() {
  if (retryTimer) return;
  const wait = backoffFor(retries);
  retryTimer = setTimeout(() => { retryTimer = null; startWhatsApp().catch(() => {}); }, wait);
  if (retryTimer.unref) retryTimer.unref();
}

async function refreshGroups() {
  if (!sock || !connected) return groupsCache;
  try {
    const map = await sock.groupFetchAllParticipating();
    groupsCache = Object.values(map || {})
      .map((g) => ({id: String(g.id), name: String(g.subject || "Grupo"), size: Array.isArray(g.participants) ? g.participants.length : 0}))
      .filter((g) => isGroupJid(g.id))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    groupsAt = Date.now();
  } catch {}
  return groupsCache;
}

async function boot() {
  if (connecting && Date.now() - connectingSince < 90000 && sock) return sock;
  if (connecting && Date.now() - connectingSince >= 90000) {
    try { sock?.ws?.close?.(); } catch {}
    sock = null;
    connecting = false;
  }
  if (connecting || sock) return sock;
  connecting = true;
  connectingSince = Date.now();
  try {
    const {state, saveCreds} = await loadAuthState();
    let version;
    try {
      const v = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, rej) => setTimeout(() => rej(Error("timeout versão")), 10000)),
      ]);
      version = v.version;
      waVersionUsed = Array.isArray(version) ? version.join(".") : String(version || "");
    } catch { version = undefined; }
    const s = makeWASocket({
      auth: {creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({level: "silent"}))},
      version,
      logger: pino({level: "silent"}),
      printQRInTerminal: false,
      browser: ["Central Achadinhos", "Chrome", "1.3"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    sock = s;
    s.ev.on("creds.update", saveCreds);
    s.ev.on("connection.update", async (u) => {
      if (u.qr) {
        try { lastQr = await QRCode.toDataURL(u.qr, {width: 240, margin: 1}); lastQrAt = Date.now(); }
        catch { lastQr = ""; }
      }
      if (u.connection === "open") {
        connected = true;
        connecting = false;
        lastQr = "";
        pairCode = null;
        pairCodeAt = 0;
        lastError = "";
        lastErrorAt = 0;
        retries = 0;
        needsRepair = false;
        phoneUser = s.user ? String(s.user.id || "").split(":")[0] : null;
        await refreshGroups();
      } else if (u.connection === "close") {
        connected = false;
        const code = errCode(u.lastDisconnect?.error);
        retries++;
        lastErrorAt = Date.now();
        sock = null;
        connecting = false;
        if (classifyClose(code) === "repair") {
          needsRepair = true;
          lastError = "Sessão inválida (código " + code + "). Desconecte e pareie de novo.";
        } else {
          lastError = "Desconectado (código " + (code || "?") + ") — reconectando (tentativa " + retries + ")";
          scheduleRetry();
        }
      }
    });
    return s;
  } catch {
    connecting = false;
    scheduleRetry();
    throw Error("boot");
  }
}

export function startWhatsApp() {
  if (sock && connected) return Promise.resolve(sock);
  return boot().catch(() => sock);
}

export async function waStatus() {
  const qrFresh = Boolean(!connected && !needsRepair && lastQr && Date.now() - lastQrAt < 60000);
  return {connected, user: phoneUser, qr: qrFresh ? lastQr : null, qrFresh,
    needsRepair, lastError: lastError || null, retries,
    pairCode, pairAge: pairCode ? Math.round((Date.now() - pairCodeAt) / 1000) : null,
    groups: groupsCache.length, groupsAt,
    uptimeSec: Math.round((Date.now() - bootAt) / 1000),
    session: storeMode(), maxPerSend: MAX_GROUPS_PER_SEND};
}

export async function waGroups(force = false) {
  if (!connected) return [];
  if (force || Date.now() - groupsAt > 60000) await refreshGroups();
  return groupsCache;
}

export async function waSend(message, groupIds, imageUrl = "") {
  const v = validateSend(message, groupIds);
  if (!v.ok) throw Error(v.error);
  if (!sock || !connected) throw Error("WhatsApp desconectado. Escaneie o QR.");
  let image = null;
  const img = String(imageUrl || "").trim();
  if (img) {
    try {
      const r = await fetch(img, {signal: AbortSignal.timeout(10000), headers: {"user-agent": "Mozilla/5.0"}});
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.startsWith("image/")) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 0 && buf.length < 8 * 1024 * 1024) image = buf;
      }
    } catch {}
  }
  const results = [];
  for (const jid of v.groups) {
    try {
      if (image) await sock.sendMessage(jid, {image, caption: v.message});
      else await sock.sendMessage(jid, {text: v.message});
      results.push({id: jid, ok: true});
    } catch {
      results.push({id: jid, ok: false, error: "Falha no envio."});
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return {sent: results.filter((r) => r.ok).length, total: results.length, results};
}

export async function waPairCode(phone) {
  const clean = String(phone || "").replace(/\D/g, "");
  if (clean.length < 10 || clean.length > 15) throw Error("Informe o número com DDI+DDD, só dígitos (ex: 5511999999999).");
  if (!sock || typeof sock.requestPairingCode !== "function") throw Error("Sessão não iniciada. Aguarde o QR aparecer e tente de novo.");
  const code = await sock.requestPairingCode(clean);
  if (!code) throw Error("O WhatsApp não devolveu o código. Tente de novo.");
  pairCode = String(code).replace("-", "");
  pairCodeAt = Date.now();
  return pairCode.slice(0, 4) + "-" + pairCode.slice(4);
}

export async function waLogout() {
  try { await sock?.logout?.(); } catch {}
  try { sock?.end?.(); } catch {}
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  sock = null;
  connected = false;
  connecting = false;
  phoneUser = null;
  lastQr = "";
  pairCode = null;
  groupsCache = [];
  lastError = "";
  retries = 0;
  needsRepair = false;
  await clearAuthState();
  setTimeout(() => { startWhatsApp().catch(() => {}); }, 1500);
  return {ok: true};
}
