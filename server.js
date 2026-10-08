(async function boot(){
  const { createServer } = await import('node:http');
  const { timingSafeEqual, createHash, randomUUID } = await import('node:crypto');
  const { extractProduct,mercadolivreItemId } = await import('./product-parser.js');
  const { officialMLPrice } = await import('./mercadolivre-price.js');
  const { createAuthorization,completeAuthorization,getAuthorizedToken,sessionStatus,clearSessionCookie,ML_REDIRECT_URI,resolveRedirectUri } = await import('./ml-oauth.js');
  const {mercadoIdsFromPage,resolveCatalog,verifyItem} = await import('./mercadolivre-catalog.js');
  const {parseShopeeIds,officialShopeeProduct} = await import('./shopee-affiliate.js');
  const { listOffers,getOffer,upsertOffer,deleteOffer,getSettings,saveSettings,dbMode } = await import('./db.js');
  const { registerUser,verifyUser,issueSession,readSession,sessionCookie,clearSessionCookieLocal,destroySession,userCount } = await import('./auth-local.js');
  const { readFile, stat } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, extname, sep } = await import('node:path');
  const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'public');
  const PORT=Number(process.env.PORT||3000);
  const VERSION='1.2.0';
  const MARKETS=['shopee.com.br','shopee.com','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la','tiktok.com','tiktokshop.com'];
  const PLATFORMS=['Shopee','Mercado Livre','TikTok Shop'];
  function marketUrl(input) {
    const u=new URL(input);
    if(u.protocol!=='https:'||u.username||u.password||u.port) throw Error('Apenas links HTTPS das plataformas selecionadas são aceitos.');
    const h=u.hostname.toLowerCase();
    if(!MARKETS.some(m=>h===m||h.endsWith('.'+m))) throw Error('Este link não é de Shopee, Mercado Livre ou TikTok Shop.');
    return u;
  }
  async function getPreview(link,mlToken=''){
    let target=marketUrl(link);
    const hops=[target.href];
    let trace={market:'',identifier:'unknown',api:'not_attempted',configured:false};
    const priceNote=(product)=>{
      if(product.price!==null&&product.price!==undefined) return 'Preço obtido de '+product.priceSource+'. Confira o preço final e a variação antes de divulgar.';
      if(trace.market==='Mercado Livre'){
        if(!trace.configured)return 'Mercado Livre ainda não conectado por OAuth neste navegador. Acesse Configurações e clique em Conectar Mercado Livre.';
        if(trace.identifier==='unknown')return 'O link curto não revelou o item ou o catálogo do anúncio. Abra o produto na loja e compartilhe a URL completa.';
        if(trace.api==='unauthorized')return 'O Mercado Livre recusou a autorização. Vá em Configurações e reconecte a conta.';
        if(trace.api==='forbidden')return 'A API retornou 403. Verifique as permissões da aplicação e do token.';
        if(trace.api==='no_buy_box')return 'O produto foi identificado, mas a API não encontrou oferta vencedora para confirmar o preço.';
        if(trace.api==='not_found')return 'O ID identificado não foi encontrado pela API. Confira o link do anúncio.';
        if(trace.api==='title_mismatch')return 'O ID encontrado pertence a outro produto. O preço não foi importado por segurança.';
        return 'O produto foi identificado, mas a API não confirmou um preço. Confira o anúncio ou as permissões da integração.';
      }
      if(product.priceSource&&product.priceSource.includes('TikTok')) return 'Preço obtido de '+product.priceSource+'. Confira a variação antes de divulgar.';
      return 'Preço não encontrado nos dados da loja. Confira manualmente antes de divulgar.';
    };
    for(let i=0;i<6;i++){
      const shopeeIds=parseShopeeIds(target.href);
      if(shopeeIds){
        const official=await officialShopeeProduct(shopeeIds);
        if(official)return {...official,itemId:shopeeIds.itemId,source:official.source||target.hostname};
      }
      const direct=mercadoIdsFromPage('',target.href,hops);
      const directIsML=Boolean(direct.itemId||direct.catalogId);
      trace.market=directIsML?'Mercado Livre':trace.market;
      trace.configured=Boolean(mlToken);
      let advancePrice=null;
      let catalogAttempt=null;
      if(direct.itemId&&trace.configured){
        const official=await officialMLPrice(direct.itemId,mlToken);
        trace.identifier='item';
        trace.api=official?'ok':'unavailable';
        if(official)advancePrice=official;
      }else if(direct.catalogId&&trace.configured){
        trace.identifier='catalog';
        catalogAttempt=await resolveCatalog(direct.catalogId,mlToken);
        trace.api=catalogAttempt.status;
        if(catalogAttempt.value){
          const official=await officialMLPrice(catalogAttempt.value.itemId,mlToken);
          advancePrice=official||(catalogAttempt.value.price!==null
            ? {price:catalogAttempt.value.price,oldPrice:null,priceSource:'Oferta vencedora do catálogo (confirmar variação)'} : null);
          trace.api=advancePrice?'ok':'price_unavailable';
        }
      }
      const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(8000),
        headers:{'user-agent':'Mozilla/5.0 (compatible; AchadinhosPreview/1.0)','accept':'text/html','accept-language':'pt-BR,pt;q=0.9'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location)throw Error('O redirecionamento não informou um endereço.');
        target=marketUrl(new URL(location,target).href);
        hops.push(target.href);
        continue;
      }
      if(!response.ok) {
        if(advancePrice)return {...advancePrice,title:'',image:'',category:'',source:target.hostname,
          priceNote:'Preço identificado pela API. A loja bloqueou os demais dados; complete título e foto manualmente.'};
        throw Error('A loja não disponibilizou os dados deste produto. Preencha manualmente.');
      }
      if(!(response.headers.get('content-type')||'').includes('text/html'))throw Error('O link não retornou uma página HTML.');
      const reader=response.body?.getReader();
      if(!reader)throw Error('Resposta vazia.');
      const chunks=[];let n=0;
      try{
        while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;
          if(n>1500000)throw Error('A página excedeu o limite de leitura.');chunks.push(value);}
      }finally{await reader.cancel().catch(()=>{});}
      const html=new TextDecoder().decode(Buffer.concat(chunks));
      const signals={
        finalHost:target.hostname,finalPathType:target.pathname.includes('/social')?'social':target.pathname.includes('/p/')?'catalog':'other',
        mlbTokens:(html.match(/\bMLB-?\d{7,14}\b/gi)||[]).length,
        productFields:(html.match(/product_id/gi)||[]).length,
        itemFields:(html.match(/item_id/gi)||[]).length,
        titleCards:(html.match(/"title"\s*:\s*\{\s*"text"/gi)||[]).length,
        hasJsonEscapes:html.includes('\\"'),
        length:html.length
      };
      const product=extractProduct(html,target.href);
      const canonical=html.match(/<meta\s+[^>]*(?:property|name)=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1]||'';
      const canonicalIds=parseShopeeIds(canonical);
      if(canonicalIds){
        const verified=await officialShopeeProduct(canonicalIds);
        if(verified)return {...verified,itemId:canonicalIds.itemId,source:verified.source||target.hostname};
      }
      const mlPage=/mercadolivre|mercadolibre|meli\.la/i.test(hops.join(' '));
      if(mlPage){
        trace.market='Mercado Livre';
        const ids=mercadoIdsFromPage(html,target.href,hops);
        const itemId=ids.itemId||direct.itemId;
        const catalogId=ids.catalogId||direct.catalogId;
        trace.identifier=itemId?'item':catalogId?'catalog':'unknown';
        if(advancePrice)Object.assign(product,advancePrice);
        else if(trace.configured){
          if(itemId){
            const uncertain=ids.evidence?.includes('exige verificar título');
            const confirmation=uncertain?await verifyItem(itemId,product.title,mlToken):{status:'ok',verified:true};
            if(!confirmation.verified)trace.api=confirmation.status;
            else{
              const official=await officialMLPrice(itemId,mlToken);
              trace.api=official?'ok':'unavailable';
              if(official)Object.assign(product,official);
            }
          }else if(catalogId){
            const uncertain=ids.evidence?.includes('exige verificar título');
            const result=catalogAttempt?.value?catalogAttempt:
              await resolveCatalog(catalogId,mlToken,fetch,uncertain?product.title:'');
            trace.api=result.status;
            if(result.value){
              const official=await officialMLPrice(result.value.itemId,mlToken);
              if(official){Object.assign(product,official);trace.api='ok';}
              else if(result.value.price!==null){
                Object.assign(product,{price:result.value.price,oldPrice:null,
                  priceSource:'Oferta vencedora do catálogo (confirmar variação)'});
                trace.api='ok';
              }
            }
          }
        }
      }
      return {...product,source:target.hostname,priceNote:priceNote(product),
        importDiagnostic:trace.market==='Mercado Livre'
          ?{market:trace.market,identifier:trace.identifier,api:trace.api,tokenConfigured:trace.configured,signals}:undefined};
    }
    throw Error('Muitos redirecionamentos. Preencha manualmente.');
  }
  const MIMES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
  function send(res,status,data,type='application/json; charset=utf-8',head=false,additionalHeaders={}){
    res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",...additionalHeaders});
    if(head)return res.end();
    return res.end(type.includes('json')?JSON.stringify(data):data);
  }
  async function readJson(req,limit=32768){
    const chunks=[];let size=0;
    for await(const c of req){size+=c.length;if(size>limit)throw Error('payload_too_large');chunks.push(c);}
    if(!chunks.length)return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const protectedAPIs = Boolean(process.env.ML_CLIENT_ID || process.env.ML_CLIENT_SECRET || process.env.SHOPEE_APP_ID || process.env.SHOPEE_APP_SECRET);
  const adminPassword = process.env.CENTRAL_ADMIN_PASSWORD || '';
  function authorized(req){
    const header=req.headers.authorization || '';
    if(!header.startsWith('Basic ') || !adminPassword)return false;
    let decoded='';
    try{decoded=Buffer.from(header.slice(6),'base64').toString('utf8');}catch{return false;}
    const separator=decoded.indexOf(':');
    if(separator<0)return false;
    const supplied=decoded.slice(separator+1);
    const lhs=createHash('sha256').update(supplied,'utf8').digest();
    const rhs=createHash('sha256').update(adminPassword,'utf8').digest();
    return timingSafeEqual(lhs,rhs);
  }
  async function currentOwner(req){
    try{
      const sess=await readSession(req.headers.cookie);
      if(sess?.username)return String(sess.username).toLowerCase();
    }catch{}
    if(authorized(req))return 'admin';
    try{
      if(!adminPassword&&(await userCount())===0)return 'public';
    }catch{}
    return null;
  }
  function needBasic(res){
    res.writeHead(401,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
      'www-authenticate':'Basic realm="Central de Achadinhos", charset="UTF-8"',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end('Autenticação administrativa necessária.');
  }
  function validOfferInput(o){
    if(!o||typeof o!=='object')return null;
    const title=String(o.title||'').trim().slice(0,180);
    const platform=String(o.platform||'');
    const price=Number(o.price);
    let url='';
    try{const u=new URL(String(o.url||''));if((u.protocol==='https:'||u.protocol==='http:')&&!u.username&&!u.password)url=u.href;}catch{}
    if(!title||!PLATFORMS.includes(platform)||!Number.isFinite(price)||price<=0||price>10000000||!url)return null;
    let image='';
    try{const u=new URL(String(o.image||''));if(u.protocol==='https:'&&!u.username&&!u.password)image=u.href;}catch{if(String(o.image||'').trim())return null;}
    let oldPrice=null;
    if(o.oldPrice!==null&&o.oldPrice!==undefined&&String(o.oldPrice)!==''){
      oldPrice=Number(o.oldPrice);
      if(!Number.isFinite(oldPrice)||oldPrice<=price||oldPrice>10000000)return null;
    }
    return {id:String(o.id||randomUUID()).slice(0,75),title,platform,
      category:String(o.category||'').trim().slice(0,60),price,oldPrice,
      coupon:String(o.coupon||'').trim().slice(0,70),url,image,
      status:['rascunho','pronta','publicada'].includes(o.status)?o.status:'rascunho',
      createdAt:String(o.createdAt||new Date().toISOString()),
      updatedAt:new Date().toISOString()};
  }
  const PUBLIC_AUTH_PATHS=new Set(['/api/auth/login','/api/auth/register','/api/auth/me']);
  const server=createServer(async(req,res)=>{
    try{
      const parsed=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      const path=parsed.pathname;
      if(protectedAPIs && path !== '/health' && path !== '/api/ml/callback' && !PUBLIC_AUTH_PATHS.has(path)) {
        if(!adminPassword)return send(res,503,{error:'Antes de ativar as APIs, configure CENTRAL_ADMIN_PASSWORD no Render.'});
        if(!authorized(req)&&!(await readSession(req.headers.cookie)))return needBasic(res);
      }
      if(path==='/health')return send(res,200,{ok:true,version:VERSION,db:dbMode()});
      if(path==='/api/auth/me'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        const sess=await readSession(req.headers.cookie);
        const owner=await currentOwner(req);
        return send(res,200,{user:sess?.username||(authorized(req)?'admin':null),owner:owner||null,
          users:await userCount(),adminProtected:Boolean(adminPassword),protectedAPIs});
      }
      if(path==='/api/auth/register'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        try{
          if((await userCount())>0&&!(await currentOwner(req)))return send(res,401,{error:'Faça login para criar usuários.'});
          const created=await registerUser(body.username,body.password);
          const sess=await issueSession(created.username);
          return send(res,201,{ok:true,user:created.username},'application/json; charset=utf-8',false,{'set-cookie':sessionCookie(sess.token)});
        }catch(e){return send(res,400,{error:e?.message||'Não foi possível registrar.'});}
      }
      if(path==='/api/auth/login'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        const ok=await verifyUser(body.username,body.password);
        if(!ok){
          if(adminPassword&&String(body.username||'').toLowerCase()==='admin'){
            const lhs=createHash('sha256').update(String(body.password||''),'utf8').digest();
            const rhs=createHash('sha256').update(adminPassword,'utf8').digest();
            if(lhs.length===rhs.length&&timingSafeEqual(lhs,rhs)){
              const sess=await issueSession('admin');
              return send(res,200,{ok:true,user:'admin'},'application/json; charset=utf-8',false,{'set-cookie':sessionCookie(sess.token)});
            }
          }
          return send(res,401,{error:'Usuário ou senha inválidos.'});
        }
        const sess=await issueSession(ok.username);
        return send(res,200,{ok:true,user:ok.username},'application/json; charset=utf-8',false,{'set-cookie':sessionCookie(sess.token)});
      }
      if(path==='/api/auth/logout'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        await destroySession(req.headers.cookie);
        return send(res,200,{ok:true},'application/json; charset=utf-8',false,{'set-cookie':clearSessionCookieLocal()});
      }
      if(path==='/api/offers'&&req.method==='GET'){
        const owner=await currentOwner(req);
        if(!owner)return send(res,401,{error:'Faça login.'});
        return send(res,200,{offers:await listOffers(owner),owner});
      }
      if(path==='/api/offers'&&req.method==='POST'){
        const owner=await currentOwner(req);
        if(!owner)return send(res,401,{error:'Faça login.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        const clean=validOfferInput(body);
        if(!clean)return send(res,400,{error:'Oferta inválida.'});
        if(await countGuard(owner))return send(res,413,{error:'Limite de 3000 ofertas.'});
        return send(res,201,{offer:await upsertOffer(clean,owner)});
      }
      if(path.startsWith('/api/offers/')&&(req.method==='PUT'||req.method==='DELETE'||req.method==='GET')){
        const owner=await currentOwner(req);
        if(!owner)return send(res,401,{error:'Faça login.'});
        const id=decodeURIComponent(path.slice('/api/offers/'.length).split('/')[0]||'');
        if(!id)return send(res,400,{error:'ID inválido.'});
        if(req.method==='DELETE'){
          const ok=await deleteOffer(id,owner);
          if(!ok)return send(res,404,{error:'Oferta não encontrada.'});
          return send(res,200,{ok:true});
        }
        if(req.method==='GET'){
          const o=await getOffer(id,owner);
          if(!o)return send(res,404,{error:'Oferta não encontrada.'});
          return send(res,200,{offer:o});
        }
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        body.id=id;
        const clean=validOfferInput(body);
        if(!clean)return send(res,400,{error:'Oferta inválida.'});
        return send(res,200,{offer:await upsertOffer(clean,owner)});
      }
      if(path==='/api/settings'&&req.method==='GET'){
        const owner=await currentOwner(req);
        if(!owner)return send(res,401,{error:'Faça login.'});
        return send(res,200,{settings:await getSettings(owner),owner});
      }
      if(path==='/api/settings'&&(req.method==='PUT'||req.method==='POST')){
        const owner=await currentOwner(req);
        if(!owner)return send(res,401,{error:'Faça login.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        return send(res,200,{settings:await saveSettings(body?.settings||body,owner)});
      }
      if(path==='/api/ml/status'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        return send(res,200,{...sessionStatus(req.headers.cookie),redirectUri:resolveRedirectUri(req)});
      }
      if(path==='/api/ml/start'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        try{
          const start=createAuthorization(process.env,resolveRedirectUri(req));
          res.writeHead(302,{'location':start.url,'set-cookie':start.cookie,
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }catch{return send(res,503,{error:'Configure primeiro ML_CLIENT_ID e ML_CLIENT_SECRET no Render.'});}
      }
      if(path==='/api/ml/callback'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        const query=new URL(req.url,`http://${req.headers.host||'localhost'}`).searchParams;
        try{
          const tokens=await completeAuthorization(Object.fromEntries(query.entries()),req.headers.cookie);
          res.writeHead(303,{'location':'/?ml=connected','set-cookie':[tokens.cookie,tokens.clearState],
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }catch(error) {
          const reason=error.message.includes('código de segurança')?'state':
            error.message.includes('recusou a autorização')?'token':
            error.message.includes('tokens inválida')?'response':
            error.message.includes('Código de autorização')?'code':
            error.message.includes('Autorização não foi concluída')?'denied':'unknown';
          const httpStatus=reason==='token'?(error.message.match(/HTTP (400|401|403|429|5\d\d)/)||[])[1]:undefined;
          console.warn('[ML_OAUTH] Falha na autorização; etapa='+reason+(httpStatus?', http='+httpStatus:''));
          res.writeHead(303,{'location':'/?ml=error&reason='+reason,
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }
      }
      if(path==='/api/ml/disconnect'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        return send(res,200,{ok:true,connected:false},'application/json; charset=utf-8',false,{'set-cookie':clearSessionCookie()});
      }
      if(path==='/api/integration-status')return send(res,200,{
        mercadoLivre:{configured:Boolean(process.env.ML_CLIENT_ID&&process.env.ML_CLIENT_SECRET),connected:sessionStatus(req.headers.cookie).connected},
        shopee:{appIdConfigured:Boolean(process.env.SHOPEE_APP_ID),appSecretConfigured:Boolean(process.env.SHOPEE_APP_SECRET)},
        accessProtected:protectedAPIs && Boolean(adminPassword),
        users:await userCount(),db:dbMode()
      });
      if(path==='/api/preview'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        const chunks=[];let size=0;
        for await(const c of req){size+=c.length;if(size>8192)return send(res,413,{error:'Solicitação grande demais.'});chunks.push(c);}
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'JSON inválido.'});}
        if(typeof body.url!=='string'||body.url.length>2000)return send(res,400,{error:'Link inválido.'});
        try{const auth=await getAuthorizedToken(req.headers.cookie);
          return send(res,200,await getPreview(body.url,auth.token||''),'application/json; charset=utf-8',false,auth.cookie?{'set-cookie':auth.cookie}:{});}
        catch(e){return send(res,422,{error:e?.message||'Prévia indisponível.'});}
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Método inválido.'});
      const loc=path==='/'?'/index.html':path;
      const target=resolve(ROOT,'.'+decodeURIComponent(loc));
      if(target!==ROOT&&!target.startsWith(ROOT+sep))return send(res,403,{error:'Acesso negado.'});
      if(!(await stat(target).catch(()=>null))?.isFile())return send(res,404,{error:'Arquivo não encontrado.'});
      const file=await readFile(target);
      return send(res,200,file,MIMES[extname(target)]||'application/octet-stream',req.method==='HEAD');
    }catch{return send(res,500,{error:'Erro interno.'});}
  });
  async function countGuard(owner){
    try{
      const {countOffers}=await import('./db.js');
      return (await countOffers(owner))>=3000;
    }catch{return false;}
  }
  server.listen(PORT,'0.0.0.0',async()=>{
    console.log('Central de Achadinhos '+VERSION+' na porta '+PORT);
    console.log('DB='+dbMode()+', users='+(await userCount())+', MLApp='+Boolean(process.env.ML_CLIENT_ID&&process.env.ML_CLIENT_SECRET)+
      ', ShopeeID='+Boolean(process.env.SHOPEE_APP_ID)+
      ', ShopeeSecret='+Boolean(process.env.SHOPEE_APP_SECRET)+
      ', SenhaAdmin='+Boolean(adminPassword));
  });
})();
