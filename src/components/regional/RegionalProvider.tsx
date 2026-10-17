'use client';
import {createContext,useContext,useEffect,useSyncExternalStore,type ReactNode} from 'react';
import {languages,direction,type Language} from '@/lib/regional/settings';
import {messages,type MessageKey} from '@/lib/regional/messages';
import {regionalUi,type RegionalUiKey} from '@/lib/regional/ui-messages';
import {regionalQaEnabled} from '@/lib/regional/qa';

type RegionalContext={language:Language;enabled:boolean;setLanguage:(language:Language)=>void;t:(key:MessageKey)=>string;ui:(key:RegionalUiKey)=>string};
const Context=createContext<RegionalContext>({language:'en',enabled:false,setLanguage:()=>{},t:key=>messages.en[key],ui:key=>regionalUi.en[key]});
function subscribeLanguage(onChange:()=>void){
  window.addEventListener('tradeos-language-change',onChange);
  window.addEventListener('focus',onChange);
  return ()=>{window.removeEventListener('tradeos-language-change',onChange);window.removeEventListener('focus',onChange);};
}
export function RegionalProvider({children,initialLanguage='en'}:{children:ReactNode;initialLanguage?:Language}) {
  const enabled=regionalQaEnabled();
  const language=useSyncExternalStore(subscribeLanguage,()=>{
    if(!enabled)return initialLanguage;
    const saved=document.cookie.split('; ').find(s=>s.startsWith('tradeos-ui-language='))?.split('=')[1];
    return languages.includes(saved as Language)?saved as Language:initialLanguage;
  },()=>initialLanguage);
  useEffect(()=>{
    if(!enabled)return;
    document.documentElement.lang=language;
    document.documentElement.dir=direction(language);
  },[language,enabled]);
  const setLanguage=(next:Language)=>{
    if(!enabled || !languages.includes(next))return;
    document.cookie=`tradeos-ui-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
    window.dispatchEvent(new Event('tradeos-language-change'));
  };
  return <Context.Provider value={{language,enabled,setLanguage,t:key=>messages[language][key],ui:key=>regionalUi[language][key]}}>{children}</Context.Provider>;
}
export const useRegional=()=>useContext(Context);
export function LanguageSwitcher(){
  const {language,enabled,setLanguage,ui}=useRegional();
  if(!enabled)return null;
  return <label className="flex items-center gap-2 text-sm text-foreground"><span className="sr-only">{ui('browserLanguage')}</span><select aria-label={ui('browserLanguage')} value={language} onChange={e=>setLanguage(e.target.value as Language)} className="min-h-11 rounded border border-input bg-background px-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="ur">اردو</option></select></label>;
}
