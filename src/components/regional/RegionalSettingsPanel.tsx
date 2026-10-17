'use client';
import {useEffect,useState} from 'react';
import {useRegional} from './RegionalProvider';
import {currencies,locales,parseRegionalSettings,type RegionalSettings,type Currency} from '@/lib/regional/settings';
import {formatDocumentMoney} from '@/lib/regional/money';
import {messages,type MessageKey} from '@/lib/regional/messages';

const control='min-h-11 w-full rounded border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type Props={request:(url:string,init?:RequestInit)=>Promise<Response>;canEdit:boolean};
export function RegionalSettingsPanel({request,canEdit}:Props){
  const {enabled,language,t,ui}=useRegional();
  const [preferences,setPreferences]=useState<RegionalSettings|null>(null);
  const [revision,setRevision]=useState('');
  const [reload,setReload]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [saved,setSaved]=useState(false);
  const [previewCurrency,setPreviewCurrency]=useState<Currency>('PKR');
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    request('/api/identity/organization/regional',{signal:controller.signal}).then(async response=>{
      const data=await response.json();
      if(!response.ok)throw new Error(data.error==='regional.persistenceUnavailable'?'persistenceUnavailable':'loadError');
      const parsed=parseRegionalSettings(data.preferences);
      if(controller.signal.aborted)return;
      setPreferences(parsed);setRevision(data.revision);setError(null);
    }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error&&error.message==='persistenceUnavailable'?'persistenceUnavailable':'loadError');});
    return ()=>controller.abort();
  },[enabled,request,reload]);
  if(!enabled)return null;
  const errorText=error && (Object.hasOwn(messages[language],error)?t(error as MessageKey):error==='regional.conflict'?ui('conflict'):error==='persistenceUnavailable'||error==='regional.persistenceUnavailable'?ui('persistenceUnavailable'):error==='loadError'?ui('loadError'):ui('saveError'));
  const update=<K extends keyof RegionalSettings>(key:K,value:RegionalSettings[K])=>{setSaved(false);setPreferences(p=>p?{...p,[key]:value}:p);};
  return <section aria-labelledby="regional-title" className="mt-5 space-y-5 rounded border border-border bg-background p-5">
    <h3 id="regional-title" className="text-lg font-semibold text-foreground">{t('regional.title')}</h3>
    <p className="text-sm text-muted-foreground">{t('regional.history')}</p>
    {errorText && <div role="alert" className="text-sm text-destructive">{errorText}<button type="button" className={`${control} mt-2 w-auto`} onClick={()=>{setPreferences(null);setError(null);setReload(n=>n+1);}}>{ui('retry')}</button></div>}
    {!preferences&&!error&&<p role="status">{ui('loading')}</p>}
    {preferences&&<form onSubmit={async event=>{
      event.preventDefault();if(!canEdit||busy)return;
      setBusy(true);setError(null);setSaved(false);
      try{
        const response=await request('/api/identity/organization/regional',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferences,revision})});
        const data=await response.json();
        if(!response.ok){setError(data.error??'saveError');return;}
        setPreferences(parseRegionalSettings(data.preferences));setRevision(data.revision);setSaved(true);
      }catch{setError('saveError');}finally{setBusy(false);}
    }} className="space-y-4">
      <fieldset disabled={!canEdit||busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-medium text-foreground">{ui('businessDefaults')}</legend>
        <label className="space-y-2 text-sm text-foreground"><span>{t('regional.language')}</span><select className={control} value={preferences.language} onChange={e=>update('language',e.target.value as RegionalSettings['language'])}><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="ur">اردو</option></select></label>
        <label className="space-y-2 text-sm text-foreground"><span>{t('regional.locale')}</span><select className={control} value={preferences.locale} onChange={e=>update('locale',e.target.value as RegionalSettings['locale'])}>{locales.map(locale=><option key={locale} value={locale}>{locale}</option>)}</select></label>
        <label className="space-y-2 text-sm text-foreground"><span>{t('regional.timeZone')}</span><input className={control} dir="ltr" value={preferences.timeZone} onChange={e=>update('timeZone',e.target.value)} list="regional-timezones"/><datalist id="regional-timezones"><option value="Asia/Karachi"/><option value="Europe/Madrid"/><option value="Europe/Rome"/><option value="Europe/London"/><option value="America/New_York"/></datalist></label>
        <label className="space-y-2 text-sm text-foreground"><span>{t('regional.currency')}</span><input className={control} readOnly value={preferences.accountingCurrency} aria-describedby="regional-currency-note"/></label>
      </fieldset>
      <p id="regional-currency-note" className="text-sm text-muted-foreground">{ui('currencyPending')}</p>
      {canEdit?<button type="submit" disabled={busy} className="min-h-11 rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">{busy?ui('saving'):t('regional.save')}</button>:<p className="text-sm text-muted-foreground">{ui('ownerOnly')}</p>}
      {saved&&<p role="status" className="text-sm text-success">{ui('saved')}</p>}
    </form>}
    <label className="block space-y-2 text-sm text-foreground"><span>{ui('preview')}</span><select className={control} value={previewCurrency} onChange={e=>setPreviewCurrency(e.target.value as Currency)}>{Object.keys(currencies).map(code=><option key={code} value={code}>{code}</option>)}</select></label>
    <output className="block text-lg tabular-nums text-foreground"><bdi>{formatDocumentMoney({amount:'1234.56',currency:previewCurrency},preferences?.locale??({en:'en-PK',es:'es-ES',it:'it-IT',ur:'ur-PK'} as const)[language])}</bdi></output>
  </section>;
}
