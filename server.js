(async function boot(){
  const { createServer } = await import('node:http');
  const { extractProduct } = await import('./product-parser.js');
  const { officialMLPrice, publicMLPrice, matchPublicPriceByTitle } = await import('./mercadolivre-price.js');
  const { createAuthorization,completeAuthorization,getAuthorizedToken,sessionStatus,clearSessionCookie,resolveRedirectUri,validClientCreds,peekPendingClient } = await import('./ml-oauth.js');
  const {mercadoIdsFromPage,resolveCatalog,verifyItem,matchingTitle} = await import('./mercadolivre-catalog.js');
  const {parseShopeeIds,officialShopeeProduct,userShopeeCreds} = await import('./shopee-affiliate.js');
  const { startWhatsApp,waStatus,waGroups,waSend,waLogout,waPairCode,setClone,cloneStatus } = await import('./wa-gateway.js');
  const { readFile, stat } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve, extname, sep } = await import('node:path');
  const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'public');
  const PORT=Number(process.env.PORT||3000);
  const VERSION='1.13.0';
  const MARKETS=['shopee.com.br','shopee.com','shope.ee','mercadolivre.com.br','mercadolivre.com','mercadolibre.com','meli.la','tiktok.com','tiktokshop.com'];
  function marketUrl(input) {
    const u=new URL(input);
    if(u.protocol!=='https:'||u.username||u.password||u.port) throw Error('Apenas links HTTPS das plataformas selecionadas são aceitos.');
    const h=u.hostname.toLowerCase();
    if(!MARKETS.some(m=>h===m||h.endsWith('.'+m))) throw Error('Este link não é de Shopee, Mercado Livre ou TikTok Shop.');
    return u;
  }
  async function getPreview(link,mlToken='',shopeeCreds=null){
    let target=marketUrl(link);
    const hops=[target.href];
    let trace={market:'',identifier:'unknown',api:'not_attempted',configured:false};
    const priceNote=(product)=>{
      if(product.price!==null&&product.price!==undefined) return 'Preço obtido de '+product.priceSource+'. Confira o preço final e a variação antes de divulgar.';
      if(trace.market==='Mercado Livre'){
        if(!trace.configured)return 'Mercado Livre ainda não conectado por OAuth neste navegador. Acesse Conectar Mercado Livre.';
        if(trace.identifier==='unknown')return 'O link curto não revelou o item ou o catálogo do anúncio. Use a URL completa.';
        if(trace.api==='unauthorized')return 'O Mercado Livre recusou a autorização. Reconecte a conta.';
        if(trace.api==='forbidden')return 'A API retornou 403. Verifique as permissões da aplicação.';
        if(trace.api==='no_buy_box')return 'Produto identificado, mas sem oferta vencedora para confirmar o preço.';
        if(trace.api==='not_found')return 'ID não encontrado pela API. Confira o link.';
        if(trace.api==='title_mismatch')return 'O ID pertence a outro produto. Preço não importado por segurança.';
        return 'Produto identificado, mas sem preço confirmado. Confira o anúncio.';
      }
      if(product.priceSource&&product.priceSource.includes('TikTok')) return 'Preço obtido de '+product.priceSource+'. Confira a variação antes de divulgar.';
      return 'Preço não encontrado nos dados da loja. Confira manualmente antes de divulgar.';
    };
    for(let i=0;i<6;i++){
      const shopeeIds=parseShopeeIds(target.href);
      if(shopeeIds){
        const official=await officialShopeeProduct(shopeeIds,shopeeCreds||{});
        if(official)return {...official,itemId:shopeeIds.itemId,source:official.source||target.hostname,shopeeSource:shopeeCreds?'navegador':'servidor'};
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
      }else if(direct.itemId&&!trace.configured){
        // ID explícito na URL é confiável: tenta a API pública sem token.
        const pub=await publicMLPrice(direct.itemId);
        trace.identifier='item';
        trace.api=pub?'ok':'unavailable';
        if(pub)advancePrice={price:pub.price,oldPrice:pub.oldPrice,priceSource:pub.priceSource};
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
        headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'pt-BR,pt;q=0.9,en;q=0.8'}});
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');
        if(!location)throw Error('O redirecionamento não informou um endereço.');
        target=marketUrl(new URL(location,target).href);
        hops.push(target.href);
        continue;
      }
      if(!response.ok) {
        if(advancePrice)return {...advancePrice,title:'',image:'',category:'',source:target.hostname,
          priceNote:'Preço identificado pela API. Complete título e foto manualmente.'};
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
        const verified=await officialShopeeProduct(canonicalIds,shopeeCreds||{});
        if(verified)return {...verified,itemId:canonicalIds.itemId,source:verified.source||target.hostname,shopeeSource:shopeeCreds?'navegador':'servidor'};
      }
      const mlPage=/mercadolivre|mercadolibre|meli\.la/i.test(hops.join(' '));
      if(mlPage){
        trace.market='Mercado Livre';
        const ids=mercadoIdsFromPage(html,target.href,hops);
        const itemId=ids.itemId||direct.itemId;
        const catalogId=ids.catalogId||direct.catalogId;
        const imageItemId=(!itemId&&product.itemIdSource==='og:image')?product.itemId:'';
        trace.identifier=itemId||imageItemId?'item':catalogId?'catalog':'unknown';
        if(advancePrice)Object.assign(product,advancePrice);
        else if(!trace.configured&&itemId){
          // ID vindo do HTML exige conferir o título antes de usar o preço público.
          const pub=await publicMLPrice(itemId);
          if(pub&&matchingTitle(product.title,pub.title)){
            Object.assign(product,{price:pub.price,oldPrice:pub.oldPrice,priceSource:pub.priceSource});
            trace.api='ok';
          }else trace.api=pub?'title_mismatch':'unavailable';
        }
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
          }else if(imageItemId){
            // ID veio da foto do anúncio (og:image): confirma o título antes de usar.
            const confirmation=await verifyItem(imageItemId,product.title,mlToken);
            if(!confirmation.verified)trace.api=confirmation.status;
            else{
              const official=await officialMLPrice(imageItemId,mlToken);
              trace.api=official?'ok':'unavailable';
              if(official)Object.assign(product,official);
            }
          }
        }
      }
      if(mlPage&&(product.price===null||product.price===undefined)&&product.title){
        // Vitrine/perfil sem ID único: confere candidatos pelo título oficial.
        const match=await matchPublicPriceByTitle(html,product.title,matchingTitle);
        if(match){
          Object.assign(product,{price:match.price,oldPrice:match.oldPrice,
            priceSource:match.priceSource,itemId:product.itemId||match.itemId});
          trace.market='Mercado Livre';trace.identifier='item';trace.api='ok';
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
  const server=createServer(async(req,res)=>{
    try{
      const parsed=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      const path=parsed.pathname;
      if(path==='/health')return send(res,200,{ok:true,version:VERSION,mode:'replicador'});
      if(path==='/api/ml/status'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        return send(res,200,{...sessionStatus(req.headers.cookie),redirectUri:resolveRedirectUri(req)});
      }
      if(path==='/api/ml/start'){
        if(req.method==='POST'){
          // Chaves do PRÓPRIO cliente (painel comercial): vão seladas no cookie
          // de estado, nunca na URL nem nos logs. Devolve JSON, sem redirect.
          let body;
          try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
          try{
            const client=validClientCreds(body.clientId,body.clientSecret);
            const start=createAuthorization(process.env,resolveRedirectUri(req),client,true);
            return send(res,200,{url:start.url},'application/json; charset=utf-8',false,{'set-cookie':start.cookie});
          }catch(e){return send(res,400,{error:e?.message||'Credenciais inválidas.'});}
        }
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        try{
          const start=createAuthorization(process.env,resolveRedirectUri(req));
          res.writeHead(302,{'location':start.url,'set-cookie':start.cookie,
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }catch{return send(res,503,{error:'Configure ML_CLIENT_ID e ML_CLIENT_SECRET no Render.'});}
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
          const detail=(error.message.match(/codigo=([a-z_]{3,40})/)||[])[1]||'';
          const http=(error.message.match(/HTTP (\d{3})/)||[])[1]||'';
          // Só códigos e metadados públicos: nunca segredos, tokens ou o código em si.
          let app='env', codeLen=0, codeSpc=0;
          try{
            app=peekPendingClient(req.headers.cookie,process.env)?.id||'env';
            const rawCode=String(new URL(req.url,`http://${req.headers.host||'localhost'}`).searchParams.get('code')||'');
            codeLen=rawCode.length;
            codeSpc=rawCode.includes(' ') ? 1 : 0;
          }catch{}
          if(reason!=='unknown')console.warn('[ML_OAUTH] etapa='+reason+(http?', http='+http:'')+(detail?', codigo='+detail:', sem codigo do ML')+', app='+app+', codeLen='+codeLen+', spc='+codeSpc);
          res.writeHead(303,{'location':'/?ml=error&reason='+reason+(detail?'&detail='+detail:''),
            'cache-control':'no-store','referrer-policy':'no-referrer'});
          return res.end();
        }
      }
      if(path==='/api/ml/disconnect'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        return send(res,200,{ok:true,connected:false},'application/json; charset=utf-8',false,{'set-cookie':clearSessionCookie()});
      }
      if(path==='/api/ml/diag'){
        // Diagnóstico de rede: trocas fictícias p/ ver se o ML responde com JSON
        // (lógica OAuth alcançável) ou vazio (bloqueio de borda). Sem segredos.
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        try{
          const probe=async(body)=>{
            const r=await fetch('https://api.mercadolibre.com/oauth/token',{method:'POST',
              headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},
              body:new URLSearchParams(body).toString(),
              signal:AbortSignal.timeout(10000),redirect:'error'});
            const t=await r.text();
            return {http:r.status,len:t.length,code:(t.match(/"error"\s*:\s*"([a-z_]{3,40})"/)||[])[1]||null};
          };
          const refresh=await probe({grant_type:'refresh_token',client_id:'0',client_secret:'0',refresh_token:'0'});
          const code=await probe({grant_type:'authorization_code',client_id:'0',client_secret:'0',code:'0',redirect_uri:'https://central-achadinhos.onrender.com/api/ml/callback'});
          return send(res,200,{refresh,code});
        }catch(e){return send(res,200,{error:String(e?.message||e).slice(0,80)});}
      }
      if(path==='/api/integration-status')return send(res,200,{
        mercadoLivre:{configured:Boolean(process.env.ML_CLIENT_ID&&process.env.ML_CLIENT_SECRET),connected:sessionStatus(req.headers.cookie).connected},
        shopee:{appIdConfigured:Boolean(process.env.SHOPEE_APP_ID),appSecretConfigured:Boolean(process.env.SHOPEE_APP_SECRET)},
        whatsapp:(await waStatus().catch(()=>({connected:false})))
      });
      if(path==='/api/preview'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        const chunks=[];let size=0;
        for await(const c of req){size+=c.length;if(size>8192)return send(res,413,{error:'Solicitação grande demais.'});chunks.push(c);}
        let body;
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'JSON inválido.'});}
        if(typeof body.url!=='string'||body.url.length>2000)return send(res,400,{error:'Link inválido.'});
        let shopeeCreds=null;
        try{shopeeCreds=userShopeeCreds(body);}catch(e){return send(res,400,{error:e?.message||'Credenciais Shopee inválidas.'});}
        try{const auth=await getAuthorizedToken(req.headers.cookie);
          return send(res,200,await getPreview(body.url,auth.token||'',shopeeCreds),'application/json; charset=utf-8',false,auth.cookie?{'set-cookie':auth.cookie}:{});}
        catch(e){return send(res,422,{error:e?.message||'Prévia indisponível.'});}
      }
      if(path==='/api/wa/status'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        return send(res,200,await waStatus());
      }
      if(path==='/api/wa/groups'){
        if(req.method!=='GET')return send(res,405,{error:'Método inválido.'});
        const force=parsed.searchParams.get('refresh')==='1';
        return send(res,200,{groups:await waGroups(force)});
      }
      if(path==='/api/wa/send'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        try{
          const out=await waSend(body.message,body.groupIds,body.imageUrl);
          return send(res,201,out);
        }catch(e){return send(res,400,{error:e?.message||'Falha no envio.'});}
      }
      if(path==='/api/wa/logout'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        return send(res,200,await waLogout());
      }
      if(path==='/api/wa/pair'){
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        try{return send(res,200,{code:await waPairCode(body.phone)});}
        catch(e){return send(res,400,{error:e?.message||'Falha ao gerar código.'});}
      }
      if(path==='/api/wa/clone'){
        if(req.method==='GET')return send(res,200,cloneStatus());
        if(req.method!=='POST')return send(res,405,{error:'Método inválido.'});
        let body;
        try{body=await readJson(req);}catch{return send(res,400,{error:'JSON inválido.'});}
        try{return send(res,200,await setClone(body||{}));}
        catch(e){return send(res,400,{error:e?.message||'Falha ao configurar.'});}
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
  startWhatsApp().catch(()=>console.warn('[WA] boot adiado; QR sob demanda.'));
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('Replicador '+VERSION+' na porta '+PORT);
    console.log('MLApp='+Boolean(process.env.ML_CLIENT_ID&&process.env.ML_CLIENT_SECRET)+
      ', ShopeeID='+Boolean(process.env.SHOPEE_APP_ID));
  });
})();
