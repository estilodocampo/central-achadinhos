// wa-store.js — guarda APENAS a sessão de login do WhatsApp (creds + keys).
// Nenhuma oferta, mensagem ou grupo é salva: tudo de negócio continua em memória.
// Backend: Postgres (DATABASE_URL) no Render | arquivos locais (DATA_DIR) no PC.
import {mkdirSync, rmSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || resolve(HERE, "data");
const SESSION_DIR = resolve(DATA_DIR, "wpp-session");
const usePg = () => Boolean(String(process.env.DATABASE_URL || "").trim());

let pgPool = null;
async function pool() {
  if (pgPool) return pgPool;
  const {Pool} = await import("pg");
  const cs = String(process.env.DATABASE_URL || "").trim();
  const ssl = /render\.com|neon\.tech|supabase\.co|amazonaws\.com/i.test(cs) || process.env.PGSSL === "1";
  pgPool = new Pool({connectionString: cs, max: 3, idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000, ssl: ssl ? {rejectUnauthorized: false} : undefined});
  pgPool.on("error", () => {});
  await pgPool.query("CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return pgPool;
}

export function storeMode() {
  if (usePg()) return "postgres";
  return "file:" + SESSION_DIR;
}

// Estado no padrão {state, saveCreds} do useMultiFileAuthState.
export async function loadAuthState() {
  const {initAuthCreds, BufferJSON} = await import("@whiskeysockets/baileys");
  if (usePg()) {
    const p = await pool();
    const rows = (await p.query("SELECT key, value FROM wa_auth")).rows;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    let creds = initAuthCreds();
    try {
      const raw = map.get("creds");
      if (raw) creds = JSON.parse(raw, BufferJSON.reviver);
    } catch {}
    const write = async (key, value) => {
      await p.query("INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [key, JSON.stringify(value, BufferJSON.replacer)]);
    };
    // Throttle: chaves de sinal mudam aos montes; salva no máx 1x/2s.
    let pending = null, timer = null;
    const flush = async () => {
      timer = null;
      const batch = pending; pending = null;
      if (!batch) return;
      try { for (const [k, v] of batch) await write(k, v); } catch {}
    };
    const queue = (entries) => {
      if (!pending) pending = new Map();
      for (const [k, v] of entries) pending.set(k, v);
      if (!timer) timer = setTimeout(flush, 2000);
      if (timer.unref) timer.unref();
    };
    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const out = {};
            for (const id of ids) {
              const raw = map.get(type + "::" + id);
              if (raw === undefined) continue;
              try { out[id] = JSON.parse(raw, BufferJSON.reviver); } catch {}
            }
            return out;
          },
          set: async (data) => {
            const entries = [];
            for (const type of Object.keys(data || {})) {
              for (const id of Object.keys(data[type] || {})) {
                const v = data[type][id];
                const k = type + "::" + id;
                if (v) { map.set(k, JSON.stringify(v, BufferJSON.replacer)); entries.push([k, v]); }
                else { map.delete(k); entries.push([k, null]); }
              }
            }
            // null = deletar
            for (const [k, v] of entries) {
              if (v === null) p.query("DELETE FROM wa_auth WHERE key=$1", [k]).catch(() => {});
            }
            queue(entries.filter(([, v]) => v !== null));
          },
        },
      },
      saveCreds: async () => {
        try { await write("creds", creds); } catch {}
      },
      _credsRef: () => creds,
      _setCreds: (c) => { creds = c; },
    };
  }
  mkdirSync(SESSION_DIR, {recursive: true});
  const {useMultiFileAuthState} = await import("@whiskeysockets/baileys");
  return useMultiFileAuthState(SESSION_DIR);
}

export async function clearAuthState() {
  if (usePg()) {
    try { (await pool()).query("DELETE FROM wa_auth").catch(() => {}); } catch {}
    try { await pgPool?.end?.(); } catch {}
    pgPool = null;
    return;
  }
  try { rmSync(SESSION_DIR, {recursive: true, force: true}); } catch {}
}
