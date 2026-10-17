import type { Language } from '../regional/settings';
import type { GuideTopic } from './guide';

// Localized welcome-tutorial content. English lives in guide.ts (guideTopics).
const localized: Record<Exclude<Language, 'en'>, GuideTopic[]> = {
  es: [
    {
      title: "Bienvenido a TradeOS",
      description: "Gestiona productos, inventario, compras, ventas, pagos y tu equipo en un solo espacio de trabajo. Las pantallas disponibles dependen de los permisos del propietario.",
      steps: [
        "Comienza con la configuración del negocio, las marcas y las categorías.",
        "Añade productos con las unidades, precios y existencias iniciales correctos.",
        "Añade clientes y proveedores, luego registra compras y ventas.",
        "Registra pagos y revisa tus informes. Haz clic en cualquier icono de interrogación para obtener ayuda. Este tutorial nunca modifica tus registros.",
      ],
    },
    {
      title: "Productos, marcas y categorías",
      description: "Un producto es un artículo que compras o vendes. Las marcas y las categorías organizan los productos y te ayudan a filtrar los informes.",
      steps: [
        "Añade el nombre del producto, la marca/categoría y el código SKU o código de barras opcional.",
        "Configura la unidad principal, la subunidad opcional y las unidades por paquete antes de registrar las existencias.",
        "Introduce los precios para la unidad principal y revisa la configuración de reposición, lotes y caducidad.",
        "Guarda el producto. Usa la revisión de configuración para completar los ajustes faltantes de muchos productos a la vez.",
      ],
    },
    {
      title: "Unidad principal y subunidad",
      description: "La unidad principal es un paquete, caja, cartón, kilogramo u otra unidad que definas. Una subunidad es una cantidad menor, como una pieza o un gramo.",
      steps: [
        "Ejemplo: unidad principal Caja, subunidad Pieza, unidades por paquete 12 significa que una caja contiene 12 piezas.",
        "Elige Principal para vender cajas o Subunidad para vender piezas. Dos cajas contienen 24 piezas.",
        "La cantidad y el precio en una factura corresponden a la unidad seleccionada. Un precio de 120 por unidad principal equivale a 10 por pieza cuando el paquete contiene 12.",
        "Revisa la unidad mostrada antes de guardar. Un producto sin una conversión de subunidad válida usa su unidad principal.",
      ],
    },
    {
      title: "Código de barras y venta rápida",
      description: "Usa un escáner de códigos de barras USB/Bluetooth en modo teclado. Escribe el código de barras en el campo de escaneo activo; en este modo no se necesita ningún emparejamiento especial dentro de TradeOS.",
      steps: [
        "En Productos, haz clic en Listo para escanear, escanea el código de barras, completa los datos restantes y guarda. Conserva los ceros iniciales del código de barras.",
        "Elige Retail POS / Crear una venta desde el panel principal. TradeOS prepara un cliente Sin cita para tu negocio; elige otro cliente cuando sea necesario.",
        "Elige si cada escaneo añade una unidad principal o una subunidad. Escanea para añadir el producto guardado correspondiente. Escanear de nuevo aumenta su cantidad.",
        "Ajusta la cantidad/precio según sea necesario. Haz clic en Listo para escanear después de editar otro campo. Los códigos de barras desconocidos o duplicados deben corregirse.",
        "Revisa y elige Pagar y guardar. Las ventas de los empleados aún requieren la aprobación del propietario. Pausar venta mantiene una cesta sin terminar en este navegador sin contabilizarla. Después de guardar, abre el recibo para imprimirlo. Usa Factura completa para opciones avanzadas.",
      ],
    },
    {
      title: "Facturas de venta, pedidos y devoluciones",
      description: "Las facturas registran ventas. Los pedidos rastrean ventas solicitadas; los envíos de los empleados pueden quedar pendientes de aprobación. Las devoluciones revierten artículos vendidos elegibles mediante el flujo de devolución.",
      steps: [
        "Elige un cliente, una fecha y un tipo de pago al contado/a crédito.",
        "Busca o escanea productos; verifica unidades, cantidad, precio de venta, descuento y cualquier cantidad adicional gratuita.",
        "Enter pasa al siguiente campo de la factura; el último campo puede abrir una nueva línea de producto. Usa el botón Guardar para terminar.",
        "Los propietarios revisan los borradores del personal antes de la aprobación. No trates un borrador pendiente como una venta completada.",
        "Usa el historial de facturas, las devoluciones, las facturas imprimibles y los formularios de carga según tus permisos.",
      ],
    },
    {
      title: "Compras y proveedores",
      description: "Registra las existencias compradas a los proveedores y controla lo que tu negocio les debe.",
      steps: [
        "Crea primero el proveedor, luego abre una factura de compra.",
        "Elige los productos y sus unidades de compra, cantidades y costos. Introduce los detalles de lote/caducidad cuando sea necesario.",
        "Revisa y guarda. Una compra guardada actualiza las existencias y los registros de proveedores correspondientes.",
        "Registra los pagos a proveedores por separado y revisa la asignación y los saldos pendientes en el libro mayor del proveedor.",
      ],
    },
    {
      title: "Inventario e importaciones",
      description: "El inventario muestra las existencias y sus movimientos. Las asignaciones de importación indican a TradeOS qué significa cada columna externa.",
      steps: [
        "Elige una entidad y sube su archivo. Reutiliza una asignación guardada para el mismo formato de archivo.",
        "Asigna las cantidades por su significado, no por el nombre de la columna de origen. Revisa con cuidado las existencias iniciales y las unidades.",
        "Revisa los errores y el tratamiento de duplicados antes de importar. Las importaciones de actualización conservan los ajustes compatibles omitidos.",
        "Usa la revisión de configuración para campos faltantes y ediciones masivas. Un nivel de reposición de cero y No son ajustes válidos e intencionados.",
        "El historial de existencias registra los movimientos; nunca inventes cantidades históricas faltantes. Revisa las alertas de stock bajo y caducidad.",
      ],
    },
    {
      title: "Clientes, crédito y pagos",
      description: "Los registros de clientes contienen datos de contacto, reglas de crédito y asignaciones opcionales de vendedor/territorio. Los registros de pagos rastrean el dinero recibido.",
      steps: [
        "Añade o importa clientes y verifica sus reglas de crédito.",
        "Los vendedores autorizados pueden enviar ventas para clientes activos de su organización, incluidos los clientes no asignados.",
        "Registra el importe recibido, el método, la fecha y la referencia, luego revisa las asignaciones de facturas.",
        "Al importar pagos históricos, usa referencias únicas para evitar duplicados. Las importaciones no reconstruyen automáticamente los saldos iniciales ni asignan pagos antiguos.",
        "Revisa las facturas pendientes y el crédito vencido antes de aceptar otra venta a crédito.",
      ],
    },
    {
      title: "Panel principal, informes y gastos",
      description: "Usa el panel principal para revisar las ventas registradas, las existencias, los importes adeudados y la actividad reciente. Registra los gastos del negocio para que los informes los incluyan.",
      steps: [
        "Revisa el rango de fechas antes de comparar totales.",
        "Abre los informes de ventas, compras, existencias y clientes para ver los detalles detrás de un resumen.",
        "Usa Exportar registros del negocio para las fechas seleccionadas, luego Imprimir / Guardar como PDF.",
        "La exportación incluye las transacciones compatibles y la actividad registrada; no es una copia de seguridad completa de la base de datos.",
        "Revisa los beneficios y otros totales contra las facturas y costos de origen antes de usarlos para decisiones del negocio.",
      ],
    },
    {
      title: "Empleados, permisos y trabajo de campo",
      description: "Los propietarios invitan al personal, eligen las herramientas permitidas y gestionan las asignaciones. Los empleados usan las pantallas que se les han otorgado y revisan su propio rendimiento.",
      steps: [
        "Un registro de empleado importado no crea automáticamente un inicio de sesión. Invita o aprovisiona la cuenta del personal por separado.",
        "Otorga solo las secciones y subopciones de ventas que el empleado necesite.",
        "Configura territorios/rutas, luego revisa visitas, asistencia, turnos y cobros donde estén habilitados.",
        "Las funciones de ubicación necesitan permisos del dispositivo y conectividad. El comportamiento en segundo plano del móvil también depende del dispositivo.",
        "Los empleados envían ventas para su aprobación; los propietarios aprueban o rechazan. La ayuda no otorga acceso adicional.",
      ],
    },
    {
      title: "Plantillas de impresión y de referencia",
      description: "Guarda diseños de facturas/formularios de carga y reutilízalos para futuras impresiones.",
      steps: [
        "Abre el personalizador de plantillas y sube un PDF, imagen u hoja de cálculo de referencia.",
        "Las hojas de cálculo detectan directamente las columnas de tabla compatibles. Las imágenes/PDF necesitan un proveedor de reconocimiento configurado.",
        "Revisa las columnas reconocidas, las fuentes, los anchos y la vista previa; los diseños de referencia arbitrarios no siempre se pueden copiar exactamente.",
        "Confirma los ajustes propuestos, haz correcciones y guarda explícitamente la plantilla.",
      ],
    },
    {
      title: "IA, tareas y configuración del negocio",
      description: "Las funciones de IA pueden ayudar con consultas y borradores cuando su proveedor está configurado. La configuración controla los datos del negocio y los flujos de trabajo disponibles.",
      steps: [
        "Haz preguntas usando los registros disponibles para tu cuenta; verifica los resultados contra las transacciones de origen.",
        "Revisa las acciones sugeridas antes de que se modifique cualquier registro del negocio. Las interrupciones del proveedor o la falta de claves pueden impedir que las funciones de IA funcionen.",
        "Usa tareas y notificaciones para dar seguimiento al trabajo.",
        "Los propietarios gestionan la marca, los permisos del personal, la seguridad y otros ajustes. Las listas de verificación de implementación/preparación no instalan automáticamente una aplicación móvil ni configuran servicios externos.",
      ],
    },
  ],
  it: [
    {
      title: "Benvenuto in TradeOS",
      description: "Gestisci prodotti, magazzino, acquisti, vendite, pagamenti e il tuo team in un unico spazio di lavoro. Le schermate disponibili dipendono dai permessi del proprietario.",
      steps: [
        "Inizia dalle impostazioni aziendali, dai marchi e dalle categorie.",
        "Aggiungi i prodotti con le unità, i prezzi e le giacenze iniziali corretti.",
        "Aggiungi clienti e fornitori, poi registra acquisti e vendite.",
        "Registra i pagamenti e rivedi i report. Clicca su qualsiasi icona con il punto interrogativo per assistenza. Questo tutorial non modifica mai i tuoi record.",
      ],
    },
    {
      title: "Prodotti, marchi e categorie",
      description: "Un prodotto è un articolo che acquisti o vendi. I marchi e le categorie organizzano i prodotti e ti aiutano a filtrare i report.",
      steps: [
        "Aggiungi il nome del prodotto, il marchio/categoria e il codice SKU o codice a barre facoltativo.",
        "Imposta l'unità principale, la sotto-unità facoltativa e le unità per confezione prima di inserire le giacenze.",
        "Inserisci i prezzi per l'unità principale e rivedi le impostazioni di riordino, lotto e scadenza.",
        "Salva il prodotto. Usa la revisione di configurazione per completare le impostazioni mancanti di molti prodotti insieme.",
      ],
    },
    {
      title: "Unità principale e sotto-unità",
      description: "L'unità principale è un pacco, una scatola, un cartone, un chilogrammo o un'altra unità da te definita. Una sotto-unità è una quantità minore, come un pezzo o un grammo.",
      steps: [
        "Esempio: unità principale Scatola, sotto-unità Pezzo, unità per confezione 12 significa che una scatola contiene 12 pezzi.",
        "Scegli Principale per vendere scatole o Sotto-unità per vendere pezzi. Due scatole contengono 24 pezzi.",
        "La quantità e il prezzo in fattura si riferiscono all'unità selezionata. Un prezzo di 120 per l'unità principale diventa 10 al pezzo quando la confezione ne contiene 12.",
        "Controlla l'unità visualizzata prima di salvare. Un prodotto senza una conversione di sotto-unità valida usa la sua unità principale.",
      ],
    },
    {
      title: "Codice a barre e vendita rapida",
      description: "Usa uno scanner di codici a barre USB/Bluetooth in modalità tastiera. Digita il codice a barre nel campo di scansione attivo; per questa modalità non serve alcun abbinamento speciale del dispositivo all'interno di TradeOS.",
      steps: [
        "In Prodotti, clicca su Pronto a scansionare, scansiona il codice a barre, completa i dati rimanenti e salva. Mantieni gli zeri iniziali del codice a barre.",
        "Scegli Retail POS / Crea una vendita dalla dashboard. TradeOS prepara un cliente Walk-in per la tua attività; scegli un altro cliente quando serve.",
        "Scegli se ogni scansione aggiunge un'unità principale o una sotto-unità. Scansiona per aggiungere il prodotto salvato corrispondente. Scansionare di nuovo aumenta la sua quantità.",
        "Regola quantità/prezzo se necessario. Clicca su Pronto a scansionare dopo aver modificato un altro campo. I codici a barre sconosciuti o duplicati devono essere corretti.",
        "Rivedi e scegli Paga e salva. Le vendite dei dipendenti richiedono comunque l'approvazione del proprietario. Sospendi vendita conserva un carrello incompleto su questo browser senza registrarlo. Dopo il salvataggio, apri la ricevuta per stamparla. Usa Fattura completa per le opzioni avanzate.",
      ],
    },
    {
      title: "Fatture di vendita, ordini e resi",
      description: "Le fatture registrano le vendite. Gli ordini tengono traccia delle vendite richieste; gli invii dei dipendenti possono restare in attesa di approvazione. I resi stornano gli articoli venduti idonei tramite il flusso di reso.",
      steps: [
        "Scegli un cliente, una data e un tipo di pagamento in contanti/a credito.",
        "Cerca o scansiona i prodotti; controlla unità, quantità, prezzo di vendita, sconto ed eventuali quantità omaggio.",
        "Invio passa al campo successivo della fattura; l'ultimo campo può aprire una nuova riga prodotto. Usa il pulsante Salva per terminare.",
        "I proprietari rivedono le bozze del personale prima dell'approvazione. Non considerare una bozza in sospeso come una vendita completata.",
        "Usa lo storico fatture, i resi, le fatture stampabili e i moduli di carico secondo i tuoi permessi.",
      ],
    },
    {
      title: "Acquisti e fornitori",
      description: "Registra le scorte acquistate dai fornitori e tieni traccia di quanto la tua attività deve loro.",
      steps: [
        "Crea prima il fornitore, poi apri una fattura di acquisto.",
        "Scegli i prodotti e le relative unità di acquisto, quantità e costi. Inserisci i dettagli di lotto/scadenza quando richiesto.",
        "Rivedi e salva. Un acquisto salvato aggiorna le scorte e i record fornitore pertinenti.",
        "Registra i pagamenti ai fornitori separatamente e rivedi imputazioni e importi in sospeso nel mastro fornitori.",
      ],
    },
    {
      title: "Magazzino e importazioni",
      description: "Il magazzino mostra le scorte e i loro movimenti. Le mappature di importazione indicano a TradeOS cosa significa ogni colonna esterna.",
      steps: [
        "Scegli un'entità e carica il suo file. Riutilizza una mappatura salvata per lo stesso formato di file.",
        "Mappa le quantità in base al significato, non al nome della colonna di origine. Rivedi con attenzione le giacenze iniziali e le unità.",
        "Prima di importare, controlla gli errori e la gestione dei duplicati. Le importazioni di aggiornamento conservano le impostazioni compatibili omesse.",
        "Usa la revisione di configurazione per i campi mancanti e le modifiche in blocco. Un livello di riordino pari a zero e No sono impostazioni valide e deliberate.",
        "La cronologia delle scorte registra i movimenti; non inventare mai quantità storiche mancanti. Controlla gli avvisi di scorte basse e scadenze.",
      ],
    },
    {
      title: "Clienti, credito e pagamenti",
      description: "Le schede cliente contengono dati di contatto, regole di credito e assegnazioni facoltative di venditore/territorio. I record di pagamento tengono traccia del denaro ricevuto.",
      steps: [
        "Aggiungi o importa i clienti e verifica le loro regole di credito.",
        "I venditori autorizzati possono inviare vendite per i clienti attivi della loro organizzazione, inclusi i clienti non assegnati.",
        "Registra l'importo ricevuto, il metodo, la data e il riferimento, poi rivedi le imputazioni alle fatture.",
        "Quando importi pagamenti storici, usa riferimenti univoci per evitare duplicati. Le importazioni non ricostruiscono automaticamente i saldi iniziali né imputano i vecchi pagamenti.",
        "Controlla le fatture in sospeso e il credito scaduto prima di accettare un'altra vendita a credito.",
      ],
    },
    {
      title: "Dashboard, report e spese",
      description: "Usa la dashboard per rivedere le vendite registrate, le scorte, gli importi dovuti e l'attività recente. Registra le spese aziendali così i report le includono.",
      steps: [
        "Controlla l'intervallo di date prima di confrontare i totali.",
        "Apri i report di vendite, acquisti, magazzino e clienti per i dettagli dietro a un riepilogo.",
        "Usa Esporta record aziendali per le date selezionate, poi Stampa / Salva come PDF.",
        "L'esportazione include le transazioni supportate e l'attività registrata; non è un backup completo del database.",
        "Rivedi l'utile e gli altri totali rispetto a fatture e costi di origine prima di usarli per decisioni aziendali.",
      ],
    },
    {
      title: "Dipendenti, permessi e lavoro sul campo",
      description: "I proprietari invitano il personale, scelgono gli strumenti consentiti e gestiscono le assegnazioni. I dipendenti usano le schermate loro concesse e rivedono la propria performance.",
      steps: [
        "Un record dipendente importato non crea automaticamente un accesso. Invita o attiva l'account del personale separatamente.",
        "Concedi solo le sezioni e le sotto-opzioni di vendita di cui il dipendente ha bisogno.",
        "Imposta territori/percorsi, poi rivedi visite, presenze, turni e incassi dove abilitati.",
        "Le funzioni di posizione richiedono i permessi del dispositivo e la connettività. Il comportamento in background del mobile dipende anche dal dispositivo.",
        "I dipendenti inviano le vendite per l'approvazione; i proprietari approvano o rifiutano. L'aiuto non concede accesso aggiuntivo.",
      ],
    },
    {
      title: "Modelli di stampa e di riferimento",
      description: "Salva i layout di fatture/moduli di carico e riutilizzali per le stampe future.",
      steps: [
        "Apri il personalizzatore di modelli e carica un PDF, un'immagine o un foglio di calcolo di riferimento.",
        "I fogli di calcolo rilevano direttamente le colonne di tabella supportate. Immagini/PDF richiedono un provider di riconoscimento configurato.",
        "Rivedi le colonne riconosciute, i font, le larghezze e l'anteprima; i layout di riferimento arbitrari non possono sempre essere copiati esattamente.",
        "Conferma le impostazioni proposte, fai le correzioni e salva esplicitamente il modello.",
      ],
    },
    {
      title: "IA, attività e impostazioni aziendali",
      description: "Le funzioni IA possono aiutare con domande e bozze quando il loro provider è configurato. Le impostazioni controllano i dati aziendali e i flussi di lavoro disponibili.",
      steps: [
        "Fai domande usando i record disponibili per il tuo account; verifica i risultati rispetto alle transazioni di origine.",
        "Rivedi le azioni suggerite prima che venga modificato qualsiasi record aziendale. Interruzioni del provider o chiavi mancanti possono impedire il funzionamento delle funzioni IA.",
        "Usa attività e notifiche per dare seguito al lavoro.",
        "I proprietari gestiscono il branding, i permessi del personale, la sicurezza e altre impostazioni. Le checklist di deployment/prontezza non installano automaticamente un'app mobile né configurano servizi esterni.",
      ],
    },
  ],
  ur: [
    {
      title: "TradeOS میں خوش آمدید",
      description: "مصنوعات، اسٹاک، خریداری، فروخت، ادائیگیوں اور اپنی ٹیم کا انتظام ایک ہی ورک اسپیس میں کریں۔ دستیاب اسکرینیں مالک کی اجازتوں پر منحصر ہیں۔",
      steps: [
        "کاروباری ترتیبات، برانڈز اور زمروں سے شروع کریں۔",
        "درست اکائیوں، قیمتوں اور ابتدائی اسٹاک کے ساتھ مصنوعات شامل کریں۔",
        "گاہک اور سپلائرز شامل کریں، پھر خریداری اور فروخت درج کریں۔",
        "ادائیگیاں درج کریں اور اپنی رپورٹس کا جائزہ لیں۔ مدد کے لیے کسی بھی سوالیہ نشان آئیکن پر کلک کریں۔ یہ ٹیوٹوریل آپ کے ریکارڈز کو کبھی تبدیل نہیں کرتا۔",
      ],
    },
    {
      title: "مصنوعات، برانڈز اور زمرے",
      description: "مصنوعات وہ چیز ہے جو آپ خریدتے یا بیچتے ہیں۔ برانڈز اور زمرے مصنوعات کو منظم کرتے ہیں اور رپورٹس کو فلٹر کرنے میں مدد دیتے ہیں۔",
      steps: [
        "مصنوعات کا نام، برانڈ/زمرہ، اور اختیاری SKU یا بارکوڈ شامل کریں۔",
        "اسٹاک درج کرنے سے پہلے مرکزی اکائی، اختیاری ذیلی اکائی اور فی پیک اکائیوں کی تعداد مقرر کریں۔",
        "مرکزی اکائی کی قیمتیں درج کریں اور دوبارہ ترتیب/بیچ/میعاد کی ترتیبات کا جائزہ لیں۔",
        "مصنوعات محفوظ کریں۔ بہت سی مصنوعات کی غائب ترتیبات ایک ساتھ مکمل کرنے کے لیے سیٹ اپ جائزہ استعمال کریں۔",
      ],
    },
    {
      title: "مرکزی اکائی اور ذیلی اکائی",
      description: "مرکزی اکائی ایک پیک، ڈبہ، کارٹن، کلوگرام یا آپ کی مقرر کردہ کوئی اور اکائی ہے۔ ذیلی اکائی ایک چھوٹی مقدار ہے جیسے پیس یا گرام۔",
      steps: [
        "مثال: مرکزی اکائی ڈبہ، ذیلی اکائی پیس، فی پیک اکائیاں 12 کا مطلب ہے ایک ڈبے میں 12 پیس ہیں۔",
        "ڈبے بیچنے کے لیے مرکزی اکائی یا پیس بیچنے کے لیے ذیلی اکائی منتخب کریں۔ دو ڈبوں میں 24 پیس ہوتے ہیں۔",
        "انوائس پر مقدار اور قیمت منتخب کردہ اکائی کے لیے ہے۔ پیک میں 12 پیس ہونے پر مرکزی اکائی کی قیمت 120 فی پیس 10 بن جاتی ہے۔",
        "محفوظ کرنے سے پہلے دکھائی گئی اکائی کا جائزہ لیں۔ درست ذیلی اکائی تبادلہ کے بغیر مصنوعات اپنی مرکزی اکائی استعمال کرتی ہے۔",
      ],
    },
    {
      title: "بارکوڈ اور فوری فروخت",
      description: "کی بورڈ موڈ میں USB/Bluetooth بارکوڈ اسکینر استعمال کریں۔ یہ فعال اسکین فیلڈ میں بارکوڈ ٹائپ کرتا ہے؛ اس موڈ کے لیے TradeOS کے اندر کسی خاص ڈیوائس پیئرنگ کی ضرورت نہیں۔",
      steps: [
        "مصنوعات میں، اسکین کے لیے تیار پر کلک کریں، بارکوڈ اسکین کریں، باقی تفصیلات پُر کریں اور محفوظ کریں۔ بارکوڈ کے شروع کے صفر برقرار رکھیں۔",
        "ڈیش بورڈ سے Retail POS / فروخت بنائیں منتخب کریں۔ TradeOS آپ کے کاروبار کے لیے واک اِن گاہک تیار کرتا ہے؛ ضرورت ہو تو کوئی اور گاہک منتخب کریں۔",
        "منتخب کریں کہ ہر اسکین ایک مرکزی اکائی شامل کرے یا ایک ذیلی اکائی۔ مماثل محفوظ مصنوعات شامل کرنے کے لیے اسکین کریں۔ دوبارہ اسکین کرنے سے اس کی مقدار بڑھتی ہے۔",
        "ضرورت کے مطابق مقدار/قیمت ایڈجسٹ کریں۔ کوئی اور فیلڈ ایڈٹ کرنے کے بعد اسکین کے لیے تیار پر کلک کریں۔ نامعلوم یا ڈپلیکیٹ بارکوڈز درست کرنا ضروری ہیں۔",
        "جائزہ لیں اور ادا کریں اور محفوظ کریں منتخب کریں۔ ملازمین کی فروخت کے لیے اب بھی مالک کی منظوری ضروری ہے۔ فروخت روکیں اس براؤزر میں نامکمل ٹوکری کو پوسٹ کیے بغیر رکھتی ہے۔ محفوظ کرنے کے بعد، پرنٹ کرنے کے لیے رسید کھولیں۔ اعلیٰ درجے کے اختیارات کے لیے مکمل انوائس استعمال کریں۔",
      ],
    },
    {
      title: "فروخت کی انوائسیں، آرڈرز اور واپسیاں",
      description: "انوائسیں فروخت درج کرتی ہیں۔ آرڈرز درخواست کردہ فروخت کو ٹریک کرتے ہیں؛ ملازمین کی جمع کردہ چیزیں منظوری کے لیے زیر التوا رہ سکتی ہیں۔ واپسیاں واپسی کے ورک فلو کے ذریعے اہل فروخت شدہ اشیاء کو الٹ دیتی ہیں۔",
      steps: [
        "گاہک، تاریخ اور نقد/ادھار ادائیگی کی قسم منتخب کریں۔",
        "مصنوعات تلاش کریں یا اسکین کریں؛ اکائیاں، مقدار، فروخت قیمت، رعایت اور کوئی مفت بونس مقدار چیک کریں۔",
        "Enter اگلے انوائس فیلڈ میں جاتا ہے؛ آخری فیلڈ نئی مصنوعات کی لائن کھول سکتا ہے۔ ختم کرنے کے لیے محفوظ کریں بٹن استعمال کریں۔",
        "مالکان منظوری سے پہلے عملے کے مسودوں کا جائزہ لیتے ہیں۔ زیر التوا مسودے کو مکمل فروخت نہ سمجھیں۔",
        "اپنی اجازتوں کے مطابق انوائس ہسٹری، واپسیاں، پرنٹ ایبل انوائسیں اور لوڈ فارمز استعمال کریں۔",
      ],
    },
    {
      title: "خریداری اور سپلائرز",
      description: "سپلائرز سے خریدا گیا اسٹاک درج کریں اور ٹریک کریں کہ آپ کے کاروبار کو ان کا کیا واجب الادا ہے۔",
      steps: [
        "پہلے سپلائر بنائیں، پھر خریداری کی انوائس کھولیں۔",
        "مصنوعات اور ان کی خریداری اکائیاں، مقداریں اور لاگتیں منتخب کریں۔ ضرورت ہو تو بیچ/میعاد کی تفصیلات درج کریں۔",
        "جائزہ لیں اور محفوظ کریں۔ محفوظ شدہ خریداری متعلقہ اسٹاک اور سپلائر ریکارڈز اپ ڈیٹ کرتی ہے۔",
        "سپلائر کی ادائیگیاں الگ سے درج کریں اور سپلائر لیجر میں تخصیص/واجب الادا رقوم کا جائزہ لیں۔",
      ],
    },
    {
      title: "انوینٹری اور امپورٹس",
      description: "انوینٹری اسٹاک اور اس کی حرکات دکھاتی ہے۔ امپورٹ میپنگز TradeOS کو بتاتی ہیں کہ ہر بیرونی کالم کا کیا مطلب ہے۔",
      steps: [
        "ایک انٹیٹی منتخب کریں اور اس کی فائل اپ لوڈ کریں۔ اسی فائل فارمیٹ کے لیے محفوظ میپنگ دوبارہ استعمال کریں۔",
        "مقداریں ماخذ کالم کے نام سے نہیں بلکہ معنی سے میپ کریں۔ ابتدائی اسٹاک اور اکائیوں کا احتیاط سے جائزہ لیں۔",
        "امپورٹ کرنے سے پہلے غلطیوں اور ڈپلیکیٹ ہینڈلنگ کا پیش نظارہ کریں۔ اپ ڈیٹ امپورٹس چھوڑی گئی تعاون شدہ ترتیبات محفوظ رکھتی ہیں۔",
        "غائب فیلڈز اور بلک ایڈٹس کے لیے سیٹ اپ جائزہ استعمال کریں۔ صفر دوبارہ ترتیب سطح اور \"نہیں\" درست جان بوجھ ترتیبات ہیں۔",
        "اسٹاک ہسٹری حرکات ریکارڈ کرتی ہے؛ غائب تاریخی مقداریں کبھی ایجاد نہ کریں۔ کم اسٹاک اور میعاد کے الرٹس کا جائزہ لیں۔",
      ],
    },
    {
      title: "گاہک، ادھار اور ادائیگیاں",
      description: "گاہک کے ریکارڈز میں رابطے کی تفصیلات، ادھار کے قواعد اور اختیاری سیلزمین/علاقہ تفویضات ہوتی ہیں۔ ادائیگی کے ریکارڈز موصول شدہ رقم ٹریک کرتے ہیں۔",
      steps: [
        "گاہک شامل کریں یا امپورٹ کریں اور ان کے ادھار کے قواعد کی تصدیق کریں۔",
        "مجاز سیلزمین اپنی تنظیم کے فعال گاہکوں کے لیے فروخت جمع کر سکتے ہیں، بشمول غیر تفویض کردہ گاہک۔",
        "موصول شدہ رقم، طریقہ، تاریخ اور حوالہ درج کریں، پھر انوائس تخصیصات کا جائزہ لیں۔",
        "تاریخی ادائیگیاں امپورٹ کرتے وقت، ڈپلیکیٹس سے بچنے کے لیے منفرد حوالے استعمال کریں۔ امپورٹس خودکار طور پر ابتدائی بیلنس دوبارہ نہیں بناتی یا پرانی ادائیگیاں تخصیص نہیں کرتی۔",
        "مزید ادھار فروخت قبول کرنے سے پہلے واجب الادا انوائسیں اور زائد المیعاد ادھار چیک کریں۔",
      ],
    },
    {
      title: "ڈیش بورڈ، رپورٹس اور اخراجات",
      description: "درج شدہ فروخت، اسٹاک، واجب الادا رقوم اور حالیہ سرگرمی کا جائزہ لینے کے لیے ڈیش بورڈ استعمال کریں۔ کاروباری اخراجات درج کریں تاکہ رپورٹس میں وہ شامل ہوں۔",
      steps: [
        "ٹوٹلز کا موازنہ کرنے سے پہلے تاریخ کی حد چیک کریں۔",
        "خلاصے کے پیچھے تفصیلات کے لیے فروخت، خریداری، اسٹاک اور گاہک کی رپورٹس کھولیں۔",
        "منتخب تاریخوں کے لیے کاروباری ریکارڈز ایکسپورٹ کریں استعمال کریں، پھر پرنٹ / PDF کے طور پر محفوظ کریں۔",
        "ایکسپورٹ میں تعاون شدہ ٹرانزیکشنز اور ریکارڈ شدہ سرگرمی شامل ہے؛ یہ ڈیٹابیس کا مکمل بیک اپ نہیں ہے۔",
        "کاروباری فیصلوں کے لیے استعمال کرنے سے پہلے منافع اور دیگر ٹوٹلز کا ماخذ انوائسوں اور لاگتوں سے موازنہ کریں۔",
      ],
    },
    {
      title: "ملازمین، اجازتیں اور فیلڈ ورک",
      description: "مالکان عملے کو مدعو کرتے ہیں، مجاز ٹولز منتخب کرتے ہیں اور تفویضات کا انتظام کرتے ہیں۔ ملازمین انہیں دی گئی اسکرینیں استعمال کرتے ہیں اور اپنی کارکردگی کا جائزہ لیتے ہیں۔",
      steps: [
        "امپورٹ شدہ ملازم کا ریکارڈ خودکار طور پر لاگ اِن نہیں بناتا۔ عملے کا اکاؤنٹ الگ سے مدعو/فراہم کریں۔",
        "صرف وہ سیکشنز اور سیلز ذیلی اختیارات دیں جن کی ملازم کو ضرورت ہے۔",
        "علاقے/روٹس مقرر کریں، پھر جہاں فعال ہیں وہاں وزٹس، حاضری، ڈیوٹی اور کلیکشنز کا جائزہ لیں۔",
        "لوکیشن فیچرز کو ڈیوائس اجازتوں اور کنیکٹیویٹی کی ضرورت ہے۔ موبائل کا بیک گراؤنڈ رویہ بھی ڈیوائس پر منحصر ہے۔",
        "ملازمین منظوری کے لیے فروخت جمع کرتے ہیں؛ مالکان منظور یا مسترد کرتے ہیں۔ مدد اضافی رسائی نہیں دیتی۔",
      ],
    },
    {
      title: "پرنٹ اور ریفرنس ٹیمپلیٹس",
      description: "انوائس/لوڈ فارم لے آؤٹس محفوظ کریں اور مستقبل کی پرنٹنگ کے لیے انہیں دوبارہ استعمال کریں۔",
      steps: [
        "ٹیمپلیٹ کسٹمائزر کھولیں اور ایک ریفرنس PDF، تصویر یا اسپریڈشیٹ اپ لوڈ کریں۔",
        "اسپریڈشیٹس تعاون شدہ ٹیبل کالمز براہ راست پہچانتی ہیں۔ تصاویر/PDFs کو کنفیگر شدہ ریکگنیشن پرووائڈر کی ضرورت ہے۔",
        "پہچانے گئے کالمز، فونٹس، چوڑائیوں اور پیش نظارے کا جائزہ لیں؛ من مانی ریفرنس لے آؤٹس ہمیشہ بالکل نقل نہیں کیے جا سکتے۔",
        "تجویز کردہ ترتیبات کی تصدیق کریں، اصلاحات کریں اور ٹیمپلیٹ واضح طور پر محفوظ کریں۔",
      ],
    },
    {
      title: "AI، ٹاسکس اور کاروباری ترتیبات",
      description: "AI فیچرز استفسارات اور مسودوں میں مدد کر سکتے ہیں جب ان کا پرووائڈر کنفیگر ہو۔ ترتیبات کاروباری تفصیلات اور دستیاب ورک فلوز کو کنٹرول کرتی ہیں۔",
      steps: [
        "اپنے اکاؤنٹ کو دستیاب ریکارڈز استعمال کرتے ہوئے سوالات پوچھیں؛ نتائج کا ماخذ ٹرانزیکشنز سے موازنہ کریں۔",
        "کسی بھی کاروباری ریکارڈ کے تبدیل ہونے سے پہلے تجویز کردہ اقدامات کا جائزہ لیں۔ پرووائڈر کی بندش یا غائب کیز AI فیچرز کو کام کرنے سے روک سکتی ہیں۔",
        "کام کی پیروی کے لیے ٹاسکس اور نوٹیفیکیشنز استعمال کریں۔",
        "مالکان برانڈنگ، عملے کی اجازتیں، سیکیورٹی اور دیگر ترتیبات کا انتظام کرتے ہیں۔ ڈپلائمنٹ/تیاری چیک لسٹیں خودکار طور پر موبائل ایپ انسٹال نہیں کرتی یا بیرونی سروسز کنفیگر نہیں کرتی۔",
      ],
    },
  ],
};

export function localizedGuideTopics(language: Language): GuideTopic[] {
  // English is the source of truth in guide.ts; keep the import to avoid duplication.
  if (language === 'en') throw new Error('Use guideTopics for English');
  return localized[language];
}
