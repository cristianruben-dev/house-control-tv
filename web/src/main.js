import './polyfills.js';
import './style.css';
import './theme.css';
import { createElement, House, Settings2, ChevronLeft, ChevronRight, Lightbulb, Power, Minus, Plus, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw, SunMoon, Layers, Image } from 'lucide';
import QRCode from 'qrcode';
import { normalize } from './vendor/config.js';
import { createWorld } from './vendor/three/world.js';
import { api, nativeConfig, remoteURL } from './api.js';

const app = document.querySelector('#app');
const $ = (s) => document.querySelector(s);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const icons = { House, Settings2, Lightbulb, Power, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw, Minus, Plus, ChevronLeft, ChevronRight, SunMoon, Layers, Image };

/**
 * The look: dark or light mode tints the glass darker or lighter, by its opacity in percent, over one of the
 * launcher's wallpapers. It comes from the launcher through House Control's service, or from this app's settings,
 * whichever was chosen last. Without either (the phone), dark at 15 % over the forest.
 */
const WALLPAPERS=import.meta.glob('./assets/wallpapers/*.jpg',{eager:true,import:'default'});
const THUMBS=import.meta.glob('./assets/wallpapers/thumbs/*.jpg',{eager:true,import:'default'});
const wallpaperFile=path=>path.split('/').pop();
const WALLPAPER_NAMES=Object.keys(WALLPAPERS).map(wallpaperFile).sort();
const DEFAULT_WALLPAPER='bosque_al_atardecer.jpg';
/** The look each wallpaper reads best with, the same as the launcher's (Wallpapers.java). */
const PRESETS={
  'acantilados_estelares.jpg':{mode:'dark',opacity:45},'bajo_el_mar.jpg':{mode:'light',opacity:55},
  'bosque_al_atardecer.jpg':{mode:'dark',opacity:30},'cometa_sobre_las_nubes.jpg':{mode:'dark',opacity:30},
  'icebergs_al_atardecer.jpg':{mode:'light',opacity:50},'mirando_los_planetas.jpg':{mode:'dark',opacity:30},
  'nebulosa_roja.jpg':{mode:'dark',opacity:35},'portal_en_ruinas.jpg':{mode:'dark',opacity:30},
};
/** Light mode puts dark text on the glass: below this much white it would not read over a dark picture. */
const LIGHT_MIN=40,OPACITY_STEP=5;
const opacityMin=mode=>mode==='light'?LIGHT_MIN:0;
let appearance={mode:'dark',opacity:15,wallpaper:DEFAULT_WALLPAPER};
function applyAppearance(a){
  const mode=a?.mode==='light'?'light':'dark';
  const opacity=Math.max(opacityMin(mode),Math.min(100,Math.round(Number(a?.opacity??15))));
  const wallpaper=WALLPAPER_NAMES.includes(a?.wallpaper)?a.wallpaper:DEFAULT_WALLPAPER;
  appearance={mode,opacity,wallpaper};
  const o=opacity/100,rgb=mode==='light'?'255,255,255':'0,0,0';
  const root=document.documentElement;root.dataset.mode=mode;
  root.style.setProperty('--sheen',`linear-gradient(180deg, rgba(${rgb},${(o*4/3).toFixed(3)}), rgba(${rgb},${(o*2/3).toFixed(3)}))`);
  root.style.setProperty('--rim',mode==='light'?'rgba(255, 255, 255, .3)':'rgba(255, 255, 255, .2)');
  root.style.setProperty('--wallpaper',`url("${WALLPAPERS['./assets/wallpapers/'+wallpaper]}")`);
}
function savedAppearance(){try{return JSON.parse(localStorage.getItem('house-tv:appearance'));}catch{return null;}}
applyAppearance(nativeConfig?.appearance||savedAppearance());window.applyAppearance=applyAppearance;
/** A look chosen in the settings: shown at once and kept (on the TV, newer than the launcher's until it changes). */
function setAppearance(next){
  applyAppearance(next);
  if(window.HouseTV?.setAppearance)window.HouseTV.setAppearance(JSON.stringify(appearance));
  else try{localStorage.setItem('house-tv:appearance',JSON.stringify(appearance));}catch{}
  modal?.paintSettings?.();
}
function icon(name, size = 24) { return createElement(icons[name] || House, { width: size, height: size, 'stroke-width': 1.65 }); }
function button(label, name, action, cls = '') {
  const b = el('button', cls); b.type = 'button'; b.setAttribute('aria-label', label);
  if (name) b.append(icon(name)); if (label) b.append(el('span', '', label)); b.onclick = action; return b;
}
const modes = { cool: 'Enfriando', heat: 'Calentando', auto: 'Automático', dry: 'Secado', fan: 'Ventilador' };
let config, bundle, world, resizeObserver, deviceKind = 'lights', room = 'all', online = false, busy = false, orbiting = false, modal = null, lastFocus = null;
let store = { state: { lights: {}, acs: {}, scene: null }, listeners: new Set(), on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } };
let lightNodes = new Map(), acNodes = new Map(), sceneNodes = new Map();
let toastTimer;
// The 3D view draws at the screen's full resolution, also on small TV chips: a lower one looked blurry.
const RES=1;
function toast(message) { const n = $('#toast'); if (!n) return; n.textContent = message; n.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('visible'), 4500); }
function emit() { for (const fn of store.listeners) fn({ type: 'bulk', remote: true }); }
function apply(next) {
  bundle = next; online = !!(next.controlReady ?? next.macOnline);
  const changed = JSON.stringify(store.state) !== JSON.stringify(next.state);
  store.state = structuredClone(next.state); if (changed) emit(); update();
  try { localStorage.setItem('house-tv:last-home:v1', JSON.stringify(next)); } catch {}
}
function available() { return online; }
async function command(action) {
  if (busy) return;
  if (!available()) { toast(bundle?.mode === 'standalone' ? (bundle.connectionLabel || 'Conecta tus dispositivos') + ' en Sincronizar y conectar.' : 'Abre House Control y TV Bridge en tu Mac para controlar los dispositivos.'); return; }
  busy = true; app.classList.add('pending');
  try {
    const result = await api('/api/action', action); apply(result.home);
    toast(result.direct ? (action.kind === 'acTarget' ? 'Temperatura guardada en la TV' : 'Dispositivo actualizado directamente') : 'Orden enviada a House Control');
  } catch (error) { toast(error.message); }
  finally { busy = false; app.classList.remove('pending'); }
}
function roomName(id) { return config.rooms.find(r => r.id === id)?.name || ''; }
function selectRoom(id) {
  room = id; world?.focus(id === 'all' ? null : { kind: 'room', id });
  for (const b of document.querySelectorAll('[data-room]')) { const selected = b.dataset.room === id; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', selected); }
  renderDevices(); update();
}
function renderDevices() {
  const list = $('#device-list'); list.replaceChildren(); lightNodes.clear(); acNodes.clear();
  // This TV only switches lights (no climate), grouped in one section per room, in the plan's room order.
  const lights = config.lights.filter(d => room === 'all' || d.room === room);
  $('#device-count').textContent = String(lights.length);
  if (!lights.length) list.append(el('p', 'empty', 'No hay luces en este cuarto.'));
  for (const r of config.rooms) {
    const inRoom = lights.filter(d => d.room === r.id);
    if (!inRoom.length) continue;
    const section = el('section', 'device-section'); const grid = el('div', 'light-grid');
    section.append(el('h3', '', r.name), grid); list.append(section);
    for (const d of inRoom) grid.append(lightTile(d));
  }
}
/** A light as a tile in its room's 3-column grid: the lit tile shows the state, so no on/off text or switch. */
function lightTile(d) {
  const b = el('button', 'light-row'); b.type = 'button';
  const lamp = el('span', 'light-icon'); lamp.append(icon('Lightbulb'));
  const title = el('span', 'light-title'); title.append(el('strong', '', d.name));
  b.append(lamp, title); b.onclick = () => command({ kind: 'light', id: d.id, on: !store.state.lights[d.id].on });
  // On small TV chips the 3D lamp highlight would redraw the model on every move; keep focus instant there.
  b.onfocus = () => { const u = world?.lights.get(d.id); if (u && RES === 1) { u.hoverGoal = 1; world.setRunning(true); } };
  b.onblur = () => { const u = world?.lights.get(d.id); if (u && RES === 1) { u.hoverGoal = 0; world.setRunning(true); } };
  lightNodes.set(d.id, { b, lamp });
  return b;
}
function update() {
  if (!config || !$('#status')) return;
  const on = Object.values(store.state.lights).filter(s => s.on).length;
  $('#status').textContent = bundle?.mode === 'standalone' ? (bundle.connectionLabel || (online ? 'TV conectada' : 'Conecta tus dispositivos en la TV')) : online ? 'Sincronizado con la Mac' : 'Mac sin conexión · solo ver';
  $('#status').classList.toggle('offline', !online);
  $('#lights-on').textContent = on;
  $('#lights-total').textContent = 'de ' + config.lights.length + ' encendidas';
  $('#active-scene').textContent = config.scenes.find(s => s.id === store.state.scene)?.name || 'Control manual';
  for (const [id, n] of lightNodes) {
    const s = store.state.lights[id]; if (!s) continue;
    n.b.classList.toggle('on', s.on); n.b.setAttribute('aria-pressed', String(s.on));
    n.b.setAttribute('aria-label', `${config.lights.find(d=>d.id===id).name}, ${s.on ? 'encendida' : 'apagada'}`);
    n.b.disabled = !available();
  }
  for (const [id, n] of acNodes) {
    const s = store.state.acs[id]; if (!s) continue;
    const d = config.acs.find(d => d.id === id);
    n.card.classList.toggle('on', s.on); n.power.setAttribute('aria-pressed', String(s.on));
    n.target.replaceChildren(document.createTextNode(s.target), el('span', '', '°'));
    n.mode.textContent = s.on ? modes[s.mode] || s.mode : 'Apagado';
    n.current.textContent = Number.isFinite(s.roomTemp) ? `${Math.round(s.roomTemp * 10) / 10}° en el cuarto` : 'Sin sensor';
    n.power.disabled = !available(); n.minus.disabled = !available() || s.target <= d.min; n.plus.disabled = !available() || s.target >= d.max;
  }
  for (const [id, b] of sceneNodes) { b.classList.toggle('active', id === store.state.scene); b.setAttribute('aria-pressed', id === store.state.scene); b.disabled = !available(); }
  $('#all-off').disabled = !available();
}
function sceneIcon(s) { return ({ sun:'Sun', sofa:'Sofa', film:'Film', moon:'Moon', door:'DoorOpen' })[s.icon] || 'Sun'; }
function render() {
  app.replaceChildren(); sceneNodes.clear();
  const header = el('header');
  const connection = el('div','connection'); const status = el('span'); status.id='status';
  const clock = el('time'); clock.id='clock';
  connection.append(status, clock, button('Ajustes', 'Settings2', ()=>openSettings(), 'settings-button'), button('Sincronizar y conectar', 'Smartphone', openSync, 'sync-button'));
  header.append(connection);
  const tabs = el('nav','rooms'); tabs.setAttribute('aria-label','Cuartos');
  for (const r of [{id:'all',name:'Toda la casa'}, ...config.rooms]) {
    const b = button(r.name, r.id==='all'?'House':null,()=>selectRoom(r.id),'room-tab'); b.dataset.room=r.id; b.classList.toggle('selected',r.id===room); b.setAttribute('aria-pressed',r.id===room); tabs.append(b);
  }
  const layout = el('main','layout');
  const stage = el('section','stage');
  const homeName = el('div','home-name',config.name);
  const canvas = el('canvas'); canvas.id='world'; canvas.setAttribute('aria-label','Modelo 3D interactivo de la casa');
  const stats = el('div','stats');
  const lightStat=el('div'); const on=el('strong'); on.id='lights-on'; const total=el('small'); total.id='lights-total'; lightStat.append(icon('Lightbulb'),on,total);
  const sceneStat=el('div'); const sc=el('strong'); sc.id='active-scene'; sceneStat.append(icon('Sofa'),sc,el('small','','Escena actual'));
  stats.append(lightStat,sceneStat);
  stage.append(canvas,homeName,stats);
  const aside = el('aside','controls'); const heading=el('div','controls-heading'); const count=el('span');count.id='device-count';heading.append(el('h2','','Luces'),count);
  const off=button('Apagar luces','Power',()=>command({kind:room==='all'?'allLights':'room',...(room==='all'?{}:{id:room}),on:false}),'all-off'); off.id='all-off';
  const list=el('div','device-list'); list.id='device-list'; aside.append(heading,off,list);
  // Scenes: their own card between the model and the lights, in columns of four (up to two columns).
  const scenes=el('section','scenes'); const sceneHeading=el('div','controls-heading'); const sceneCount=el('span',''); sceneCount.textContent=String(Math.min(8,config.scenes.length));
  sceneHeading.append(el('h2','','Escenas'),sceneCount);
  const sceneList=el('div','scene-list');
  for (const s of config.scenes.slice(0,8)) { const b=button(s.name,sceneIcon(s),()=>command({kind:'scene',id:s.id}),'scene-button'); sceneList.append(b);sceneNodes.set(s.id,b); }
  if (!config.scenes.length) sceneList.append(el('p','empty','Agrega escenas en House Control en tu Mac.'));
  scenes.append(sceneHeading,sceneList);
  layout.append(stage,scenes,aside);
  const toastNode=el('div','toast');toastNode.id='toast';toastNode.setAttribute('role','status');
  app.append(header,tabs,layout,toastNode);
  renderDevices(); update(); tickClock();
  try {
    world=createWorld(canvas,config,store,{background:'transparent',resolution:()=>RES,onHover(){},onPick(t){if(!t)return;if(t.kind==='room')selectRoom(t.id);if(t.kind==='light')command({kind:'light',id:t.id,on:!store.state.lights[t.id].on});}});
    world.setInsets(24,38);world.setRunning(true);world.intro();
    setTimeout(()=>console.info('TV_RENDER_STATS',JSON.stringify(world?.stats())),6000);
    resizeObserver?.disconnect(); resizeObserver=new ResizeObserver(()=>world?.resize()); resizeObserver.observe(canvas);
  } catch(error) { stage.append(el('div','render-error','El 3D no está disponible en este dispositivo. Puedes seguir usando los controles de la derecha.')); console.error(error); }
  requestAnimationFrame(()=>tabs.querySelector('button').focus({preventScroll:true}));
  window.__houseTV={get config(){return config;},get state(){return store.state;},get online(){return online;},get world(){return world;},command,selectRoom};
}
function tickClock(){if($('#clock'))$('#clock').textContent=new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});}
setInterval(tickClock,15000);
let modalCleanup = null;
function closeModal(){modalCleanup?.();modalCleanup=null;modal?.remove();modal=null;lastFocus?.focus();}
/**
 * Settings: a dialog with its sections on the left (about 30 %) and the focused section's options on the right,
 * like the launcher's. Theme, glass opacity and wallpaper; a wallpaper brings the theme and opacity that suit it.
 */
