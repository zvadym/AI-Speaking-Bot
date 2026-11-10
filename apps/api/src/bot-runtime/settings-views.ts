import { SETTINGS_LEVELS, type SettingsView } from './settings-model.js';
export interface SettingsLabels { title: string; level: string; topic: string; replies: string; voice: string; text: string; free: string; done: string; back: string; card: string; widget: string; choose: string; saved: string; pending: string; error: string; refresh: string }
const defaults: SettingsLabels = { title:'Settings',level:'Level',topic:'Topic',replies:'Bot replies',voice:'Voice',text:'Text',free:'Free conversation',done:'Done',back:'Back',card:'Card',widget:'Widget',choose:'Choose a settings view',saved:'Changes saved',pending:'Saving…',error:'Could not save. Refresh and try again.',refresh:'Refresh' };
export function settingsLabels(locale: unknown): SettingsLabels {
  const value = (locale as { settings?: Partial<SettingsLabels> })?.settings;
  return { ...defaults, ...value };
}
export function renderSettingsRich(s: SettingsView, l: SettingsLabels): { blocks: object[] } {
  const blocks: object[] = [];
  const heading = (text: string) => blocks.push({type:'paragraph',text:{type:'bold',text}});
  const row = (buttons: Array<[string,string,boolean?]>) => blocks.push({type:'buttons',buttons:buttons.map(([text,action,selected]) => ({text:(selected?'✓ ':'')+text,callback_data:'settings:r:'+action,...(selected?{style:'primary'}:{})}))});
  heading('⚙️ '+l.title);
  if (s.screen === 'closed') { blocks.push({type:'paragraph',text:l.saved});row([[l.back,'home']]); return {blocks}; }
  if (s.e) blocks.push({type:'paragraph',text:l.error});
  if (s.screen === 'topics') {
    heading(l.topic);row([[l.free,'topic:free',s.t==='free']]);
    for (const [id,title] of s.o) row([[title,'topic:'+id,s.t===id]]);
    const nav: Array<[string,string]> = [];
    if(s.p>0)nav.push(['←','page:'+(s.p-1)]);
    if(s.p+1<s.pages)nav.push(['→','page:'+(s.p+1)]);
    if(nav.length)row(nav);
    row([[l.back,'home']]);
  } else {
    heading(l.level);row(SETTINGS_LEVELS.map(x=>[x.toUpperCase(),'level:'+x,s.l===x]));
    heading(l.topic);row([[s.n+' ▾','page:0']]);
    heading(l.replies);row([['🎤 '+l.voice,'reply:voice',s.r==='voice'],['💬 '+l.text,'reply:text',s.r==='text']]);
    row([[l.done,'close'],[l.refresh,'home']]);
  }
  return {blocks};
}
// Only supported widget DOM APIs; labels use textContent, never interpolated HTML.
export function renderSettingsWidget(l: SettingsLabels): string {
  const labels = JSON.stringify(l).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
  return `<style>
body{margin:0;padding:16px;font:14px system-ui;color:var(--tg-theme-text-color)}
h3{margin:0 0 14px;font-size:19px}p{margin:12px 0 6px;color:var(--tg-theme-hint-color);font-size:13px}
.row{display:flex;gap:6px;margin:6px 0}button{flex:1;min-width:0;padding:10px 7px;border:1px solid var(--tg-theme-section-separator-color);border-radius:10px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font:inherit;white-space:normal;overflow-wrap:anywhere}
button.sel{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);border-color:var(--tg-theme-button-color)}button:disabled{color:var(--tg-theme-hint-color)}#status{font-size:12px;min-height:16px;margin-top:10px;color:var(--tg-theme-hint-color)}
</style><div id="app"></div><div id="status" role="status"></div><script>
const L=${labels},W=window.TelegramWidget,A=document.getElementById('app'),S=document.getElementById('status');
let state=JSON.parse(W.chatData||'null'),busy=false;
function accept(next){if(next&&(!state||next.v>=state.v)){state=next;draw()}}
function request(action){if(busy)return;busy=true;S.textContent=L.pending;draw();let promise;try{promise=W.request('settings:w:'+action)}catch(e){failed();return}promise.then(a=>{busy=false;if(a.result){const result=JSON.parse(a.result);if(result.error)throw new Error('FAILED');accept(result)}draw();S.textContent=state&&state.e?L.error:''}).catch(failed)}
function failed(){busy=false;S.textContent=L.error;draw()}
function el(tag,text){const e=document.createElement(tag);e.textContent=text;return e}
function row(items){const r=el('div','');r.className='row';items.forEach(i=>{const b=el('button',(i[2]?'✓ ':'')+i[0]);b.className=i[2]?'sel':'';b.disabled=busy;b.setAttribute('aria-pressed',i[2]?'true':'false');b.onclick=()=>request(i[1]);r.appendChild(b)});A.appendChild(r)}
function draw(){A.innerHTML='';A.appendChild(el('h3','⚙️ '+L.title));if(!state){row([[L.refresh,'home']]);return}if(state.screen==='closed'){A.appendChild(el('p',L.saved));row([[L.back,'home']]);return}if(state.screen==='topics'){A.appendChild(el('p',L.topic));row([[L.free,'topic:free',state.t==='free']]);state.o.forEach(t=>row([[t[1],'topic:'+t[0],state.t===t[0]]]));const n=[];if(state.p>0)n.push(['←','page:'+(state.p-1)]);if(state.p+1<state.pages)n.push(['→','page:'+(state.p+1)]);if(n.length)row(n);row([[L.back,'home']])}else{A.appendChild(el('p',L.level));row(['a1','a2','b1','b2','c1'].map(x=>[x.toUpperCase(),'level:'+x,state.l===x]));A.appendChild(el('p',L.topic));row([[state.n+' ▾','page:0']]);A.appendChild(el('p',L.replies));row([['🎤 '+L.voice,'reply:voice',state.r==='voice'],['💬 '+L.text,'reply:text',state.r==='text']]);row([[L.done,'close'],[L.refresh,'home']])}}
W.onEvent('chatDataChanged',()=>accept(JSON.parse(W.chatData||'null')));draw();W.ready();
</script>`;
}
