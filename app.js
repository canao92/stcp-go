/* STCP GO · Porto em Movimento. No mock real-time data. */
(() => {
'use strict';
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
 pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 bus:'<rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 12h14M8 20v2m8-2v2M8 8h.01M16 8h.01"/>',
 route:'<circle cx="6" cy="19" r="2"/><path d="M9 19h6a5 5 0 0 0 0-10h-6a4 4 0 0 1 0-8"/><circle cx="8" cy="3" r="2"/>',
 map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
 search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
 refresh:'<path d="M20 7v-4m0 4h-4M4 17v4m0-4h4"/><path d="M6 9a7 7 0 0 1 12-3l2 1M4 17l2 1a7 7 0 0 0 12-3"/>',
 near:'<path d="m3 11 18-8-8 18-2-8z"/>',
 radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5"/>',
 spark:'<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
 share:'<path d="M12 16V2m0 0L7 7m5-5 5 5M4 13v7h16v-7"/>',
 star:'<path d="m12 2 3.1 6.4 7 1-5.1 5 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-5 7-1z"/>',
 back:'<path d="m15 18-6-6 6-6"/>',
 swap:'<path d="M4 7h16m0 0-4-4m4 4-4 4M20 17H4m0 0 4-4m-4 4 4 4"/>',
 link:'<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>',
 clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 walk:'<circle cx="14" cy="4" r="2"/><path d="m7 21 3-6 2 2 1 4m-3-14 4 2-2 5-4-2m8 0 4 2"/>'
};
const icon = (name,size) => `<svg ${size?`width="${size}" height="${size}"`:''} viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.pin}</svg>`;
$$('[data-icon]').forEach(el => el.innerHTML=icon(el.dataset.icon));

const appleSearchBtn = $('#apple-search');
if (appleSearchBtn) appleSearchBtn.addEventListener('click', () => {
 const origin=$('#google-origin').value.trim(),destination=$('#google-destination').value.trim();
 if (!origin || !destination) {toast('Indica a origem e o destino para abrir no Apple Maps.');return}
 const params=new URLSearchParams({saddr:origin+', Porto, Portugal',daddr:destination+', Porto, Portugal',dirflg:'r'});
 window.open('https://maps.apple.com/?'+params.toString(),'_blank','noopener,noreferrer');
});
const googleSearchBtn = $('#google-search');
if (googleSearchBtn) googleSearchBtn.addEventListener('click', async () => {
 const origin=$('#google-origin').value.trim(),destination=$('#google-destination').value.trim(),out=$('#google-results');
 if(!origin||!destination){out.innerHTML=empty('Preenche os dois locais','Indica a origem e o destino.');return}
 googleSearchBtn.disabled=true;out.textContent='A pesquisar trajetos...';
 try{
  const response=await fetch('/api/google/transit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination})});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Não foi possível pesquisar trajetos.');
  out.innerHTML=(result.journeys||[]).length ? result.journeys.map((j,i)=>'<div class="result-card" style="display:block;padding:15px"><strong>Opção '+(i+1)+' · '+esc(j.duration||'Duração não disponível')+'</strong>'+((j.segments||[]).map(x=>'<p style="margin:10px 0"><strong>'+esc(x.line||'Transporte')+'</strong> · '+esc(x.destination||'')+'<br><small>'+esc(x.from||'')+' → '+esc(x.to||'')+'</small></p>').join('')||'<p>Sem detalhes de linhas disponíveis.</p>')+'</div>').join('') : empty('Sem trajetos encontrados','Experimenta outros locais ou confirma a cobertura no Google Maps.');
 }catch(e){out.innerHTML=empty('Pesquisa indisponível',e.message,'route')}
 finally{googleSearchBtn.disabled=false}
});
const data = {page:'home', ready:false, stop:null, stopLines:[], arrivals:[], chosenLine:'', route:null,
    variants:[], variantIndex:0, from:null, to:null, vehicles:[], vehicleId:'', map:null, mapMarkers:null,
    favourites:JSON.parse(localStorage.getItem('stcp_go_favourites')||'[]'), mapLoaded:false};
let toastTimer;
function toast(message){let el=$('#notify');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4200)}
function empty(title,desc,ico='pin'){return `<div class="empty-state">${icon(ico)}<strong>${esc(title)}</strong><p>${esc(desc)}</p></div>`}
function statusMessage(msg,isError=false){$('#status-text').textContent=msg;$('#sidebar-status').textContent=msg;$('#home-status').style.background=isError?'#fff0ec':'#eaf5f6';$('#home-status').style.color=isError?'#b65f46':'#438781';$('#status-retry').classList.toggle('hidden',!isError)}
async function api(path){
 const res=await fetch(path,{headers:{Accept:'application/json'}});
 let result;
 try{result=await res.json()}catch(_){throw new Error('A fonte de dados não devolveu uma resposta válida.')}
 if(!res.ok) throw new Error(result.error||'Não foi possível obter dados.');
 return result;
}
function debounce(fn,wait=250){let timer;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait)}}
function stopID(s){return s.code||s.id}
function stopOfficial(s){return 'https://stcp.pt/pt/paragem?stop='+encodeURIComponent(stopID(s))}
function mapsTransit(origin,destination){
 let params=new URLSearchParams({api:'1',travelmode:'transit'});
 if(origin)params.set('origin',`${origin.lat},${origin.lon}`);
 if(destination)params.set('destination',`${destination.lat},${destination.lon}`);
 if(!destination&&!origin){params.set('query','STCP Porto');return 'https://www.google.com/maps/search/?'+params}
 if(!destination)params.set('destination',`${origin.lat},${origin.lon}`);
 return 'https://www.google.com/maps/dir/?'+params;
}
function updateURL(params={}){let u=new URL(location.href);u.search='';Object.entries(params).forEach(([k,v])=>{if(v)u.searchParams.set(k,v)});history.replaceState(null,'',u)}
function showPage(page,params=null){
 data.page=page;
 $$('.page').forEach(e=>e.classList.toggle('active',e.id===`page-${page}`));
 $$('[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
 if(params!==null)updateURL(params);
 window.scrollTo({top:0,behavior:'smooth'});
 if(page==='routes')loadRoutes($('#route-search').value);
 if(page==='map')loadMap();
 if(page==='home')renderFavourites();
}
function go(tab){showPage(tab,{})}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
$$('[data-action]').forEach(b=>b.addEventListener('click',()=>{
 const act=b.dataset.action;if(act==='near')nearby();else go(act);
}));
$('#refresh-btn').addEventListener('click',()=>{checkStatus(); if(data.page==='map')loadMap(true);else if(data.stop)loadStop(data.stop.id,false);toast('A atualizar informação...')});
$('#status-retry').addEventListener('click',async()=>{try{await api('/api/reload');toast('A tentar atualizar dados STCP...');checkStatus()}catch(e){toast(e.message)}});

async function checkStatus(){
 try{const res=await api('/api/status');data.ready=res.status==='pronto';
  if(data.ready){statusMessage(`Horários STCP · ${res.routes} linhas e ${res.stops} paragens`);if(data.page==='routes')loadRoutes($('#route-search').value);}
  else statusMessage(res.status==='a carregar'?'A carregar horários oficiais STCP...':res.error||'Dados de horários indisponíveis.',res.status!=='a carregar');
 }catch(e){statusMessage('Servidor indisponível. Verifica a ligação.',true)}
}
async function findStops(q,opts={}){
 const param=opts.lat!=null?`lat=${encodeURIComponent(opts.lat)}&lon=${encodeURIComponent(opts.lon)}`:'q='+encodeURIComponent(q||'');
 return (await api('/api/stops?'+param)).stops||[];
}
function stopRow(s){return `<button class="result-card stop-result" data-stop-id="${esc(s.id)}"><span class="stop-icon">${icon('pin')}</span><span class="result-content"><strong>${esc(s.name)}</strong><small>${esc(s.code||s.id)}${s.zone?' · Zona '+esc(s.zone):''}${s.lines?.length?' · '+s.lines.slice(0,8).map(esc).join(' · '):''}</small></span><span class="result-arrow">→</span></button>`}
function routeRow(r){return `<button class="result-card route-result" data-route-id="${esc(r.id)}"><span class="line-square">${esc(r.number)}</span><span class="result-content"><strong>Linha ${esc(r.number)}</strong><small>${esc(r.name||'Consultar percurso')}</small></span><span class="result-arrow">→</span></button>`}
function renderStopResults(stops){$('#stop-results').innerHTML=stops.length?stops.map(stopRow).join(''):empty('Nenhuma paragem encontrada','Experimenta outro nome ou o código indicado na placa da paragem.');}
const stopSearch=debounce(async()=>{const q=$('#stop-search').value.trim();if(!q){$('#stop-results').innerHTML=empty('Onde vais apanhar o autocarro?','Escreve o nome de uma paragem ou procura por GPS.');return;}try{renderStopResults(await findStops(q))}catch(e){$('#stop-results').innerHTML=empty('Não foi possível pesquisar',e.message)}},230);
$('#stop-search').addEventListener('input',stopSearch);
async function nearby(){go('stops');$('#stop-results').innerHTML='<div class="loading">A procurar paragens próximas...</div>';
 if(!navigator.geolocation){toast('Este dispositivo não suporta localização.');return}
 navigator.geolocation.getCurrentPosition(async pos=>{
  try{let stops=await findStops('',{lat:pos.coords.latitude,lon:pos.coords.longitude});renderStopResults(stops)}
  catch(e){$('#stop-results').innerHTML=empty('Não foi possível localizar paragens',e.message)}
 },error=>{$('#stop-results').innerHTML=empty('Localização não disponível','Ativa a localização nas permissões do navegador e tenta novamente.');toast(error.message)},
 {enableHighAccuracy:true,timeout:11000,maximumAge:60000});
}
$('#near-btn').addEventListener('click',nearby);
const routeSearch=debounce(()=>loadRoutes($('#route-search').value),200);
$('#route-search').addEventListener('input',routeSearch);
async function loadRoutes(query=''){
 try{let routes=(await api('/api/routes?q='+encodeURIComponent(query))).routes||[];
 $('#route-results').innerHTML=routes.length?routes.map(routeRow).join(''):empty('Sem linhas correspondentes','Tenta outro número ou destino.','bus');
 }catch(e){$('#route-results').innerHTML=empty('Dados de linhas indisponíveis',e.message,'bus')}
}
const homeSearch=debounce(async()=>{
 const query=$('#home-search').value.trim();const target=$('#home-results');
 if(!query){target.classList.add('hidden');return}
 try{
  let [stops,routes]=await Promise.all([findStops(query),api('/api/routes?q='+encodeURIComponent(query))]);
  const matches=[...stops.slice(0,4).map(s=>`<button data-stop-id="${esc(s.id)}">${icon('pin')}<strong>${esc(s.name)}</strong><small>Paragem ${esc(s.code)}</small></button>`),
   ...routes.routes.slice(0,4).map(r=>`<button data-route-id="${esc(r.id)}">${icon('bus')}<strong>Linha ${esc(r.number)}</strong><small>${esc(r.name)}</small></button>`)];
  target.innerHTML=matches.join('')||'<div class="loading">Sem resultados</div>';target.classList.remove('hidden');
 }catch(e){target.innerHTML=`<div class="loading">${esc(e.message)}</div>`;target.classList.remove('hidden')}
},260);
$('#home-search').addEventListener('input',homeSearch);

function favourite(s){return data.favourites.some(x=>x.id===s.id)}
function toggleFavourite(){
 if(!data.stop)return;
 if(favourite(data.stop))data.favourites=data.favourites.filter(x=>x.id!==data.stop.id);
 else data.favourites.unshift({id:data.stop.id,name:data.stop.name,code:stopID(data.stop)});
 localStorage.setItem('stcp_go_favourites',JSON.stringify(data.favourites.slice(0,30)));
 toast(favourite(data.stop)?'Paragem guardada nos favoritos.':'Paragem retirada dos favoritos.');
 renderStopDetail();
}
function renderFavourites(){
 $('#favourites-home').innerHTML=data.favourites.length?data.favourites.slice(0,4).map(f=>stopRow(f)).join(''):'<div class="empty-small">Ainda não tens paragens favoritas. Guarda uma paragem com ☆ para a encontrares aqui.</div>';
}
async function loadStop(id, navigate=true){
 if(navigate)showPage('stop-detail',{stop:id});
 $('#stop-detail').innerHTML='<div class="loading">A consultar a paragem STCP...</div>';
 try{const result=await api('/api/stop?id='+encodeURIComponent(id));data.stop=result.stop;data.stopLines=result.lines;data.arrivals=result.arrivals;data.chosenLine=navigate?'':data.chosenLine;
  if(navigate){const url=new URL(location.href);url.searchParams.set('stop',result.stop.id);history.replaceState(null,'',url)}
  renderStopDetail();
 }catch(e){$('#stop-detail').innerHTML=empty('Paragem indisponível',e.message)}
}
function filteredArrivals(){return data.chosenLine?data.arrivals.filter(a=>a.route_id===data.chosenLine):data.arrivals}
function renderStopDetail(){
 const s=data.stop;if(!s)return;
 const now=new Intl.DateTimeFormat('pt-PT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Lisbon'}).format(new Date());
 const arrivals=filteredArrivals();
 $('#stop-detail').innerHTML=`<div class="detail-head"><span class="eyebrow">PARAGEM ${esc(stopID(s))}</span><h1>${esc(s.name)}</h1><p>${s.zone?'Zona Andante '+esc(s.zone)+' · ':''}Horários e próximos autocarros</p><div class="large-symbol">◉</div><div class="detail-actions"><button id="share-stop" class="highlight">${icon('share')} Partilhar chegada</button><button id="fav-stop">${icon('star')} ${favourite(s)?'Guardada':'Guardar'}</button><button id="official-stop">${icon('link')} Tempo real STCP</button><button id="whatsapp-stcp">WhatsApp STCP</button></div></div>
 <div class="detail-title"><h2>Próximas passagens</h2><small>Atualizado às ${now}</small></div><div class="filter-scroll"><button class="line-filter ${!data.chosenLine?'active':''}" data-line-id="">Todas</button>${data.stopLines.map(r=>`<button class="line-filter ${data.chosenLine===r.id?'active':''}" data-line-id="${esc(r.id)}">${esc(r.number)}</button>`).join('')}</div>
 <p class="small-caption"><span class="sub-badge scheduled">${icon('clock')} Horário programado</span> Estes tempos provêm do GTFS e não incluem atrasos. Para chegadas em tempo real, utiliza o botão «Tempo real STCP».</p>
 <div class="list-stack">${arrivals.length?arrivals.map(a=>`<div class="arrival-card"><span class="line-square tiny">${esc(a.line)}</span><span class="result-content"><strong>${esc(a.destination||'Destino não indicado')}</strong><small>Passagem prevista às ${esc(a.time)}</small></span><span class="arrival-eta"><strong>${a.minutes===0?'Agora':a.minutes+' min'}</strong><small>Programado</small></span></div>`).join(''):empty('Sem passagens programadas próximas','Confirma o horário em direto no portal STCP.','clock')}</div>
 <div class="follow-panel"><span class="round">${icon('share')}</span><div><strong>Partilha com quem está à tua espera</strong><p>Envia o tempo programado e um link direto para esta paragem. Quem abrir o link poderá consultar a informação atualizada.</p><button class="text-action" id="share-inline">Partilhar paragem →</button></div></div>`;
 $('#share-stop').onclick=shareStop;$('#share-inline').onclick=shareStop;$('#fav-stop').onclick=toggleFavourite;
 $('#official-stop').onclick=()=>window.open(stopOfficial(s),'_blank','noopener');
 $('#whatsapp-stcp').onclick=()=>window.open('https://wa.me/351226158158?text='+encodeURIComponent(stopID(s)),'_blank','noopener');
 $$('.line-filter').forEach(b=>b.onclick=()=>{data.chosenLine=b.dataset.lineId;renderStopDetail()});
}
async function sharePayload(title,text,url){
 if(navigator.share){try{await navigator.share({title,text,url});return}catch(e){if(e.name==='AbortError')return}}
 const all=text+'\n'+url;
 if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(all);toast('Mensagem e link copiados.');return}catch(_){}}
 window.open('https://wa.me/?text='+encodeURIComponent(all),'_blank','noopener');
}
async function shareStop(){
 if(!data.stop)return;
 let first=filteredArrivals()[0];const s=data.stop;
 const realUrl=stopOfficial(s);
 const appLink=new URL(location.href);appLink.search='';appLink.searchParams.set('stop',s.id);
 if(data.chosenLine)appLink.searchParams.set('line',data.chosenLine);
 const published=!['localhost','127.0.0.1'].includes(location.hostname)&&location.protocol==='https:';
 const url=published?appLink.href:realUrl;
 let message=`🚌 STCP · ${s.name} (paragem ${stopID(s)}).`;
 if(first)message+=`\nLinha ${first.line} — ${first.destination}: passagem PROGRAMADA para as ${first.time} (cerca de ${first.minutes} min no momento da partilha).`;
 message+='\n⏱️ Confirma a chegada em tempo real ao abrir o link; a previsão pode mudar.';
 await sharePayload('STCP GO · '+s.name,message,url);
}
$('#stop-back').onclick=()=>go('stops');

