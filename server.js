(async function boot(){
  const { createServer } = await import('node:http');
  const { timingSafeEqual, createHash } = await import('node:crypto');
  const { extractProduct,mercadolivreItemId } = await import('./product-parser.js');
  const { officialMLPrice } = await import('./mercadolivre-price.js');
  const { createAuthorization,completeAuthorization,getAuthorizedToken,sessionStatus,clearSessionCookie,ML_REDIRECT_URI } = await import('./ml-oauth.js');
  const {mercadoIdsFromPage,resolveCatalog,verifyItem} = await import('./mercadolivre-catalog.js');
  const {parseShopeeIds,officialShopeeProduct} = await import('./shopee-affiliate.js');
  const { readFile, stat } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, extname, sep } = await import('node:path');
  const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'public');
  const PORT=Number(process.env.PORT||3000);
  const MARKETS=['shopee.com.br','shopee.com','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la','tiktok.com','tiktokshop.com'];
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
      return 'Preço não encontrado nos dados da loja. Confira manualmente antes de divulgar.';
    };
    for(let i=0;i<6;i++){
      // Links Shopee diretos: preferir API oficial à leitura HTML.
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
      // Informações estruturais para diagnóstico; nunca expor HTML, link completo ou token.
      const signals={
        finalHost:target.hostname,finalPathType:target.pathname.includes('/social')?'social':target.pathname.includes('/p/')?'catalog':'other',
        mlbTokens:(html.match(/\bMLB-?\d{7,14}\b/gi)||[]).length,
        productFields:(html.match(/product_id/gi)||[]).length,
        itemFields:(html.match(/item_id/gi)||[]).length,
        titleCards:(html.match(/"title"\s*:\s*\{\s*"text"/gi)||[]).length,
        hasJsonEscapes:html.includes('\\\\"'),
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
  const server=createServer(async(req,res)=>{
    try{
      const path=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;
      // Health check continua público para o monitoramento do Render.
      if(protectedAPIs && path !== '/health' && path !== '/api/ml/callback') {
        if(!adminPassword)return send(res,503,{error:'Antes de ativar as APIs, configure CENTRAL_ADMIN_PASSWORD no Render.'});
        if(!authorized(req)){
          res.writeHead(401,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store',
            'www-authenticate':'Basic realm="Central de Achadinhos", charset="UTF-8"',
            'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
          return res.end('Autenticação administrativa necessária.');
        }
      }
      if(path==='/health')return send(res,200,{ok:true,version:'1.1.0'});
      if(path==='/api/ml/status'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        return send(res,200,{...sessionStatus(req.headers.cookie),redirectUri:ML_REDIRECT_URI});
      }
      if(path==='/api/ml/start'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        try{
          const start=createAuthorization();
          res.writeHead(302,{'location':start.url,'set-cookie':start.cookie,
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }catch{return send(res,503,{error:'Configure primeiro ML_CLIENT_ID e ML_CLIENT_SECRET no Render.'});}
      }
      if(path==='/api/ml/callback'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        const query=new URL(req.url,'https://central-achadinhos.onrender.com').searchParams;
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
          const httpStatus=reason==='token'?(error.message.match(/HTTP (400|401|403|429|5\\d\\d)/)||[])[1]:undefined;
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
        accessProtected:protectedAPIs && Boolean(adminPassword)
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
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('Central de Achadinhos na porta '+PORT);
    console.log('Integracoes configuradas: MLApp='+Boolean(process.env.ML_CLIENT_ID&&process.env.ML_CLIENT_SECRET)+
      ', ShopeeID='+Boolean(process.env.SHOPEE_APP_ID)+
      ', ShopeeSecret='+Boolean(process.env.SHOPEE_APP_SECRET)+
      ', SenhaAdmin='+Boolean(adminPassword));

  });
})();
