import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {renderSettingsWidget,encodeWidgetSettings} from '../src/bot-runtime/settings-widget.js';
import {settingsLabels} from '../src/bot-runtime/settings-views.js';

test('all localized widgets fit Telegram HTML and compressed size limits',()=>{
  const dir=new URL('../../../deploy/bots/',import.meta.url);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){
    const c=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
    const html=renderSettingsWidget(settingsLabels(c.locale));
    assert.ok(Buffer.byteLength(html)<=32768,file);
    assert.ok(deflateSync(html,{level:9}).length<=4096,file);
  }
});

test('widget labels cannot escape the script or inject markup; stats state stays compact',()=>{
  const html=renderSettingsWidget(settingsLabels({settings:{title:'</script><img src=x onerror=alert(1)>'}}));
  assert.equal(html.split('</script>').length,2);
  assert.ok(!html.includes('<img src=x'));
  const state=encodeWidgetSettings({v:1,l:'c1',r:'text',screen:'stats',botKey:'uk-en',webappUrl:'https://example.test',
    stats:{tier:'pro',planExpiresOn:'2026-12-31',planAutorenew:true,pendingPlanTier:'free',pendingPlanEffectiveOn:null,
      limitPeriod:'month',limitSeconds:7200,usedSeconds:123,remainingSeconds:7077,limitReached:false}});
  assert.ok(Buffer.byteLength(state)<=1024);
  const value=JSON.parse(state);assert.equal(value.q.u,123);assert.equal(value.q.a,7077);assert.equal(value.q.p,'pro');
});
