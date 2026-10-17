import type { Language } from './settings';
// Stable section IDs; record names and customer-entered values are never translated.
const labels:Record<string,readonly [string,string,string]>={
  dashboard:['Panel','Panoramica','ڈیش بورڈ'], 'setup-import':['Configuración e importación','Configurazione e importazione','ترتیبات اور ڈیٹا درآمد'],
  products:['Productos','Prodotti','مصنوعات'],brands:['Marcas','Marchi','برانڈز'],categories:['Categorías','Categorie','زمرے'],customers:['Clientes','Clienti','گاہک'],suppliers:['Proveedores','Fornitori','سپلائر'],purchases:['Compras','Acquisti','خریداری'],sales:['Ventas','Vendite','فروخت'],inventory:['Inventario','Inventario','اسٹاک'],
  'customer-payments':['Cobros de clientes','Incassi dai clienti','گاہکوں سے وصولیاں'],'supplier-payments':['Pagos a proveedores','Pagamenti ai fornitori','سپلائر کو ادائیگیاں'],expenses:['Gastos','Spese','اخراجات'],'profit-loss':['Pérdidas y ganancias','Profitti e perdite','منافع اور نقصان'],
  'business-intelligence':['Análisis empresarial','Analisi aziendale','کاروباری تجزیہ'],'business-records':['Exportar registros','Esporta registri','کاروباری ریکارڈ برآمد'],'ai-analytics':['Análisis con IA','Analisi IA','اے آئی تجزیہ'],'customer-credit':['Crédito de clientes','Credito clienti','گاہکوں کا ادھار'],'supplier-ledger':['Libro de proveedores','Mastro fornitori','سپلائر کھاتہ'],'business-settings':['Configuración de empresa','Impostazioni attività','کاروباری ترتیبات'],
  'task-manager':['Tareas','Attività','کام'],'activity-logs':['Registro de actividad','Registro attività','سرگرمی کا ریکارڈ'],'staff-permissions':['Personal y permisos','Personale e permessi','عملہ اور اختیارات'],'security-check':['Comprobación de seguridad','Controllo sicurezza','حفاظتی جانچ'],deployment:['Despliegue','Distribuzione','تعیناتی'],'staff-duty':['Turnos del personal','Turni del personale','عملے کی ڈیوٹی'],
  'ai-assistant':['Asistente de IA','Assistente IA','اے آئی معاون'],'ai-business-query':['Consulta empresarial con IA','Domande aziendali IA','اے آئی کاروباری سوال'],'ai-voice-operator':['Operador de voz IA','Operatore vocale IA','اے آئی صوتی آپریٹر'],'market-intelligence':['Información de mercado','Analisi di mercato','مارکیٹ کی معلومات'],'live-tracking':['Seguimiento en directo','Tracciamento in tempo reale','براہ راست ٹریکنگ'],'mobile-app':['Aplicación móvil','App mobile','موبائل ایپ'],employees:['Empleados','Dipendenti','ملازمین'],territories:['Territorios','Territori','علاقے'],routes:['Rutas','Percorsi','روٹس'],notifications:['Notificaciones','Notifiche','اطلاعات'],
};
export function navigationLabel(id:string,fallback:string,language:Language){
  return language==='en'?fallback:(labels[id]?.[language==='es'?0:language==='it'?1:2]??fallback);
}
const chrome:Record<string,readonly [string,string,string]>={
  Home:['Inicio','Home','ابتدا'],Sell:['Vender','Vendere','فروخت'],Stock:['Existencias','Scorte','اسٹاک'],Buy:['Comprar','Acquistare','خریداری'],Customers:['Clientes','Clienti','گاہک'],Money:['Finanzas','Finanze','مالیات'],More:['Más','Altro','مزید'],
  'Find a page':['Buscar una página','Trova una pagina','صفحہ تلاش کریں'],'Search menu':['Buscar en el menú','Cerca nel menu','مینو میں تلاش کریں'],'Main navigation':['Navegación principal','Navigazione principale','مرکزی نیویگیشن'],'Navigation menu':['Menú de navegación','Menu di navigazione','نیویگیشن مینو'],'Close navigation menu':['Cerrar menú','Chiudi menu','مینو بند کریں'],'No matching pages. Try another name.':['No hay páginas coincidentes. Prueba otro nombre.','Nessuna pagina corrispondente. Prova un altro nome.','کوئی صفحہ نہیں ملا۔ دوسرا نام آزمائیں۔'],
  'Drag to reorder':['Arrastra para reordenar','Trascina per riordinare','ترتیب بدلنے کے لیے گھسیٹیں'],
  'Move up':['Subir','Sposta su','اوپر کریں'],'Move down':['Bajar','Sposta giù','نیچے کریں'],
  'Hide section':['Ocultar sección','Nascondi sezione','حصہ چھپائیں'],'Unhide section':['Mostrar sección','Mostra sezione','حصہ دکھائیں'],
  'Reset to default order':['Restablecer orden','Ripristina ordine','ترتیب بحال کریں'],
  'Done customizing':['Terminar personalización','Fine personalizzazione','ترتیب مکمل'],
  'Reorder or hide menu sections':['Reordenar u ocultar secciones','Riordina o nascondi sezioni','مینو کے حصوں کی ترتیب یا نمائش بدلیں'],
  'Expand sidebar':['Expandir barra lateral','Espandi barra laterale','سائیڈ بار پھیلائیں'],
  'Collapse sidebar':['Contraer barra lateral','Comprimi barra laterale','سائیڈ بار سمیٹیں'],
  'drag onto the home dashboard to add it as a card':['arrástrala al panel principal para añadirla como tarjeta','trascinala nella dashboard per aggiungerla come scheda','اسے کارڈ کے طور پر شامل کرنے کے لیے ہوم ڈیش بورڈ پر گھسیٹیں'],
  'No menu sections to show.':['No hay secciones de menú para mostrar.','Nessuna sezione di menu da mostrare.','دکھانے کے لیے مینو کے حصے نہیں ہیں۔'],
  'Customize your workspace':['Personaliza tu espacio de trabajo','Personalizza il tuo spazio di lavoro','اپنی ورک اسپیس ترتیب دیں'],
  'Reorder pages within their task groups. Use the eye to show or hide a page.':['Reordena las páginas dentro de sus grupos de tareas. Usa el ojo para mostrar u ocultar una página.','Riordina le pagine nei rispettivi gruppi di attività. Usa l’occhio per mostrare o nascondere una pagina.','صفحات کو ان کے ٹاسک گروپوں میں ترتیب دیں۔ صفحہ دکھانے یا چھپانے کے لیے آنکھ کا نشان استعمال کریں۔'],
  'Reorder / hide sections':['Reordenar / ocultar secciones','Riordina / nascondi sezioni','حصے ترتیب دیں / چھپائیں'],
  'Collapse':['Contraer','Comprimi','سمیٹیں'],
  'Screen zoom':['Zoom de pantalla','Zoom schermo','اسکرین زوم'],
  'Suggested zoom ratio':['Proporción de zoom sugerida','Rapporto di zoom consigliato','تجویز کردہ زوم تناسب'],
  'Custom percentage':['Porcentaje personalizado','Percentuale personalizzata','اپنی مرضی کا فیصد'],
  'Custom zoom percentage':['Porcentaje de zoom personalizado','Percentuale di zoom personalizzata','اپنی مرضی کے زوم کا فیصد'],
  'Okay':['Aceptar','OK','ٹھیک ہے'],'Cancel':['Cancelar','Annulla','منسوخ کریں'],
};
export function navigationText(key:string,language:Language){return language==='en'?key:(chrome[key]?.[language==='es'?0:language==='it'?1:2]??key);}
