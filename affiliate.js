// affiliate.js — troca o link original pelo link DE AFILIADO do usuário.
// ML: injeta matt_tool/matt_word (rastreador oficial) em URLs de produto.
// Shopee: usa offerLink devolvido pela API com a chave do usuário.
// Puro e testável; nada é logado.
export function validMLAffiliate(tool, word) {
  const t = String(tool ?? "").trim();
  const w = String(word ?? "").trim();
  if (!/^\d{4,20}$/.test(t)) throw Error("matt_tool inválido (só números).");
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(w)) throw Error("matt_word inválido.");
  return {tool: t, word: w};
}

function isMLProductHost(host) {
  const h = String(host || "").toLowerCase();
  return ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com"].some(
    (m) => h === m || h.endsWith("." + m)
  );
}

export function applyMLAffiliate(rawUrl, cfg) {
  const out = {url: String(rawUrl || ""), applied: false};
  try {
    if (!cfg || !cfg.tool || !cfg.word) return out;
    validMLAffiliate(cfg.tool, cfg.word);
    const u = new URL(out.url);
    if (u.protocol !== "https:" || !isMLProductHost(u.hostname)) return out;
    u.searchParams.delete("matt_tool");
    u.searchParams.delete("matt_word");
    u.searchParams.delete("matt_origin");
    u.searchParams.set("matt_tool", cfg.tool);
    u.searchParams.set("matt_word", cfg.word);
    out.url = u.href;
    out.applied = true;
  } catch {}
  return out;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
// Reescreve links ML de produto dentro de um texto. Retorna {text, replaced}.
export function rewriteLinksInText(text, cfg) {
  const src = String(text || "");
  if (!cfg || !cfg.tool || !cfg.word) return {text: src, replaced: 0};
  let replaced = 0;
  const out = src.replace(URL_RE, (m) => {
    // tira pontuação grudada no fim (comum em mensagens)
    const trail = m.match(/[.,;:!?)]+$/);
    const core = trail ? m.slice(0, -trail[0].length) : m;
    const r = applyMLAffiliate(core, cfg);
    if (r.applied) { replaced++; return r.url + (trail ? trail[0] : ""); }
    return m;
  });
  return {text: out, replaced};
}
