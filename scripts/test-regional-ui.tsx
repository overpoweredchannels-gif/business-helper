import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {RegionalProvider,LanguageSwitcher} from '../src/components/regional/RegionalProvider';
import {RegionalSettingsPanel} from '../src/components/regional/RegionalSettingsPanel';
import {navigationLabel,navigationText} from '../src/lib/regional/navigation';
import {navigationItems} from '../src/lib/tradeos/constants';
import {messages} from '../src/lib/regional/messages';
import {regionalUi} from '../src/lib/regional/ui-messages';

process.env.NEXT_PUBLIC_SUPABASE_URL='https://rtfowunsyrdygyvubnvs.supabase.co';
for(const language of ['en','es','it','ur'] as const){
  const markup=renderToStaticMarkup(<RegionalProvider initialLanguage={language}><LanguageSwitcher/></RegionalProvider>);
  for(const option of ['English','Español','Italiano','اردو'])assert.ok(markup.includes(option));
  assert.ok(markup.includes('min-h-11'));assert.ok(markup.includes('focus-visible:ring-2'));
  assert.deepEqual(Object.keys(regionalUi[language]).sort(),Object.keys(regionalUi.en).sort());
  assert.deepEqual(Object.keys(messages[language]).sort(),Object.keys(messages.en).sort());
  for(const item of navigationItems){const translated=navigationLabel(item.id,item.label,language);assert.ok(translated);if(language!=='en')assert.notEqual(translated,item.label,`Missing ${language} ${item.id}`);}
  assert.ok(navigationText('Find a page',language));
  const panel=renderToStaticMarkup(<RegionalProvider initialLanguage={language}><RegionalSettingsPanel canEdit={false} request={async()=>{throw new Error('SSR must not fetch');}}/></RegionalProvider>);
  for(const code of ['PKR','EUR','USD','GBP'])assert.ok(panel.includes(`value="${code}"`));
  assert.ok(panel.includes('<bdi>'),'Money previews must isolate mixed-direction text');
  assert.ok(!panel.includes('<form'),'No settings writes before loading authoritative preferences');
}
process.env.NEXT_PUBLIC_SUPABASE_URL='https://lhqmtgrstvwtysfjjmhz.supabase.co';
assert.equal(renderToStaticMarkup(<RegionalProvider><LanguageSwitcher/></RegionalProvider>),'');
console.log('PASS QA-only selector rendering, four catalogs, complete navigation link coverage, focus and touch classes. Physical/browser layout not asserted.');
