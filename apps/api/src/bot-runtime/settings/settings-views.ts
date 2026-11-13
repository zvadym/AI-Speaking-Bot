import { buildStatsMessage } from './stats-message.js';
import { SETTINGS_LEVELS, type SettingsView } from './settings-model.js';
export interface SettingsLabels { title: string; level: string; replies: string; voice: string; text: string; done: string; saved: string; error: string; autosave: string; stats: string; feedback: string; cancel: string; back: string; feedback_waiting: string; used:string; remaining:string; level_descriptions?: Partial<Record<typeof SETTINGS_LEVELS[number],string>>; reply_descriptions?: Partial<Record<'voice'|'text',string>> }
const defaults: SettingsLabels = { title:'Settings',level:'Level',replies:'Bot replies',voice:'Voice',text:'Text',done:'Done',saved:'Changes saved',error:'Could not save. Please try again.',autosave:'Changes are saved automatically',stats:'Statistics',feedback:'Send feedback',cancel:'Cancel',back:'Back',feedback_waiting:'Reply to the feedback request with text or a voice note.',used:'Used (min:sec)',remaining:'Remaining (min:sec)' };
export function settingsLabels(locale: unknown): SettingsLabels {
  const value = (locale as { settings?: Partial<SettingsLabels> })?.settings;
  return { ...(locale as Record<string,unknown>), ...defaults, ...value };
}
export function renderSettingsRich(s: SettingsView, l: SettingsLabels): { blocks: object[] } {
  const blocks: object[] = [];
  const heading = (text: string) => blocks.push({type:'paragraph',text:{type:'bold',text}});
  const button = (text:string,action:string,selected?:boolean) => ({text,callback_data:'settings:r:'+action,...(selected?{style:'primary'}:{})});
  const row = (buttons: Array<[string,string,boolean?]>) => blocks.push({type:'buttons',buttons:buttons.map(([text,action,selected]) => button(text,action,selected))});
  const choice = (title:string,description:string|undefined,action:string,selected:boolean) => {
    blocks.push({type:'paragraph',text:[{type:'button',button:button(title,action,selected)},...(description?[' '+description]:[])]});
  };
  heading('⚙️ '+l.title);
  if (s.e) blocks.push({type:'paragraph',text:l.error});
  if(s.screen==='feedback') {
    blocks.push({type:'paragraph',text:l.feedback_waiting});
    row([[l.cancel,'cancel']]);
    return {blocks};
  }
  if(s.screen==='stats' && s.stats) {
    const message=buildStatsMessage({context:s.stats,locale:l,botKey:s.botKey||'',webappUrl:s.webappUrl||'https://example.invalid'});
    // These strings are our curated locale HTML, never user/model-generated.
    for(const line of message.text.split('\n').filter(Boolean))
      blocks.push({type:'paragraph',text:line.replace(/<[^>]*>/g,'')});
    const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
    blocks.push({type:'paragraph',text:`${l.used}: ${clock(s.stats.usedSeconds)} / ${clock(s.stats.limitSeconds)}\n${l.remaining}: ${clock(s.stats.remainingSeconds)}`});
    blocks.push({type:'buttons',buttons:message.replyMarkup.inline_keyboard.flat().map(b=>({text:b.text,web_app:b.web_app}))});
    row([[l.back,'home']]);
    return {blocks};
  }
  heading(l.level);
  for(const x of SETTINGS_LEVELS)choice(x.toUpperCase(),l.level_descriptions?.[x],'level:'+x,s.l===x);
  heading(l.replies);
  choice('🎤 '+l.voice,l.reply_descriptions?.voice,'reply:voice',s.r==='voice');
  choice('💬 '+l.text,l.reply_descriptions?.text,'reply:text',s.r==='text');
  blocks.push({type:'footer',text:l.autosave},{type:'divider'});
  row([['📊 '+l.stats,'stats']]);
  row([['✉️ '+l.feedback,'feedback']]);
  blocks.push({type:'divider'});
  row([[l.done,'close']]);
  return {blocks};
}
