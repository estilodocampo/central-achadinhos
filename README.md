# Central de Achadinhos — Replicador v1.7.0 (modo comercial)

Replique anúncios de afiliados (Shopee, Mercado Livre, TikTok Shop) nos seus grupos de WhatsApp. **Ofertas e mensagens nunca são salvas** — cada cliente conecta as próprias contas no painel.

## Conexões por cliente (painel, sem login na conta)

- **Mercado Livre**: cole SEU App ID + Client Secret no bloco e clique Conectar. As chaves vão seladas no cookie de sessão (nunca na URL/log); o token renova sozinho. Cada usuário usa o próprio app ML — só precisa cadastrar o retorno `/api/ml/callback` nele uma vez.
- **Shopee**: campos App ID + App Secret salvos no navegador (`localStorage`) e enviados por busca; o servidor prefere a chave do cliente e usa a do servidor como reserva. Nada é registrado em log.

Replique anúncios de afiliados (Shopee, Mercado Livre, TikTok Shop) nos seus grupos de WhatsApp. **Ofertas e mensagens nunca são salvas** — cada cliente conecta as próprias contas no painel.

## Conexões por cliente (painel)

- **Mercado Livre**: botão Conectar (OAuth). Cada usuário autoriza com a própria conta; token fica no cookie do navegador dele.
- **Shopee**: campos App ID + App Secret salvos no navegador (`localStorage`) e enviados por busca; o servidor prefere a chave do cliente e usa a do servidor como reserva. Nada é registrado em log.
- **TikTok Shop**: campos App Key + Secret salvos no navegador (prontos para a API oficial quando o app do vendedor for aprovado). Hoje a extração é direta da página.

Replique anúncios de afiliados (Shopee, Mercado Livre, TikTok Shop) nos seus grupos de WhatsApp. **Ofertas e mensagens nunca são salvas** — só o login do WhatsApp é guardado (como "manter conectado"), igual à loja.

## Clonador de grupos (etapa 4)

Espelha ofertas de um grupo (origem) no seu grupo (destino), sozinhas, na hora que chegam. Só texto e foto; ignora figurinhas, enquetes, reações e as próprias mensagens (anti-loop total). A config (origem/destino/ligado/contador) sobrevive a reinícios — mensagens nunca são salvas.

## Sessão que sobrevive (padrão da loja Estilo do Campo)

- `wa-store.js`: credenciais Baileys em Postgres (`DATABASE_URL`, tabela `wa_auth`) no Render; arquivos locais (`data/wpp-session`) no PC
- `wa-gateway.js`: retry com backoff (5s→5min), trava de 90s, timeout de versão, códigos terminais (401/403/411/500) pedem reparo em vez de loop, `markOnlineOnConnect: false`
- Painel: estado de reparo + **vincular por código de 8 letras** (plano B quando o QR não completa) + botão **🔄 Novo QR**
- Reiniciou ou fez deploy? Reconecta sozinho sem novo QR. Só peça novo QR se mostrar "reparar sessão".

## Como usar (passo a passo)

1. **Anúncio**: cole o link → Buscar dados (título, preço, foto via `/api/preview`) → revise.
2. **Mensagem**: gerada automaticamente, editável, com preço, cupom e seu link de afiliado.
3. **Grupos**: escaneie o QR com seu WhatsApp → selecione os grupos → Replicar agora.

## WhatsApp automático (Baileys)

- `GET /api/wa/status` — conectado? + QR em dataURL (válido 60s, atualiza a cada 5s no painel)
- `GET /api/wa/groups?refresh=1` — seus grupos (`id`, nome, participantes)
- `POST /api/wa/send` `{message, groupIds[], imageUrl?}` — envia texto (ou imagem com legenda), máx. 20 grupos por vez, intervalo anti-bloqueio
- `POST /api/wa/logout` — desconecta e limpa a sessão
- Sessão **só em memória**: reiniciar o servidor pede novo QR. Comece com poucos grupos para evitar bloqueio da conta.

## Executar

Node.js 22+. `npm start` → `http://localhost:3000`. `npm test` (45 testes).

## Deploy automático GitHub → Render

Repo `estilodocampo/central-achadinhos`, branch `main`, `autoDeploy: true`. `render.yaml` sem banco. Env opcionais no Render:

- `ML_CLIENT_ID` / `ML_CLIENT_SECRET` (+ `CENTRAL_ADMIN_PASSWORD`, `ML_OAUTH_PKCE=true` se preciso) — só para puxar preço oficial ML por OAuth (token fica no cookie do navegador, nada no servidor)
- `SHOPEE_APP_ID` / `SHOPEE_APP_SECRET` — preço oficial Shopee

Sem essas vars, a prévia usa metadados públicos + TikTok embutido. Revise sempre o preço antes de replicar. Painel independente, sem afiliação com marketplaces ou WhatsApp.