async function loadRoute(id){
 showPage('route-detail',{route:id});$('#route-detail').innerHTML='<div class="loading">A carregar o percurso...</div>';
 try{const d=await api('/api/route?id='+encodeURIComponent(id));data.route=d.route;data.variants=d.variants;data.variantIndex=0;renderRouteDetail();}
 catch(e){$('#route-detail').innerHTML=empty('Percurso indisponível',e.message,'bus')}
}
function renderRouteDetail(){
 const r=data.route;if(!r)return;
 const v=data.variants[data.variantIndex];
 $('#route-detail').innerHTML=`<div class="detail-head"><span class="eyebrow">LINHA STCP</span><h1>${esc(r.number)} <span style="font-size:18px;font-weight:400">${esc(r.name)}</span></h1><p>Consulta os sentidos e as paragens desta linha.</p><div class="detail-actions"><button class="highlight" id="route-official">${icon('link')} Consultar STCP</button></div></div><div class="detail-title"><h2>Sentidos disponíveis</h2><small>${data.variants.length} percursos</small></div><div class="filter-scroll">${data.variants.map((p,i)=>`<button class="variant-filter ${i===data.variantIndex?'active':''}" data-variant="${i}">${esc(p.headsign)} (${p.stops.length})</button>`).join('')}</div>
 ${v?`<div class="detail-title"><h2>Paragens da linha</h2><small>${v.stops.length} paragens</small></div><div class="stop-list">${v.stops.map(s=>`<button class="stop-row" data-stop-id="${esc(s.id)}"><span class="circle"></span><span style="flex:1;min-width:0"><strong>${esc(s.name)}</strong><small>${esc(stopID(s))}</small></span><span class="arrow">→</span></button>`).join('')}</div>`:empty('Sem trajeto publicado','Consulta o portal STCP para esta linha.','route')}`;
 $$('.variant-filter').forEach(b=>b.onclick=()=>{data.variantIndex=Number(b.dataset.variant);renderRouteDetail()});
 $('#route-official').onclick=()=>window.open('https://stcp.pt/pt/linhas','_blank','noopener');
}
$('#route-back').onclick=()=>go('routes');