function openSettings(start='theme'){
  if(modal)closeModal();
  lastFocus=document.activeElement;modal=el('div','modal-backdrop settings-backdrop');modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Ajustes');
  const panel=el('section','settings-panel'),side=el('nav','settings-side'),content=el('div','settings-content');
  side.append(el('h2','','Ajustes'));
  const sections={theme:['Tema','SunMoon'],glass:['Vidrio','Layers'],wallpaper:['Fondo','Image']};
  const tabs={};let current=null;
  for(const [key,[label,name]] of Object.entries(sections)){
    const b=button(label,name,()=>firstOption()?.focus(),'settings-section');b.dataset.section=key;tabs[key]=b;side.append(b);
    b.onfocus=()=>show(key);
  }
  panel.append(side,content);modal.append(panel);document.body.append(modal);
  const firstOption=()=>content.querySelector('.checked')||content.querySelector('button');
  function show(key){
    if(key===current)return;current=key;
    for(const b of Object.values(tabs))b.classList.toggle('active',b.dataset.section===key);
    content.replaceChildren(el('h3','',sections[key][0]));
    if(key==='theme'){
      content.append(el('p','settings-hint','Modo oscuro: vidrio oscuro y texto blanco. Modo claro: vidrio blanco y texto oscuro.'));
      for(const [mode,label] of [['dark','Oscuro'],['light','Claro']]){const b=button(label,null,()=>setAppearance({...appearance,mode}),'settings-row option');b.dataset.theme=mode;content.append(b);}
    }else if(key==='glass'){
      content.append(el('p','settings-hint','Cuánto tiñe el vidrio el fondo de pantalla. Izquierda y derecha lo cambian; el modo claro deja al menos 40 % para que su texto oscuro se lea.'));
      const slider=el('button','settings-row opacity-row');slider.type='button';slider.setAttribute('aria-label','Opacidad del vidrio');
      const value=el('span','opacity-value'),bar=el('span','opacity-bar'),fill=el('i');bar.append(fill);
      slider.append(el('span','','Opacidad'),value,bar);content.append(slider);
    }else{
      content.append(el('p','settings-hint','Las mismas imágenes que la pantalla de inicio. Cada una trae el tema y la opacidad que mejor le quedan.'));
      const grid=el('div','wallpaper-grid');
      for(const name of WALLPAPER_NAMES){
        const b=el('button','wallpaper-tile');b.type='button';b.dataset.wallpaper=name;
        b.setAttribute('aria-label',name.replace('.jpg','').replace(/_/g,' '));
        b.style.setProperty('--thumb',`url("${THUMBS['./assets/wallpapers/thumbs/'+name]}")`);
        b.onclick=()=>setAppearance({...appearance,...PRESETS[name],wallpaper:name});
        grid.append(b);
      }
      content.append(grid);
    }
    paint();
  }
  function paint(){
    for(const b of content.querySelectorAll('[data-theme]'))b.classList.toggle('checked',b.dataset.theme===appearance.mode);
    for(const b of content.querySelectorAll('[data-wallpaper]'))b.classList.toggle('checked',b.dataset.wallpaper===appearance.wallpaper);
    const value=content.querySelector('.opacity-value');
    if(value){value.textContent='‹ '+appearance.opacity+'% ›';content.querySelector('.opacity-bar i').style.width=appearance.opacity+'%';}
  }
  modal.paintSettings=paint;
  // Back leaves the options for the sections first, then closes the settings.
  modal.back=()=>{if(content.contains(document.activeElement))tabs[current].focus();else closeModal();};
  modal.side=side;modal.content=content;modal.activeSection=()=>tabs[current];modal.firstOption=firstOption;
  tabs[start].focus();
}
async function openSync(){
  if (nativeConfig?.mode === 'standalone' || bundle?.mode === 'standalone') return openStandaloneSync();
  lastFocus=document.activeElement;modal=el('div','modal-backdrop');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Sincronizar y conectar');
  const panel=el('section','sync-panel'); const close=button('Volver al inicio','ArrowLeft',closeModal,'back-button');
  panel.append(close,el('p','eyebrow','TU CASA. EN CADA PANTALLA.'),el('h2','','Una casa. Siempre sincronizada.'),el('p','sync-description','Tu plano, escenas y estados de los dispositivos vienen de House Control en tu Mac. Los cambios en la app aparecen aquí solos.'));
  const content=el('div','sync-content');const qr=el('canvas','qr');
  const text=el('div');text.append(el('h3','','Ábrela en tu iPhone'),el('p','','Escanea con la cámara para controlar esta misma casa desde tu teléfono por Wi-Fi.'),el('p','sync-note','Para sincronizar los ajustes desde la app del iPhone, vincúlalo con tu Mac en House Control → Vincular iPhone. Deja House Control y TV Bridge abiertos en tu Mac.'));
  if(nativeConfig?.endpoint || !nativeConfig){content.append(qr,text);QRCode.toCanvas(qr,remoteURL(bundle?.endpoint),{width:220,margin:2,errorCorrectionLevel:'M',color:{dark:'#0a0e1a',light:'#ffffff'}}).catch(()=>qr.remove());}
  else text.append(el('p','','Conecta tu TV ejecutando ./house-tv/deploy.py en tu Mac.'));
  panel.append(content,el('div','sync-state',online?'Conectada a la Mac · se actualiza cada 2 segundos':'La Mac está sin conexión. Se muestra tu última casa guardada.'));
  modal.append(panel);document.body.append(modal);close.focus();
}
async function openStandaloneSync() {
  if (modal) closeModal();
  lastFocus=document.activeElement;modal=el('div','modal-backdrop');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Conexiones de la TV');
  const panel=el('section','sync-panel');const close=button('Volver al inicio','ArrowLeft',closeModal,'back-button');
  const content=el('div','standalone-content');panel.append(close,content);modal.append(panel);document.body.append(modal);close.focus();
  const owner=modal;let timer=0;modalCleanup=()=>clearTimeout(timer);
  const alive=()=>modal===owner;let pages=0;
  const message=el('p','sync-note');message.setAttribute('role','status');
  async function showHome() {
    clearTimeout(timer);content.replaceChildren();owner.back=null;const page=++pages;
    let status;
    try { status=await api('/api/connections'); } catch(error) {content.append(el('p','setup-error',error.message));return;}
    if(!alive()||pages!==page)return;
    const ha=status.homeassistant,hue=status.hue,connected=[ha.connected&&'Home Assistant',hue.connected&&'Hue'].filter(Boolean);
    content.append(el('p','eyebrow','TU TV. TU CASA.'),el('h2','',connected.length?'Lista sin tu Mac':'Conecta tus dispositivos a esta TV'),el('p','sync-description',connected.length?'Tu TV guarda esta casa y manda las órdenes directo a tus dispositivos. Tu Mac puede estar apagada.':'Conecta Home Assistant o vincula un Hue Bridge de Philips. La TV habla con ellos directo por tu Wi-Fi.'));
    content.append(el('div','sync-state',connected.length?connected.join(' · ')+' conectado · credenciales guardadas en esta TV':'Todavía no hay ningún hub conectado'));
    const remote=el('div','sync-content');const qr=el('canvas','qr');const text=el('div');text.append(el('h3','','Controla desde tu teléfono'),el('p','','Escanea este enlace privado con la cámara. Tu teléfono se conecta directo a esta TV por Wi-Fi. Mantén la TV despierta con House Control o Luma abierta.'),el('p','sync-note','Los ajustes se sincronizan solos desde tu Mac vinculada cuando está despierta. Tu TV guarda el estado de sus dispositivos y funciona con la Mac apagada. También puedes importar un plano JSON desde tu teléfono.'));
    remote.append(qr,text);content.append(remote);QRCode.toCanvas(qr,remoteURL(bundle?.endpoint),{width:260,margin:2,color:{dark:'#0a0e1a',light:'#ffffff'}}).catch(()=>qr.remove());
    const file=el('input','plan-file');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Importar plano de House Control');
    file.onchange=async()=>{if(!file.files?.[0])return;try{const data=JSON.parse(await file.files[0].text());await api('/api/import',data);toast('Plano guardado en la TV');closeModal();}catch(error){message.textContent=error.message;}};
    const importRow=el('div','import-row');importRow.append(el('span','','Importar plano JSON'),file);if(!nativeConfig)content.append(importRow);content.append(message);
    content.append(button('Home Assistant y Hue','Wifi',showServices,connected.length?'secondary':'primary'));
    // Coming back from the hubs page the focused button is gone: land on the hubs button again.
    if(!modal.contains(document.activeElement))content.querySelector('button')?.focus();
  }
  async function showServices() {
    // A search still running when this page is left must not draw it again.
    const page=++pages,alive=()=>modal===owner&&pages===page;
    clearTimeout(timer);content.replaceChildren(el('h2','','Buscando tus hubs…'));owner.back=showHome;
    let status,found={homeassistant:[],hue:[]};
    try{status=await api('/api/connections');}catch(error){content.replaceChildren(el('p','setup-error',error.message),button('Atrás','ArrowLeft',showHome,'secondary'));return;}
    if(!alive())return;
    const render=()=>{
      const note=el('p','sync-note');note.setAttribute('role','status');
      content.replaceChildren(el('p','eyebrow','HUBS LOCALES · SIN MAC'),el('h2','','Home Assistant y Philips Hue'),el('p','sync-description','La TV habla con ellos directo por tu Wi-Fi. Las credenciales se cifran en esta TV. Apple Home solo funciona en iPhone; agrega los dispositivos HomeKit o Matter a Home Assistant para controlarlos aquí.'));
      const ha=status.homeassistant,hue=status.hue;
      content.append(el('h3','',ha.connected?`Home Assistant · ${ha.name}`:'Home Assistant'));
      if(ha.connected){content.append(el('div','sync-state',`Conectado a ${ha.url}${ha.source==='mac'?' · desde tu Mac':''}${ha.lastError?' · '+ha.lastError:''}`),button('Desconectar Home Assistant','Power',async()=>{status=await api('/api/homeassistant/disconnect',{});render();},'secondary'));}
      else{
        const form=el('div','login-form');const urlLabel=el('label','','Dirección del servidor');urlLabel.htmlFor='ha-url';const url=el('input');url.id='ha-url';url.placeholder='http://192.168.1.20:8123';url.value=found.homeassistant[0]?.url||'';url.autocomplete='off';url.spellcheck=false;
        const tokenLabel=el('label','','Token de acceso de larga duración');tokenLabel.htmlFor='ha-token';const token=el('input');token.id='ha-token';token.type='password';token.autocomplete='off';token.placeholder='Perfil → Seguridad → Tokens de acceso de larga duración';
        const connect=button('Conectar','Check',async()=>{connect.disabled=true;note.textContent='Comprobando…';try{status=await api('/api/homeassistant/connect',{url:url.value,token:token.value});toast('Home Assistant conectado a tu TV');render();}catch(error){note.textContent=error.message;connect.disabled=false;}},'primary');
        form.append(urlLabel,url,el('span'),tokenLabel,token,connect);content.append(form);
        for(const s of found.homeassistant)content.append(button(`Usar ${s.name}`,'Wifi',()=>{url.value=s.url;token.focus();},'secondary'));
        content.append(el('p','sync-note',nativeConfig?'Escribir un token con el control es lento: abre el enlace privado en tu teléfono desde Sincronizar y conectar y pégalo ahí.':'Pega el token aquí; va directo a la TV y se queda ahí.'));
      }
      content.append(el('h3','',hue.connected?`Philips Hue · ${hue.name}`:'Philips Hue'));
      if(hue.connected){content.append(el('div','sync-state',`Vinculado con ${hue.host}${hue.source==='mac'?' · desde tu Mac':''}${hue.lastError?' · '+hue.lastError:''}`),button('Olvidar Hue Bridge','Power',async()=>{status=await api('/api/hue/disconnect',{});render();},'secondary'));}
      else{
        const form=el('div','login-form');const hostLabel=el('label','','Dirección del bridge');hostLabel.htmlFor='hue-host';const host=el('input');host.id='hue-host';host.placeholder='192.168.1.30';host.value=found.hue[0]?.host||'';host.autocomplete='off';host.spellcheck=false;
        const pair=button('Vincular','Lightbulb',()=>pairHue({host:host.value,bridgeId:found.hue.find(b=>b.host===host.value)?.bridgeId||'',name:found.hue.find(b=>b.host===host.value)?.name||''},note),'primary');
        form.append(hostLabel,host,pair);content.append(form);
        for(const b of found.hue)content.append(button(`Vincular ${b.name}`,'Lightbulb',()=>pairHue(b,note),'secondary'));
        content.append(el('p','sync-note','Elige Vincular y luego presiona el botón redondo encima del bridge antes de un minuto. Se recuerda el certificado del bridge, así que se rechaza otro aparato en su dirección.'));
      }
      content.append(note,button('Buscar de nuevo en la red','RefreshCw',discover,'secondary'),button('Atrás','ArrowLeft',showHome,'secondary'));
      // A button, not a text field: focusing a field brings up the TV's on-screen keyboard over the page.
      if(!modal.contains(document.activeElement))content.querySelector('button')?.focus();
    };
    async function pairHue(bridge,note){
      const started=Date.now();note.textContent='Presiona el botón redondo del Hue Bridge…';
      while(alive()&&Date.now()-started<60000){
        try{const result=await api('/api/hue/pair',{host:bridge.host,bridgeId:bridge.bridgeId||'',name:bridge.name||''});if(!alive())return;if(!result.buttonRequired){status=result;toast('Hue Bridge vinculado con tu TV');render();return;}}
        catch(error){if(alive())note.textContent=error.message;return;}
        await new Promise(r=>{timer=setTimeout(r,2000);});
      }
      if(alive())note.textContent='No se presionó el botón a tiempo. Elige Vincular para intentarlo de nuevo.';
    }
    async function discover(){try{found=await api('/api/connections/discover',{});}catch{}if(alive())render();}
    render();if(!status.homeassistant.connected||!status.hue.connected)discover();
  }
  await showHome();
}
function focusables(){return [...(modal||app).querySelectorAll('button:not(:disabled),input,[tabindex="0"]')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);}
function navigate(key){
  const all=focusables(),current=document.activeElement;
  const focus=(n)=>{if(n){n.focus({preventScroll:true});n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}return true;};
  const selectedRoom=()=>document.querySelector('[data-room="'+room+'"]');
  // No device filters any more: "the top of the device panel" is the Lights off button.
  const deviceFilter=()=>$('#all-off');
  const firstDevice=()=>$('#device-list')?.querySelector('button:not(:disabled)');
  const scene=()=>[...sceneNodes.values()].find(b=>b.classList.contains('active')) || [...sceneNodes.values()][0];
  const firstScene=()=>[...sceneNodes.values()].find(b=>!b.disabled);
  const tiles=()=>[...($('#device-list')?.querySelectorAll('button:not(:disabled)')||[])];
  if(!modal && current?.matches('[data-room]')){
    const tabs=[...document.querySelectorAll('[data-room]')],i=tabs.indexOf(current);
    if(key==='ArrowDown')return focus(firstScene()||deviceFilter());
    if(key==='ArrowUp')return focus($('.sync-button'));
    if(key==='ArrowLeft')return focus(tabs[Math.max(0,i-1)]);
    if(key==='ArrowRight')return focus(tabs[i+1]||current);
  }
  // The header's buttons: left and right between them, down to the room tabs.
  if(!modal && current?.matches('.sync-button, .settings-button')){
    if(key==='ArrowDown')return focus(selectedRoom());
    if(key==='ArrowLeft'&&current.matches('.sync-button'))return focus($('.settings-button'));
    if(key==='ArrowRight'&&current.matches('.settings-button'))return focus($('.sync-button'));
    return true;
  }
  // Settings: up and down along the sections, right into the options; left from the options' first column back.
  if(modal?.side){
    if(modal.side.contains(current)){
      if(key==='ArrowRight')return focus(modal.firstOption());
      if(key==='ArrowLeft')return true;
      return focus(nearest(current,[...modal.side.querySelectorAll('button')],key)||current);
    }
    if(modal.content.contains(current)){
      const next=nearest(current,[...modal.content.querySelectorAll('button')],key,key==='ArrowLeft'||key==='ArrowRight');
      if(next)return focus(next);
      return key==='ArrowLeft'?focus(modal.activeSection()):true;
    }
  }
  if(current?.matches('#all-off')){
    if(key==='ArrowUp')return focus(selectedRoom());
    if(key==='ArrowDown')return focus(firstDevice()||current);
    if(key==='ArrowLeft')return focus(scene()||current);
    if(key==='ArrowRight')return true;
  }
  // Lights sit in per-room sections: move by position, left and right only within the same row; past the
  // edges go to Lights off or the scenes.
  if(current?.matches('.light-row')){
    const next=nearest(current,tiles(),key,key==='ArrowLeft'||key==='ArrowRight');
    if(next)return focus(next);
    if(key==='ArrowUp')return focus($('#all-off'));
    if(key==='ArrowLeft')return focus(nearest(current,[...sceneNodes.values()].filter(b=>!b.disabled),key)||scene()||current);
    return true;
  }
  // Scenes: columns of four, filled top to bottom. Up from the top goes to the room tabs; right from the last
  // column to the lights.
  if(current?.matches('.scene-button')){
    const scenes=[...sceneNodes.values()].filter(b=>!b.disabled),i=scenes.indexOf(current),row=i%4;
    if(key==='ArrowUp')return focus(row>0?scenes[i-1]:selectedRoom());
    if(key==='ArrowDown')return focus(row<3&&scenes[i+1]?scenes[i+1]:current);
    if(key==='ArrowLeft')return focus(scenes[i-4]||current);
    if(key==='ArrowRight')return focus(scenes[i+4]||nearest(current,tiles(),key)||$('#all-off'));
  }
  if(!all.includes(current)){focus(modal?all[0]:scene()||all[0]);return;}
  // In dialogs, left and right stay on the same row: off its end, focus stays put.
  const best=nearest(current,all,key,!!modal&&(key==='ArrowLeft'||key==='ArrowRight'));
  if(best){best.focus({preventScroll:true});best.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
}
/**
 * The control in {@code list} nearest to {@code current} in the arrow's direction, or null. Controls that
 * line up with it (overlap across the arrow) win over ones off to the side; {@code strict} allows only those.
 */
function nearest(current,list,key,strict){
  const a=current.getBoundingClientRect(),ax=a.x+a.width/2,ay=a.y+a.height/2,horizontal=key==='ArrowLeft'||key==='ArrowRight';
  let best=null,score=Infinity;
  for(const b of list){
    if(b===current)continue;
    const r=b.getBoundingClientRect(),dx=r.x+r.width/2-ax,dy=r.y+r.height/2-ay;
    const forward=key==='ArrowRight'?dx:key==='ArrowLeft'?-dx:key==='ArrowDown'?dy:-dy;
    if(forward<3)continue;
    const gap=horizontal?Math.max(0,Math.max(a.top,r.top)-Math.min(a.bottom,r.bottom)):Math.max(0,Math.max(a.left,r.left)-Math.min(a.right,r.right));
    if(strict&&gap>0)continue;
    const cost=forward+gap*2.8+(gap>0?80:0)+Math.abs(horizontal?dy:dx)*.3;
    if(cost<score){score=cost;best=b;}
  }
  return best;
}
function back(){
  // The remote's Back leaves a dialog's inner page first (the hubs page goes back to Sync & connect).
  if(modal){if(modal.back)modal.back();else closeModal();return true;}
  if(orbiting){orbiting=false;$('#orbit')?.classList.remove('active');return true;}
  if(room!=='all'){selectRoom('all');document.querySelector('[data-room="all"]')?.focus();return true;}
  return false;
}
window.tvBack=()=>{if(!back())window.HouseTV?.exit();};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();back();return;}
  if(orbiting&&!modal){if(e.key.startsWith('Arrow')){e.preventDefault();world?.orbit(e.key==='ArrowLeft'?-4:e.key==='ArrowRight'?4:0,e.key==='ArrowUp'?3:e.key==='ArrowDown'?-3:0);}if(e.key==='Enter'){e.preventDefault();back();}return;}
  if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&document.activeElement?.matches('.opacity-row')){
    e.preventDefault();setAppearance({...appearance,opacity:appearance.opacity+(e.key==='ArrowLeft'?-OPACITY_STEP:OPACITY_STEP)});return;
  }
  if(e.key.startsWith('Arrow')){e.preventDefault();navigate(e.key);}
});
// On the TV, moving the remote over a text field must not bring up the on-screen keyboard and trap the D-pad
// in it: fields stay read-only while merely focused, and OK opens the keyboard to edit.
if(nativeConfig){
  const field=n=>n instanceof HTMLInputElement&&!['file','checkbox','radio','button','submit'].includes(n.type);
  const lock=n=>{if(field(n))n.readOnly=true;};
  new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.nodeType===1){lock(n);n.querySelectorAll?.('input').forEach(lock);}}).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('focusout',e=>lock(e.target));
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&field(e.target)&&e.target.readOnly){e.preventDefault();e.stopImmediatePropagation();const n=e.target;n.readOnly=false;n.setSelectionRange?.(n.value.length,n.value.length);window.HouseTV?.keyboard?.();}},true);
}
document.addEventListener('visibilitychange',()=>world?.setRunning(!document.hidden));
function showSetup(error){
  app.replaceChildren();const box=el('div','setup');box.append(icon('House',58),el('h1','','Tu casa, en la pantalla grande'),el('p','','Importa tu casa una vez con sync-tv.py o desde tu teléfono y luego conecta Home Assistant o Hue en esta TV. No necesitas tu Mac para el uso diario.'),el('p','setup-error',error.message));
  box.append(button('Reintentar','RefreshCw',()=>location.reload(),'primary'));app.append(box);box.querySelector('button').focus();
}
async function boot(){
  try {const next=await api('/api/home');config=normalize(next.plan);bundle=next;online=!!(next.controlReady ?? next.macOnline);store.state=next.state;render();apply(next);}
  catch(error){console.warn('TV_BOOT',error.message);let cached;try{cached=JSON.parse(localStorage.getItem('house-tv:last-home:v1'));}catch{}if(cached){config=normalize(cached.plan);bundle=cached;store.state=cached.state;online=false;render();toast('Se muestra tu casa guardada. Abre Sincronizar y conectar para revisar la conexión de la TV.');}else showSetup(error);}
  setTimeout(poll,1800);
}
async function poll(){
  if(!document.hidden&&!busy)try{const next=await api('/api/home');if(!config||bundle?.revision!==next.revision){world?.dispose();room='all';config=normalize(next.plan);store.state=next.state;bundle=next;online=!!(next.controlReady ?? next.macOnline);render();}apply(next);}catch(error){if(online)console.warn('TV_CONNECTION',error.message);online=false;update();}
  setTimeout(poll,1800);
}
boot();
