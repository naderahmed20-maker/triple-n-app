import type {
  TranslationKey,
} from './en';

const it: Record<
  TranslationKey,
  string
> = {
  // Common
  'common.cancel': 'Annulla',
  'common.save': 'Salva',
  'common.delete': 'Elimina',
  'common.edit': 'Modifica',
  'common.done': 'Fatto',
  'common.close': 'Chiudi',
  'common.back': 'Indietro',
  'common.retry': 'Riprova',
  'common.loading': 'Caricamento...',
  'common.error': 'Errore',
  'common.success': 'Operazione riuscita',
  'common.user': 'User',
  'common.yes': 'Sì',
  'common.no': 'No',
  'common.search': 'Cerca...',
  'common.share': 'Condividi',
  'common.download': 'Scarica',
  'common.favorite': 'Preferito',
  'common.favorites': 'Preferiti',
  'common.all': 'Tutti',
  'common.none': 'Nessuno',
  'common.view': 'Visualizza',
  'common.saved': 'Salvato',
  'common.failed': 'Non riuscito',
  'common.queued': 'In coda',
  'common.processing': 'Elaborazione...',
  'common.items': 'Capi',
  'common.outfits': 'Outfit',

  // Navigation
  'nav.home': 'Home',
  'nav.wardrobe': 'Guardaroba',
  'nav.outfits': 'Outfit',
  'nav.saved': 'Salvati',
  'nav.profile': 'Profilo',

  // Authentication
  'auth.signIn': 'Accedi',
  'auth.signUp': 'Crea account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.logout': 'Esci',
  'auth.loginRequired': 'Accesso richiesto',
  'auth.loginFirst':
    'Effettua prima l’accesso.',
  'auth.writeCredentials':
    'Inserisci email e password.',
  'auth.loginFailed':
    'Accesso non riuscito',
  'auth.signupFailed':
    'Registrazione non riuscita',
  'auth.accountCreated':
    'Account creato. Ora effettua l’accesso.',
  'auth.stylePoweredByAI':
    'Il tuo stile, potenziato dall’AI',
    'auth.aiFashionAssistant': 'ASSISTENTE DI MODA AI',

  // Home
  'home.title': 'Home',
  'home.greetingMorning':
    'Buongiorno',
  'home.greetingAfternoon':
    'Buon pomeriggio',
  'home.greetingEvening':
    'Buonasera',
  'home.dressAmazing':
    'Vestiamoci alla grande oggi.',
  'home.wardrobeOverview':
    'Panoramica guardaroba',
  'home.items': 'Capi',
  'home.outfits': 'Outfit',
  'home.favorites': 'Preferiti',
  'home.surprise': 'Sorpresa',
  'home.occasion': 'Occasione',
  'home.weather': 'Meteo',
  'home.smart': 'Smart',
  'home.stats': 'Statistiche',
  'home.outfitOfDay':
    'Outfit del giorno',
  'home.generateFirst':
    'Genera il tuo primo outfit',
  'home.currentWeather':
    'Meteo attuale',
  'home.summerMode':
    'Modalità Estate',
  'home.seasonMode':
    'Modalità {{season}}',

  // Weather and seasons
  'weather.hot': 'Caldo',
  'weather.mild': 'Mite',
  'weather.rainy': 'Pioggia',
  'weather.cold': 'Freddo',
  'season.spring': 'Primavera',
  'season.summer': 'Estate',
  'season.autumn': 'Autunno',
  'season.fall': 'Autunno',
  'season.winter': 'Inverno',

  // Wardrobe
  'wardrobe.title': 'Guardaroba',
  'wardrobe.itemsCount':
    '{{count}} capi',
  'wardrobe.men': 'Uomo',
  'wardrobe.women': 'Donna',
  'wardrobe.scanItem': 'Scansiona articolo',
  'wardrobe.noItems':
    'Il guardaroba è ancora vuoto',
  'wardrobe.selectDelete':
    'Seleziona da eliminare',
  'wardrobe.cancelDelete':
    'Annulla eliminazione',
  'wardrobe.deleteItems':
    'Elimina {{count}} capi',
  'wardrobe.deleteFailed':
    'Eliminazione non riuscita',
  'wardrobe.deleteFailedMessage':
    'Impossibile eliminare i capi.',
  'wardrobe.favoriteFailed':
    'Impossibile aggiornare il preferito.',
  'wardrobe.loadFailed':
    'Impossibile caricare il guardaroba.',
  'wardrobe.preparingCount':
    '{{count}} capo/i in preparazione',
  'wardrobe.itemPreparing':
    'Il capo è in preparazione',
  'wardrobe.itemPreparingMessage':
    'Puoi lasciarlo in elaborazione oppure annullare.',
  'wardrobe.cancelProcessing':
    'Annulla elaborazione',
  'wardrobe.keepProcessing':
    'Continua elaborazione',
  'wardrobe.cancelFailed':
    'Annullamento non riuscito',
  'wardrobe.cancelFailedMessage':
    'Impossibile annullare questo capo.',
  'wardrobe.processingCancelled':
    'Elaborazione annullata',
  'wardrobe.cleaningFailed':
    'Pulizia non riuscita',
  'wardrobe.cleaningFailedMessage':
    'Triple N non è riuscito a preparare questo capo.',
  'wardrobe.retryFailed':
    'Nuovo tentativo non riuscito',
  'wardrobe.retryFailedMessage':
    'Impossibile riprovare questo capo.',
  'wardrobe.cleaning':
    'Pulizia...',
  'wardrobe.tripleNAI':
    'Triple N AI',
  'wardrobe.tapDetails':
    'Tocca per i dettagli',
  'wardrobe.waiting':
    'IN ATTESA',
  'wardrobe.ai': 'AI',
  'wardrobe.failed':
    'NON RIUSCITO',
  'wardrobe.itemLimit':
    'Massimo 100 capi nel guardaroba',
    'wardrobe.cancelledByUser':
  'Annullato dall’utente',

  // Add item
  'addItem.title':
    'Aggiungi nuovo capo',
  'addItem.photoTitle':
    'Aggiungi foto del capo',
  'addItem.photoInstructions':
    'Posiziona un solo capo su uno sfondo semplice e mantienilo interamente dentro l’inquadratura.',
  'addItem.scanItem': 'Scansiona articolo',
  'addItem.photoHint':
    'Un solo capo • sfondo semplice • capo interamente visibile',
  'addItem.cameraPermission':
    'Autorizzazione fotocamera',
  'addItem.cameraPermissionMessage':
    'Consenti l’accesso alla fotocamera per fotografare il tuo capo.',
  'addItem.preparingPhoto':
    'Preparazione foto...',
  'addItem.photoError':
    'Errore immagine',
  'addItem.photoErrorMessage':
    'Impossibile preparare questa immagine.',
  'addItem.bestPhotoTitle':
    'Foto migliore per una pulizia più veloce',
  'addItem.bestPhotoText':
    'Mantieni il capo centrato, evita le ombre e lascia un piccolo spazio intorno a ogni bordo.',
  'addItem.itemName':
    'Nome del capo',
  'addItem.itemNamePlaceholder':
    'Esempio: camicia verde oliva',
  'addItem.colorAnalysis':
    'Analisi del colore',
  'addItem.mainColor':
    'Colore principale',
  'addItem.chooseShade':
    'Scegli tonalità',
  'addItem.chooseCategory':
    'Scegli categoria',
  'addItem.itemType':
    'Tipo di capo',
  'addItem.accessoryType':
    'Tipo di accessorio',
  'addItem.itemTypeRequired':
    'Tipo di capo richiesto',
  'addItem.chooseItemType':
    'Scegli prima il tipo di capo.',
  'addItem.chooseAccessoryType':
    'Scegli prima il tipo di accessorio.',
  'addItem.bestMatches':
    'Migliori abbinamenti',
  'addItem.noMatches':
    'Nessun capo abbinabile',
  'addItem.saveWardrobe':
    'Salva nel guardaroba',
  'addItem.chooseImageFirst':
    'Scegli prima un’immagine.',
  'addItem.couldNotAdd':
    'Impossibile aggiungere il capo',
  'addItem.queueMessage':
    'Caricamento del capo e aggiunta alla coda di elaborazione Triple N.',
  'addItem.preparingItem':
    'Preparazione del capo...',
  'addItem.runpodHint':
    'La foto ottimizzata aiuta RunPod a terminare più velocemente.',

  // Edit item
  'editItem.title':
    'Modifica capo',
  'editItem.notFound':
    'Capo non trovato',
  'editItem.loadFailed':
    'Impossibile caricare il capo.',
  'editItem.itemNamePlaceholder':
    'Esempio: maglietta nera',
  'editItem.chooseCategory':
    'Scegli categoria',
  'editItem.chooseColor':
    'Scegli colore',
  'editItem.saveChanges':
    'Salva modifiche',

  // Categories
  'category.tops': 'Maglie',
  'category.pants': 'Pantaloni',
  'category.shorts':
    'Pantaloncini',
  'category.shoes': 'Scarpe',
  'category.jackets': 'Giacche',
  'category.dresses': 'Vestiti',
  'category.skirts': 'Gonne',
  'category.accessories':
    'Accessori',
  'category.bags': 'Borse',
  'category.heels':
    'Scarpe con tacco',

  // General outfits
  'outfit.builder':
    'Creatore di outfit',
  'outfit.generate': 'Genera',
  'outfit.regenerate':
    'Genera di nuovo',
  'outfit.generateFirst':
    'Genera prima un outfit.',
  'outfit.notEnoughClothes':
    'Capi insufficienti',
  'outfit.needPieces':
    'Servono almeno una maglia, un capo inferiore e un paio di scarpe.',
  'outfit.colorMatch':
    'Compatibilità colori',
  'outfit.styleMatch':
    'Compatibilità stile',
  'outfit.whyWorks':
    'Perché funziona',
  'outfit.explanationAfterGeneration':
    'Triple N spiegherà l’outfit dopo la generazione.',
  'outfit.contextConsidered':
    'Verranno considerati meteo, stagione e colori.',
  'outfit.save':
    'Salva outfit',
  'outfit.saved':
    'Outfit salvato correttamente.',
  'outfit.saveFailed':
    'Salvataggio non riuscito',
  'outfit.saveFailedMessage':
    'Qualcosa è andato storto.',
  'outfit.noOutfit':
    'Nessun outfit',
  'outfit.completeFirst':
    'Genera prima un outfit completo.',
  'outfit.match':
    'Compatibilità',
  'outfit.colors': 'Colori',
  'outfit.style': 'Stile',
  'outfit.weather': 'Meteo',
  'outfit.season': 'Stagione',
  'outfit.occasion': 'Occasione',
  'outfit.next':
    'Outfit successivo',

  // Surprise
  'surprise.title':
    'Sorprendimi',
  'surprise.subtitle':
    'Una sorpresa intelligente tra i tuoi outfit migliori.',
  'surprise.styleTitle':
    'Sorpresa {{style}}',
  'surprise.description':
    'Triple N sceglie casualmente tra gli outfit con gli abbinamenti migliori.',
  'surprise.button':
    'Sorprendimi',
  'surprise.another':
    'Un altro',
  'surprise.readyTitle':
    'Pronto per una sorpresa?',
  'surprise.readyText':
    'Premi Sorprendimi per generare un outfit intelligente.',
  'surprise.randomCount':
    'Scelta casuale tra {{count}} outfit adatti',
  'surprise.noStrong':
    'Nessun outfit {{style}} abbastanza valido',
  'surprise.noWeak':
    'Triple N non mostrerà combinazioni deboli o inadatte.',
  'surprise.loading':
    'Triple N sta analizzando il tuo guardaroba...',

  // Occasion outfit
  'occasion.title':
    'Outfit per occasione',
  'occasion.subtitle':
    'Scegli l’atmosfera. Triple N crea il look.',
  'occasion.stylePreference':
    'Preferenza di stile: {{style}}',
  'occasion.noStrong':
    'Nessun outfit {{occasion}} abbastanza valido',
  'occasion.addMore':
    'Aggiungi più capi adatti per {{occasion}}.',
  'occasion.noWeak':
    'Triple N non mostrerà outfit deboli o inadatti.',
  'occasion.outfitCount':
    'Outfit {{current}} di {{total}}',
  'occasion.loading':
    'Triple N sta creando il tuo outfit...',

  // Weather outfit
  'weatherOutfit.title':
    'Outfit meteo',
  'weatherOutfit.subtitle':
    'Triple N crea l’outfit in base al meteo di oggi.',
  'weatherOutfit.recommendation':
    'Consiglio per clima {{weather}}',
  'weatherOutfit.generate':
    'Genera outfit meteo',
  'weatherOutfit.loading':
    'Triple N sta controllando il meteo...',
  'weatherOutfit.weatherLoading':
    'Caricamento meteo',
  'weatherOutfit.weatherLoadingMessage':
    'Attendi mentre viene caricato il meteo.',
  'weatherOutfit.unavailable':
    'Meteo non disponibile',
  'weatherOutfit.hotDescription':
    'È stato rilevato un clima caldo. Triple N evita giacche e scarpe pesanti.',
  'weatherOutfit.coldDescription':
    'È stato rilevato un clima freddo. Triple N richiede uno strato esterno adatto.',
  'weatherOutfit.rainyDescription':
    'È stato rilevato un clima piovoso. Triple N evita i sandali e richiede una giacca.',
  'weatherOutfit.mildDescription':
    'È stato rilevato un clima mite. Triple N bilancia comfort e stile.',
  'weatherOutfit.noStrong':
    'Nessun outfit adatto al clima {{weather}}',
  'weatherOutfit.addMore':
    'Aggiungi più capi adatti al clima {{weather}}.',
  'weatherOutfit.noUnsuitable':
    'Triple N non mostrerà outfit inadatti.',
    // Weather Context - Seasons
'weatherContext.season.winter':
  'Inverno',

'weatherContext.season.spring':
  'Primavera',

'weatherContext.season.summer':
  'Estate',

'weatherContext.season.autumn':
  'Autunno',

// Weather Context - Conditions
'weatherContext.weather.sunny':
  'Soleggiato',

'weatherContext.weather.cold':
  'Freddo',

'weatherContext.weather.fresh':
  'Fresco',

'weatherContext.weather.cloudy':
  'Nuvoloso',

'weatherContext.weather.hot':
  'Caldo',

'weatherContext.weather.mild':
  'Mite',

'weatherContext.weather.rainy':
  'Piovoso',

'weatherContext.weather.unknown':
  'Sconosciuto',


  // Smart suggestion
  'smart.title':
    'Suggerimento Smart',
  'smart.subtitle':
    'Il tuo assistente di moda AI',
  'smart.recommendation':
    'Consiglio {{style}}',
  'smart.summerMode':
    'La Modalità Estate evita gli strati pesanti.',
  'smart.noStrong':
    'Nessun outfit {{style}} abbastanza valido',
  'smart.addMore':
    'Aggiungi più capi adatti allo stile {{style}}.',
  'smart.noWeak':
    'Triple N non mostrerà combinazioni deboli o inadatte.',
  'smart.analyzeAgain':
    'Analizza di nuovo',
  'smart.oneSuitable':
    'Hai 1 outfit {{style}} adatto',
  'smart.loading':
    'Triple N sta cercando il tuo outfit migliore...',

  // Saved outfits
  'savedOutfits.title':
    'Outfit salvati',
  'savedOutfits.count':
    '{{count}} outfit',
  'savedOutfits.empty':
    'Nessun outfit salvato',
  'savedOutfits.loadFailed':
    'Impossibile caricare gli outfit salvati.',
  'savedOutfits.favoriteFailed':
    'Impossibile aggiornare il preferito.',
  'savedOutfits.deleteFailed':
    'Impossibile eliminare l’outfit.',
  'savedOutfits.shareFailed':
    'Impossibile condividere questo outfit.',
    // Saved Outfits Filters
'savedOutfits.filter.smart':
  'Smart',

'savedOutfits.filter.casual':
  'Casual',

'savedOutfits.filter.work':
  'Lavoro',

'savedOutfits.filter.date':
  'Appuntamento',

'savedOutfits.filter.party':
  'Festa',

'savedOutfits.filter.sport':
  'Sport',

// Saved Outfits Occasion
'savedOutfits.occasion.weather':
  'Meteo',

// Saved Outfits Share
'savedOutfits.share.top':
  'Maglia',

'savedOutfits.share.bottom':
  'Pantaloni',

'savedOutfits.share.shoes':
  'Scarpe',

'savedOutfits.share.noJacket':
  'Nessuna giacca',

'savedOutfits.share.noAccessory':
  'Nessun accessorio',

'savedOutfits.share.occasionMissing':
  'Occasione non salvata',

'savedOutfits.share.weatherMissing':
  'Meteo non salvato',

'savedOutfits.share.seasonMissing':
  'Stagione non salvata',

'savedOutfits.share.signature':
  'Creato con Triple N ✨',

'savedOutfits.shareErrorTitle':
  'Impossibile condividere l’outfit',

  // Outfit details
  'details.title':
    'Outfit salvato',
  'details.notFound':
    'Outfit non trovato',
  'details.loading':
    'Caricamento outfit...',
  'details.match':
    'Compatibilità Triple N',
  'details.aiInsight':
    'Analisi AI',
  'details.deleteTitle':
    'Elimina outfit',
  'details.deleteQuestion':
    'Vuoi davvero eliminare questo outfit?',
  'details.tryOnTitle':
    'Il Virtual Try-On sta arrivando ✨',
  'details.tryOnMessage':
    'Stiamo dedicando a questa funzione tutta l’attenzione necessaria per offrire un’esperienza realistica e curata. Sarà disponibile in un prossimo aggiornamento di Triple N.',
  'details.gotIt':
    'Ho capito',
  'details.shareUnavailable':
    'Condivisione non disponibile',
  'details.shareUnavailableMessage':
    'La condivisione non è disponibile su questo dispositivo.',
  'details.previewNotReady':
    'L’anteprima dell’outfit non è pronta',
  'details.couldNotShare':
    'Impossibile condividere',
  'details.tryAgainMoment':
    'Riprova tra qualche istante.',

  // Preview
  'preview.title':
    'Anteprima outfit',
  'preview.noOutfit':
    'Nessun outfit trovato',
  'preview.unavailable':
    'Anteprima non disponibile',
  'preview.loadFailed':
    'Impossibile caricare questo outfit.',
  'preview.permissionMessage':
    'Consenti l’accesso alle foto per salvare il tuo outfit.',
  'preview.savedTitle':
    'Outfit salvato ✨',
  'preview.savedMessage':
    'L’anteprima dell’outfit è stata salvata nelle foto.',
  'preview.couldNotSave':
    'Impossibile salvare',
    'preview.notReady':
    'L’anteprima dell’outfit non è pronta.',

  // Profile
  'profile.title': 'Profilo',
  'profile.account': 'Account',
  'profile.settings':
    'Impostazioni',
  'profile.help':
    'Centro assistenza',
  'profile.about':
    'Informazioni su Triple N',
  'profile.summary':
    '{{items}} capi • {{outfits}} outfit',
  'profile.loadFailed':
    'Impossibile caricare il profilo.',
  'profile.logoutFailed':
    'Disconnessione non riuscita',
  'profile.logoutFailedMessage':
    'Impossibile effettuare la disconnessione.',
    'profile.noEmail':
    'Nessuna email',

  // Settings
  'settings.title':
    'Impostazioni',
  'settings.subtitle':
    'Personalizza la tua esperienza Triple N',
  'settings.notifications':
    'Notifiche',
  'settings.notificationsSubtitle':
    'Promemoria giornaliero alle 8:00',
  'settings.temperature':
    'Temperatura',
  'settings.temperatureSubtitle':
    'Unità meteo per gli outfit',
  'settings.defaultOccasion':
    'Occasione predefinita',
  'settings.occasionSubtitle':
    'Il tuo stile abituale',
  'settings.stylePreference':
    'Preferenza di stile',
  'settings.styleSubtitle':
    'Il tuo stile di moda preferito',
  'settings.language':
    'Lingua',
  'settings.languageSubtitle':
    'Lingua dell’app',
  'settings.save':
    'Salva impostazioni',
  'settings.savedTitle':
    'Salvato',
  'settings.saved':
    'Impostazioni aggiornate correttamente.',
  'settings.loadFailed':
    'Impossibile caricare le impostazioni.',
  'settings.saveFailed':
    'Impossibile salvare le impostazioni.',
  'settings.reset':
    'Ripristina dati app',
  'settings.resetMessage':
    'Questa operazione eliminerà definitivamente il guardaroba, le immagini elaborate, gli outfit salvati e le impostazioni locali. Non può essere annullata.',
  'settings.deleteEverything':
    'Elimina tutto',
  'settings.resetFailed':
    'Ripristino non riuscito',
  'settings.resetFailedMessage':
    'Impossibile ripristinare i dati dell’app.',
  'settings.occasionDialog':
    'Scegli il tuo stile predefinito',
  'settings.styleDialog':
    'Scegli il tuo stile di moda preferito',
  'settings.languageDialog':
    'Scegli la lingua dell’app',
    'settings.valueCasual':
    'Casual',
  'settings.valueWork':
    'Lavoro',
  'settings.valueDate':
    'Appuntamento',
  'settings.valueParty':
    'Festa',
  'settings.valueSport':
    'Sportivo',
  'settings.valueMinimal':
    'Minimal',
  'settings.valueClassic':
    'Classico',
  'settings.valueStreetwear':
    'Streetwear',
  'settings.valueLuxury':
    'Lusso',
  'settings.valueEnglish':
    'Inglese',
  'settings.valueItalian':
    'Italiano',

  // Permissions and notifications
  'permission.required':
    'Autorizzazione necessaria',
  'permission.photos':
    'Consenti l’accesso alle foto per salvare il tuo outfit.',
  'permission.notifications':
    'Il permesso per le notifiche non è stato concesso. Attivalo dalle impostazioni del telefono.',
  'notification.outfitTitle':
    'Promemoria outfit Triple N 👕',
  'notification.outfitBody':
    'Il tuo outfit del giorno è pronto.',

    // Weather Outfit
  'weatherOutfit.loadFailed':
    'Impossibile caricare l’outfit meteo.',

  'weatherOutfit.noOutfitToSave':
    'Non c’è nessun outfit meteo adatto da salvare.',

  'weatherOutfit.saved':
    'Outfit meteo salvato correttamente.',

  'weatherOutfit.stylePreference':
    'Preferenza di stile: {{style}}',

  'weatherOutfit.outfitCount':
    'Outfit {{current}} di {{total}}',

    // Smart Suggestion
  'smartSuggestion.loadFailed':
    'Impossibile caricare il suggerimento smart.',
  'smartSuggestion.refreshFailed':
    'Impossibile aggiornare il suggerimento smart.',
  'smartSuggestion.noOutfitToSave':
    'Non c’è nessun outfit adatto da salvare.',
  'smartSuggestion.saved':
    'Outfit smart salvato correttamente.',
  'smartSuggestion.loading':
    'Triple N sta cercando il tuo outfit migliore...',
  'smartSuggestion.title':
    'Suggerimento Smart',
  'smartSuggestion.subtitle':
    'Il tuo assistente di moda AI',
  'smartSuggestion.recommendation':
    'Consiglio {{style}}',
  'smartSuggestion.analyzed':
    'Triple N ha analizzato il tuo guardaroba.',
  'smartSuggestion.summerMode':
    '☀️ La modalità Estate evita gli strati pesanti.',
  'smartSuggestion.noStrong':
    'Nessun outfit {{style}} abbastanza valido',
  'smartSuggestion.addMore':
    'Aggiungi più capi adatti allo stile {{style}}.',
  'smartSuggestion.noWeak':
    'Triple N non mostrerà combinazioni deboli o inadatte.',
  'smartSuggestion.analyzeAgain':
    'Analizza di nuovo',
  'smartSuggestion.oneSuitable':
    'Hai 1 outfit {{style}} adatto',
  'smartSuggestion.outfitCount':
    'Outfit {{current}} di {{total}}',

    // Statistics
  'stats.loadFailed':
    'Impossibile caricare le statistiche.',
  'stats.title':
    'Statistiche',
  'stats.subtitle':
    'Le prestazioni del tuo guardaroba',
  'stats.welcome':
    'Bentornato 👋',
  'stats.readyItems':
    'Hai {{count}} capi pronti per creare il tuo prossimo outfit.',
  'stats.totalWardrobe':
    'Totale guardaroba',
  'stats.savedLooks':
    'Look salvati',
  'stats.styleInsight':
    'Analisi dello stile',
  'stats.insightGrowing':
    'Il tuo guardaroba sta ancora crescendo. Aggiungi altri capi per migliorare i consigli dell’AI.',
  'stats.insightGood':
    'Bel guardaroba! Triple N può creare combinazioni più varie.',
  'stats.insightExcellent':
    'Guardaroba eccellente! Il tuo assistente AI ha molte opzioni per creare outfit premium.',
  'stats.bestMatch':
    'Migliore compatibilità',
  'stats.bestColor':
    'Migliori colori',
  'stats.wardrobeGoal':
    'Obiettivo guardaroba',
  'stats.goalComplete':
    'Eccellente! Il tuo guardaroba è completo.',
  'stats.goalRemaining':
    'Aggiungi altri {{count}} capi per raggiungere il tuo primo obiettivo.',
  'stats.outfitHistory':
    'Cronologia outfit',
  'stats.lastSaved':
    'Ultimo outfit salvato: {{date}}',

    'details.loadFailed':
    'Impossibile caricare questo outfit.',
  'details.favoriteFailed':
    'Impossibile aggiornare il preferito.',
  'details.deleteFailed':
    'Impossibile eliminare l’outfit.',
  'details.defaultInsightOne':
    'Ottimo equilibrio tra i capi selezionati.',
  'details.defaultInsightTwo':
    'I colori e le categorie creano un outfit completo.',
  'details.defaultInsightThree':
    'Questo outfit è adatto al contesto salvato.',


    'account.title': 'Account',
  'account.subtitle': 'Gestisci le tue informazioni personali',
  'account.loading': 'Caricamento del tuo account...',
  'account.yourName': 'Il tuo nome',
  'account.member': 'Membro Triple N',
  'account.firstName': 'Nome',
  'account.firstNamePlaceholder': 'Ahmed',
  'account.email': 'Email',
  'account.gender': 'Genere',
  'account.male': 'Uomo',
  'account.female': 'Donna',
  'account.birthDate': 'Data di nascita',
  'account.birthDatePlaceholder': '14/07/2003',
  'account.saveChanges': 'Salva modifiche',
  'account.saving': 'Salvataggio...',
  'account.missingTitle': 'Informazioni mancanti',
  'account.firstNameRequired': 'Inserisci il tuo nome.',
  'account.genderRequired': 'Scegli il tuo genere.',
  'account.birthDateRequired': 'Inserisci la tua data di nascita.',
  'account.invalidBirthDateTitle': 'Data di nascita non valida',
  'account.invalidBirthDateMessage': 'Inserisci la data nel formato AAAA-MM-GG oppure GG/MM/AAAA.',
  'account.savedTitle': 'Salvato',
  'account.savedMessage': 'Il tuo profilo è stato aggiornato.',
  'account.loadFailed': 'Impossibile caricare il tuo account.',
  'account.saveFailed': 'Si è verificato un problema durante il salvataggio del tuo account.',

  'helpCenter.title': 'Help Center',
  'helpCenter.subtitle': 'Everything you need to use Triple N',

  'helpCenter.addClothesTitle': 'Add Clothes',
  'helpCenter.addClothesSubtitle': 'Build your digital wardrobe',
  'helpCenter.addClothesMessage': 'Vai su Guardaroba -> Scansiona articolo -> scatta la foto -> aggiungi il capo al guardaroba.',

  'helpCenter.aiTitle': 'AI Outfit Suggestions',
  'helpCenter.aiSubtitle': 'How Triple N builds outfits',
  'helpCenter.aiAlertTitle': 'AI Suggestions',
  'helpCenter.aiMessage': 'Triple N analyzes colors, categories, weather, season and your preferences to build the best outfit.',

  'helpCenter.favoritesTitle': 'Favorites',
  'helpCenter.favoritesSubtitle': 'Save your favorite clothes',
  'helpCenter.favoritesMessage': 'Tap the heart icon to save any clothing item or outfit.',

  'helpCenter.faqTitle': 'Frequently Asked Questions',
  'helpCenter.faqSubtitle': 'Common questions',

  'helpCenter.supportTitle': 'Contact Support',
  'helpCenter.supportEmailSubject': 'Triple N Support',

  'helpCenter.reportBugTitle': 'Report a Bug',
  'helpCenter.reportBugSubtitle': 'Tell us about an issue',
  'helpCenter.bugEmailSubject': 'Triple N Bug Report',

  'helpCenter.privacyTitle': 'Privacy Policy',
  'helpCenter.privacySubtitle': 'How we protect your data',

  'helpCenter.termsTitle': 'Terms of Service',
  'helpCenter.termsSubtitle': 'Read the app terms',

  'helpCenter.linkErrorTitle': 'Could not open link',
  'helpCenter.linkErrorMessage': 'This link cannot be opened on your device right now.',

  // About
'about.tagline':
  'Il tuo assistente di moda personale',

'about.version':
  'Versione 1.0.0 Produzione',

'about.smartStylingTitle':
  'Stile Intelligente',

'about.smartStylingText':
  'Triple N ti aiuta a creare outfit migliori con i vestiti che possiedi già.',

'about.aiAssistantTitle':
  'Assistente AI',

'about.aiAssistantText':
  'L\'app suggerisce outfit in base a categorie, colori, meteo, stagioni e occasioni.',

'about.privacyTitle':
  'Privacy al Primo Posto',

'about.privacyText':
  'Il tuo guardaroba è archiviato in modo sicuro nel cloud e sincronizzato su tutti i tuoi dispositivi.',

'about.missionTitle':
  'La Nostra Missione',

'about.missionText':
  'Rendere la scelta degli outfit ogni giorno più veloce, intelligente e personale.',

'about.visionTitle':
  'La Nostra Visione',

'about.visionText':
  'Diventare l\'assistente di moda con intelligenza artificiale più affidabile al mondo.',

'about.shareApp':
  'Condividi Triple N',

'about.shareMessage': 'Scopri Triple N - Assistente di Moda AI.',

'about.shareError':
  'Impossibile condividere l\'app in questo momento.',

'about.rateApp':
  'Valuta l\'App',

'about.comingSoonTitle':
  'Prossimamente',

'about.ratingComingSoon':
  'La valutazione su App Store e Google Play sarà disponibile dopo il lancio.',

'about.footer':
  'Realizzato con passione per uno stile migliore.',

'about.copyright':
  '©️ 2026 Triple N. Tutti i diritti riservati.',

  // Onboarding
'onboarding.welcome':
  'Welcome 👋',

'onboarding.subtitle':
  'Before we start, tell us a little about you.',

'onboarding.firstName':
  'First Name',

'onboarding.firstNamePlaceholder':
  'Ahmed',

'onboarding.gender':
  'Gender',

'onboarding.male':
  'Male',

'onboarding.female':
  'Female',

'onboarding.birthDate':
  'Date of Birth',

'onboarding.birthDatePlaceholder':
  '2003-07-14',

'onboarding.continue':
  'Continue',

'onboarding.saving':
  'Saving...',

'onboarding.missingTitle':
  'Missing',

'onboarding.enterFirstName':
  'Please enter your first name.',

'onboarding.chooseGender':
  'Please choose your gender.',

'onboarding.enterBirthDate':
  'Please enter your birth date.',

'onboarding.genericError':
  'Something went wrong.',

  // Wardrobe Type
'wardrobeType.title':
  'Scegli il tuo guardaroba',

'wardrobeType.subtitle':
  'Questo determina le categorie e il layout degli outfit.',

'wardrobeType.male':
  'Guardaroba Uomo',

'wardrobeType.female':
  'Guardaroba Donna',

  // Processing Image
'processingImage.wardrobeReady':
  'Il guardaroba è pronto',

'processingImage.processingCompleted':
  'Elaborazione completata',

'processingImage.processingFailed':
  'Elaborazione non riuscita',

'processingImage.processingCancelled':
  'Elaborazione annullata',

'processingImage.uploadingPhotos':
  'Caricamento delle foto...',

'processingImage.preparingClothing':
  'Preparazione dei capi...',

'processingImage.itemsAdded':
  'capi sono stati aggiunti al guardaroba.',

'processingImage.completed':
  'completati',

'processingImage.and':
  'e',

'processingImage.failedLowercase':
  'non riusciti',

'processingImage.photosCouldNotBeProcessed':
  'Non è stato possibile elaborare le foto selezionate.',

'processingImage.uploadCancelled':
  'Questo caricamento è stato annullato.',

'processingImage.removingBackground':
  'Triple N AI sta rimuovendo lo sfondo. Mantieni Triple N aperto fino al termine dell\'elaborazione.',

'processingImage.readStatusError':
  'Impossibile leggere lo stato del caricamento.',

'processingImage.genericError':
  'Si è verificato un errore.',

'processingImage.removeUploadTitle':
  'Rimuovere questo caricamento?',

'processingImage.removeUploadMessage':
  'Questo rimuove solo il collegamento salvato sul telefono. Non elimina i capi già elaborati.',

'processingImage.remove':
  'Rimuovi',

'processingImage.loadingProgress':
  'Caricamento dello stato...',

'processingImage.pleaseWait':
  'Attendi un momento.',

'processingImage.noActiveUpload':
  'Nessun caricamento attivo',

'processingImage.noBatchFound':
  'Non è stato trovato alcun gruppo di immagini da seguire.',

'processingImage.openWardrobe':
  'Apri il guardaroba',

'processingImage.progress':
  'Avanzamento',

'processingImage.photosFinished':
  'foto completate',

'processingImage.ready':
  'Pronte',

'processingImage.remaining':
  'Rimanenti',

'processingImage.failed':
  'Non riuscite',

'processingImage.refreshing':
  'Aggiornamento...',

'processingImage.canLeaveScreen':
  'Mantieni Triple N aperto',

'processingImage.workerContinues':
  'Puoi tornare al guardaroba, ma mantieni Triple N in primo piano fino al termine dell\'elaborazione.',

'processingImage.continueInBackground':
  'Torna al guardaroba',

  // Outfit Canvas
'outfitCanvas.generateOutfit':
  'Crea un outfit',

  // Color Score
'colorScore.perfect':
  'Colori Perfetti',

'colorScore.good':
  'Buoni Colori',

'colorScore.average':
  'Colori Medi',

'colorScore.poor':
  'Colori Scarsi',

  // Match Score
'matchScore.excellent':
  'Abbinamento Perfetto',

'matchScore.good':
  'Buon Abbinamento',

'matchScore.average':
  'Abbinamento Medio',

'matchScore.poor':
  'Abbinamento Scarso',

  // Modal
'modal.title':
  'Questa è una finestra modale',

'modal.goHome':
  'Vai alla schermata principale',

  // Clothing Categories
'clothing.category.all':
  'Tutti',

'clothing.category.tops':
  'Parte superiore',

'clothing.category.pants':
  'Pantaloni',

'clothing.category.shorts':
  'Pantaloncini',

'clothing.category.shoes':
  'Scarpe',

'clothing.category.jackets':
  'Giacche',

'clothing.category.accessories':
  'Accessori',

'clothing.category.dresses':
  'Vestiti',

'clothing.category.skirts':
  'Gonne',

'clothing.category.heels':
  'Scarpe con tacco',

'clothing.category.bags':
  'Borse',

// Top Types
'clothing.topType.tShirt':
  'T-shirt',

'clothing.topType.shirt':
  'Camicia',

'clothing.topType.polo':
  'Polo',

'clothing.topType.hoodie':
  'Felpa con cappuccio',

'clothing.topType.sweater':
  'Maglione',

// Pants Types
'clothing.pantsType.jeans':
  'Jeans',

'clothing.pantsType.cargo':
  'Pantaloni cargo',

'clothing.pantsType.formal':
  'Pantaloni eleganti',

'clothing.pantsType.joggers':
  'Pantaloni sportivi',

// Shoes Types
'clothing.shoesType.sneakers':
  'Sneakers',

'clothing.shoesType.boots':
  'Stivali',

'clothing.shoesType.loafers':
  'Mocassini',

'clothing.shoesType.sandals':
  'Sandali',

// Jacket Types
'clothing.jacketType.jacket':
  'Giacca',

'clothing.jacketType.coat':
  'Cappotto',

// Accessory Types
'clothing.accessoryType.watch':
  'Orologio',

'clothing.accessoryType.glasses':
  'Occhiali',

'clothing.accessoryType.cap':
  'Cappellino',

'clothing.accessoryType.bag':
  'Borsa',

'clothing.accessoryType.other':
  'Altro',

  'clothing.accessoryType.backpack': 'Zaino',
'clothing.accessoryType.handbag': 'Borsa',

  // Colors

'color.Black': 'Nero',

'color.White': 'Bianco',

'color.Gray': 'Grigio',

'color.Blue': 'Blu',

'color.Navy': 'Blu Navy',

'color.Denim': 'Denim',

'color.Beige': 'Beige',

'color.Camel': 'Cammello',

'color.Cream': 'Crema',

'color.Brown': 'Marrone',

'color.Green': 'Verde',

'color.Olive': 'Oliva',

'color.Red': 'Rosso',

'color.Burgundy': 'Bordeaux',

'color.Pink': 'Rosa',

'color.Yellow': 'Giallo',

'color.Orange': 'Arancione',

'color.Purple': 'Viola',

'color.Khaki': 'Kaki',

'color.Gold': 'Oro',

'color.Silver': 'Argento',

};

export default it;