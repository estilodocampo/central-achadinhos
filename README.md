# Central de Achadinhos — v1.2.0

Painel web gratuito para organizar ofertas de afiliados do Mercado Livre, Shopee e TikTok Shop e preparar publicações para WhatsApp.

## Novidades v1.2.0 — Postgres persistente

- **Postgres no Render** (`DATABASE_URL` via Blueprint `central-db` free): sobrevive a redeploys/reinícios, múltiplos usuários simultâneos
- **Fallback automático**: sem `DATABASE_URL` usa SQLite local (`data/central.db`); sem SQLite usa memória. `GET /health` mostra `db: postgres|sqlite|memory`
- **Mesma API**: `/api/offers`, `/api/settings`, `/api/auth/*` agora async, multi-usuário isolado por `owner`
- Teste com `npm test` (53 testes). Local sem Postgres continua funcionando zero-config.

## Novidades v1.1.0

- **SQLite persistente** (`data/central.db`, `DATA_DIR`/`SQLITE_PATH` configuráveis, fallback em memória): `GET/POST /api/offers`, `GET/PUT /api/settings`
- **Multi-usuário básico**: `POST /api/auth/register|login|logout`, `GET /api/auth/me`, sessões HttpOnly 30 dias (PBKDF2 100k), ofertas isoladas por usuário, `admin` via `CENTRAL_ADMIN_PASSWORD`
- **Redirect ML dinâmico**: `resolveRedirectUri(req)` usa `ML_REDIRECT_URI` se definido, senão `X-Forwarded-Proto + Host` (suporta localhost http e qualquer domínio Render)
- **TikTok Shop melhorado**: limpa `| TikTok Shop` do título, `extractTikTokPrice()` com trava anti-recomendação, categorias Papelaria + plurais
- **Deploy automático**: `render.yaml` com `branch: main` + `autoDeploy: true` + `NODE_VERSION 22.16.0`; todo `git push` redeploya

## Funcionalidades

- Cadastro, edição e remoção de ofertas, preços, fotos, cupons e links de afiliados
- Busca, filtros, seleção para publicações e compartilhamento manual
- Prévia de informações públicas de produto via API `/api/preview` (pode falhar quando a loja restringe acesso)
- Exportação CSV e backup/restauração JSON
- Layout responsivo para celular

## Executar

Node.js 22 ou mais recente. Execute `npm start`, e acesse `http://localhost:3000`. Teste com `npm test` (53 testes).
Sem `DATABASE_URL`, usa SQLite local automaticamente. Para testar Postgres local: `set DATABASE_URL=postgres://...` + `npm start`.

## Deploy automático GitHub → Render

Repo privado `estilodocampo/central-achadinhos`, branch `main`. Cada `git push` dispara redeploy (`autoDeploy: true`).

## Render

Conecte o repositório como Web Service gratuito, runtime Node, branch main, comando de build `npm install && npm test` e de inicialização `npm start`. A rota `/health` responde ao health check.

## Limitações v1.1

**Logado: salva no servidor (SQLite) e espelha no navegador. Deslogado: só localStorage.** No Render free o disco é efêmero — mantenha backup JSON; use `SQLITE_PATH` em disco persistente ou Postgres futuro para durabilidade total.

Os preços obtidos por metadados podem ser imprecisos ou estar desatualizados; revise sempre antes de publicar. A plataforma não calcula comissões, não consulta vendas, não obtém preços automaticamente em segundo plano nem envia mensagens diretamente para grupos/canais do WhatsApp. O compartilhamento é manual.

Não informe senhas ou chaves de API no painel. Este projeto não possui afiliação oficial com os marketplaces ou WhatsApp.

## Integração com as APIs de afiliados

No Render, abra **central-achadinhos > Environment > Add Environment Variable** e registre separadamente:

- `CENTRAL_ADMIN_PASSWORD`: senha administrativa forte e exclusiva (configure antes das chaves das APIs). A Central exigirá autenticação HTTP Basic no navegador enquanto pelo menos uma API estiver habilitada. Use exclusivamente HTTPS no Render.
- `ML_ACCESS_TOKEN`: token OAuth de acesso do Mercado Livre. Ele expira e deve ser renovado periodicamente; App ID e Client Secret não são substitutos do access token.
- `SHOPEE_APP_ID`: App ID da Open API de Afiliados Shopee.
- `SHOPEE_APP_SECRET`: segredo da Open API de Afiliados Shopee.

Quando uma credencial da API for configurada sem `CENTRAL_ADMIN_PASSWORD`, o painel retorna **503** até a senha ser informada. O endpoint `/health` continua disponível para o Render. Esse bloqueio evita disponibilizar suas cotas de API publicamente.

**Nunca inclua credenciais em mensagens, prints, no código-fonte ou em variáveis prefixadas por PUBLIC_.** Salve-as apenas nas variáveis de ambiente protegidas do serviço no Render.

### Como funciona a importação

- Para anúncio do Mercado Livre com ID identificado, o servidor tenta obter o preço pelo endpoint oficial `/items/{itemId}/sale_price` quando `ML_ACCESS_TOKEN` estiver definido.
- Para anúncio Shopee com `shopId` e `itemId`, o servidor tenta a API GraphQL `productOfferV2` quando App ID/Secret estiverem definidos. Para links curtos precisa conseguir seguir o redirecionamento até o endereço com esses identificadores.
- A foto, o título e o preço só são usados quando vinculados ao anúncio correto. Na Shopee, preços diferentes entre variações deixam o preço em branco até escolha manual.
- O link de afiliado digitado permanece inalterado no cadastro.
- Se a página bloquear robôs, faltar um identificador ou a API retornar erro, o importador solicita conferência manual e não inventa preços. A existência das credenciais não garante acesso ao preço de qualquer produto.

Para diagnosticar um problema de importação, verifique os logs do Render sem divulgar tokens ou qualquer dado de autenticação.

## Mercado Livre — Conectar conta por OAuth (v1.0.4)

1. Na conta de desenvolvedores do Mercado Livre, configure o Redirect URI **exatamente** como
   `https://central-achadinhos.onrender.com/api/ml/callback`.
2. No Render, em **Environment**, cadastre:
   - `CENTRAL_ADMIN_PASSWORD` — senha forte (já necessária para ativar integrações privadas);
   - `ML_CLIENT_ID` — ID do aplicativo Mercado Livre;
   - `ML_CLIENT_SECRET` — chave secreta do aplicativo, regenerada se exposta.
   - `ML_OAUTH_PKCE=true` somente se habilitou PKCE no painel de desenvolvedores.
3. **Remova** a antiga variável `ML_ACCESS_TOKEN` que contiver o Client Secret ou um valor incorreto.
4. Salve as variáveis, abra **Configurações → Conectar Mercado Livre** no próprio sistema e autorize a conta principal.
5. O site guarda os tokens **criptografados em cookie HttpOnly Secure apenas no navegador que foi autorizado**, renovando o Access Token quando está perto de expirar. Em outro navegador ou dispositivo, repita a conexão.

Não cole as credenciais em chats, prints, arquivos ou repositórios. Nenhuma credencial é registrada nos logs. Esta implementação não guarda os tokens em banco central; por isso não autoriza importação desassistida por agendamentos nem oferece sincronização entre dispositivos. A disponibilidade de preços varia conforme o item e a API.
