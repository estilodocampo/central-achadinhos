import {DisconnectReason, fetchLatestBaileysVersion, initAuthCreds, makeCacheableSignalKeyStore, makeWASocket} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";

const MAX_GROUPS_PER_SEND = 20;
const MAX_MESSAGE = 2000;

let sock = null;
let starting = null;
let connected = false;
let phoneUser = null;
let lastQr = "";
let lastQrAt = 0;
let groupsCache = [];
let groupsAt = 0;
let creds = initAuthCreds();
const keyStore = Object.create(null);

function signalKeys() {
  return {
    get: async (type, ids) => {
      const out = {};
      for (const id of ids) {
        const v = keyStore[type + "::" + id];
        if (v) out[id] = v;
      }
      return out;
    },
    set: async (data) => {
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type] || {})) {
          const v = data[type][id];
          if (v) keyStore[type + "::" + id] = v;
          else delete keyStore[type + "::" + id];
        }
      }
    },
  };
}

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

function resetCreds() {
  creds = initAuthCreds();
  for (const k of Object.keys(keyStore)) delete keyStore[k];
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
  const {version} = await fetchLatestBaileysVersion();
  const auth = {creds, keys: makeCacheableSignalKeyStore(signalKeys(), pino({level: "silent"}))};
  const s = makeWASocket({
    version,
    auth,
    logger: pino({level: "silent"}),
    printQRInTerminal: false,
    browser: ["Central Achadinhos", "Chrome", "1.3"],
    syncFullHistory: false,
  });
  creds = auth.creds;
  s.ev.on("creds.update", () => { creds = auth.creds; });
  s.ev.on("connection.update", async (u) => {
    if (u.qr) {
      lastQr = u.qr;
      lastQrAt = Date.now();
    }
    if (u.connection === "open") {
      connected = true;
      lastQr = "";
      phoneUser = s.user ? String(s.user.id || "").split(":")[0] : null;
      await refreshGroups();
    }
    if (u.connection === "close") {
      connected = false;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        resetCreds();
        lastQr = "";
      }
      const delay = code === DisconnectReason.restartRequired ? 1000 : 4000;
      setTimeout(() => { starting = null; startWhatsApp().catch(() => {}); }, delay);
    }
  });
  sock = s;
  return s;
}

export function startWhatsApp() {
  if (sock && connected) return Promise.resolve(sock);
  if (starting) return starting;
  starting = boot().catch((e) => { starting = null; throw e; });
  return starting;
}

export async function waStatus() {
  let qrDataUrl = null;
  if (!connected && lastQr && Date.now() - lastQrAt < 60000) {
    try { qrDataUrl = await QRCode.toDataURL(lastQr, {width: 240, margin: 1}); }
    catch { qrDataUrl = null; }
  }
  return {connected, user: phoneUser, qr: qrDataUrl, qrFresh: Boolean(qrDataUrl),
    groups: groupsCache.length, groupsAt, maxPerSend: MAX_GROUPS_PER_SEND};
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
    } catch (e) {
      results.push({id: jid, ok: false, error: "Falha no envio."});
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return {sent: results.filter((r) => r.ok).length, total: results.length, results};
}

export async function waLogout() {
  try { await sock?.logout?.(); } catch {}
  try { sock?.end?.(); } catch {}
  sock = null;
  starting = null;
  connected = false;
  phoneUser = null;
  lastQr = "";
  groupsCache = [];
  resetCreds();
  return {ok: true};
}
