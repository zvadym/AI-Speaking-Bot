import type { SettingsView } from './settings-model.js';
import type { SettingsLabels } from './settings-views.js';

// HTML stays fixed in Telegram; only this compact, server-owned state changes.
export function encodeWidgetSettings(view: SettingsView): string {
  const {stats,...base}=view;
  const value=JSON.stringify({...base,...(stats?{q:{p:stats.tier,u:stats.usedSeconds,n:stats.limitSeconds,
    a:stats.remainingSeconds,d:stats.planExpiresOn,r:stats.planAutorenew,t:stats.pendingPlanTier}}:{})});
  if(Buffer.byteLength(value)>1024)throw new Error('settings_widget_state_too_large');
  return value;
}

export function renderSettingsWidget(labels: SettingsLabels): string {
  const keys=['title','level','replies','voice','text','done','saved','error','autosave','stats','feedback','cancel','back','feedback_waiting','used','remaining',
    'level_descriptions','reply_descriptions','stats_plan_prefix','tier_pro','tier_free','plan_valid_until_prefix','stats_autorenew_prefix','autorenew_on','autorenew_off','stats_pending_prefix',
    'stats_week_title','stats_free_title','pending_change_prefix','pending_change_suffix'];
  const values=Object.fromEntries(keys.map(k=>{const value=(labels as unknown as Record<string,unknown>)[k];return [k,typeof value==='string'?value.replace(/<[^>]*>/g,''):value];}));
  const json=JSON.stringify(values).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return `<style>
body{margin:0;padding:6px 12px max(12px,env(safe-area-inset-bottom));color:var(--tg-theme-text-color);font-size:13px;line-height:16px}
h3{margin:0 0 4px;font-size:20px;line-height:24px}h4{margin:3px 0;padding:3px 8px;font-size:16px;line-height:22px;background:var(--tg-theme-secondary-bg-color)}
.choice{display:flex;align-items:center;gap:12px;margin:2px 0}.note{flex:1;min-width:0}
button{box-sizing:border-box;font:inherit;color:var(--tg-theme-text-color);background:var(--tg-theme-secondary-bg-color);border:0;border-radius:0;padding:6px 8px;min-height:30px}
.pick{width:52px;height:52px;min-width:52px;min-height:52px;padding:2px;font-weight:600;font-size:14px;line-height:18px;white-space:normal}
.selected{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.actions{display:flex;gap:6px;margin:3px 0}.actions button{flex:1;min-width:0}.hint{color:var(--tg-theme-hint-color);font-size:11px;line-height:14px;margin:2px 0}
hr{border:0;border-top:1px solid var(--tg-theme-section-separator-color);margin:6px 0}#status{color:var(--tg-theme-hint-color);font-size:11px;line-height:14px}button:disabled{opacity:.6}
@media(max-width:340px){body{font-size:12px;line-height:15px}.choice{gap:10px}.pick{font-size:13px}}
</style><div id="app"></div><div id="status" role="status"></div><script>
const L=${json},W=window.TelegramWidget,A=document.getElementById('app'),M=document.getElementById('status');
let state=null,busy=false;
function el(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e}
function accept(next){if(next&&(!state||next.v>=state.v)){state=next;draw()}}
function request(action){if(busy)return;busy=true;draw();let pending;try{pending=W.request('settings:h:'+action)}catch(e){failed();return}pending.then(a=>{busy=false;if(a.result){const next=JSON.parse(a.result);if(next.error)throw new Error('FAILED');accept(next)}draw();M.textContent=state&&state.e?L.error:''}).catch(failed)}
function failed(){busy=false;draw();M.textContent=L.error}
function button(title,action,selected){const b=el('button',title);b.disabled=busy;b.onclick=()=>request(action);b.setAttribute('aria-pressed',selected?'true':'false');if(selected)b.className='selected';return b}
function row(items){const r=el('div');r.className='actions';items.forEach(i=>r.appendChild(button(i[0],i[1])));A.appendChild(r)}
function choice(title,note,action,selected){const r=el('div'),b=button(title,action,selected),n=el('div',note);r.className='choice';b.className+=(selected?' ':'')+'pick';n.className='note';r.appendChild(b);r.appendChild(n);A.appendChild(r)}
function line(text){A.appendChild(el('p',text))}function clock(n){return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')}
function draw(){A.innerHTML='';A.appendChild(el('h3','⚙️ '+L.title));if(!state){row([[L.back,'refresh']]);return}
if(state.screen==='closed'){line(L.saved);return}
if(state.screen==='feedback'){line(L.feedback_waiting);row([[L.cancel,'cancel']]);return}
if(state.screen==='stats'&&state.q){const q=state.q;A.appendChild(el('h4',L.stats));line((L.stats_plan_prefix||'Plan: ')+(q.p==='pro'?(L.tier_pro||'PRO'):(L.tier_free||'FREE')));if(q.d)line((L.plan_valid_until_prefix||'Valid until: ')+q.d);line(q.p==='pro'?(L.stats_week_title||'This month'):(L.stats_free_title||'Free plan limit'));line(L.used+': '+clock(q.u)+' / '+clock(q.n));line(L.remaining+': '+clock(q.a));if(q.p==='pro'){line((L.stats_autorenew_prefix||'Auto-renew: ')+(q.r?(L.autorenew_on||'On'):(L.autorenew_off||'Off')));if(q.t)line((L.stats_pending_prefix||'Scheduled change: ')+(L.pending_change_prefix||'change to ')+q.t.toUpperCase()+(L.pending_change_suffix||' at period end'))}row([[L.back,'home']]);return}
A.appendChild(el('h4',L.level));['a1','a2','b1','b2','c1'].forEach(x=>choice(x.toUpperCase(),(L.level_descriptions||{})[x]||'','level:'+x,state.l===x));
A.appendChild(el('h4',L.replies));choice('🎤 '+L.voice,(L.reply_descriptions||{}).voice||'','reply:voice',state.r==='voice');choice('💬 '+L.text,(L.reply_descriptions||{}).text||'','reply:text',state.r==='text');
const hint=el('div',L.autosave);hint.className='hint';A.appendChild(hint);A.appendChild(el('hr'));row([['📊 '+L.stats,'stats'],['✉️ '+L.feedback,'feedback']]);row([[L.done,'close']])}
try{accept(JSON.parse(W.chatData||'null'))}catch(e){}W.onEvent('chatDataChanged',()=>{try{accept(JSON.parse(W.chatData||'null'))}catch(e){failed()}});draw();W.ready();
</script>`;
}