function setupJourneyInput(name){
 const el=$('#journey-'+name), results=$('#journey-'+name+'-results');
 const update=debounce(async()=>{
  let q=el.value.trim();data[name]=null;
  if(q.length<2){results.classList.add('hidden');return}
  try{let arr=(await findStops(q)).slice(0,8);
   results.innerHTML=arr.length?arr.map(s=>`<button data-choose="${name}" data-id="${esc(s.id)}" data-name="${esc(s.name)}">${esc(s.name)}<small>${esc(stopID(s))}</small></button>`).join(''):'<div class="loading">Nenhuma paragem encontrada</div>';
   results.classList.remove('hidden');
  }catch(e){results.innerHTML='<div class="loading">Pesquisa indisponível</div>';results.classList.remove('hidden')}
 },230);
 el.addEventListener('input',update);el.addEventListener('focus',()=>{if(el.value&&results.childElementCount)results.classList.remove('hidden')});
}
setupJourneyInput('from');setupJourneyInput('to');
$('#swap-btn').onclick=()=>{const left=data.from;data.from=data.to;data.to=left;
  $('#journey-from').value=data.from?.name||'';$('#journey-to').value=data.to?.name||'';
  $('#journey-from-results').classList.add('hidden');$('#journey-to-results').classList.add('hidden');
};
$('#journey-go').onclick=async()=>{
 if(!data.from||!data.to){toast('Seleciona uma paragem de partida e outra de destino na lista de sugestões.');return}
 $('#journey-results').innerHTML='<div class="loading">A analisar os trajetos...</div>';
 try{const res=await api('/api/journey?from='+encodeURIComponent(data.from.id)+'&to='+encodeURIComponent(data.to.id));
  $('#journey-results').innerHTML=res.results.length?res.results.map((r,i)=>`<div class="journey-option"><h3>${r.transfers?'1 mudança de autocarro':'Viagem direta'} <span style="color:#8096a9;font-size:11px;font-weight:500">· ${r.stops} paragens</span></h3><div class="route-path">${r.lines.map((ln,j)=>`${j?'<span>→</span>':''}<span class="line-square">${esc(ln)}</span>`).join('')}</div>${r.via?`<small>Mudar de autocarro em <strong>${esc(r.via.name)}</strong>.</small>`:'<small>Não é necessário mudar de autocarro.</small>'}</div>`).join(''):empty('Não encontrámos um trajeto direto ou com uma mudança','O planeador do Google Maps poderá mostrar percursos com mais ligações.','route');
  $('#journey-results').innerHTML+=`<button class="secondary-btn full" id="external-planner">${icon('map')} Ver tempos reais e navegação no Google Maps ↗</button>`;
  $('#external-planner').onclick=()=>window.open(mapsTransit(data.from,data.to),'_blank','noopener');
 }catch(e){$('#journey-results').innerHTML=empty('Não foi possível calcular o percurso',e.message,'route')}
};

