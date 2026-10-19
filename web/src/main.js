import './polyfills.js';
import './style.css';
import { createElement, House, Settings2, ChevronLeft, ChevronRight, Lightbulb, Power, Minus, Plus, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw } from 'lucide';
import QRCode from 'qrcode';
import { normalize } from './vendor/config.js';
import { createWorld } from './vendor/three/world.js';
import { api, nativeConfig, remoteURL } from './api.js';

const app = document.querySelector('#app');
const $ = (s) => document.querySelector(s);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const icons = { House, Settings2, Lightbulb, Power, Snowflake, Sun, Moon, Sofa, Film, DoorOpen, Wifi, Rotate3d, Check, ArrowLeft, Smartphone, RefreshCw, Minus, Plus, ChevronLeft, ChevronRight };
function icon(name, size = 24) { return createElement(icons[name] || House, { width: size, height: size, 'stroke-width': 1.65 }); }
function button(label, name, action, cls = '') {
  const b = el('button', cls); b.type = 'button'; b.setAttribute('aria-label', label);
  if (name) b.append(icon(name)); if (label) b.append(el('span', '', label)); b.onclick = action; return b;
}
const modes = { cool: 'Cooling', heat: 'Heating', auto: 'Auto', dry: 'Dry', fan: 'Fan' };
let config, bundle, world, resizeObserver, deviceKind = 'lights', room = 'all', online = false, demo = false, busy = false, orbiting = false, modal = null, lastFocus = null;
let store = { state: { lights: {}, acs: {}, scene: null }, listeners: new Set(), on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } };
let lightNodes = new Map(), acNodes = new Map(), sceneNodes = new Map();
let toastTimer;
// Small TV chips (2 GB, 4 cores) draw the 3D view at a lower internal resolution; the UI stays sharp.
const RES=(navigator.deviceMemory||4)<=2||(navigator.hardwareConcurrency||8)<=4?0.62:1;
function toast(message) { const n = $('#toast'); if (!n) return; n.textContent = message; n.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('visible'), 4500); }
function emit() { for (const fn of store.listeners) fn({ type: 'bulk', remote: true }); }
function apply(next) {
  bundle = next; online = !!(next.controlReady ?? next.macOnline);
  const changed = JSON.stringify(store.state) !== JSON.stringify(next.state);
  store.state = structuredClone(next.state); if (changed) emit(); update();
  try { localStorage.setItem('house-tv:last-home:v1', JSON.stringify(next)); } catch {}
}
function available() { return demo || online; }
async function command(action) {
  if (busy) return;
  if (!available()) { toast(bundle?.mode === 'standalone' ? (bundle.connectionLabel || 'Connect your devices') + ' in Sync & connect.' : 'Open House Control and TV Bridge on your Mac to control devices.'); return; }
  busy = true; app.classList.add('pending');
  try {
    if (demo) {
      const s = store.state;
      if (action.kind === 'light') { s.lights[action.id].on = action.on; s.scene = null; }
      if (action.kind === 'allLights' || action.kind === 'room') { for (const d of config.lights.filter(d => action.kind !== 'room' || d.room === action.id)) s.lights[d.id].on = action.on; s.scene = null; }
      if (action.kind === 'acPower') s.acs[action.id].on = action.on;
      if (action.kind === 'acTarget') s.acs[action.id].target = action.target;
      if (action.kind === 'scene') {
        const scene = config.scenes.find(s => s.id === action.id);
        for (const key of ['lights','acs']) for (const [id, value] of Object.entries(s[key])) Object.assign(value, scene[key]['*'] || {}, scene[key][id] || {});
        s.scene = scene.id;
      }
      emit(); update();
    } else {
      const result = await api(bundle?.mode==='demo'?'/api/demo/action':'/api/action', action); apply(result.home);
      toast(result.direct ? (action.kind === 'acTarget' ? 'Temperature saved on TV' : 'Device settings updated directly') : 'Command sent to House Control');
    }
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
  if (!lights.length) list.append(el('p', 'empty', 'No lights in this room.'));
  for (const r of config.rooms) {
    const inRoom = lights.filter(d => d.room === r.id);
    if (!inRoom.length) continue;
    const section = el('section', 'device-section'); const grid = el('div', 'light-grid');
    section.append(el('h3', '', r.name), grid); list.append(section);
    for (const d of inRoom) grid.append(lightTile(d));
  }
}
/** A light as a tile in its room's 3-column grid: the lit tile shows the state, so no On/Off text or switch. */
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
  $('#status').textContent = (demo || bundle?.mode === 'demo') ? 'Demo · no real devices' : bundle?.mode === 'standalone' ? (bundle.connectionLabel || (online ? 'TV connected' : 'Connect your devices on TV')) : online ? 'Synced with Mac' : 'Mac offline · view only';
  $('#status').classList.toggle('offline', !online && !demo);
  $('#lights-on').textContent = on;
  $('#lights-total').textContent = 'of ' + config.lights.length + ' on';
  $('#active-scene').textContent = config.scenes.find(s => s.id === store.state.scene)?.name || 'Manual control';
  for (const [id, n] of lightNodes) {
    const s = store.state.lights[id]; if (!s) continue;
    n.b.classList.toggle('on', s.on); n.b.setAttribute('aria-pressed', String(s.on));
    n.b.setAttribute('aria-label', `${config.lights.find(d=>d.id===id).name}, ${s.on ? 'on' : 'off'}`);
    n.b.disabled = !available();
  }
  for (const [id, n] of acNodes) {
    const s = store.state.acs[id]; if (!s) continue;
    const d = config.acs.find(d => d.id === id);
    n.card.classList.toggle('on', s.on); n.power.setAttribute('aria-pressed', String(s.on));
    n.target.replaceChildren(document.createTextNode(s.target), el('span', '', '°'));
    n.mode.textContent = s.on ? modes[s.mode] || s.mode : 'Off';
    n.current.textContent = Number.isFinite(s.roomTemp) ? `${Math.round(s.roomTemp * 10) / 10}° in room` : 'No sensor';
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
  connection.append(status, clock, button('Sync & connect', 'Smartphone', openSync, 'sync-button'));
  header.append(connection);
  const tabs = el('nav','rooms'); tabs.setAttribute('aria-label','Rooms');
  for (const r of [{id:'all',name:'Whole home'}, ...config.rooms]) {
    const b = button(r.name, r.id==='all'?'House':null,()=>selectRoom(r.id),'room-tab'); b.dataset.room=r.id; b.classList.toggle('selected',r.id===room); b.setAttribute('aria-pressed',r.id===room); tabs.append(b);
  }
  const layout = el('main','layout');
  const stage = el('section','stage');
  const homeName = el('div','home-name',config.name);
  const canvas = el('canvas'); canvas.id='world'; canvas.setAttribute('aria-label','Interactive 3D home model');
  const stats = el('div','stats');
  const lightStat=el('div'); const on=el('strong'); on.id='lights-on'; const total=el('small'); total.id='lights-total'; lightStat.append(icon('Lightbulb'),on,total);
  const sceneStat=el('div'); const sc=el('strong'); sc.id='active-scene'; sceneStat.append(icon('Sofa'),sc,el('small','','Current scene'));
  stats.append(lightStat,sceneStat);
  stage.append(canvas,homeName,stats);
  const aside = el('aside','controls'); const heading=el('div','controls-heading'); const count=el('span');count.id='device-count';heading.append(el('h2','','Devices'),count);
  const off=button('Lights off','Power',()=>command({kind:room==='all'?'allLights':'room',...(room==='all'?{}:{id:room}),on:false}),'all-off'); off.id='all-off';
  const list=el('div','device-list'); list.id='device-list'; aside.append(heading,off,list);
  // Scenes: their own card between the model and the lights, in columns of four (up to two columns).
  const scenes=el('section','scenes'); const sceneHeading=el('div','controls-heading'); const sceneCount=el('span',''); sceneCount.textContent=String(Math.min(8,config.scenes.length));
  sceneHeading.append(el('h2','','Scenes'),sceneCount);
  const sceneList=el('div','scene-list');
  for (const s of config.scenes.slice(0,8)) { const b=button(s.name,sceneIcon(s),()=>command({kind:'scene',id:s.id}),'scene-button'); sceneList.append(b);sceneNodes.set(s.id,b); }
  if (!config.scenes.length) sceneList.append(el('p','empty','Add scenes in House Control on your Mac.'));
  scenes.append(sceneHeading,sceneList);
  layout.append(stage,scenes,aside);
  const toastNode=el('div','toast');toastNode.id='toast';toastNode.setAttribute('role','status');
  app.append(header,tabs,layout,toastNode);
  renderDevices(); update(); tickClock();
  try {
    world=createWorld(canvas,config,store,{resolution:()=>RES,onHover(){},onPick(t){if(!t)return;if(t.kind==='room')selectRoom(t.id);if(t.kind==='light')command({kind:'light',id:t.id,on:!store.state.lights[t.id].on});}});
    world.setInsets(24,38);world.setRunning(true);world.intro();
    setTimeout(()=>console.info('TV_RENDER_STATS',JSON.stringify(world?.stats())),6000);
    resizeObserver?.disconnect(); resizeObserver=new ResizeObserver(()=>world?.resize()); resizeObserver.observe(canvas);
  } catch(error) { stage.append(el('div','render-error','3D is unavailable on this device. You can still use the controls on the right.')); console.error(error); }
  requestAnimationFrame(()=>tabs.querySelector('button').focus({preventScroll:true}));
  window.__houseTV={get config(){return config;},get state(){return store.state;},get online(){return online;},get world(){return world;},command,selectRoom};
}
function tickClock(){if($('#clock'))$('#clock').textContent=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
setInterval(tickClock,15000);
let modalCleanup = null;
function closeModal(){modalCleanup?.();modalCleanup=null;modal?.remove();modal=null;lastFocus?.focus();}
async function openSync(){
  if(bundle?.mode==='demo'){
    lastFocus=document.activeElement;modal=el('div','modal-backdrop');const panel=el('section','sync-panel');panel.append(el('p','eyebrow','ISOLATED DEMO'),el('h2','','A home you can safely explore'),el('p','sync-description','This demo has no real-device bindings. All switches and scenes affect the demo model only.'),button('Back to demo','ArrowLeft',closeModal,'primary'),button('Reset demo','RefreshCw',()=>switchDemo(true),'secondary'),button('Return to my home','House',()=>switchDemo(false),'secondary'));modal.append(panel);document.body.append(modal);panel.querySelector('button').focus();return;
  }
  if (nativeConfig?.mode === 'standalone' || bundle?.mode === 'standalone') return openStandaloneSync();
  lastFocus=document.activeElement;modal=el('div','modal-backdrop');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Sync & connect');
  const panel=el('section','sync-panel'); const close=button('Back to home','ArrowLeft',closeModal,'back-button');
  panel.append(close,el('p','eyebrow','YOUR HOME. EVERY SCREEN.'),el('h2','','One home. Always in sync.'),el('p','sync-description','Your floor plan, scenes and device states come from House Control on your Mac. Changes in the app appear here automatically.'));
  const content=el('div','sync-content');const qr=el('canvas','qr');
  const text=el('div');text.append(el('h3','','Open on your iPhone'),el('p','','Scan with your camera to control this same home from your phone over Wi-Fi.'),el('p','sync-note','To sync settings from the iPhone app, pair it with your Mac in House Control → Pair iPhone. Keep House Control and TV Bridge running on your Mac.'));
  if(nativeConfig?.endpoint || !nativeConfig){content.append(qr,text);QRCode.toCanvas(qr,remoteURL(bundle?.endpoint),{width:220,margin:2,errorCorrectionLevel:'M',color:{dark:'#0a0e1a',light:'#ffffff'}}).catch(()=>qr.remove());}
  else text.append(el('p','','Connect your TV by running ./house-tv/deploy.py on your Mac.'));
  panel.append(content,el('div','sync-state',demo?'Demonstration home':online?'Connected to Mac · refreshes every 2 seconds':'Mac is offline. Showing your last saved home.'));
  modal.append(panel);document.body.append(modal);close.focus();
}
async function switchDemo(enabled){await api('/api/demo',{enabled});closeModal();world?.dispose();config=null;await boot();}
async function openStandaloneSync() {
  if (modal) closeModal();
  lastFocus=document.activeElement;modal=el('div','modal-backdrop');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','TV connections');
  const panel=el('section','sync-panel');const close=button('Back to home','ArrowLeft',closeModal,'back-button');
  const content=el('div','standalone-content');panel.append(close,content);modal.append(panel);document.body.append(modal);close.focus();
  const owner=modal;let timer=0;modalCleanup=()=>clearTimeout(timer);
  const alive=()=>modal===owner;
  const message=el('p','sync-note');message.setAttribute('role','status');
  async function showHome() {
    clearTimeout(timer);content.replaceChildren();
    let status;
    try { status=await api('/api/connections'); } catch(error) {content.append(el('p','setup-error',error.message));return;}
    if(!alive())return;
    const ha=status.homeassistant,hue=status.hue,connected=[ha.connected&&'Home Assistant',hue.connected&&'Hue'].filter(Boolean);
    content.append(el('p','eyebrow','YOUR TV. YOUR HOME.'),el('h2','',connected.length?'Ready without your Mac':'Connect your devices to this TV'),el('p','sync-description',connected.length?'Your TV stores this home and sends commands directly to your devices. Your Mac can be off.':'Connect Home Assistant or pair a Philips Hue Bridge. The TV talks to them directly on your Wi-Fi.'));
    content.append(el('div','sync-state',connected.length?connected.join(' · ')+' connected · credentials stored on this TV':'No hub connected yet'));
    const remote=el('div','sync-content');const qr=el('canvas','qr');const text=el('div');text.append(el('h3','','Control from your phone'),el('p','','Scan this private link with your camera. Your phone connects directly to this TV on Wi-Fi. Keep the TV awake with House Control or Luma open.'),el('p','sync-note','Settings sync automatically from your paired Mac when it is awake. Your TV keeps its own device state and works when the Mac is off. You can also import a floor plan JSON from your phone.'));
    remote.append(qr,text);content.append(remote);QRCode.toCanvas(qr,remoteURL(bundle?.endpoint),{width:260,margin:2,color:{dark:'#0a0e1a',light:'#ffffff'}}).catch(()=>qr.remove());
    const file=el('input','plan-file');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Import House Control floor plan');
    file.onchange=async()=>{if(!file.files?.[0])return;try{const data=JSON.parse(await file.files[0].text());await api('/api/import',data);toast('Floor plan saved on TV');closeModal();}catch(error){message.textContent=error.message;}};
    const importRow=el('div','import-row');importRow.append(el('span','','Import floor plan JSON'),file);if(!nativeConfig)content.append(importRow);content.append(message);
    content.append(button('Home Assistant & Hue','Wifi',showServices,connected.length?'secondary':'primary'),button('Explore demo home','House',()=>switchDemo(true),'secondary'));
  }
  async function showServices() {
    clearTimeout(timer);content.replaceChildren(el('h2','','Looking for your hubs…'));
    let status,found={homeassistant:[],hue:[]};
    try{status=await api('/api/connections');}catch(error){content.replaceChildren(el('p','setup-error',error.message),button('Back','ArrowLeft',showHome,'secondary'));return;}
    if(!alive())return;
    const render=()=>{
      const note=el('p','sync-note');note.setAttribute('role','status');
      content.replaceChildren(el('p','eyebrow','LOCAL HUBS · NO MAC NEEDED'),el('h2','','Home Assistant & Philips Hue'),el('p','sync-description','The TV talks to them directly on your Wi-Fi. Credentials are encrypted on this TV. Apple Home is iPhone-only; add HomeKit or Matter devices to Home Assistant to switch them here.'));
      const ha=status.homeassistant,hue=status.hue;
      content.append(el('h3','',ha.connected?`Home Assistant · ${ha.name}`:'Home Assistant'));
      if(ha.connected){content.append(el('div','sync-state',`Connected to ${ha.url}${ha.source==='mac'?' · from your Mac':''}${ha.lastError?' · '+ha.lastError:''}`),button('Disconnect Home Assistant','Power',async()=>{status=await api('/api/homeassistant/disconnect',{});render();},'secondary'));}
      else{
        const form=el('div','login-form');const urlLabel=el('label','','Server address');urlLabel.htmlFor='ha-url';const url=el('input');url.id='ha-url';url.placeholder='http://192.168.1.20:8123';url.value=found.homeassistant[0]?.url||'';url.autocomplete='off';url.spellcheck=false;
        const tokenLabel=el('label','','Long-lived access token');tokenLabel.htmlFor='ha-token';const token=el('input');token.id='ha-token';token.type='password';token.autocomplete='off';token.placeholder='Profile → Security → Long-lived access tokens';
        const connect=button('Connect','Check',async()=>{connect.disabled=true;note.textContent='Checking…';try{status=await api('/api/homeassistant/connect',{url:url.value,token:token.value});toast('Home Assistant connected to your TV');render();}catch(error){note.textContent=error.message;connect.disabled=false;}},'primary');
        form.append(urlLabel,url,el('span'),tokenLabel,token,connect);content.append(form);
        for(const s of found.homeassistant)content.append(button(`Use ${s.name}`,'Wifi',()=>{url.value=s.url;token.focus();},'secondary'));
        content.append(el('p','sync-note',nativeConfig?'Typing a token with the remote is slow: open the private phone link from Sync & connect and paste it there.':'Paste the token here; it goes straight to the TV and stays there.'));
      }
      content.append(el('h3','',hue.connected?`Philips Hue · ${hue.name}`:'Philips Hue'));
      if(hue.connected){content.append(el('div','sync-state',`Paired with ${hue.host}${hue.source==='mac'?' · from your Mac':''}${hue.lastError?' · '+hue.lastError:''}`),button('Forget Hue Bridge','Power',async()=>{status=await api('/api/hue/disconnect',{});render();},'secondary'));}
      else{
        const form=el('div','login-form');const hostLabel=el('label','','Bridge address');hostLabel.htmlFor='hue-host';const host=el('input');host.id='hue-host';host.placeholder='192.168.1.30';host.value=found.hue[0]?.host||'';host.autocomplete='off';host.spellcheck=false;
        const pair=button('Pair','Lightbulb',()=>pairHue({host:host.value,bridgeId:found.hue.find(b=>b.host===host.value)?.bridgeId||'',name:found.hue.find(b=>b.host===host.value)?.name||''},note),'primary');
        form.append(hostLabel,host,pair);content.append(form);
        for(const b of found.hue)content.append(button(`Pair ${b.name}`,'Lightbulb',()=>pairHue(b,note),'secondary'));
        content.append(el('p','sync-note','Pair, then press the round button on top of the bridge within a minute. The bridge’s certificate is remembered so another device at its address is refused.'));
      }
      content.append(note,button('Search the network again','RefreshCw',discover,'secondary'),button('Back','ArrowLeft',showHome,'secondary'));
      content.querySelector('button,input')?.focus();
    };
    async function pairHue(bridge,note){
      const started=Date.now();note.textContent='Press the round button on the Hue Bridge…';
      while(alive()&&Date.now()-started<60000){
        try{const result=await api('/api/hue/pair',{host:bridge.host,bridgeId:bridge.bridgeId||'',name:bridge.name||''});if(!alive())return;if(!result.buttonRequired){status=result;toast('Hue Bridge paired with your TV');render();return;}}
        catch(error){if(alive())note.textContent=error.message;return;}
        await new Promise(r=>{timer=setTimeout(r,2000);});
      }
      if(alive())note.textContent='The button was not pressed in time. Choose Pair to try again.';
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
  const deviceFilter=()=>document.querySelector('[data-kind="'+deviceKind+'"]');
  const firstDevice=()=>$('#device-list')?.querySelector('button:not(:disabled)');
  const scene=()=>[...sceneNodes.values()].find(b=>b.classList.contains('active')) || [...sceneNodes.values()][0];
  if(!modal && current?.matches('[data-room]')){
    const tabs=[...document.querySelectorAll('[data-room]')],i=tabs.indexOf(current);
    if(key==='ArrowDown')return focus(deviceFilter());
    if(key==='ArrowUp')return focus($('.sync-button'));
    if(key==='ArrowLeft')return focus(tabs[Math.max(0,i-1)]);
    if(key==='ArrowRight')return focus(tabs[i+1]||deviceFilter());
  }
  if(current?.matches('.sync-button')&&key==='ArrowDown')return focus(selectedRoom());
  if(current?.matches('[data-kind]')){
    if(key==='ArrowUp')return focus(selectedRoom());
    if(key==='ArrowDown')return focus(deviceKind==='lights'?$('#all-off'):firstDevice()||scene());
    const filters=[...document.querySelectorAll('[data-kind]')],i=filters.indexOf(current);
    if(key==='ArrowLeft')return focus(filters[i-1]||$('#orbit'));
    if(key==='ArrowRight')return focus(filters[i+1]||current);
  }
  if(current?.matches('#all-off')){
    if(key==='ArrowUp')return focus(deviceFilter());
    if(key==='ArrowDown')return focus(firstDevice()||scene());
    if(key==='ArrowLeft')return focus($('#orbit'));
  }
  if(current?.matches('.light-row')){
    const rows=[...$('#device-list').querySelectorAll('button:not(:disabled)')],i=rows.indexOf(current);
    if(key==='ArrowDown')return focus(rows[i+1]||scene());
    if(key==='ArrowUp')return focus(rows[i-1]||$('#all-off'));
    if(key==='ArrowLeft')return focus($('#orbit'));
  }
  if(current?.matches('.scene-button')){
    const scenes=[...sceneNodes.values()].filter(b=>!b.disabled),i=scenes.indexOf(current);
    if(key==='ArrowUp')return focus(deviceFilter());
    if(key==='ArrowLeft')return focus(scenes[Math.max(0,i-1)]);
    if(key==='ArrowRight')return focus(scenes[Math.min(scenes.length-1,i+1)]);
  }
  if(current?.matches('#orbit')){
    if(key==='ArrowUp')return focus(selectedRoom());
    if(key==='ArrowDown')return focus(scene());
    if(key==='ArrowRight')return focus(firstDevice()||deviceFilter());
  }
if(!all.includes(current)){all[0]?.focus();return;}
  const a=current.getBoundingClientRect(),ax=a.x+a.width/2,ay=a.y+a.height/2;
  let best=null,score=Infinity;
  for(const b of all){if(b===current)continue;const r=b.getBoundingClientRect();const dx=r.x+r.width/2-ax,dy=r.y+r.height/2-ay;const horizontal=key==='ArrowLeft'||key==='ArrowRight';const forward=(key==='ArrowRight'?dx:key==='ArrowLeft'?-dx:key==='ArrowDown'?dy:-dy);if(forward<3)continue;const cross=Math.abs(horizontal?dy:dx);const cost=forward+cross*2.8+(cross> (horizontal?a.height:a.width)*.75?80:0);if(cost<score){score=cost;best=b;}}
  if(best){best.focus({preventScroll:true});best.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
}
function back(){
  if(modal){closeModal();return true;}
  if(orbiting){orbiting=false;$('#orbit')?.classList.remove('active');return true;}
  if(room!=='all'){selectRoom('all');document.querySelector('[data-room="all"]')?.focus();return true;}
  return false;
}
window.tvBack=()=>{if(!back())window.HouseTV?.exit();};
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();back();return;}
  if(orbiting&&!modal){if(e.key.startsWith('Arrow')){e.preventDefault();world?.orbit(e.key==='ArrowLeft'?-4:e.key==='ArrowRight'?4:0,e.key==='ArrowUp'?3:e.key==='ArrowDown'?-3:0);}if(e.key==='Enter'){e.preventDefault();back();}return;}
  if(e.key.startsWith('Arrow')){e.preventDefault();navigate(e.key);}
});
document.addEventListener('visibilitychange',()=>world?.setRunning(!document.hidden));
async function loadDemo(){
  demo=true;online=false;const raw=await(await fetch('./plans/demo-loft.json')).json();config=normalize(raw);
  store.state={lights:Object.fromEntries(config.lights.map(d=>[d.id,{on:true,brightness:.75,temp:3000,color:null}])),acs:Object.fromEntries(config.acs.map(d=>[d.id,{on:false,target:23,mode:'cool',fan:'auto'}])),scene:null};render();
}
function showSetup(error){
  app.replaceChildren();const box=el('div','setup');box.append(icon('House',58),el('h1','','Your home belongs on the big screen'),el('p','','Import your home once with sync-tv.py or from your phone, then connect Home Assistant or Hue on this TV. Your Mac is not needed for everyday control.'),el('p','setup-error',error.message));
  box.append(button('Try again','RefreshCw',()=>location.reload(),'primary'),button('Explore demo','House',loadDemo,'secondary'));app.append(box);box.querySelector('button').focus();
}
async function boot(){
  try {const next=await api('/api/home');config=normalize(next.plan);bundle=next;online=!!(next.controlReady ?? next.macOnline);store.state=next.state;render();apply(next);}
  catch(error){console.warn('TV_BOOT',error.message);let cached;try{cached=JSON.parse(localStorage.getItem('house-tv:last-home:v1'));}catch{}if(cached){config=normalize(cached.plan);bundle=cached;store.state=cached.state;online=false;render();toast('Showing your saved home. Open Sync & connect to check the TV connection.');}else showSetup(error);}
  setTimeout(poll,1800);
}
async function poll(){
  if(!demo&&!document.hidden&&!busy)try{const next=await api('/api/home');if(!config||bundle?.revision!==next.revision){world?.dispose();room='all';config=normalize(next.plan);store.state=next.state;bundle=next;online=!!(next.controlReady ?? next.macOnline);render();}apply(next);}catch(error){if(online)console.warn('TV_CONNECTION',error.message);online=false;update();}
  setTimeout(poll,1800);
}
boot();
