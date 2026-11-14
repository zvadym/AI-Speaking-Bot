import { buildStatsMessage } from './stats-message.js';
import { SETTINGS_LEVELS, type SettingsView } from './settings-model.js';
import { vocabularyLanguage } from '../../vocabulary/types.js';
import { VOCABULARY_PAGE_SIZE } from '../../vocabulary/list.js';
export interface SettingsLabels { title: string; level: string; replies: string; voice: string; text: string; done: string; saved: string; error: string; autosave: string; stats: string; feedback: string; cancel: string; back: string; feedback_waiting: string; used:string; remaining:string; vocabulary:string; vocabulary_empty:string; vocabulary_word:string; vocabulary_meaning:string; vocabulary_progress:string; vocabulary_learned:string; vocabulary_page:string; vocabulary_total:string; previous:string; next:string; level_descriptions?: Partial<Record<typeof SETTINGS_LEVELS[number],string>>; reply_descriptions?: Partial<Record<'voice'|'text',string>> }
const defaults: SettingsLabels = { title:'Settings',level:'Level',replies:'Bot replies',voice:'Voice',text:'Text',done:'Done',saved:'Changes saved',error:'Could not save. Please try again.',autosave:'Changes are saved automatically',stats:'Statistics',feedback:'Send feedback',cancel:'Cancel',back:'Back',feedback_waiting:'Reply to the feedback request with text or a voice note.',used:'Used (min:sec)',remaining:'Remaining (min:sec)',vocabulary:'Vocabulary',vocabulary_empty:'Your vocabulary is empty. Tap Vocabulary below a tutor reply and add words.',vocabulary_word:'Word',vocabulary_meaning:'Translation / meaning',vocabulary_progress:'Progress',vocabulary_learned:'Learned',vocabulary_page:'Page',vocabulary_total:'Words',previous:'Previous',next:'Next' };
export function settingsLabels(locale: unknown): SettingsLabels {
  const value = (locale as { settings?: Partial<SettingsLabels> })?.settings;
  return { ...(locale as Record<string,unknown>), ...defaults, ...value };
}
export function renderSettingsRich(s: SettingsView, l: SettingsLabels): { blocks: object[] } {
  const blocks: object[] = [];
  const heading = (text: string) => blocks.push({type:'paragraph',text:{type:'bold',text}});
  const button = (text:string,action:string,selected?:boolean) => ({text,callback_data:'settings:r:'+action,...(selected?{style:'primary'}:{})});
  const row = (buttons: Array<[string,string,boolean?]>) => blocks.push({type:'buttons',buttons:buttons.map(([text,action,selected]) => button(text,action,selected))});
  const choices = (items:Array<[string,string|undefined,string,boolean]>) => blocks.push({
    type:'table',is_compact:true,
    cells:items.map(([title,description,action,selected])=>[
      {text:{type:'button',button:button(title,action,selected)},align:'left',valign:'top'},
      {text:description||'',align:'left',valign:'top'}
    ])
  });
  heading(s.screen==='vocabulary'?'📚 '+l.vocabulary:'⚙️ '+l.title);
  if (s.e) blocks.push({type:'paragraph',text:l.error});
  if(s.screen==='vocabulary'&&s.vocabulary){
    const {items,page,total}=s.vocabulary;
    const pages=Math.max(1,Math.ceil(total/VOCABULARY_PAGE_SIZE));
    if(!items.length)blocks.push({type:'paragraph',text:l.vocabulary_empty});
    else {
      const cell=(text:string|object)=>({text,align:'left',valign:'top'});
      blocks.push({type:'table',is_compact:true,cells:[
        [l.vocabulary_word,l.vocabulary_meaning,l.vocabulary_progress].map(text=>cell({type:'bold',text})),
        ...items.map(item=>{
          const meaning=item.translation||item.meaning;
          return [cell(item.lemma),cell(meaning.length>160?meaning.slice(0,157)+'…':meaning),
            cell(item.progress===5?`✓ ${l.vocabulary_learned}`:`${item.progress}/5`)];
        })
      ]});
      blocks.push({type:'footer',text:`${l.vocabulary_page} ${page+1}/${pages} · ${l.vocabulary_total}: ${total}`});
    }
    const navigation:Array<[string,string,boolean?]>=[];
    if(page>0)navigation.push(['‹ '+l.previous,`vocabulary:${page-1}`]);
    if(page+1<pages)navigation.push([l.next+' ›',`vocabulary:${page+1}`]);
    if(navigation.length)row(navigation);
    row([[l.back,'home']]);
    return {blocks};
  }
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
  choices(SETTINGS_LEVELS.map(x=>[x.toUpperCase(),l.level_descriptions?.[x],'level:'+x,s.l===x]));
  heading(l.replies);
  choices([
    ['🎤 '+l.voice,l.reply_descriptions?.voice,'reply:voice',s.r==='voice'],
    ['💬 '+l.text,l.reply_descriptions?.text,'reply:text',s.r==='text']
  ]);
  blocks.push({type:'footer',text:l.autosave},{type:'divider'});
  row([['📊 '+l.stats,'stats']]);
  if(vocabularyLanguage(s.botKey?.split('-')[1]||''))row([['📚 '+l.vocabulary,'vocabulary:0']]);
  row([['✉️ '+l.feedback,'feedback']]);
  blocks.push({type:'divider'});
  row([[l.done,'close']]);
  return {blocks};
}