function ensureMap(){
 if(data.map)return true;
 if(typeof L==='undefined'){$('#map').innerHTML='<div class="map-fallback">Não foi possível carregar o mapa. Confirma a ligação à Internet.</div>';return false}
 $('#map').innerHTML='';data.map=L.map('map',{zoomControl:true}).setView([41.1579,-8.6291],12);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(data.map);
 data.mapMarkers=L.layerGroup().addTo(data.map);return true;
}
async function loadMap(force=false){
 if(!ensureMap())return;
 setTimeout(()=>data.map.invalidateSize(),80);
 $('#gps-status').textContent='A atualizar posições GPS...';
 try{
  const res=await api('/api/vehicles');
  if(!Array.isArray(res.vehicles))throw new Error(res.error||'Localização em tempo real indisponível.');
  data.vehicles=res.vehicles;data.mapMarkers.clearLayers();
  for(const v of data.vehicles){
   let html=`<div class="bus-marker">${esc(v.line&&v.line.length<5?v.line:'🚌')}</div>`;
   let marker=L.marker([v.lat,v.lon],{icon:L.divIcon({className:'map-leaflet-icon',html,iconSize:[32,32],iconAnchor:[16,16]})}).addTo(data.mapMarkers);
   marker.on('click',()=>pickVehicle(v.id));
  }
  $('#gps-status').textContent=`${data.vehicles.length} posições GPS publicadas`;
  if(data.vehicleId)pickVehicle(data.vehicleId);
  if(force)toast('Mapa de autocarros atualizado.');
 }catch(e){$('#gps-status').textContent='GPS indisponível';toast('Posições GPS: '+e.message)}
}
function pickVehicle(id){
 const v=data.vehicles.find(x=>x.id===id);if(!v){$('#vehicle-card').classList.add('hidden');return}
 data.vehicleId=id;data.map.setView([v.lat,v.lon],15);
 $('#vehicle-card').classList.remove('hidden');
 $('#vehicle-card').innerHTML=`<div><strong>🚌 Autocarro ${esc(v.line||'STCP')}</strong><small>ID ${esc(v.id.slice(-23))}${v.observed?' · '+esc(v.observed):''}</small></div><button id="vehicle-share">${icon('share')} Partilhar</button>`;
 $('#vehicle-share').onclick=()=>shareVehicle(v);
}
async function shareVehicle(v){
 const appLink=new URL(location.href);appLink.search='';appLink.searchParams.set('vehicle',v.id);
 const published=!['localhost','127.0.0.1'].includes(location.hostname)&&location.protocol==='https:';
 const url=published?appLink.href:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(`${v.lat},${v.lon}`);
 await sharePayload('STCP GO · Autocarro','🚌 Acompanha a posição indicada deste autocarro STCP no mapa. A localização depende da fonte de GPS e pode deixar de estar disponível.',url);
}
$('#map-refresh').onclick=()=>loadMap(true);
$('#maps-open').onclick=()=>window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent('STCP Porto'),'_blank','noopener');

