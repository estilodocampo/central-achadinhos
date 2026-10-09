// wa-gateway.js — WhatsApp como aparelho vinculado (envio automático).
// Sessão de login persiste via wa-store (Postgres no Render, arquivos no PC).
// Ofertas, mensagens e grupos NUNCA são salvos.
import {DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, makeWASocket} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import {loadAuthState, clearAuthState, storeMode, getCfg, setCfg} from "./wa-store.js";
import {rewriteLinksInText, validMLAffiliate} from "./affiliate.js";
import {parseShopeeIds, officialShopeeProduct, userShopeeCreds} from "./shopee-affiliate.js";

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

let lastCode = 0;
function scheduleRetry() {
  if (retryTimer) return;
  // 515 = restart exigido pelo WhatsApp: reconecta rápido; resto segue backoff.
  const wait = lastCode === 515 ? 2000 : backoffFor(retries);
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
    s.ev.on("messages.upsert", (m) => { handleIncoming(m).catch(() => {}); });
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
        lastCode = code;
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

// ---------- Clonador de grupos (pares independentes) ----------
const clone = {pairs: [], lastError: "",
  aff: {mlTool: "", mlWord: "", shopeeConvert: false, shopeeId: "", shopeeSecret: ""}};
const MAX_PAIRS = 4;
function cleanPair(p, i) {
  const id = String(p?.id || "p" + (i + 1)).slice(0, 12);
  const from = isGroupJid(p?.from) ? String(p.from) : "";
  const to = isGroupJid(p?.to) ? String(p.to) : "";
  return {id, from, to, enabled: p?.enabled === true && Boolean(from && to && from !== to),
    cloned: Number(p?.cloned) || 0, lastAt: Number(p?.lastAt) || 0};
}
let cloneLoaded = false;
async function loadClone() {
  if (cloneLoaded) return;
  cloneLoaded = true;
  try {
    const c = await getCfg("clone");
    if (c && typeof c === "object") {
      if (Array.isArray(c.pairs)) {
        clone.pairs = c.pairs.slice(0, MAX_PAIRS).map(cleanPair);
      } else if (c.from || c.to) {
        // Migra config antiga de par único.
        clone.pairs = [cleanPair({id: "p1", from: c.from, to: c.to, enabled: c.enabled, cloned: c.cloned, lastAt: c.lastAt}, 0)];
      }
      if (c.aff && typeof c.aff === "object") {
        clone.aff.mlTool = /^\d{4,20}$/.test(String(c.aff.mlTool || "")) ? String(c.aff.mlTool) : "";
        clone.aff.mlWord = /^[A-Za-z0-9._-]{2,60}$/.test(String(c.aff.mlWord || "")) ? String(c.aff.mlWord) : "";
        clone.aff.shopeeConvert = c.aff.shopeeConvert === true;
        clone.aff.shopeeId = /^\d{3,32}$/.test(String(c.aff.shopeeId || "")) ? String(c.aff.shopeeId) : "";
        clone.aff.shopeeSecret = String(c.aff.shopeeSecret || "").length >= 8 ? String(c.aff.shopeeSecret) : "";
        if (!clone.aff.shopeeId || !clone.aff.shopeeSecret) { clone.aff.shopeeConvert = false; clone.aff.shopeeId = ""; clone.aff.shopeeSecret = ""; }
      }
    }
  } catch {}
}
// Compat: config antiga de par único vira {pairs:[...]}.
function asPairs(cfg) {
  if (!cfg || typeof cfg !== "object") return [];
  if (Array.isArray(cfg.pairs)) return cfg.pairs;
  if (cfg.from || cfg.to) return [{id: "p1", from: cfg.from, to: cfg.to, enabled: cfg.enabled}];
  return [];
}
function saveClone() {
  setCfg("clone", {pairs: clone.pairs.map((p) => ({id: p.id, from: p.from, to: p.to, enabled: p.enabled, cloned: p.cloned, lastAt: p.lastAt})),
    aff: {mlTool: clone.aff.mlTool, mlWord: clone.aff.mlWord, shopeeConvert: clone.aff.shopeeConvert,
      shopeeId: clone.aff.shopeeId, shopeeSecret: clone.aff.shopeeSecret}}).catch(() => {});
}
// Decisão pura/testável: só texto e foto, nunca as próprias mensagens (anti-loop).
// Aceita config nova {pairs:[...]} ou antiga {from,to,enabled}. Devolve to+pairId.
export function shouldClone(msg, cfg) {
  if (!msg || typeof msg !== "object") return null;
  const key = msg.key || {};
  if (key.fromMe) return null;
  const pairs = asPairs(cfg).map((p, i) => cleanPair(p, i)).filter((p) => p.enabled);
  const pair = pairs.find((p) => String(key.remoteJid || "") === p.from);
  if (!pair) return null;
  const m = msg.message || {};
  if (m.protocolMessage || m.reactionMessage || m.pollCreationMessage) return null;
  const base = {to: pair.to, pairId: pair.id};
  if (typeof m.conversation === "string" && m.conversation.trim()) return {kind: "text", text: m.conversation, ...base};
  const ext = m.extendedTextMessage;
  if (ext && typeof ext.text === "string" && ext.text.trim()) return {kind: "text", text: ext.text, ...base};
  if (m.imageMessage && (typeof m.imageMessage.caption === "string" || true)) {
    return {kind: "image", caption: typeof m.imageMessage.caption === "string" ? m.imageMessage.caption : "", msg, ...base};
  }
  return null;
}
// Todos os pares que casam com a mensagem (independentes entre si).
export function matchPairs(msg, cfg) {
  if (!msg || typeof msg !== "object" || msg.key?.fromMe) return [];
  const jid = String(msg.key?.remoteJid || "");
  return asPairs(cfg).map((p, i) => cleanPair(p, i))
    .filter((p) => p.enabled && jid === p.from);
}
async function handleIncoming(upsert) {
  await loadClone();
  if (!sock || !connected) return;
  if (!clone.pairs.some((p) => p.enabled)) return;
  const list = upsert?.messages || [];
  for (const msg of list) {
    if (msg?.key?.fromMe) continue;
    // Ignora histórico antigo: só mensagens dos últimos 10 min.
    const ts = Number(msg?.messageTimestamp) || 0;
    if (ts && Date.now() / 1000 - ts > 600) continue;
    const job = shouldClone(msg, {pairs: clone.pairs});
    if (!job) continue;
    try {
      if (job.kind === "image") {
        const buf = await sock.downloadMediaMessage(msg, "buffer", {});
        const caption = (await applyAffiliateToText(job.caption, clone.aff)).text;
        await sock.sendMessage(job.to, {image: buf, caption});
      } else {
        const text = (await applyAffiliateToText(job.text, clone.aff)).text;
        await sock.sendMessage(job.to, {text});
      }
      const pair = clone.pairs.find((p) => p.id === job.pairId);
      if (pair) { pair.cloned++; pair.lastAt = Date.now(); }
      clone.lastError = "";
      saveClone();
    } catch {
      clone.lastError = "Falha ao replicar mensagem.";
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
// Expande links curtos (meli.la, shope.ee) para a URL final quando ela for
// de loja conhecida. Qualquer falha mantém o link original.
async function expandShortLinks(text, shortHosts, finalOk) {
  const found = String(text || "").match(/https?:\/\/[^\s<>"')]+/g) || [];
  let out = String(text || "");
  let n = 0;
  for (const raw of found) {
    if (n >= 5) break;
    let u;
    try { u = new URL(raw.replace(/[.,;:!?)]+$/, "")); } catch { continue; }
    const h = u.hostname.toLowerCase();
    if (!shortHosts.some((m) => h === m || h.endsWith("." + m))) continue;
    try {
      const r = await fetch(u.href, {method: "GET", redirect: "follow",
        signal: AbortSignal.timeout(8000), headers: {"user-agent": "Mozilla/5.0"}});
      try { await r.body?.cancel?.(); } catch {}
      const fin = new URL(r.url);
      if (fin.protocol === "https:" && finalOk(fin.hostname)) {
        out = out.split(raw).join(fin.href);
        n++;
      }
    } catch {}
  }
  return out;
}
async function convertShopeeLinks(text, creds) {
  const found = String(text || "").match(/https?:\/\/[^\s<>"')]+/g) || [];
  let out = String(text || ""), replaced = 0;
  let n = 0;
  for (const raw of found) {
    if (n >= 5) break;
    const clean = raw.replace(/[.,;:!?)]+$/, "");
    const ids = parseShopeeIds(clean);
    if (!ids) continue;
    n++;
    try {
      const off = await officialShopeeProduct(ids, {appId: creds.appId, secret: creds.secret});
      if (off?.affiliateUrl) { out = out.split(raw).join(off.affiliateUrl); replaced++; }
    } catch {}
  }
  return {text: out, replaced};
}
async function applyAffiliateToText(text, aff) {
  let out = String(text || ""), replaced = 0;
  try {
    if (aff?.mlTool && aff?.mlWord) {
      out = await expandShortLinks(out, ["meli.la"], (h) =>
        ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com"].some((m) => h === m || h.endsWith("." + m)));
      const r = rewriteLinksInText(out, {tool: aff.mlTool, word: aff.mlWord});
      out = r.text; replaced += r.replaced;
    }
    if (aff?.shopeeConvert && aff?.shopeeId && aff?.shopeeSecret) {
      out = await expandShortLinks(out, ["shope.ee"], (h) =>
        ["shopee.com.br", "shopee.com"].some((m) => h === m || h.endsWith("." + m)));
      const r2 = await convertShopeeLinks(out, {appId: aff.shopeeId, secret: aff.shopeeSecret});
      out = r2.text; replaced += r2.replaced;
    }
  } catch {}
  return {text: out, replaced};
}
export async function setClone({from, to, enabled, affiliate, pairs}) {
  await loadClone();
  if (affiliate !== undefined) {
    const a = affiliate || {};
    const tool = String(a.mlTool ?? "").trim(), word = String(a.mlWord ?? "").trim();
    if (!tool && !word) { clone.aff.mlTool = ""; clone.aff.mlWord = ""; }
    else {
      const v = validMLAffiliate(tool, word);
      clone.aff.mlTool = v.tool; clone.aff.mlWord = v.word;
    }
    clone.aff.shopeeConvert = a.shopeeConvert === true;
    if (a.shopeeId !== undefined || a.shopeeSecret !== undefined) {
      const c = userShopeeCreds({shopeeAppId: a.shopeeId ?? "", shopeeAppSecret: a.shopeeSecret ?? ""});
      if (c) { clone.aff.shopeeId = c.appId; clone.aff.shopeeSecret = c.secret; }
      else { clone.aff.shopeeId = ""; clone.aff.shopeeSecret = ""; }
    }
    if (clone.aff.shopeeConvert && (!clone.aff.shopeeId || !clone.aff.shopeeSecret)) {
      throw Error("Para converter Shopee, salve seu App ID + Secret.");
    }
  }
  if (pairs !== undefined) {
    // Substitui a lista de pares (cada par independente: origem/destino/ligado).
    if (!Array.isArray(pairs) || !pairs.length || pairs.length > MAX_PAIRS) {
      throw Error("Envie de 1 a " + MAX_PAIRS + " pares.");
    }
    const cleaned = pairs.map((p, i) => cleanPair(p, i));
    for (const p of cleaned) {
      if (p.enabled && (!p.from || !p.to)) throw Error("Par '" + p.id + "': escolha origem e destino.");
      if (p.enabled && p.from === p.to) throw Error("Par '" + p.id + "': origem e destino precisam ser diferentes.");
      const prev = clone.pairs.find((x) => x.id === p.id && x.from === p.from && x.to === p.to);
      if (prev) { p.cloned = prev.cloned; p.lastAt = prev.lastAt; }
    }
    clone.pairs = cleaned;
  } else {
    // Compat: par único vira/atualiza o primeiro par, sem mexer nos demais.
    const f = String(from || "").trim(), t = String(to || "").trim();
    let p1 = clone.pairs.find((p) => p.id === "p1");
    if (!p1) { p1 = {id: "p1", from: "", to: "", enabled: false, cloned: 0, lastAt: 0}; clone.pairs.unshift(p1); }
    if (enabled === true) {
      if (!isGroupJid(f) || !isGroupJid(t)) throw Error("Escolha grupos válidos.");
      if (f === t) throw Error("Origem e destino precisam ser grupos diferentes.");
      if (p1.from !== f || p1.to !== t) { p1.cloned = 0; p1.lastAt = 0; }
      p1.from = f; p1.to = t; p1.enabled = true;
    } else if (enabled === false) {
      p1.enabled = false;
      if (f) p1.from = f;
      if (t) p1.to = t;
    }
    clone.pairs = clone.pairs.slice(0, MAX_PAIRS);
  }
  saveClone();
  return cloneStatus();
}
export function cloneStatus() {
  return {enabled: clone.pairs.some((p) => p.enabled),
    from: clone.pairs[0]?.from || "", to: clone.pairs[0]?.to || "",
    cloned: clone.pairs.reduce((n, p) => n + (p.cloned || 0), 0),
    lastAt: clone.pairs.reduce((m, p) => Math.max(m, p.lastAt || 0), 0) || null,
    lastError: clone.lastError || null,
    pairs: clone.pairs.map((p) => ({id: p.id, from: p.from, to: p.to, enabled: p.enabled, cloned: p.cloned, lastAt: p.lastAt || null})),
    affiliate: {mlTool: clone.aff.mlTool, mlWord: clone.aff.mlWord,
      shopeeConvert: clone.aff.shopeeConvert, hasShopee: Boolean(clone.aff.shopeeId && clone.aff.shopeeSecret)}};
}

export async function waStatus() {
  const qrFresh = Boolean(!connected && !needsRepair && lastQr && Date.now() - lastQrAt < 60000);
  return {connected, user: phoneUser, qr: qrFresh ? lastQr : null, qrFresh,
    needsRepair, lastError: lastError || null, retries,
    pairCode, pairAge: pairCode ? Math.round((Date.now() - pairCodeAt) / 1000) : null,
    groups: groupsCache.length, groupsAt,
    uptimeSec: Math.round((Date.now() - bootAt) / 1000),
    clone: cloneStatus(),
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
