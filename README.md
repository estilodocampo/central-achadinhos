# Central de Achadinhos — Replicador v1.3.0

Replique anúncios de afiliados (Shopee, Mercado Livre, TikTok Shop) nos seus grupos de WhatsApp. **Nada é salvo** — sem banco, sem login, sem histórico.

## Como usar (3 passos)

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