// Delegated clicks also work on dynamically rendered content.
document.addEventListener('click',ev=>{
 const stop=ev.target.closest('[data-stop-id]');if(stop){$('#home-results').classList.add('hidden');loadStop(stop.dataset.stopId);return}
 const route=ev.target.closest('[data-route-id]');if(route){$('#home-results').classList.add('hidden');loadRoute(route.dataset.routeId);return}
 const opt=ev.target.closest('[data-choose]');if(opt){const name=opt.dataset.choose;
  data[name]={id:opt.dataset.id,name:opt.dataset.name};$('#journey-'+name).value=opt.dataset.name;
  $('#journey-'+name+'-results').classList.add('hidden');return}
 if(!ev.target.closest('.journey-input-wrap'))$$('.autocomplete').forEach(c=>c.classList.add('hidden'));
 if(!ev.target.closest('#home-results')&&!ev.target.closest('#home-search'))$('#home-results').classList.add('hidden');
});

// Link routes for sharing; do not confuse locally hosted links with public URLs.
async function routeFromURL(){
 const u=new URL(location.href), stop=u.searchParams.get('stop'),route=u.searchParams.get('route'),vehicle=u.searchParams.get('vehicle');
 if(stop){await loadStop(stop);const line=u.searchParams.get('line');if(line){data.chosenLine=line;renderStopDetail()}}
 else if(route)await loadRoute(route);
 else if(vehicle){showPage('map',{vehicle});data.vehicleId=vehicle;await loadMap();}
}
async function start(){
 renderFavourites();await checkStatus();await routeFromURL();
 const iv=setInterval(()=>{if(data.page==='stop-detail'&&data.stop)loadStop(data.stop.id,false);if(data.page==='map')loadMap();},45_000);
 setInterval(()=>{if(!data.ready)checkStatus()},12000);
 if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
start();
})();
