import type { Pool } from 'pg';
import type { PreparedUpdate } from '../contracts.js';
import type { SettingsView } from './settings-model.js';
import { settingsLabels,renderSettingsRich } from './settings-views.js';
import { encodeWidgetSettings } from './settings-widget.js';
import { buildStatsMessage } from './stats-message.js';

type Api=(method:string,body:Record<string,unknown>)=>Promise<unknown>;
export async function editSettingsCard({chatId,messageId,view,locale,widget,api}:{
  chatId:number;messageId:number;view:SettingsView;locale:unknown;widget:boolean;api:Api;
}) {
  if(!widget){await api('editMessageText',{chat_id:chatId,message_id:messageId,rich_message:renderSettingsRich(view,settingsLabels(locale))});return;}
  const body={chat_id:chatId,message_id:messageId};
  for(const [method,payload] of [
    ['editMessageWidgetData',{...body,chat_data:encodeWidgetSettings(view)}],
    ['editMessageReplyMarkup',{...body,reply_markup:view.screen==='stats'&&view.stats
      ?buildStatsMessage({context:view.stats,locale,botKey:view.botKey||'',webappUrl:view.webappUrl||'https://example.invalid'}).replyMarkup:{inline_keyboard:[]}}]
  ] as const){
    try{await api(method,payload);}catch(error){if(!String((error as Error).message).includes('message is not modified'))throw error;}
  }
}

export async function completeFeedbackCard(pool:Pool,update:PreparedUpdate,messageId:number,view:SettingsView,locale:unknown,api:Api) {
  const known=await pool.query('SELECT 1 FROM bot_settings_widget_cards WHERE chat_id=$1 AND bot_key=$2 AND message_id=$3',[update.input.chatId,update.botKey,messageId]);
  if(known.rows.length){
    const changed=await pool.query(`UPDATE bot_settings_widget_cards SET screen='home',action_at=(SELECT created_at FROM bot_update_executions WHERE decision_id=$4)
      WHERE chat_id=$1 AND bot_key=$2 AND message_id=$3 AND screen<>'closed'
        AND action_at<=(SELECT created_at FROM bot_update_executions WHERE decision_id=$4) RETURNING decision_id`,[update.input.chatId,update.botKey,messageId,update.decisionId]);
    if(!changed.rows.length)return;
  }
  await editSettingsCard({chatId:update.input.chatId!,messageId,view,locale,widget:!!known.rows.length,api});
}
