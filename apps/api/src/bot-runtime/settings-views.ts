import { SETTINGS_LEVELS, type SettingsView } from './settings-model.js';
export interface SettingsLabels { title: string; level: string; topic: string; replies: string; voice: string; text: string; free: string; done: string; back: string; saved: string; error: string; autosave: string }
const defaults: SettingsLabels = { title:'Settings',level:'Level',topic:'Topic',replies:'Bot replies',voice:'Voice',text:'Text',free:'Free conversation',done:'Done',back:'Back',saved:'Changes saved',error:'Could not save. Please try again.',autosave:'Changes are saved automatically' };
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
    blocks.push({type:'divider'}, {type:'footer',text:l.autosave});
    row([[l.done,'close']]);
  }
  return {blocks};
}
