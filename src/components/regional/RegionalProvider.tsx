'use client';
import {createContext,useContext,useEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {languages,direction,parseLanguageCookie,parseCurrencyCookie,localeFor,type Language,type Currency} from '@/lib/regional/settings';
import {messages,type MessageKey} from '@/lib/regional/messages';
import {regionalUi,type RegionalUiKey} from '@/lib/regional/ui-messages';
import {regionalQaEnabled} from '@/lib/regional/qa';
import {setActiveCurrency,setActiveFxRate} from '@/lib/tradeos/formatters';
import {supabase} from '@/lib/supabase/client';

type RegionalContext={language:Language;enabled:boolean;setLanguage:(language:Language)=>void;currency:Currency;setCurrency:(currency:Currency)=>void;fxRate:number|null;refreshFxRate:()=>void;t:(key:MessageKey)=>string;ui:(key:RegionalUiKey)=>string};
const Context=createContext<RegionalContext>({language:'en',enabled:false,setLanguage:()=>{},currency:'PKR',setCurrency:()=>{},fxRate:null,refreshFxRate:()=>{},t:key=>messages.en[key],ui:key=>regionalUi.en[key]});
async function fetchFxRate(currency:Currency):Promise<number|null>{
  try{
    const {data}=await supabase.auth.getSession();
    const token=data.session?.access_token;
    if(!token)return null;
    const response=await fetch(`/api/fx/rates?currency=${currency}`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok)return null;
    const payload=await response.json() as {ok?:boolean;rate?:string|null};
    if(!payload.ok||!payload.rate)return null;
    const parsed=Number.parseFloat(payload.rate);
    return Number.isFinite(parsed)&&parsed>0?parsed:null;
  }catch{return null;}
}
function subscribeLanguage(onChange:()=>void){
  window.addEventListener('tradeos-language-change',onChange);
  window.addEventListener('focus',onChange);
  return ()=>{window.removeEventListener('tradeos-language-change',onChange);window.removeEventListener('focus',onChange);};
}
function subscribeCurrency(onChange:()=>void){
  window.addEventListener('tradeos-currency-change',onChange);
  window.addEventListener('focus',onChange);
  return ()=>{window.removeEventListener('tradeos-currency-change',onChange);window.removeEventListener('focus',onChange);};
}
export function RegionalProvider({children,initialLanguage='en'}:{children:ReactNode;initialLanguage?:Language}) {
  const enabled=regionalQaEnabled();
  const language=useSyncExternalStore(subscribeLanguage,()=>{
    if(!enabled)return initialLanguage;
    return parseLanguageCookie(document.cookie)??initialLanguage;
  },()=>initialLanguage);
  const currency=useSyncExternalStore(subscribeCurrency,()=>{
    if(!enabled)return 'PKR' as Currency;
    return parseCurrencyCookie(document.cookie)??('PKR' as Currency);
  },()=>'PKR' as Currency);
  useEffect(()=>{
    if(!enabled)return;
    document.documentElement.lang=language;
    document.documentElement.dir=direction(language);
  },[language,enabled]);
  useEffect(()=>{
    if(!enabled)return;
    setActiveCurrency(currency,localeFor(language));
  },[currency,language,enabled]);
  const [fxRate,setFxRate]=useState<number|null>(null);
  const [fxRefreshTick,setFxRefreshTick]=useState(0);
  const refreshFxRate=()=>setFxRefreshTick(n=>n+1);
  useEffect(()=>{
    if(!enabled)return;
    if(currency==='PKR'){setFxRate(null);setActiveFxRate(null);return;}
    let cancelled=false;
    void fetchFxRate(currency).then(rate=>{if(cancelled)return;setFxRate(rate);setActiveFxRate(rate);});
    return ()=>{cancelled=true;};
  },[currency,fxRefreshTick,enabled]);
  const setLanguage=(next:Language)=>{
    if(!enabled || !languages.includes(next))return;
    document.cookie=`tradeos-ui-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
    window.dispatchEvent(new Event('tradeos-language-change'));
  };
  const setCurrency=(next:Currency)=>{
    if(!enabled)return;
    document.cookie=`tradeos-ui-currency=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
    window.dispatchEvent(new Event('tradeos-currency-change'));
  };
  return <Context.Provider value={{language,enabled,setLanguage,currency,setCurrency,fxRate,refreshFxRate,t:key=>messages[language][key],ui:key=>regionalUi[language][key]}}>{children}</Context.Provider>;
}
export const useRegional=()=>useContext(Context);
export function LanguageSwitcher(){
  const {language,enabled,setLanguage,ui}=useRegional();
  if(!enabled)return null;
  return <label className="flex items-center gap-2 text-sm text-foreground"><span className="sr-only">{ui('browserLanguage')}</span><select aria-label={ui('browserLanguage')} value={language} onChange={e=>setLanguage(e.target.value as Language)} className="min-h-11 rounded border border-input bg-background px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="ur">اردو</option></select></label>;
}
