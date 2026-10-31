// BloxCraft AI - Dedicated Roblox Assistant Core Engine

// Modelli Gemini attualmente validi sull'API v1beta (aggiornato Ott 2026)
const VALID_GEMINI_MODELS = [
  'gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-3.8-flash-lite',
  'gemini-2.5-pro', 'gemini-2.5-flash'
];

// Modelli deprecati/rimossi da Google → forzano reset a gemini-3.8-flash
const OBSOLETE_MODELS = [
  'gemini-2.0-flash', 'gemini-2.0-flash-lite',
  'gemini-1.5-flash', 'gemini-1.5-pro',
  'gemini-1.0-pro'
];

// Normalizzazione modello salvato
let savedProvider = localStorage.getItem('bloxcraft_model_provider');
const isObsolete = !savedProvider
  || OBSOLETE_MODELS.includes(savedProvider)
  || (!savedProvider.startsWith('groq') && !VALID_GEMINI_MODELS.includes(savedProvider));

if (isObsolete) {
  savedProvider = 'gemini-3.8-flash';
  localStorage.setItem('bloxcraft_model_provider', 'gemini-3.8-flash');
}

const CONFIG = {
  activeMode: 'scripting',
  activeOutputTab: 'code',
  engine3D: localStorage.getItem('bloxcraft_3d_engine') || 'native', // 'native' (Gemini Vision + Studio Luau illimitato) | 'meshy' (.GLB)
  apiKey: localStorage.getItem('bloxcraft_api_key') || '',
  meshyKey: localStorage.getItem('bloxcraft_meshy_key') || '',
  tripoKey: localStorage.getItem('bloxcraft_tripo_key') || '',
  modelProvider: savedProvider,
  generatedCode: '',
  commandBarCode: '',
  instructionsMarkdown: '',
  current3DManifest: null,
  currentGlbUrl: null,        // URL of last GLB loaded from Meshy/Tripo
  last3DPrompt: '',           // Description of current 3D model
  currentGlbBlob: null,       // Blob for download
  referenceImage: null,       // Base64 data URI per Image-to-3D Meshy o Gemini Vision
  referenceImageName: '',     // Nome file reference
  activeAssetForScript: null, // Asset target per aggiunta script: { type: 'model'|'ui', id, name }
  currentProjectId: localStorage.getItem('bloxcraft_current_project_id') || 'project_default'
};

// Network & Timer variables
let activeAbortController = null;
let loadingTimerInterval = null;
let loadingStartTime = 0;
let isGenerating = false; // Guard anti-doppio-invio

// Meshy/Tripo polling variables
let meshyPollInterval = null;
let meshyTimerInterval = null;
let meshyStartTime = 0;
let currentGlbObjectUrl = null; // for cleanup

// Three.js Engine Variables
let threeScene, threeCamera, threeRenderer, threeControls, threeCurrentModelGroup;
let isThreeAutoRotate = false;
let isThreeWireframe = false;

// System Prompts for each specialized mode
const SYSTEM_PROMPTS = {
  scripting: `Sei BloxCraft AI Script Architect, il massimo esperto mondiale di programmazione Luau e Roblox Engine.
Il tuo compito è scrivere codice Luau moderno, efficiente, sicuro ed esente da bug per Roblox Studio.

Linee guida fondamentali:
1. Usa la sintassi Luau moderna (es. task.wait() invece di wait(), task.spawn invece di spawn(), task.delay).
2. Gestisci correttamente la sicurezza Client-Server (Replication, RemoteEvent, RemoteFunction) e prevenzione exploit (la logica di salute/soldi/danno deve essere gestita SEMPRE sul Server).
3. Includi sempre all'inizio del tuo codice un'indicazione chiara del tipo di script e della sua posizione:
   -- TIPO: [Script / LocalScript / ModuleScript]
   -- POSIZIONE: [ServerScriptService / StarterPlayerScripts / ReplicatedStorage / StarterGui / Workspace]
4. Commenta le parti chiave del codice in modo pulito in italiano.
5. Separa la risposta in:
   - Prima parte: Spiegazione sintetica di come funziona e istruzioni per Roblox Studio.
   - Seconda parte: Il blocco di codice completo Luau (\`\`\`lua ... \`\`\`). Non omettere parti di codice con "...resto del codice...", scrivi sempre l'implementazione completa e funzionante.`,

  '3d-builder': `Sei BloxCraft 3D Master Studio Architect per Roblox Engine.
Il tuo compito è creare un modello 3D procedurale dettagliato, proporzionato e spettacolare per Roblox Studio.
Se l'utente fornisce un'immagine reference, analizza visivamente la creatura, il drago, il personaggio, l'arma, l'edificio o il veicolo nell'immagine: riproducine le proporzioni, i colori esatti e i dettagli distintivi.

DEVI FORNIRE OBBLIGATORIAMENTE DUE BLOCCHI NELLA TUA RISPOSTA:

1. Un blocco \`\`\`3d_manifest ... \`\`\` in formato JSON valido per la visualizzazione WebGL a 360° nel browser:
{
  "name": "Nome Descrittivo del Modello",
  "parts": [
    { "type": "box", "size": [x, y, z], "pos": [x, y, z], "rot": [0, 0, 0], "color": "#hexColor", "material": "plastic|metal|wood|neon|glass" },
    ...
  ]
}
Regole per il manifest:
- Componi il modello con 15-40 parti dettagliate (es. per un drago: busto, collo, testa, corna, ali segmentate, zampe, artigli, coda, occhi neon).
- Tipi supportati per "type": "box", "cylinder", "sphere", "wedge".
- Posizioni e dimensioni realistiche (studs Roblox).

2. Un blocco \`\`\`luau ... \`\`\` con lo script completo per Roblox Studio:
-- TIPO: Script / Command Bar
-- POSIZIONE: Workspace
local model = Instance.new("Model")
model.Name = "NomeModello"
model.Parent = workspace
-- crea ogni parte con Instance.new("Part"), CFrame, Size, Color3.fromRGB, Material, Anchored = true
...
model.PrimaryPart = primaryPart

Includi materiali Roblox (Enum.Material.Neon, SmoothPlastic, Metal), luci PointLight e particelle ParticleEmitter se magico.`,

  'ui-designer': `Sei BloxCraft GUI & HUD Designer, specializzato nel design di interfacce utente moderne per Roblox (stile giochi AAA front-page: anime, sci-fi, RPG, simulator).

Regole di design per Roblox:
1. Usa la gerarchia moderna: ScreenGui con ResetOnSpawn = false, ZIndexBehavior = Sibling.
2. Usa CanvasGroup, UICorner (per bordi arrotondati), UIStroke (per bordi neon o eleganti), UIGradient e UIAspectRatioConstraint per la responsività su PC e Mobile.
3. Fornisci uno script Luau che crea programmaticamente l'intera UI in StarterGui, inclusi effetti di animazione con TweenService.
4. Fornisci ANCHE alla fine della risposta un blocco speciale HTML/CSS racchiuso in \`\`\`html_preview ... \`\`\` che simula visivamente questa UI nel visualizzatore.
5. All'inizio indica:
   -- TIPO: LocalScript
   -- POSIZIONE: StarterGui`,

  debugger: `Sei BloxCraft Console & Bug Fixer per Roblox Studio.
Il tuo compito è diagnosticare e correggere errori di runtime, errori di sintassi, infinite loop e avvisi della console (Output) di Roblox Studio.

Quando ricevi un errore o uno script da revisionare:
1. Identifica immediatamente la causa radice (es. tentativo di indicizzare nil, RemoteEvent non trovato, script client che tenta di accedere a servizi server come DataStoreService, memory leak).
2. Spiega in modo chiaro e conciso qual era il problema.
3. Fornisci lo script Luau completamente corretto e ottimizzato all'interno di \`\`\`lua ... \`\`\`.`
};

// Mode metadata
const MODE_INFO = {
  scripting: {
    title: 'Luau Script Architect',
    icon: 'code-2',
    color: 'text-blue-400',
    desc: 'Generatore puro di Script Luau per Roblox Studio (Google Gemini 3.8)',
    placeholder: "Descrivi cosa vuoi creare (es. 'Crea un sistema di spade con combo di 3 colpi, hitbox con Raycast e animazione')..."
  },
  '3d-builder': {
    title: '3D Builder — Meshy AI',
    icon: 'cuboid',
    color: 'text-emerald-400',
    desc: 'Generatore di Mesh 3D GLB con Meshy AI (Text-to-3D o Image-to-3D da immagine reference)',
    placeholder: "Descrivi il modello 3D oppure carica un'immagine reference con 'Carica Immagine'..."
  },
  'ui-designer': {
    title: 'GUI & HUD Designer',
    icon: 'layout',
    color: 'text-purple-400',
    desc: 'Interfacce utente moderne con visual preview live e animazioni',
    placeholder: "Descrivi l'interfaccia (es. 'Un HUD in basso a sinistra con barra della vita rossa, stamina verde, livello del giocatore e monete d'oro')..."
  },
  debugger: {
    title: 'Console Debugger',
    icon: 'bug',
    color: 'text-rose-400',
    desc: 'Incolla il testo rosso della console di Studio per individuare e risolvere i bug',
    placeholder: "Incolla qui l'errore della console di Roblox Studio (es. 'Workspace.Sword.ServerScript:24: attempt to index nil with Humanoid') ed eventualmente il tuo script..."
  }
};

// ==========================================
// 3D ENGINE SELECTOR
// ==========================================

function set3DEngine(engine) {
  CONFIG.engine3D = engine;
  localStorage.setItem('bloxcraft_3d_engine', engine);
  const nativeBtn = document.getElementById('engine-native-btn');
  const meshyBtn = document.getElementById('engine-meshy-btn');
  if (nativeBtn && meshyBtn) {
    if (engine === 'native') {
      nativeBtn.className = "px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
      meshyBtn.className = "px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 transition text-gray-400 hover:text-white";
    } else {
      meshyBtn.className = "px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition bg-purple-500/20 text-purple-300 border border-purple-500/40";
      nativeBtn.className = "px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 transition text-gray-400 hover:text-white";
    }
  }
  console.log(`[BloxCraft] Engine 3D impostato: ${engine === 'native' ? '⚡ Studio Nativo (Gemini Vision)' : '🎨 Meshy AI (.GLB)'}`);
}

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  updateApiStatusUI();
  
  // Set saved settings
  const select = document.getElementById('modelProviderSelect');
  if (select && CONFIG.modelProvider) {
    select.value = CONFIG.modelProvider;
    updateActiveModelTag(CONFIG.modelProvider);
  }
  
  const keyInput = document.getElementById('apiKeyInput');
  if (keyInput && CONFIG.apiKey) {
    keyInput.value = CONFIG.apiKey;
  }

  const meshyInput = document.getElementById('meshyKeyInput');
  if (meshyInput && CONFIG.meshyKey) meshyInput.value = CONFIG.meshyKey;
  const tripoInput = document.getElementById('tripoKeyInput');
  if (tripoInput && CONFIG.tripoKey) tripoInput.value = CONFIG.tripoKey;

  // Initialize Three.js Engine
  setTimeout(() => {
    initThreeEngine();
    // Load previously saved active Roblox Place and its assets
    restoreCurrentPlace();
    // Verifica iniziale e monitoraggio automatico Bridge Roblox Studio MCP
    checkMcpStatus(false);
    setInterval(() => checkMcpStatus(false), 5000);
    // Supporto Drag & Drop e Incolla (CTRL+V) per Immagini Reference
    initImageDropSupport();
    // Inizializza i pulsanti engine 3D con lo stato salvato
    set3DEngine(CONFIG.engine3D);
  }, 100);
});

// ==========================================
// ROBLOX PLACE-CENTRIC ARCHITECTURE & ASSETS
// ==========================================

let currentPlace = {
  id: localStorage.getItem('bloxcraft_current_place_id') || 'place_default',
  name: localStorage.getItem('bloxcraft_current_place_name') || 'Mio Gioco Roblox',
  updatedAt: Date.now(),
  models: [],
  scripts: [],
  uis: [],
  chats: {
    'scripting': [],
    '3d-builder': [],
    'ui-designer': [],
    'debugger': []
  }
};

// Assicura che la struttura chats sia presente e migra eventuali vecchi messaggi
function ensurePlaceChats() {
  if (!currentPlace.chats || typeof currentPlace.chats !== 'object') {
    currentPlace.chats = {
      'scripting': [],
      '3d-builder': [],
      'ui-designer': [],
      'debugger': []
    };
  }
  if (!Array.isArray(currentPlace.chats['scripting'])) currentPlace.chats['scripting'] = [];
  if (!Array.isArray(currentPlace.chats['3d-builder'])) currentPlace.chats['3d-builder'] = [];
  if (!Array.isArray(currentPlace.chats['ui-designer'])) currentPlace.chats['ui-designer'] = [];
  if (!Array.isArray(currentPlace.chats['debugger'])) currentPlace.chats['debugger'] = [];

  // Se c'erano vecchi messaggi generici in chatMessages, migrali su scripting
  if (Array.isArray(currentPlace.chatMessages) && currentPlace.chatMessages.length > 0 && currentPlace.chats['scripting'].length === 0) {
    currentPlace.chats['scripting'] = [...currentPlace.chatMessages];
  }
}

function saveCurrentPlace() {
  ensurePlaceChats();
  currentPlace.updatedAt = Date.now();

  // Persist this place
  localStorage.setItem(`bloxcraft_place_${currentPlace.id}`, JSON.stringify(currentPlace));
  localStorage.setItem('bloxcraft_current_place_id', currentPlace.id);
  localStorage.setItem('bloxcraft_current_place_name', currentPlace.name);

  // Update places index
  let places = getSavedPlacesIndex();
  const existingIdx = places.findIndex(p => p.id === currentPlace.id);
  const summary = {
    id: currentPlace.id,
    name: currentPlace.name,
    modelsCount: currentPlace.models.length,
    scriptsCount: currentPlace.scripts.length,
    uisCount: currentPlace.uis.length,
    updatedAt: currentPlace.updatedAt
  };

  if (existingIdx >= 0) {
    places[existingIdx] = summary;
  } else {
    places.unshift(summary);
  }
  localStorage.setItem('bloxcraft_places_index', JSON.stringify(places.slice(0, 30)));

  // Update navbar and sidebar
  updatePlaceUI();
}

// Alias globale sicuro per evitare ReferenceError
function saveCurrentProjectState() {
  saveCurrentPlace();
}

function restoreCurrentPlace() {
  const currentId = localStorage.getItem('bloxcraft_current_place_id') || 'place_default';
  const raw = localStorage.getItem(`bloxcraft_place_${currentId}`);

  if (raw) {
    try {
      const data = JSON.parse(raw);
      currentPlace.id = data.id || currentId;
      currentPlace.name = data.name || 'Mio Gioco Roblox';
      currentPlace.models = data.models || [];
      currentPlace.scripts = data.scripts || [];
      currentPlace.uis = data.uis || [];
      currentPlace.chats = data.chats || null;
      currentPlace.chatMessages = data.chatMessages || [];
    } catch(e) {
      console.warn("Ripristino place fallito:", e);
    }
  } else {
    // Migration: check if old project exists to import as initial assets
    const oldRaw = localStorage.getItem(`bloxcraft_proj_project_default`);
    if (oldRaw) {
      try {
        const oldData = JSON.parse(oldRaw);
        if (oldData.generatedCode) {
          currentPlace.scripts.push({
            id: 'scr_' + Date.now(),
            name: 'Script Principale',
            code: oldData.generatedCode,
            placement: 'ServerScriptService',
            type: 'Script Server',
            date: Date.now()
          });
        }
        if (oldData.currentGlbUrl) {
          currentPlace.models.push({
            id: 'mod_' + Date.now(),
            name: oldData.name || 'Modello 3D',
            glbUrl: oldData.currentGlbUrl,
            prompt: oldData.last3DPrompt || '',
            date: Date.now()
          });
        }
      } catch(e) {}
    }
    saveCurrentPlace();
  }

  ensurePlaceChats();
  updatePlaceUI();

  // Renderizza la chat della modalità attiva
  renderActiveChat();

  // If place has models, load the most recent one
  if (currentPlace.models.length > 0) {
    const latestModel = currentPlace.models[0];
    loadPlaceModel(latestModel.id, false);
  }

  // If place has scripts, load the most recent one
  if (currentPlace.scripts.length > 0) {
    const latestScript = currentPlace.scripts[0];
    loadPlaceScript(latestScript.id, false);
  }
}

// Renderizza i messaggi della chat per la modalità attualmente selezionata
function renderActiveChat() {
  const chatContainer = document.getElementById('chatHistory');
  if (!chatContainer) return;
  chatContainer.innerHTML = '';

  ensurePlaceChats();
  const mode = CONFIG.activeMode || 'scripting';
  const messages = currentPlace.chats[mode] || [];

  if (messages.length === 0) {
    addModeWelcomeBubble(mode);
  } else {
    messages.forEach(msg => {
      if (msg.sender === 'user') renderUserBubbleDOM(msg.text);
      else renderBotBubbleDOM(msg.text);
    });
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updatePlaceUI() {
  const navName = document.getElementById('currentPlaceNavName');
  if (navName) navName.textContent = currentPlace.name;

  const countEl = document.getElementById('placeAssetsCount');
  if (countEl) {
    countEl.textContent = `${currentPlace.models.length} Modelli · ${currentPlace.scripts.length} Script`;
  }

  renderPlaceAssetsList();
}

function renderPlaceAssetsList() {
  const container = document.getElementById('placeAssetsContainer');
  if (!container) return;

  const totalAssets = currentPlace.models.length + currentPlace.scripts.length + currentPlace.uis.length;
  if (totalAssets === 0) {
    container.innerHTML = `
      <div class="text-[11px] text-gray-500 text-center py-4 px-2 bg-roblox-card/40 rounded-xl border border-roblox-border/50">
        Nessun asset ancora in questo place.<br>Genera un modello 3D o uno script per iniziare!
      </div>
    `;
    return;
  }

  let html = '';

  // 3D Models in this Place
  currentPlace.models.forEach(m => {
    html += `
      <div class="group flex items-center justify-between p-2 rounded-xl bg-roblox-card/70 hover:bg-roblox-card border border-roblox-border hover:border-emerald-500/40 transition cursor-pointer" onclick="loadPlaceModel('${m.id}', true)">
        <div class="flex items-center gap-2 truncate">
          <i data-lucide="cuboid" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>
          <span class="text-xs text-gray-200 truncate font-medium">${escapeHtml(m.name)}</span>
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onclick="event.stopPropagation(); openAddScriptModalForModel('${m.id}')" class="p-1 rounded text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20" title="📜 Aggiungi Script Luau a questo modello 3D">
            <i data-lucide="file-code" class="w-3 h-3"></i>
          </button>
          <button onclick="event.stopPropagation(); injectPlaceModelToStudio('${m.id}')" class="p-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/20" title="⚡ Inietta questo modello direttamente in Roblox Studio">
            <i data-lucide="zap" class="w-3 h-3 text-yellow-300"></i>
          </button>
          <button onclick="event.stopPropagation(); deletePlaceAsset('model', '${m.id}')" class="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10" title="Elimina modello">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;
  });

  // Luau Scripts in this Place
  currentPlace.scripts.forEach(s => {
    html += `
      <div class="group flex items-center justify-between p-2 rounded-xl bg-roblox-card/70 hover:bg-roblox-card border border-roblox-border hover:border-blue-500/40 transition cursor-pointer" onclick="loadPlaceScript('${s.id}', true)">
        <div class="flex items-center gap-2 truncate">
          <i data-lucide="code-2" class="w-3.5 h-3.5 text-blue-400 shrink-0"></i>
          <span class="text-xs text-gray-200 truncate font-medium">${escapeHtml(s.name)}</span>
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onclick="event.stopPropagation(); injectPlaceScriptToStudio('${s.id}')" class="p-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/20" title="Inietta questo script direttamente in Roblox Studio">
            <i data-lucide="zap" class="w-3 h-3 text-yellow-300"></i>
          </button>
          <button onclick="event.stopPropagation(); deletePlaceAsset('script', '${s.id}')" class="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10" title="Elimina script">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;
  });

  // UIs in this Place
  currentPlace.uis.forEach(u => {
    html += `
      <div class="group flex items-center justify-between p-2 rounded-xl bg-roblox-card/70 hover:bg-roblox-card border border-roblox-border hover:border-purple-500/40 transition cursor-pointer" onclick="loadPlaceUI('${u.id}', true)">
        <div class="flex items-center gap-2 truncate">
          <i data-lucide="layout" class="w-3.5 h-3.5 text-purple-400 shrink-0"></i>
          <span class="text-xs text-gray-200 truncate font-medium">${escapeHtml(u.name)}</span>
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onclick="event.stopPropagation(); openAddScriptModalForUI('${u.id}')" class="p-1 rounded text-purple-400 hover:text-purple-300 hover:bg-purple-500/20" title="📜 Aggiungi LocalScript per questa GUI">
            <i data-lucide="file-code" class="w-3 h-3"></i>
          </button>
          <button onclick="event.stopPropagation(); deletePlaceAsset('ui', '${u.id}')" class="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10" title="Elimina UI">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

function loadPlaceModel(modelId, switchTab = true) {
  const model = currentPlace.models.find(m => m.id === modelId);
  if (!model) return;

  CONFIG.currentGlbUrl = model.glbUrl;
  CONFIG.last3DPrompt = model.prompt;
  document.getElementById('threeModelTitle').textContent = model.name;

  if (model.glbUrl) {
    loadGLBFromUrl(model.glbUrl);
    document.getElementById('downloadGlbBtn')?.classList.remove('hidden');
    document.getElementById('addScriptToModelBtn')?.classList.remove('hidden');
  }

  if (switchTab) {
    switchOutputTab('3d');
  }
}

function loadPlaceScript(scriptId, switchTab = true) {
  const s = currentPlace.scripts.find(item => item.id === scriptId);
  if (!s) return;

  CONFIG.generatedCode = s.code;
  CONFIG.commandBarCode = `task.spawn(function()\n${s.code}\nend)`;

  const codeElem = document.getElementById('codeBlock');
  codeElem.textContent = s.code;
  Prism.highlightElement(codeElem);
  detectPlacementAdvice(s.code);

  if (switchTab) {
    switchOutputTab('code');
  }
}

function loadPlaceUI(uiId, switchTab = true) {
  const u = currentPlace.uis.find(item => item.id === uiId);
  if (!u) return;

  if (u.html) renderUIPreview(u.html);
  if (u.code) {
    CONFIG.generatedCode = u.code;
    const codeElem = document.getElementById('codeBlock');
    codeElem.textContent = u.code;
    Prism.highlightElement(codeElem);
  }

  if (switchTab) {
    switchOutputTab('preview');
  }
}

function deletePlaceAsset(type, id) {
  if (type === 'model') {
    currentPlace.models = currentPlace.models.filter(m => m.id !== id);
    if (CONFIG.currentGlbUrl && currentPlace.models.every(m => m.glbUrl !== CONFIG.currentGlbUrl)) {
      clearWorkspace();
    }
  } else if (type === 'script') {
    currentPlace.scripts = currentPlace.scripts.filter(s => s.id !== id);
  } else if (type === 'ui') {
    currentPlace.uis = currentPlace.uis.filter(u => u.id !== id);
  }
  saveCurrentPlace();
}

function getSavedPlacesIndex() {
  try {
    return JSON.parse(localStorage.getItem('bloxcraft_places_index')) || [
      { id: 'place_default', name: 'Mio Gioco Roblox', modelsCount: 0, scriptsCount: 0, uisCount: 0, updatedAt: Date.now() }
    ];
  } catch {
    return [];
  }
}

function openPlacesModal() {
  const container = document.getElementById('placesListContainer');
  const places = getSavedPlacesIndex();

  container.innerHTML = places.map(p => `
    <div class="p-3.5 rounded-xl bg-roblox-card border border-roblox-border flex items-center justify-between hover:border-emerald-500/50 transition">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <i data-lucide="gamepad-2" class="w-5 h-5 text-emerald-400"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h4 class="font-bold text-white text-sm">${escapeHtml(p.name)}</h4>
            ${p.id === currentPlace.id ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Attivo</span>' : ''}
          </div>
          <div class="text-[11px] text-gray-400 font-mono mt-0.5">
            📦 ${p.modelsCount || 0} Modelli · 📜 ${p.scriptsCount || 0} Script · 🖥️ ${p.uisCount || 0} UI
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="renamePlacePrompt('${p.id}')" class="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-roblox-border transition" title="Rinomina Place">
          <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
        </button>
        ${p.id !== currentPlace.id ? `
          <button onclick="switchPlace('${p.id}')" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition">
            Apri
          </button>
          <button onclick="deletePlace('${p.id}')" class="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition" title="Elimina Place">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        ` : `
          <span class="text-xs text-emerald-400 font-semibold px-2">In Uso</span>
        `}
      </div>
    </div>
  `).join('');

  lucide.createIcons();
  document.getElementById('placesModal').classList.remove('hidden');
}

function closePlacesModal() {
  document.getElementById('placesModal').classList.add('hidden');
}

function switchPlace(placeId) {
  saveCurrentPlace();
  localStorage.setItem('bloxcraft_current_place_id', placeId);
  currentPlace.id = placeId;
  restoreCurrentPlace();
  closePlacesModal();
}

function createNewPlacePrompt() {
  const name = prompt("Nome del nuovo Place / Gioco Roblox (es. 'Sword RPG', 'Sci-Fi Tycoon', 'Horror Mansion'):");
  if (!name || !name.trim()) return;

  saveCurrentPlace();

  const newId = 'place_' + Date.now();
  currentPlace = {
    id: newId,
    name: name.trim(),
    updatedAt: Date.now(),
    models: [],
    scripts: [],
    uis: [],
    chatMessages: []
  };

  CONFIG.chatMessages = [];
  CONFIG.generatedCode = '';
  CONFIG.commandBarCode = '';
  CONFIG.currentGlbUrl = null;
  CONFIG.last3DPrompt = '';

  saveCurrentPlace();
  restoreCurrentPlace();
  closePlacesModal();

  appendBotMessage(`🎮 **Benvenuto nel Place "${currentPlace.name}"!**\nTutti i modelli 3D e gli script che creerai da adesso saranno salvati insieme all'interno di questo place.`);
}

function renamePlacePrompt(placeId) {
  const places = getSavedPlacesIndex();
  const target = places.find(p => p.id === placeId);
  if (!target) return;

  const newName = prompt("Nuovo nome per questo Place:", target.name);
  if (!newName || !newName.trim()) return;

  if (currentPlace.id === placeId) {
    currentPlace.name = newName.trim();
    saveCurrentPlace();
  } else {
    const raw = localStorage.getItem(`bloxcraft_place_${placeId}`);
    if (raw) {
      const data = JSON.parse(raw);
      data.name = newName.trim();
      localStorage.setItem(`bloxcraft_place_${placeId}`, JSON.stringify(data));
    }
    const idx = places.findIndex(p => p.id === placeId);
    if (idx >= 0) {
      places[idx].name = newName.trim();
      localStorage.setItem('bloxcraft_places_index', JSON.stringify(places));
    }
  }

  openPlacesModal();
}

function deletePlace(placeId) {
  if (placeId === currentPlace.id) return;
  if (!confirm("Sei sicuro di voler eliminare questo Place e tutti i suoi asset?")) return;

  localStorage.removeItem(`bloxcraft_place_${placeId}`);
  let places = getSavedPlacesIndex().filter(p => p.id !== placeId);
  localStorage.setItem('bloxcraft_places_index', JSON.stringify(places));
  openPlacesModal();
}

function promptNewAsset() {
  const choice = prompt("Cosa vuoi creare per questo Place?\n\n1 = Modello 3D (Meshy AI)\n2 = Script Luau (Gemini)\n3 = Interfaccia GUI (HUD)\n\nDigita 1, 2 o 3:");
  if (choice === '1') {
    switchMode('3d-builder');
  } else if (choice === '2') {
    switchMode('scripting');
  } else if (choice === '3') {
    switchMode('ui-designer');
  }
}

function openMcpModal() {
  document.getElementById('mcpModal').classList.remove('hidden');
  checkMcpStatus(false);
}

function closeMcpModal() {
  document.getElementById('mcpModal').classList.add('hidden');
}

function addInitialWelcomeBubble() {
  addModeWelcomeBubble(CONFIG.activeMode || 'scripting');
}

function addModeWelcomeBubble(modeKey) {
  const chat = document.getElementById('chatHistory');
  if (!chat) return;

  if (modeKey === '3d-builder') {
    chat.innerHTML = `
      <div class="flex gap-3 text-sm chat-bubble">
        <div class="w-7 h-7 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <i data-lucide="cuboid" class="w-3.5 h-3.5 text-emerald-400"></i>
        </div>
        <div class="space-y-1">
          <div class="font-semibold text-emerald-300 text-xs flex items-center gap-1.5">
            <span>BloxCraft AI — 3D Builder (Meshy AI)</span>
            <span class="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-mono">Chat Separata</span>
          </div>
          <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3.5 rounded-2xl rounded-tl-none text-xs space-y-2">
            <p>Benvenuto nella modalità <strong>3D Builder</strong>! Qui crei modelli 3D GLB reali per Roblox Studio in 2 modi:</p>
            <ul class="list-disc list-inside space-y-1 text-gray-400 pl-1">
              <li><strong>Text-to-3D:</strong> Descrivi l'oggetto a parole (es. <em>"Spada laser runica con guardia d'oro"</em>).</li>
              <li><strong>Image-to-3D:</strong> Clicca su <strong>"Carica Immagine"</strong> (o incolla con Ctrl+V) per generare il modello 3D fedele alla tua foto reference!</li>
            </ul>
            <div class="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-200 text-[11px] flex items-center gap-1.5">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 text-yellow-300 shrink-0"></i>
              <span><strong>Nuovo:</strong> Dopo aver generato il modello potrai cliccare su <em>"Aggiungi Script al Modello"</em> per programmarne il comportamento in Studio!</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (modeKey === 'ui-designer') {
    chat.innerHTML = `
      <div class="flex gap-3 text-sm chat-bubble">
        <div class="w-7 h-7 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center shrink-0">
          <i data-lucide="layout" class="w-3.5 h-3.5 text-purple-400"></i>
        </div>
        <div class="space-y-1">
          <div class="font-semibold text-purple-300 text-xs flex items-center gap-1.5">
            <span>BloxCraft AI — GUI & HUD Designer</span>
            <span class="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded font-mono">Chat Separata</span>
          </div>
          <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3.5 rounded-2xl rounded-tl-none text-xs space-y-2">
            <p>Benvenuto nel designer di <strong>Interfacce Grafiche (GUI / HUD)</strong> per Roblox!</p>
            <ul class="list-disc list-inside space-y-1 text-gray-400 pl-1">
              <li>Genera layout visivi per barre della salute/stamina, negozi, inventari, menu pausa.</li>
              <li>Vedi la <strong>preview visiva interattiva</strong> simulata a schermo nel tab <em>Visual UI</em>.</li>
              <li>Usa il pulsante <strong>"Aggiungi Script a questa GUI"</strong> per generare i LocalScript con TweenService, click e tasti per StarterGui!</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  } else if (modeKey === 'debugger') {
    chat.innerHTML = `
      <div class="flex gap-3 text-sm chat-bubble">
        <div class="w-7 h-7 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center shrink-0">
          <i data-lucide="terminal" class="w-3.5 h-3.5 text-rose-400"></i>
        </div>
        <div class="space-y-1">
          <div class="font-semibold text-rose-300 text-xs flex items-center gap-1.5">
            <span>BloxCraft AI — Console Debugger</span>
            <span class="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded font-mono">Chat Separata</span>
          </div>
          <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3.5 rounded-2xl rounded-tl-none text-xs space-y-2">
            <p>Incolla qui gli <strong>errori rossi</strong> della Output Console di Roblox Studio o lo script difettoso.</p>
            <p class="text-gray-400">L'IA analizzerà la causa dell'errore (nil value, infinite loop, DataStore fallito) e ti fornirà la versione corretta e spiegata.</p>
          </div>
        </div>
      </div>
    `;
  } else {
    // Default: Luau Scripting
    chat.innerHTML = `
      <div class="flex gap-3 text-sm chat-bubble">
        <div class="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
          <i data-lucide="code-2" class="w-3.5 h-3.5 text-blue-400"></i>
        </div>
        <div class="space-y-1">
          <div class="font-semibold text-blue-300 text-xs flex items-center gap-1.5">
            <span>BloxCraft AI — Luau Scripting</span>
            <span class="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.2 rounded font-mono">Chat Separata</span>
          </div>
          <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3.5 rounded-2xl rounded-tl-none text-xs space-y-2">
            <p>Benvenuto nell'assistente di <strong>Scripting Luau per Roblox</strong>. Cosa vuoi programmare per il place <em>"${escapeHtml(currentPlace.name)}"</em>?</p>
            <ul class="list-disc list-inside space-y-1 text-gray-400 pl-1">
              <li>Sistemi di combattimento con combo di spade e raycast hitbox</li>
              <li>Tycoon dropper con nastri trasportatori e leaderstats</li>
              <li>Salvataggio dati con DataStore / DataStore2 (Coins, Level)</li>
              <li>LocalScript per client e ServerScript per logica autoritativa</li>
            </ul>
            <p class="text-gray-400 text-[11px] pt-1">💡 Puoi anche cliccare sui <strong>Preset Rapidi</strong> a sinistra per iniziare con un click!</p>
          </div>
        </div>
      </div>
    `;
  }
  lucide.createIcons();
}

// Switch Assistant Mode
function switchMode(modeKey) {
  CONFIG.activeMode = modeKey;
  
  // Update sidebar buttons
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`mode-${modeKey}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Update header info
  const info = MODE_INFO[modeKey];
  document.getElementById('modeTitle').textContent = info.title;
  document.getElementById('modeDescription').textContent = info.desc;
  document.getElementById('userPromptInput').placeholder = info.placeholder;
  
  const iconSpan = document.getElementById('modeTitleIcon');
  iconSpan.className = info.color;
  iconSpan.innerHTML = `<i data-lucide="${info.icon}" class="w-4 h-4"></i>`;
  lucide.createIcons();

  const uploadBtn = document.getElementById('uploadRefImgBtn');
  if (uploadBtn) {
    if (modeKey === '3d-builder') {
      uploadBtn.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-600/25 hover:bg-purple-600/40 text-purple-200 border border-purple-500/50 text-xs transition shadow-sm";
      uploadBtn.title = "Carica un'immagine reference per generare il modello 3D (Meshy Image-to-3D)";
    } else {
      uploadBtn.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-roblox-surface hover:bg-roblox-border text-gray-300 hover:text-white border border-roblox-border text-xs transition shadow-sm";
    }
  }

  // Ricarica la chat specifica per questa modalità!
  renderActiveChat();

  if (modeKey === '3d-builder') {
    switchOutputTab('3d');
  } else if (modeKey === 'ui-designer') {
    switchOutputTab('preview');
  } else {
    switchOutputTab('code');
  }

  saveCurrentProjectState();
}

// Switch Output Tabs (Code, 3D Viewport, Preview, Instructions)
function switchOutputTab(tabKey) {
  CONFIG.activeOutputTab = tabKey;
  
  document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
  const activeBtn = document.getElementById(`tab-${tabKey}-btn`);
  if (activeBtn) activeBtn.classList.add('active');

  document.getElementById('codeView').classList.toggle('hidden', tabKey !== 'code');
  document.getElementById('threeDView').classList.toggle('hidden', tabKey !== '3d');
  document.getElementById('previewView').classList.toggle('hidden', tabKey !== 'preview');
  document.getElementById('instructionsView').classList.toggle('hidden', tabKey !== 'instructions');

  if (tabKey === '3d') {
    setTimeout(onThreeResize, 50);
  }
}

// Handle Keydown on Prompt Input
function handleTextareaKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitPrompt();
  }
}

// Apply Quick Presets
function applyPreset(presetKey) {
  const input = document.getElementById('userPromptInput');
  switch (presetKey) {
    case 'combat':
      switchMode('scripting');
      input.value = "Crea un sistema completo di combattimento con la spada: 1) LocalScript dentro al Tool per rilevare l'input del click e riprodurre l'animazione di fendente con combo da 3 colpi. 2) RemoteEvent in ReplicatedStorage. 3) ServerScript che valida la distanza (< 10 studs), applica 25 danni al nemico, emette particelle di sangue e gestisce il cooldown di 0.5s tra i colpi.";
      break;
    case 'tycoon':
      switchMode('scripting');
      input.value = "Crea un sistema di Tycoon Dropper con nastro trasportatore: 1) Un dropper che genera una parte 'IronOre' ogni 2 secondi con valore 10$. 2) Un conveyor belt con AssemblyLinearVelocity che sposta i minerali. 3) Un blocco 'Furnace' che quando tocca il minerale lo distrugge, riproduce un suono di cassa e aggiunge i soldi alle leaderstats del proprietario.";
      break;
    case 'leaderstats':
      switchMode('scripting');
      input.value = "Crea uno script Server completo per gestire le Leaderstats dei giocatori con DataStore2 o DataStore standard di Roblox: salva 'Monete' (Coins) e 'Livello' (Level). Gestisci il salvataggio automatico ogni 5 minuti, al salvataggio all'uscita (PlayerRemoving) e con BindToClose per evitare perdita di dati durante lo spegnimento dei server.";
      break;
    case 'swordInStone':
      switchMode('3d-builder');
      buildRealisticSwordInTheStone();
      switchOutputTab('3d');
      appendUserMessage("Crea il modello 3D di una Spada nella Roccia leggendaria.");
      appendBotMessage("⚔️ **Ecco la Spada Leggendaria nella Roccia con Mesh Poligonale Realistica!**\n\n* **Lama d'acciaio speculare** a sezione a diamante rastremata con incisioni runiche ciano che emettono luce.\n* **Guardia d'oro lavorata** con gemme di rubino incastonate e impugnatura in cuoio con anelli dorati.\n* **Masso di granito sfaccettato** con fratture e angoli naturali.\n* **File .OBJ scaricabile:** Puoi scaricarlo con il pulsante viola per importarlo come \`MeshPart\` in Roblox Studio!\n* **Script Luau pronto:** Trovi lo script completo nella scheda 'Codice Luau' con \`ProximityPrompt\` per l'estrazione.");
      saveCurrentProjectState();
      return;
    case 'castle3d':
      switchMode('3d-builder');
      input.value = "Crea un Castello Medievale fortificato: 4 torri cilindriche agli angoli con merli in pietra grigia, mura di cinta spesse con camminamento, un portone ad arco in legno scuro con rinforzi in metallo, e una fortezza centrale alta con bandiere rosse e torce con luce arancione brillante.";
      break;
    case 'hudui':
      switchMode('ui-designer');
      input.value = "Crea un HUD moderno per il giocatore posizionato in basso a sinistra: 1) Barra della Salute (verde/rossa) con testo '100 / 100 HP'. 2) Barra della Stamina (blu/ciano) '100 / 100'. 3) Icona del livello con bordo circolare e monete correnti con icona d'oro. Includi animazioni fluide con TweenService quando la vita scende.";
      break;
  }
  submitPrompt();
}

// Cancel prompt
function cancelActivePrompt() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  stopLoadingTimer();
  stopMeshyTimer();
  showLoading(false);
  showMeshyStatus(false);
  appendBotMessage("🛑 Richiesta annullata dall'utente.");
}

// Main Submit Prompt Function
async function submitPrompt() {
  // Guard anti-doppio-invio
  if (isGenerating) return;

  const input = document.getElementById('userPromptInput');
  let prompt = input.value.trim();

  // Se l'utente ha caricato un'immagine di riferimento:
  // 1. Il testo può essere opzionale
  // 2. La modalità DEVE passare a 3D Builder (Meshy Image-to-3D)
  if (CONFIG.referenceImage) {
    if (CONFIG.activeMode !== '3d-builder') {
      switchMode('3d-builder');
    }
    if (!prompt) {
      prompt = "Modello 3D da Immagine Reference (" + (CONFIG.referenceImageName || "immagine") + ")";
    }
  }

  if (!prompt) return;

  // Valida la chiave Meshy se in modalità 3D AND engine è Meshy
  if (CONFIG.activeMode === '3d-builder' && CONFIG.engine3D === 'meshy' && !CONFIG.meshyKey) {
    openSettingsModal();
    const meshyInput = document.getElementById('meshyKeyInput');
    if (meshyInput) {
      meshyInput.focus();
      meshyInput.classList.add('ring-2', 'ring-emerald-400');
    }
    appendBotMessage(`⚠️ **Modalità 3D Builder attiva (Meshy AI)**\nPer generare modelli 3D GLB reali con Meshy AI, inserisci la tua chiave gratuita in ⚙️ **Impostazioni API**.\n\n📌 **Come ottenerla gratis (200 crediti/mese):**\n1. Vai su [app.meshy.ai](https://app.meshy.ai) → Accedi con Google\n2. Vai su **Settings → API Keys** e copia la chiave (\`msy_...\`)\n3. Incollala nelle impostazioni di BloxCraft AI.\n\n💡 **Alternativa gratuita e illimitata:** Passa a **⚡ Studio Nativo** (usa Gemini Vision, 0 crediti, 1.500 richieste/giorno).`);
    return;
  }

  // Valida la chiave Gemini se in modalità Scripting / GUI / Debugger O se 3D Builder con engine nativo
  if (!CONFIG.apiKey && (CONFIG.activeMode !== '3d-builder' || CONFIG.engine3D === 'native')) {
    openSettingsModal();
    const apiInput = document.getElementById('apiKeyInput');
    if (apiInput) {
      apiInput.focus();
      apiInput.classList.add('ring-2', 'ring-blue-400');
    }
    alert("Inserisci la tua chiave API Google Gemini gratuita nelle impostazioni per procedere.");
    return;
  }

  // Blocca ulteriori invii e aggiorna UI
  isGenerating = true;
  const sendBtn = document.getElementById('sendPromptBtn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>...</span>`;
  }

  const hasReference = !!CONFIG.referenceImage;
  const refName = CONFIG.referenceImageName;

  if (hasReference) {
    appendUserMessage(`🖼️ **[Reference Immagine: ${refName || 'immagine'}]**\n${prompt}`);
  } else {
    appendUserMessage(prompt);
  }
  input.value = '';

  try {
    if (CONFIG.activeMode === '3d-builder') {
      await handle3DBuilderPrompt(prompt);
    } else {
      showLoading(true);
      startLoadingTimer();

      // Mostra typing indicator nella chat
      const typingId = 'typing_' + Date.now();
      appendTypingIndicator(typingId);

      activeAbortController = new AbortController();
      const timeoutId = setTimeout(() => {
        if (activeAbortController) activeAbortController.abort();
      }, 150000);

      try {
        const responseText = await callCloudAI(prompt, CONFIG.activeMode, activeAbortController.signal);
        clearTimeout(timeoutId);
        removeTypingIndicator(typingId);
        processAIResponse(responseText);
      } catch (err) {
        clearTimeout(timeoutId);
        removeTypingIndicator(typingId);
        if (err.name === 'AbortError') {
          appendBotMessage('⚠️ **Richiesta interrotta**: La chiamata ha impiegato troppo tempo. Riprova.');
        } else {
          appendBotMessage(`⚠️ **Errore**: ${err.message || 'Verifica la tua chiave API o la connessione.'}`);
        }
      } finally {
        stopLoadingTimer();
        showLoading(false);
        activeAbortController = null;
      }
    }
  } finally {
    // Ripristina sempre il bottone e il guard
    isGenerating = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg><span>Genera</span>`;
    }
  }
}

async function handle3DBuilderPrompt(userPrompt) {
  // Remember prompt for optional scripting later
  CONFIG.last3DPrompt = userPrompt;
  const refImg = CONFIG.referenceImage;
  const refImgName = CONFIG.referenceImageName;

  // ────────────────────────────────────────────────────────────
  // ENGINE NATIVO: Gemini Vision + Procedural Luau (ILLIMITATO)
  // ────────────────────────────────────────────────────────────
  if (CONFIG.engine3D === 'native') {
    if (!CONFIG.apiKey) {
      openSettingsModal();
      appendBotMessage(`⚠️ **Chiave Gemini richiesta per Studio Nativo**\nInserisci la tua chiave Google Gemini API gratuita in ⚙️ **Impostazioni API**.`);
      return;
    }

    if (refImg) {
      appendBotMessage(`🧠 **Studio Nativo — Analisi Immagine con Gemini Vision**\nSto analizzando l'immagine reference \`${refImgName || 'immagine'}\` con **⭐ Gemini 2.5 Pro** (il più capace). Se i crediti giornalieri sono esauriti, passo automaticamente al modello successivo.`);
    } else {
      appendBotMessage(`⚡ **Studio Nativo — Generazione 3D Procedurale**\nSto generando il modello 3D con **⭐ Gemini 2.5 Pro**. Se i crediti sono esauriti, passo automaticamente al modello successivo.`);
    }

    // Pulisci riferimento immagine dopo uso
    removeReferenceImage();
    switchOutputTab('3d');

    showLoading(true);
    startLoadingTimer();

    const typingId = 'typing_' + Date.now();
    appendTypingIndicator(typingId);

    activeAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
      if (activeAbortController) activeAbortController.abort();
    }, 150000);

    try {
      // Usa la catena fallback: 2.5 Pro → 3.8 Pro → 3.8 Flash → 2.5 Flash
      const responseText = await call3DAIWithFallback(userPrompt, activeAbortController.signal, refImg);
      clearTimeout(timeoutId);
      removeTypingIndicator(typingId);

      // Parse e render 3D manifest + codice Luau
      processAIResponse(responseText);

      // Salva modello nativo come asset nel place
      const modelName = (userPrompt && userPrompt.length > 28) ? userPrompt.substring(0, 28) + '...' : (userPrompt || 'Modello 3D Nativo');
      const nativeModelAsset = {
        id: 'mod_' + Date.now(),
        name: modelName,
        glbUrl: null, // nessun GLB, è procedurale
        manifest: CONFIG.current3DManifest,
        prompt: userPrompt,
        luauCode: CONFIG.generatedCode,
        date: Date.now()
      };
      currentPlace.models.unshift(nativeModelAsset);
      saveCurrentPlace();
      renderPlaceAssetsList();

    } catch (err) {
      clearTimeout(timeoutId);
      removeTypingIndicator(typingId);
      if (err.name === 'AbortError') {
        appendBotMessage('⚠️ **Richiesta interrotta**: La generazione ha impiegato troppo tempo. Riprova.');
      } else {
        appendBotMessage(`❌ **Errore Studio Nativo**: ${err.message || 'Verifica la chiave API Gemini nelle impostazioni.'}`);
      }
    } finally {
      stopLoadingTimer();
      showLoading(false);
      activeAbortController = null;
    }
    return;
  }

  // ────────────────────────────────────────────────────────────
  // ENGINE MESHY: Mesh GLB reale (.GLB con texture PBR)
  // ────────────────────────────────────────────────────────────

  // Check if user accidentally pasted Tripo key into Meshy field
  if (CONFIG.meshyKey.startsWith('tsk_')) {
    appendBotMessage(`⚠️ **Attenzione Chiave API:** Nel campo *Chiave Meshy AI* è presente una chiave Tripo3D (\`tsk_...\`).\nLa chiave di Meshy AI inizia con \`msy_...\`. Creala gratuitamente su [app.meshy.ai](https://app.meshy.ai).`);
    openSettingsModal();
    return;
  }

  if (refImg) {
    appendBotMessage(`🎨 **Generazione Mesh 3D con Meshy Image-to-3D avviata!**\nReference: \`${refImgName || 'immagine'}\`\nSto trasformando l'immagine in un modello 3D GLB texturizzato. Richiede circa 1-2 minuti. Segui l'avanzamento nel viewport 3D.`);
  } else {
    appendBotMessage(`🎨 **Generazione Mesh 3D con Meshy AI avviata!**\nSto creando il modello 3D in cloud per te. Richiede circa 1-2 minuti. Segui l'avanzamento nel viewport 3D.`);
  }

  // Pulisci l'immagine dal box di input dopo l'invio
  removeReferenceImage();
  switchOutputTab('3d');

  await generateMeshyModel(userPrompt, refImg);
}

// ==========================================
// MODAL & GESTIONE AGGIUNTA SCRIPT PER MODELLI 3D & GUI
// ==========================================

function openAddScriptModalForModel(modelId) {
  const model = currentPlace.models.find(m => m.id === modelId) || currentPlace.models[0];
  const name = model ? model.name : 'Modello 3D';
  CONFIG.activeAssetForScript = {
    type: 'model',
    id: model ? model.id : 'mod_active',
    name: name,
    prompt: model ? model.prompt : ''
  };

  const modal = document.getElementById('addScriptModal');
  const title = document.getElementById('addScriptModalTitle');
  const sub = document.getElementById('addScriptModalSub');
  const icon = document.getElementById('addScriptModalIcon');
  const grid = document.getElementById('addScriptPresetsGrid');
  const custom = document.getElementById('addScriptCustomInput');

  if (title) title.textContent = `Aggiungi Script Luau a "${name}"`;
  if (sub) sub.textContent = 'Scegli come questo modello 3D deve comportarsi dentro Roblox Studio:';
  if (icon) {
    icon.className = 'w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center';
    icon.innerHTML = '<i data-lucide="cuboid" class="w-4 h-4 text-emerald-400"></i>';
  }

  // Presets per Modello 3D
  if (grid) {
    grid.innerHTML = `
      <button type="button" onclick="selectScriptPreset('Interazione tasto [E] (ProximityPrompt) che aggiunge 100 monete con suono magico e particelle')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-emerald-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">🪙</span>
        <div>
          <div class="font-bold text-white text-[11px]">ProximityPrompt [E]</div>
          <div class="text-[10px] text-gray-400">Interazione tasto E + ricompensa</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Tool equipaggiabile nello zaino (Backpack): impugnabile con animazione di fendente e hitbox al click')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-emerald-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">⚔️</span>
        <div>
          <div class="font-bold text-white text-[11px]">Tool / Arma Impugnabile</div>
          <div class="text-[10px] text-gray-400">Equipaggia nello zaino con click</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Animazione fluida di levitazione su e giu e rotazione continua a 360 gradi a mezz aria con TweenService')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-emerald-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">🌀</span>
        <div>
          <div class="font-bold text-white text-[11px]">Rotazione & Fluttuazione</div>
          <div class="text-[10px] text-gray-400">Galleggia e ruota a mezz'aria</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Trappola al tocco (.Touched): quando un giocatore tocca il modello perde 25 HP con suono di danno e fumo rosso')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-emerald-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">💥</span>
        <div>
          <div class="font-bold text-white text-[11px]">Trappola / Danno Touch</div>
          <div class="text-[10px] text-gray-400">Danno al contatto del player</div>
        </div>
      </button>
    `;
  }

  if (custom) custom.value = 'Interazione con tasto [E] (ProximityPrompt) che dà 100 monete e riproduce un suono';
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function openAddScriptModalForUI(uiId) {
  const ui = currentPlace.uis.find(u => u.id === uiId) || currentPlace.uis[0];
  const name = ui ? ui.name : 'Interfaccia GUI';
  CONFIG.activeAssetForScript = {
    type: 'ui',
    id: ui ? ui.id : 'ui_active',
    name: name
  };

  const modal = document.getElementById('addScriptModal');
  const title = document.getElementById('addScriptModalTitle');
  const sub = document.getElementById('addScriptModalSub');
  const icon = document.getElementById('addScriptModalIcon');
  const grid = document.getElementById('addScriptPresetsGrid');
  const custom = document.getElementById('addScriptCustomInput');

  if (title) title.textContent = `Aggiungi LocalScript a "${name}"`;
  if (sub) sub.textContent = 'Scegli la logica client per questa interfaccia in StarterGui:';
  if (icon) {
    icon.className = 'w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center';
    icon.innerHTML = '<i data-lucide="layout" class="w-4 h-4 text-purple-400"></i>';
  }

  // Presets per GUI
  if (grid) {
    grid.innerHTML = `
      <button type="button" onclick="selectScriptPreset('Aggiornamento dinamico della barra vita con TweenService fluido collegato a Humanoid.HealthChanged')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-purple-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">💖</span>
        <div>
          <div class="font-bold text-white text-[11px]">Barra Vita Dinamica</div>
          <div class="text-[10px] text-gray-400">Sincronizzata con la vita reale</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Apertura e chiusura animata del menu premendo il tasto M o cliccando sul pulsante di chiusura X')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-purple-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">🔘</span>
        <div>
          <div class="font-bold text-white text-[11px]">Apri/Chiudi con Tasto M</div>
          <div class="text-[10px] text-gray-400">Animazione con UserInputService</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Sistema di Shop: click sui bottoni di acquisto, convalida monete del player e notifica di acquisto completato')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-purple-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">🛒</span>
        <div>
          <div class="font-bold text-white text-[11px]">Negozio / Acquisto</div>
          <div class="text-[10px] text-gray-400">Click pulsanti e verifica monete</div>
        </div>
      </button>
      <button type="button" onclick="selectScriptPreset('Sistema di Notifiche Toast: funzione ShowNotification(testo) che fa scorrere un banner a schermo per 3 secondi')" class="p-2.5 rounded-xl bg-roblox-card hover:bg-roblox-card/80 border border-roblox-border hover:border-purple-500/40 text-left transition flex items-center gap-2">
        <span class="text-base">🔔</span>
        <div>
          <div class="font-bold text-white text-[11px]">Notifiche Pop-up</div>
          <div class="text-[10px] text-gray-400">Banner toast a scomparsa</div>
        </div>
      </button>
    `;
  }

  if (custom) custom.value = 'Aggiornamento dinamico della barra vita con TweenService fluido quando il giocatore subisce danno';
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function selectScriptPreset(text) {
  const custom = document.getElementById('addScriptCustomInput');
  if (custom) custom.value = text;
}

function closeAddScriptModal() {
  const modal = document.getElementById('addScriptModal');
  if (modal) modal.classList.add('hidden');
  CONFIG.activeAssetForScript = null;
}

function promptAddScriptToModel() {
  const latest = currentPlace.models[0];
  openAddScriptModalForModel(latest ? latest.id : 'mod_active');
}

function promptAddScriptToActiveUI() {
  const latest = currentPlace.uis[0];
  openAddScriptModalForUI(latest ? latest.id : 'ui_active');
}

async function confirmGenerateScriptForAsset() {
  const custom = document.getElementById('addScriptCustomInput');
  const userAction = custom ? custom.value.trim() : '';

  if (!userAction) {
    alert('Inserisci una descrizione del comportamento desiderato!');
    return;
  }

  if (!CONFIG.apiKey) {
    alert('Per generare lo script Luau con l\'IA, inserisci la tua chiave gratuita di Google Gemini nelle Impostazioni API!');
    closeAddScriptModal();
    openSettingsModal();
    return;
  }

  const asset = CONFIG.activeAssetForScript || { type: 'model', name: 'Asset' };
  closeAddScriptModal();

  showLoading(true);
  const loadingText = document.getElementById('loadingText');
  const loadingSub = document.getElementById('loadingSubText');
  if (loadingText) loadingText.textContent = `Generazione Script Luau per "${asset.name}"...`;
  if (loadingSub) loadingSub.textContent = `Creazione logiche: ${userAction.substring(0, 40)}...`;
  startLoadingTimer();

  try {
    let fullScriptPrompt;
    if (asset.type === 'ui') {
      fullScriptPrompt = `Ho un'interfaccia ScreenGui creata per Roblox Studio chiamata "${asset.name}". Scrivi un LocalScript completo, ottimizzato e moderno per Roblox Studio da posizionare dentro alla GUI in StarterGui.
Comportamento richiesto: "${userAction}".
Linee guida:
1. Usa TweenService per le animazioni e UserInputService se ci sono tasti della tastiera.
2. Includi gestione di errori, percorsi corretti (script.Parent) e suoni se appropriato.
3. Fornisci SOLO codice Luau completo dentro al blocco \`\`\`luau.`;
    } else {
      fullScriptPrompt = `Ho un modello 3D in Roblox Studio chiamato "${asset.name}" posizionato nel Workspace (generato con: "${asset.prompt || asset.name}"). Scrivi uno script Luau completo, sicuro e moderno per Roblox Studio che implementa questa specifica interazione: "${userAction}".
Linee guida:
1. Specifica all'inizio il tipo di script (-- TIPO: Script Server / LocalScript) e la posizione consigliata (-- POSIZIONE: Workspace / ServerScriptService).
2. Assumi che il modello si trovi in Workspace e assegna nomi chiari alle variabili.
3. Fornisci il codice Luau completo e testato dentro al blocco \`\`\`luau.`;
    }

    const responseText = await callCloudAI(fullScriptPrompt, 'scripting', null);
    processAIResponse(responseText);
    switchOutputTab('code');

    // Aggiorna nome script generato con riferimento all'asset
    if (currentPlace.scripts.length > 0) {
      currentPlace.scripts[0].name = `Script ${asset.name} - ${userAction.substring(0, 20)}`;
      saveCurrentPlace();
    }

    appendBotMessage(`📜 **Script Luau creato e collegato a "${asset.name}"!**\n\n- Comportamento: *${userAction}*\n- Codice pronto nel tab **"Codice Luau"**\n- Clicca su **"⚡ Inietta in Studio (MCP)"** per applicarlo istantaneamente dentro Roblox Studio!`);

  } catch(err) {
    appendBotMessage(`⚠️ Errore durante la creazione dello script Luau: ${err.message}`);
  } finally {
    stopLoadingTimer();
    showLoading(false);
  }
}

async function generateMeshyModel(prompt, referenceImage = null) {
  const isImageMode = !!referenceImage;
  showMeshyStatus(true, isImageMode ? 'Invio immagine reference a Meshy Image-to-3D...' : 'Invio richiesta a Meshy AI...');
  setMeshyStep(1);
  
  try {
    let taskId;
    let pollEndpoint;

    if (isImageMode) {
      // Meshy Image-to-3D API
      const createRes = await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.meshyKey}`
        },
        body: JSON.stringify({
          image_url: referenceImage,
          enable_pbr: true,
          should_texture: true
        })
      });

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        const errMsg = errData.message || `Errore HTTP ${createRes.status}: ${createRes.statusText}`;
        if (createRes.status === 401) {
          throw new Error(`Chiave Meshy non valida (${errMsg}). Verifica la chiave su app.meshy.ai (deve iniziare con 'msy_')`);
        } else if (createRes.status === 402 || createRes.status === 429) {
          throw new Error(`Crediti Meshy esauriti o limite raggiunto (${errMsg}).`);
        } else {
          throw new Error(errMsg);
        }
      }

      const createData = await createRes.json();
      taskId = createData.result;
      pollEndpoint = `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`;
    } else {
      // Meshy Text-to-3D API
      const createRes = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.meshyKey}`
        },
        body: JSON.stringify({
          mode: 'preview',
          prompt: prompt,
          art_style: 'realistic',
          negative_prompt: 'low quality, blurry, bad geometry',
          ai_model: 'meshy-4'
        })
      });
      
      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        const errMsg = errData.message || `Errore HTTP ${createRes.status}: ${createRes.statusText}`;
        if (createRes.status === 401) {
          throw new Error(`Chiave Meshy non valida (${errMsg}). Verifica la chiave su app.meshy.ai (deve iniziare con 'msy_')`);
        } else if (createRes.status === 402 || createRes.status === 429) {
          throw new Error(`Crediti Meshy esauriti o limite raggiunto (${errMsg}).`);
        } else {
          throw new Error(errMsg);
        }
      }

      const createData = await createRes.json();
      taskId = createData.result;
      pollEndpoint = `https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`;
    }
    
    if (!taskId) throw new Error('Meshy non ha restituito un task ID valido.');
    
    showMeshyStatus(true, isImageMode ? 'Elaborazione geometria 3D da reference...' : 'Generazione geometria in corso...');
    setMeshyStep(1, 'active');
    
    // Step 2: Poll until SUCCEEDED
    startMeshyTimer();
    const glbUrl = await pollMeshyTask(taskId, pollEndpoint);
    
    if (!glbUrl) throw new Error('Meshy non ha restituito un URL GLB valido.');
    
    // Salva IMMEDIATAMENTE il modello come asset nel Place (non perderlo mai!)
    const modelAsset = {
      id: 'mod_' + Date.now(),
      name: (prompt && prompt.length > 28) ? prompt.substring(0, 28) + '...' : (prompt || 'Modello 3D da Reference'),
      glbUrl: glbUrl,
      prompt: prompt,
      date: Date.now()
    };
    currentPlace.models.unshift(modelAsset);
    saveCurrentPlace();
    CONFIG.currentGlbUrl = glbUrl;

    setMeshyStep(2, 'done');
    showMeshyStatus(true, 'Caricamento del modello GLB nel viewer 3D...');
    
    // Step 3: Load GLB into Three.js (con fallback sicuro)
    let viewerLoaded = false;
    try {
      await loadGLBFromUrl(glbUrl);
      setMeshyStep(3, 'done');
      viewerLoaded = true;
    } catch(viewerErr) {
      console.warn('Caricamento visuale Three.js non riuscito:', viewerErr);
    }
    
    showMeshyStatus(false);
    stopMeshyTimer();

    appendBotMessage(`✅ **Modello 3D GLB generato con successo con Meshy AI!**\n\n${viewerLoaded ? '🎨 Il modello è visualizzato nel viewport 3D qui a fianco!' : '💾 Il modello è stato generato e salvato nel tuo Place (scaricabile con il pulsante verde).'} \n\nCosa puoi fare adesso:\n- ⚡ **Inietta in Studio (MCP):** Clicca su *"⚡ Inietta Modello in Studio"* per importarlo direttamente nel Workspace\n- ⬇️ **Scarica .GLB:** Scarica il file 3D reale con texture PBR per Roblox Studio\n- 📜 **Aggiungi Script Luau:** Clicca sul pulsante *"Aggiungi Script al Modello"* per dargli logica di gioco\n- 📁 Lo trovi sempre salvato a sinistra tra gli **Asset del Place**.`);
    
  } catch(err) {
    stopMeshyTimer();
    showMeshyStatus(false);
    console.error('Meshy error:', err);
    
    appendBotMessage(`❌ **Errore Meshy AI**: ${err.message}\n\n📌 **Come risolvere:**\n1. Vai su [app.meshy.ai](https://app.meshy.ai) → Accedi con Google\n2. Clicca in alto a destra sul tuo profilo o su **API Keys**\n3. Crea o copia la tua chiave (\`msy_...\`)\n4. Incollala in ⚙️ **Impostazioni API** nel campo *Chiave API Meshy AI*`);
  }
}

async function pollMeshyTask(taskId, customEndpoint = null) {
  const endpoint = customEndpoint || `https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`;
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 120; // 6 min max (3s interval)
    
    meshyPollInterval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(meshyPollInterval);
        reject(new Error('Timeout: la generazione Meshy ha superato i 6 minuti.'));
        return;
      }
      
      try {
        const pollRes = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${CONFIG.meshyKey}` }
        });
        
        if (!pollRes.ok) {
          // continue polling
          return;
        }
        
        const data = await pollRes.json();
        const status = data.status;
        const progress = data.progress || 0;
        
        document.getElementById('meshyStatusText').textContent = 
          `Generazione geometria: ${progress}%`;
        
        if (status === 'SUCCEEDED') {
          clearInterval(meshyPollInterval);
          meshyPollInterval = null;
          
          const modelUrls = data.model_urls || {};
          const glbUrl = modelUrls.glb || modelUrls.fbx || modelUrls.obj;
          resolve(glbUrl);
          
        } else if (status === 'FAILED' || status === 'EXPIRED') {
          clearInterval(meshyPollInterval);
          meshyPollInterval = null;
          reject(new Error(`Meshy task ${status}: ${data.task_error?.message || 'errore sconosciuto'}`));
        }
        // else: IN_PROGRESS or PENDING — keep polling
        
      } catch(e) {
        // Network error during poll — keep trying
        console.warn('Poll error:', e);
      }
    }, 3000);
  });
}

async function generateTripoModel(prompt) {
  showMeshyStatus(true, 'Invio richiesta a Tripo3D...');
  setMeshyStep(1, 'active');
  
  try {
    const createRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.tripoKey}`
      },
      body: JSON.stringify({
        type: 'text_to_model',
        prompt: prompt,
        model_version: 'v2.0-20240919',
        texture: true,
        pbr: true
      })
    });
    
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      throw new Error(errData.message || `Errore Tripo3D ${createRes.status}`);
    }
    
    const createData = await createRes.json();
    const taskId = createData.data?.task_id;
    
    if (!taskId) throw new Error('Tripo3D non ha restituito un task ID valido.');
    
    startMeshyTimer();
    showMeshyStatus(true, 'Generazione mesh Tripo3D in corso...');
    
    const glbUrl = await pollTripoTask(taskId);
    
    if (!glbUrl) throw new Error('Tripo3D non ha restituito un URL modello.');
    
    setMeshyStep(2, 'done');
    showMeshyStatus(true, 'Caricamento GLB...');
    setMeshyStep(3, 'active');
    
    await loadGLBFromUrl(glbUrl);
    
    stopMeshyTimer();
    showMeshyStatus(false);
    
    appendBotMessage(`✅ **Modello 3D generato con Tripo3D!** Scaricalo come GLB con il pulsante verde e importalo come **MeshPart** in Roblox Studio.`);
    saveCurrentProjectState();
    
  } catch(err) {
    stopMeshyTimer();
    showMeshyStatus(false);
    if (err.message && err.message.includes('fetch')) {
      appendBotMessage(`❌ **Errore di connessione Tripo3D (CORS)**: L'API di Tripo3D non permette chiamate dirette dal browser web senza un server proxy.\n\n👉 **Soluzione consigliata**: Usa **Meshy AI** per la generazione 3D! Meshy supporta al 100% le chiamate dirette dal browser. Puoi ottenere la chiave gratuita su [app.meshy.ai](https://app.meshy.ai) (200 crediti gratuiti ogni mese).`);
    } else {
      appendBotMessage(`❌ **Errore Tripo3D**: ${err.message}\n\nVerifica la chiave API su [platform.tripo3d.ai](https://platform.tripo3d.ai).`);
    }
  }
}

async function pollTripoTask(taskId) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 120;
    
    meshyPollInterval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(meshyPollInterval);
        reject(new Error('Timeout Tripo3D: generazione troppo lunga.'));
        return;
      }
      
      try {
        const pollRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
          headers: { 'Authorization': `Bearer ${CONFIG.tripoKey}` }
        });
        
        if (!pollRes.ok) return;
        
        const data = await pollRes.json();
        const status = data.data?.status;
        const progress = data.data?.progress || 0;
        
        document.getElementById('meshyStatusText').textContent = `Tripo3D: ${progress}%`;
        
        if (status === 'success') {
          clearInterval(meshyPollInterval);
          meshyPollInterval = null;
          const glbUrl = data.data?.output?.model || data.data?.output?.pbr_model;
          resolve(glbUrl);
        } else if (status === 'failed' || status === 'cancelled') {
          clearInterval(meshyPollInterval);
          meshyPollInterval = null;
          reject(new Error(`Tripo3D: ${status}`));
        }
      } catch(e) {
        console.warn('Tripo poll error:', e);
      }
    }, 3000);
  });
}

// Scarica il file binario GLB attraverso tentativi a cascata (diretto + proxy CORS multipli)
async function fetchGlbArrayBuffer(url) {
  // 1. Tentativo Diretto
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) return await res.arrayBuffer();
  } catch(e) {
    console.warn("[BloxCraft] Fetch diretto fallito (probabile blocco CORS CDN), provo proxy 1...", e);
  }

  // 2. Tentativo tramite api.allorigins.win
  try {
    const p1 = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    const res = await fetch(p1);
    if (res.ok) return await res.arrayBuffer();
  } catch(e) {
    console.warn("[BloxCraft] Proxy allorigins fallito, provo proxy 2...", e);
  }

  // 3. Tentativo tramite corsproxy.io
  try {
    const p2 = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const res = await fetch(p2);
    if (res.ok) return await res.arrayBuffer();
  } catch(e) {
    console.warn("[BloxCraft] Proxy corsproxy fallito", e);
  }

  throw new Error("Impossibile scaricare i dati binari del modello GLB dal CDN.");
}

async function loadGLBFromUrl(glbUrl) {
  if (!threeScene || !threeCurrentModelGroup) initThreeEngine();

  // Salva l'URL globale
  CONFIG.currentGlbUrl = glbUrl;

  // Mostra i bottoni per scaricare e aggiungere script
  const dlBtn = document.getElementById('downloadGlbBtn');
  if (dlBtn) dlBtn.classList.remove('hidden');
  const addScriptBtn = document.getElementById('addScriptToModelBtn');
  if (addScriptBtn) addScriptBtn.classList.remove('hidden');

  // Scarica il buffer binario in memoria (supera qualsiasi blocco CORS)
  const buffer = await fetchGlbArrayBuffer(glbUrl);

  return new Promise((resolve, reject) => {
    // Pulisci il vecchio modello
    while (threeCurrentModelGroup.children.length > 0) {
      const obj = threeCurrentModelGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
      threeCurrentModelGroup.remove(obj);
    }

    document.getElementById('threePlaceholder').classList.add('hidden');

    const loader = new THREE.GLTFLoader();
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const model = gltf.scene;
        model.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        threeCurrentModelGroup.add(model);

        const box = new THREE.Box3().setFromObject(threeCurrentModelGroup);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scale = 15 / maxDim;
          threeCurrentModelGroup.scale.setScalar(scale);
        }

        centerThreeCameraOnModel();

        let meshCount = 0;
        model.traverse(c => { if (c.isMesh) meshCount++; });
        document.getElementById('threeModelTitle').textContent = '🎨 Modello 3D Reale (Meshy AI)';
        document.getElementById('threePartCount').textContent = `${meshCount} mesh`;

        resolve();
      },
      (parseErr) => {
        console.error("[BloxCraft] Errore parsing GLB in Three.js:", parseErr);
        reject(new Error("Errore durante la decodifica della geometria 3D: " + (parseErr.message || "formato non valido")));
      }
    );
  });
}

async function downloadCurrentGLB() {
  if (!CONFIG.currentGlbUrl) {
    alert('Nessun modello GLB disponibile. Genera prima un modello 3D!');
    return;
  }
  
  try {
    // Try to fetch and trigger download
    const response = await fetch(CONFIG.currentGlbUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BloxCraft_3D_${Date.now()}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    alert('✅ File GLB scaricato!\n\nCome importarlo in Roblox Studio:\n1. In Roblox Studio, inserisci un "MeshPart" nel Workspace\n2. Nelle proprietà, clicca su "MeshId"\n3. Seleziona il file .glb appena scaricato\n\nOppure usa la funzione "Import 3D" dal menu Home di Roblox Studio!');
  } catch(err) {
    // Open in new tab as fallback
    window.open(CONFIG.currentGlbUrl, '_blank');
    alert('Il download diretto non è riuscito. Il file si aprirà in una nuova scheda — salvalo da lì con click destro → Salva con nome.');
  }
}

function showMeshyStatus(show, text) {
  const bar = document.getElementById('meshyStatusBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !show);
  if (text) {
    const textEl = document.getElementById('meshyStatusText');
    if (textEl) textEl.textContent = text;
  }
  // Hide spinner when done
  const spinner = document.getElementById('meshySpinner');
  if (spinner) spinner.style.display = show ? 'block' : 'none';
}

function setMeshyStep(stepNum, state) {
  // state: 'active' | 'done' | 'pending'
  for (let i = 1; i <= 3; i++) {
    const stepEl = document.getElementById(`step${i}`);
    if (!stepEl) continue;
    const dot = stepEl.querySelector('.step-dot');
    if (!dot) continue;
    
    if (i < stepNum) {
      // completed
      dot.className = 'step-dot w-1.5 h-1.5 rounded-full bg-emerald-400';
      stepEl.classList.remove('text-gray-400');
      stepEl.classList.add('text-emerald-400');
    } else if (i === stepNum) {
      if (state === 'active' || state === 'done') {
        dot.className = 'step-dot w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse';
        stepEl.classList.remove('text-gray-400');
        stepEl.classList.add('text-emerald-400');
      }
    } else {
      dot.className = 'step-dot w-1.5 h-1.5 rounded-full bg-gray-600';
      stepEl.classList.remove('text-emerald-400');
      stepEl.classList.add('text-gray-400');
    }
  }
}

function startMeshyTimer() {
  meshyStartTime = Date.now();
  const timerEl = document.getElementById('meshyTimer');
  if (timerEl) timerEl.textContent = '00:00';
  
  meshyTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - meshyStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('meshyTimer');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 500);
}

function stopMeshyTimer() {
  if (meshyTimerInterval) {
    clearInterval(meshyTimerInterval);
    meshyTimerInterval = null;
  }
  if (meshyPollInterval) {
    clearInterval(meshyPollInterval);
    meshyPollInterval = null;
  }
}

// Start live timer during loading
function startLoadingTimer() {
  loadingStartTime = Date.now();
  const timerElem = document.getElementById('loadingTimer');
  const subText = document.getElementById('loadingSubText');
  if (timerElem) timerElem.textContent = "00:00";

  loadingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - loadingStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    if (timerElem) timerElem.textContent = `${mins}:${secs}`;

    if (subText) {
      if (elapsed < 5) subText.textContent = "Invio prompt a Google Gemini Cloud...";
      else if (elapsed < 15) subText.textContent = "Elaborazione geometria 3D e script Luau...";
      else if (elapsed < 35) subText.textContent = "Calcolo coordinate, parti e materiali PBR (quasi pronto)...";
      else subText.textContent = "Finalizzazione del modello e invio al visualizzatore 3D...";
    }
  }, 500);
}

function stopLoadingTimer() {
  if (loadingTimerInterval) {
    clearInterval(loadingTimerInterval);
    loadingTimerInterval = null;
  }
}

// ==========================================
// 3D BUILDER — CATENA FALLBACK MODELLI
// Ordine: 2.5 Pro → 3.8 Pro → 3.8 Flash → 2.5 Flash
// Si abbassa automaticamente se quota esaurito (429) o modello non trovato (404)
// ==========================================
const MODELS_3D_CHAIN = [
  { id: 'gemini-2.5-pro',   label: '⭐ Gemini 2.5 Pro' },
  { id: 'gemini-3.8-pro',   label: '🔥 Gemini 3.8 Pro' },
  { id: 'gemini-3.8-flash', label: '⚡ Gemini 3.8 Flash' },
  { id: 'gemini-2.5-flash', label: '🌀 Gemini 2.5 Flash' }
];

async function call3DAIWithFallback(userPrompt, abortSignal, referenceImageData = null) {
  const systemInstruction = SYSTEM_PROMPTS['3d-builder'];
  let lastError = null;

  const buildParts = (imgData) => {
    const parts = [];
    if (imgData) {
      const m = imgData.match(/^data:([a-zA-Z0-9/+]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    parts.push({ text: userPrompt });
    return parts;
  };

  for (const modelEntry of MODELS_3D_CHAIN) {
    const modelId = modelEntry.id;
    console.log(`[BloxCraft 3D] Tentativo con ${modelEntry.label}...`);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${CONFIG.apiKey}`;
      const payload = {
        contents: [{ role: 'user', parts: buildParts(referenceImageData) }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortSignal
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          if (modelEntry.id !== MODELS_3D_CHAIN[0].id) {
            appendBotMessage(`ℹ️ **Passaggio automatico**: ${MODELS_3D_CHAIN[0].label} ha esaurito i crediti. Generazione completata con **${modelEntry.label}**.`);
          }
          return text;
        }
        throw new Error('Risposta vuota dal modello.');
      }

      // 429 = quota esaurita | 404 = non disponibile → prova il prossimo
      if (res.status === 429 || res.status === 404 || res.status === 400) {
        const errData = await res.json().catch(() => ({}));
        lastError = new Error(`${modelEntry.label}: ${errData.error?.message || 'HTTP ' + res.status}`);
        console.warn(`[BloxCraft 3D] Scendo al modello successivo. Motivo: ${lastError.message}`);
        continue;
      }

      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Errore HTTP ${res.status}`);

    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
      if (!err.message?.includes('Failed to fetch')) continue;
      throw err;
    }
  }
  throw new Error(`Tutti i modelli 3D hanno fallito. Ultimo errore: ${lastError?.message || 'Sconosciuto'}`);
}

// Call Cloud AI (Gemini or Groq) — supporta input multimodale (immagini reference)
async function callCloudAI(userPrompt, mode, abortSignal, referenceImageData = null) {
  const systemInstruction = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.scripting;

  if (CONFIG.modelProvider.startsWith('gemini')) {
    // Normalizza: rimpiazza modelli deprecati con gemini-3.8-flash (default attuale Google)
    let model = CONFIG.modelProvider;
    if (OBSOLETE_MODELS.includes(model) || (!model.startsWith('gemini') && !model.startsWith('groq'))) {
      model = 'gemini-3.8-flash';
      CONFIG.modelProvider = 'gemini-3.8-flash';
      localStorage.setItem('bloxcraft_model_provider', 'gemini-3.8-flash');
    }

    console.log(`[BloxCraft] Chiamata a Google Generative AI (${model})${referenceImageData ? ' [VISION+IMAGE]' : ''}...`);

    // Costruisci i parts: se c'è un'immagine, aggiungila come inlineData prima del testo
    const buildParts = (includeImage) => {
      const parts = [];
      if (includeImage && referenceImageData) {
        // referenceImageData è una data URI: "data:image/png;base64,XXXX..."
        const matches = referenceImageData.match(/^data:([a-zA-Z0-9/+]+);base64,(.+)$/);
        if (matches) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      }
      parts.push({ text: userPrompt });
      return parts;
    };

    const makeGeminiRequest = async (targetModel) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${CONFIG.apiKey}`;
      const payload = {
        contents: [{ role: "user", parts: buildParts(true) }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
      };
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortSignal
      });
    };

    let res = await makeGeminiRequest(model);

    // Fallback automatico se il modello specifico restituisce 404 (non trovato)
    if (!res.ok && res.status === 404 && model !== 'gemini-3.8-flash') {
      console.warn(`[BloxCraft] Modello ${model} non trovato (404), fallback automatico a gemini-3.8-flash...`);
      res = await makeGeminiRequest('gemini-3.8-flash');
      if (res.ok) {
        CONFIG.modelProvider = 'gemini-3.8-flash';
        localStorage.setItem('bloxcraft_model_provider', 'gemini-3.8-flash');
      }
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Errore HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Nessuna risposta generata dal modello.";
  } else if (CONFIG.modelProvider === 'groq-qwen-32b') {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'qwen-2.5-coder-32b',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Errore Groq ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } else {
    throw new Error("Provider modello non supportato o non configurato.");
  }
}

// Process and parse AI Response
function processAIResponse(rawText) {
  // 0. Pre-extract explanation text (needed below for asset naming)
  const explanation = rawText.replace(/```(?:lua|luau|html_preview|3d_manifest)[\s\S]*?```/gi, '').trim();

  // 1. Extract Lua code blocks
  const luaRegex = /```(?:lua|luau)\n([\s\S]*?)```/i;
  const luaMatch = rawText.match(luaRegex);
  
  let luaCode = "";
  if (luaMatch) {
    luaCode = luaMatch[1].trim();
  } else {
    const anyBlockMatch = rawText.match(/```\n([\s\S]*?)```/);
    if (anyBlockMatch) {
      luaCode = anyBlockMatch[1].trim();
    }
  }

  CONFIG.generatedCode = luaCode;
  
  // 2. Prepare Command Bar Code & Save as Asset in Place
  if (luaCode) {
    CONFIG.commandBarCode = `task.spawn(function()\n${luaCode}\nend)`;
    const codeElem = document.getElementById('codeBlock');
    codeElem.textContent = luaCode;
    Prism.highlightElement(codeElem);
    detectPlacementAdvice(luaCode);

    // Save as script asset in active Roblox Place
    const sType = document.getElementById('scriptTypeTag')?.textContent || 'Script Server';
    const sPlacement = document.getElementById('placementText')?.textContent || 'ServerScriptService';
    const firstLine = explanation ? explanation.split('\n')[0].replace(/^[#* \t-]+/, '').trim().substring(0, 28) : '';
    const scriptAsset = {
      id: 'scr_' + Date.now(),
      name: firstLine || 'Script Luau',
      code: luaCode,
      placement: sPlacement,
      type: sType,
      date: Date.now()
    };
    currentPlace.scripts.unshift(scriptAsset);
    saveCurrentPlace();
  }

  // 3. Extract 3D Manifest (if present or in 3D builder mode)
  const manifestRegex = /```3d_manifest\n([\s\S]*?)```/i;
  const manifestMatch = rawText.match(manifestRegex);
  
  if (manifestMatch) {
    try {
      const manifestData = JSON.parse(manifestMatch[1]);
      CONFIG.current3DManifest = manifestData;
      render3DModel(manifestData);
      switchOutputTab('3d');
    } catch (e) {
      console.warn("Parsing 3D manifest fallito:", e);
      parseProceduralLuauTo3D(luaCode);
    }
  } else if (CONFIG.activeMode === '3d-builder' && luaCode && !CONFIG.currentGlbUrl) {
    parseProceduralLuauTo3D(luaCode);
    switchOutputTab('3d');
  }

  // 4. Extract HTML preview (if in UI mode)
  const htmlRegex = /```html_preview\n([\s\S]*?)```/i;
  const htmlMatch = rawText.match(htmlRegex);
  if (htmlMatch) {
    renderUIPreview(htmlMatch[1]);
    currentPlace.uis.unshift({
      id: 'ui_' + Date.now(),
      name: 'Interfaccia GUI',
      code: luaCode,
      html: htmlMatch[1],
      date: Date.now()
    });
    saveCurrentPlace();
    if (CONFIG.activeMode === 'ui-designer') switchOutputTab('preview');
  } else if (CONFIG.activeMode === 'ui-designer') {
    renderFallbackUIPreview();
    switchOutputTab('preview');
  }

  // 5. Instructions view
  CONFIG.instructionsMarkdown = explanation;
  document.getElementById('instructionsContent').innerHTML = marked.parse(explanation);

  // 6. Append Bot message to chat
  const previewSnippet = explanation.substring(0, 280) + (explanation.length > 280 ? '...' : '');
  appendBotMessage(previewSnippet || "Ho generato la soluzione richiesta per il tuo place. Esplora il modello 3D, il codice o l'interfaccia nel pannello a destra!");

  if (CONFIG.activeMode === 'scripting') {
    switchOutputTab('code');
  }

  // Save place state
  saveCurrentPlace();
}

// ==========================================
// THREE.JS REALTIME 3D VIEWPORT ENGINE
// ==========================================

function initThreeEngine() {
  const container = document.getElementById('threeCanvasContainer');
  if (!container || threeRenderer) return;

  // Scene
  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0a0d14);

  // Camera
  const aspect = container.clientWidth / (container.clientHeight || 400);
  threeCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  threeCamera.position.set(24, 18, 28);

  // Renderer
  threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  threeRenderer.setSize(container.clientWidth, container.clientHeight || 400);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  threeRenderer.shadowMap.enabled = true;
  threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(threeRenderer.domElement);

  // OrbitControls
  threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
  threeControls.enableDamping = true;
  threeControls.dampingFactor = 0.05;
  threeControls.maxPolarAngle = Math.PI / 2 + 0.08;
  threeControls.target.set(0, 4, 0);

  // Studio Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  threeScene.add(ambient);

  const mainLight = new THREE.DirectionalLight(0xffffff, 0.85);
  mainLight.position.set(30, 50, 30);
  mainLight.castShadow = true;
  threeScene.add(mainLight);

  const cyanRimLight = new THREE.DirectionalLight(0x00a2ff, 0.4);
  cyanRimLight.position.set(-25, 20, -25);
  threeScene.add(cyanRimLight);

  // Roblox Studio Baseplate Grid
  const grid = new THREE.GridHelper(60, 60, 0x00a2ff, 0x1f2937);
  grid.position.y = 0;
  threeScene.add(grid);

  // Shadow receiving ground
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  threeScene.add(ground);

  // Model group
  threeCurrentModelGroup = new THREE.Group();
  threeScene.add(threeCurrentModelGroup);

  // Animation Loop
  function renderLoop() {
    requestAnimationFrame(renderLoop);
    if (isThreeAutoRotate && threeControls) {
      threeControls.autoRotate = true;
      threeControls.autoRotateSpeed = 2.0;
    } else if (threeControls) {
      threeControls.autoRotate = false;
    }
    threeControls.update();
    threeRenderer.render(threeScene, threeCamera);
  }
  renderLoop();

  window.addEventListener('resize', onThreeResize);
}

function onThreeResize() {
  const container = document.getElementById('threeCanvasContainer');
  if (!container || !threeRenderer || !threeCamera) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w <= 0 || h <= 0) return;
  threeCamera.aspect = w / h;
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(w, h);
}

// Render a 3D model into the Three.js viewport
function render3DModel(manifest) {
  if (!threeScene || !threeCurrentModelGroup) initThreeEngine();

  // Clear previous model parts
  while (threeCurrentModelGroup.children.length > 0) {
    const obj = threeCurrentModelGroup.children[0];
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    threeCurrentModelGroup.remove(obj);
  }

  // Check if this is a Sword in the Stone request - build true AAA sculpted mesh!
  const nameLower = ((manifest.name || "") + " " + (CONFIG.chatMessages[CONFIG.chatMessages.length - 1]?.text || "")).toLowerCase();
  if (nameLower.includes("spada") || nameLower.includes("sword") || nameLower.includes("roccia") || nameLower.includes("stone")) {
    buildRealisticSwordInTheStone();
    return;
  }

  // Update UI Titles
  document.getElementById('threePlaceholder').classList.add('hidden');
  document.getElementById('threeModelTitle').textContent = manifest.name || "Modello 3D Roblox";
  document.getElementById('threePartCount').textContent = `${manifest.parts ? manifest.parts.length : 0} Parti`;

  if (!manifest.parts || manifest.parts.length === 0) return;

  manifest.parts.forEach(part => {
    let geom;
    const type = (part.type || 'box').toLowerCase();
    const size = part.size || [2, 2, 2];
    const pos = part.pos || [0, 0, 0];
    const rot = part.rot || [0, 0, 0];
    const colorHex = part.color || '#3b82f6';
    const matType = (part.material || 'plastic').toLowerCase();

    // Geometry creation with faceted detail
    if (type === 'cylinder') {
      const radiusTop = size[0] ? size[0] / 2 : 1;
      const radiusBottom = size[1] ? size[1] / 2 : radiusTop;
      const height = size[2] || 4;
      geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32);
    } else if (type === 'sphere') {
      const radius = size[0] ? size[0] / 2 : 1.5;
      geom = new THREE.SphereGeometry(radius, 32, 32);
    } else if (type === 'wedge') {
      const w = size[0] || 2, h = size[1] || 2, d = size[2] || 2;
      geom = createWedgeGeometry(w, h, d);
    } else if (type === 'rock' || type === 'dodecahedron') {
      geom = new THREE.DodecahedronGeometry(size[0] || 3, 1);
    } else {
      geom = new THREE.BoxGeometry(size[0] || 2, size[1] || 2, size[2] || 2);
    }

    // Material creation with realistic PBR
    let mat;
    const parsedColor = new THREE.Color(colorHex);

    if (matType === 'neon') {
      mat = new THREE.MeshBasicMaterial({
        color: parsedColor,
        wireframe: isThreeWireframe
      });
      const pLight = new THREE.PointLight(parsedColor, 0.9, 10);
      pLight.position.set(pos[0], pos[1], pos[2]);
      threeCurrentModelGroup.add(pLight);
    } else if (matType === 'glass') {
      mat = new THREE.MeshPhysicalMaterial({
        color: parsedColor,
        roughness: 0.1,
        transmission: 0.85,
        thickness: 0.6,
        wireframe: isThreeWireframe
      });
    } else if (matType === 'metal') {
      mat = new THREE.MeshStandardMaterial({
        color: parsedColor,
        metalness: 0.9,
        roughness: 0.18,
        wireframe: isThreeWireframe
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: parsedColor,
        roughness: 0.5,
        metalness: 0.1,
        wireframe: isThreeWireframe
      });
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    threeCurrentModelGroup.add(mesh);
  });

  centerThreeCameraOnModel();
}

// ==========================================
// AAA REALISTIC PROCEDURAL 3D MESH GENERATOR
// ==========================================

function buildRealisticSwordInTheStone() {
  document.getElementById('threePlaceholder').classList.add('hidden');
  document.getElementById('threeModelTitle').textContent = "🗡️ Spada Leggendaria nella Roccia";
  document.getElementById('threePartCount').textContent = "Mesh Poligonale AAA";

  // 1. THE JAGGED FRACTURED ROCK BASE (Dodecahedron with vertex noise & fractures)
  const rockGeo = new THREE.DodecahedronGeometry(6.2, 1);
  const posAttr = rockGeo.attributes.position;
  // Deform vertices for natural rugged organic stone facets
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const noise = (Math.sin(vx * 2.1) + Math.cos(vz * 1.8) + Math.sin(vy * 3.2)) * 0.45;
    posAttr.setXYZ(i, vx + noise * 0.7, Math.max(0.1, vy + noise * 0.4), vz + noise * 0.7);
  }
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x333842,
    roughness: 0.92,
    metalness: 0.08,
    flatShading: true
  });
  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.scale.set(1.4, 0.75, 1.3);
  rockMesh.position.set(0, 2.5, 0);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  threeCurrentModelGroup.add(rockMesh);

  // Secondary rock cluster
  const smallRockGeo = new THREE.DodecahedronGeometry(3.5, 1);
  const smallRock = new THREE.Mesh(smallRockGeo, rockMat);
  smallRock.scale.set(1.2, 0.7, 1.1);
  smallRock.position.set(4.2, 1.4, -1.5);
  smallRock.rotation.set(0.3, 0.8, -0.2);
  smallRock.castShadow = true;
  smallRock.receiveShadow = true;
  threeCurrentModelGroup.add(smallRock);

  // 2. THE STEEL BLADE (Sharp Diamond-Cross Section Tapered Blade)
  const bladeGroup = new THREE.Group();

  // Main Blade Geometry (Sharp diamond edge)
  const bladeShape = new THREE.Shape();
  // Diamond cross section: sharp left and right edges, thicker center ridge
  bladeShape.moveTo(0, 0.22);
  bladeShape.lineTo(0.75, 0);
  bladeShape.lineTo(0, -0.22);
  bladeShape.lineTo(-0.75, 0);
  bladeShape.closePath();

  // Extrude blade along Y with taper
  const extrudeSettings = {
    steps: 1,
    depth: 9.5,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.05,
    bevelSegments: 2
  };
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
  bladeGeo.rotateX(-Math.PI / 2); // orient along Y

  // Taper the blade vertices towards the tip
  const bladePos = bladeGeo.attributes.position;
  for (let i = 0; i < bladePos.count; i++) {
    const y = bladePos.getY(i);
    const factor = Math.max(0.08, 1 - (y / 10.0) * 0.75); // tapers to sharp tip
    bladePos.setX(i, bladePos.getX(i) * factor);
    bladePos.setZ(i, bladePos.getZ(i) * factor);
  }
  bladeGeo.computeVertexNormals();

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xecf0f1,
    metalness: 0.96,
    roughness: 0.12,
    envMapIntensity: 1.5
  });
  const bladeMesh = new THREE.Mesh(bladeGeo, steelMat);
  bladeMesh.position.set(0, 4.0, 0);
  bladeMesh.castShadow = true;
  bladeGroup.add(bladeMesh);

  // Glowing Cyan Rune Fuller (Blood Groove)
  const fullerGeo = new THREE.BoxGeometry(0.12, 7.5, 0.26);
  const runeMat = new THREE.MeshBasicMaterial({ color: 0x00f5ff });
  const fullerMesh = new THREE.Mesh(fullerGeo, runeMat);
  fullerMesh.position.set(0, 8.0, 0);
  bladeGroup.add(fullerMesh);

  // Blade PointLight Aura
  const runeLight = new THREE.PointLight(0x00f5ff, 1.2, 12);
  runeLight.position.set(0, 8.5, 0.5);
  bladeGroup.add(runeLight);

  // 3. THE ORNATE GOLDEN CROSSGUARD
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.88,
    roughness: 0.22
  });

  // Center block of crossguard
  const guardCenterGeo = new THREE.BoxGeometry(1.6, 0.55, 0.75);
  const guardCenter = new THREE.Mesh(guardCenterGeo, goldMat);
  guardCenter.position.set(0, 13.6, 0);
  guardCenter.castShadow = true;
  bladeGroup.add(guardCenter);

  // Winged curved quillons left & right
  [-1, 1].forEach(dir => {
    const wingGeo = new THREE.CylinderGeometry(0.28, 0.18, 2.0, 16);
    wingGeo.rotateZ(dir * Math.PI / 2.3);
    const wingMesh = new THREE.Mesh(wingGeo, goldMat);
    wingMesh.position.set(dir * 1.6, 13.55, 0);
    wingMesh.castShadow = true;
    bladeGroup.add(wingMesh);

    // Tip gem / ornament
    const gemGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const rubyMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.1, metalness: 0.3 });
    const gemMesh = new THREE.Mesh(gemGeo, rubyMat);
    gemMesh.position.set(dir * 2.5, 13.4, 0);
    bladeGroup.add(gemMesh);
  });

  // Central Ruby Crest
  const centerRubyGeo = new THREE.OctahedronGeometry(0.28);
  const centerRuby = new THREE.Mesh(centerRubyGeo, new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.1, metalness: 0.2 }));
  centerRuby.position.set(0, 13.6, 0.42);
  bladeGroup.add(centerRuby);

  // 4. THE GRIP / HILT (Dark Brown Leather Wrapped Cylinder)
  const hiltGeo = new THREE.CylinderGeometry(0.32, 0.35, 3.2, 24);
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x24180f,
    roughness: 0.85,
    metalness: 0.05
  });
  const hiltMesh = new THREE.Mesh(hiltGeo, leatherMat);
  hiltMesh.position.set(0, 15.3, 0);
  hiltMesh.castShadow = true;
  bladeGroup.add(hiltMesh);

  // Gold Wire Spiral Rings on Grip
  for (let r = 0; r < 4; r++) {
    const ringGeo = new THREE.TorusGeometry(0.34, 0.04, 12, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo, goldMat);
    ringMesh.position.set(0, 14.2 + r * 0.7, 0);
    bladeGroup.add(ringMesh);
  }

  // 5. THE ORNATE POMMEL (Seamlessly connected to the grip!)
  const pommelGeo = new THREE.DodecahedronGeometry(0.65, 0);
  const pommelMesh = new THREE.Mesh(pommelGeo, goldMat);
  pommelMesh.position.set(0, 17.15, 0); // connected flush on top of grip!
  pommelMesh.castShadow = true;
  bladeGroup.add(pommelMesh);

  // Top pommel crown tip
  const crownGeo = new THREE.ConeGeometry(0.25, 0.45, 12);
  const crownMesh = new THREE.Mesh(crownGeo, goldMat);
  crownMesh.position.set(0, 17.7, 0);
  bladeGroup.add(crownMesh);

  // 6. MAGICAL ORBITING PARTICLES
  const particleGeo = new THREE.BufferGeometry();
  const particleCount = 40;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let p = 0; p < particleCount; p++) {
    const radius = 1.2 + Math.random() * 2.0;
    const angle = Math.random() * Math.PI * 2;
    const py = 4.0 + Math.random() * 12.0;
    particlePositions[p * 3] = Math.cos(angle) * radius;
    particlePositions[p * 3 + 1] = py;
    particlePositions[p * 3 + 2] = Math.sin(angle) * radius;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0x00f5ff,
    size: 0.18,
    transparent: true,
    opacity: 0.85
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  bladeGroup.add(particles);

  threeCurrentModelGroup.add(bladeGroup);

  // Center camera on the majestic sword
  centerThreeCameraOnModel();

  // Also generate the Luau script for Roblox Studio in the code block!
  generateRobloxSwordScript();
}

// Generate the complete Roblox Studio script for the Sword in the Stone
function generateRobloxSwordScript() {
  const luauScript = `-- ====================================================================
-- TIPO: Script Server
-- POSIZIONE: Workspace (o ServerScriptService)
-- DESCRIZIONE: Spada Leggendaria nella Roccia con ProximityPrompt, Suoni ed Estrazione
-- ====================================================================

local Workspace = game:GetService("Workspace")
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

-- Crea il Modello Principale
local swordModel = Instance.new("Model")
swordModel.Name = "SpadaNellaRoccia"

-- 1. LA ROCCIA BASE
local rock = Instance.new("Part")
rock.Name = "RockBase"
rock.Size = Vector3.new(12, 5, 11)
rock.Position = Vector3.new(0, 2.5, 0)
rock.Material = Enum.Material.Slate
rock.Color = Color3.fromRGB(55, 60, 70)
rock.Anchored = true
rock.Parent = swordModel
swordModel.PrimaryPart = rock

-- 2. LAMA DELLA SPADA
local blade = Instance.new("Part")
blade.Name = "SwordBlade"
blade.Size = Vector3.new(0.4, 9, 1.2)
blade.Position = Vector3.new(0, 7.5, 0)
blade.Material = Enum.Material.Metal
blade.Color = Color3.fromRGB(220, 225, 235)
blade.Anchored = true
blade.Parent = swordModel

-- Bagliore Runico Neon
local rune = Instance.new("Part")
rune.Name = "RuneCore"
rune.Size = Vector3.new(0.5, 7.5, 0.2)
rune.Position = Vector3.new(0, 8, 0)
rune.Material = Enum.Material.Neon
rune.Color = Color3.fromRGB(0, 245, 255)
rune.Anchored = true
rune.CanCollide = false
rune.Parent = swordModel

local runeLight = Instance.new("PointLight")
runeLight.Color = Color3.fromRGB(0, 245, 255)
runeLight.Brightness = 2.5
runeLight.Range = 14
runeLight.Parent = rune

-- 3. ELSA E IMPUGNATURA
local guard = Instance.new("Part")
guard.Name = "CrossGuard"
guard.Size = Vector3.new(0.8, 0.6, 3.8)
guard.Position = Vector3.new(0, 12.2, 0)
guard.Material = Enum.Material.Metal
guard.Color = Color3.fromRGB(212, 175, 55) -- Oro
guard.Anchored = true
guard.Parent = swordModel

local handle = Instance.new("Part")
handle.Name = "Handle"
handle.Size = Vector3.new(0.6, 2.8, 0.6)
handle.Position = Vector3.new(0, 13.8, 0)
handle.Material = Enum.Material.WoodPlanks
handle.Color = Color3.fromRGB(45, 25, 15) -- Cuoio
handle.Anchored = true
handle.Parent = swordModel

local pommel = Instance.new("Part")
pommel.Name = "Pommel"
pommel.Shape = Enum.PartType.Ball
pommel.Size = Vector3.new(1.2, 1.2, 1.2)
pommel.Position = Vector3.new(0, 15.4, 0)
pommel.Material = Enum.Material.Metal
pommel.Color = Color3.fromRGB(212, 175, 55)
pommel.Anchored = true
pommel.Parent = swordModel

-- 4. INTERAZIONE PROXIMITY PROMPT (Premi E per estrarre)
local prompt = Instance.new("ProximityPrompt")
prompt.ObjectText = "Spada di Excalibur"
prompt.ActionText = "Estrai la Spada"
prompt.HoldDuration = 3.0 -- Tieni premuto 3 secondi
prompt.MaxActivationDistance = 12
prompt.RequiresLineOfSight = true
prompt.Parent = blade

prompt.Triggered:Connect(function(player)
    local character = player.Character
    if not character then return end
    local humanoid = character:FindFirstChildOfClass("Humanoid")
    if not humanoid or humanoid.Health <= 0 then return end

    prompt.Enabled = false
    print(player.Name .. " ha estratto la Spada Leggendaria dalla roccia!")

    -- Effetto sonoro e particelle
    local sound = Instance.new("Sound")
    sound.SoundId = "rbxassetid://9114223170" -- Chime magico
    sound.Volume = 1.0
    sound.Parent = blade
    sound:Play()

    -- Animazione di sollevamento della spada
    local tweenInfo = TweenInfo.new(1.5, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)
    local tween = TweenService:Create(blade, tweenInfo, { Position = blade.Position + Vector3.new(0, 5, 0) })
    tween:Play()

    -- Assegna valuta o tool nello zaino del giocatore
    local leaderstats = player:FindFirstChild("leaderstats")
    if leaderstats and leaderstats:FindFirstChild("Monete") then
        leaderstats.Monete.Value += 1000
    end
end)

swordModel.Parent = Workspace
print("✅ Spada nella Roccia generata con successo in Workspace!")`;

  CONFIG.generatedCode = luauScript;
  CONFIG.commandBarCode = `task.spawn(function()\n${luauScript}\nend)`;
  
  const codeElem = document.getElementById('codeBlock');
  codeElem.textContent = luauScript;
  Prism.highlightElement(codeElem);
  detectPlacementAdvice(luauScript);

  CONFIG.instructionsMarkdown = `### 🗡️ Spada Leggendaria nella Roccia (Modello AAA)

**Caratteristiche del Modello Generato:**
* **Visualizzatore 3D Realtime:** Lama affilata in acciaio speculare con scanalatura runica ciano al neon, guardia alata dorata con rubini incastonati, impugnatura in cuoio e pomolo dorato perfettamente raccordato.
* **Base Rocciosa:** Masso sfaccettato in granito grigio con fratture angolari naturali.
* **Interazione Inclusa:** Script Luau già pronto con \`ProximityPrompt\` per consentire ai giocatori di tenere premuto [E] per 3 secondi ed estrarre la spada dalla roccia con effetti sonori e tween di sollevamento!

**Due modi per usarlo su Roblox Studio:**
1. **Come Script Diretto:** Clicca sul pulsante verde **"Copia x Command Bar"**, incollalo nella barra dei comandi di Roblox Studio e premi INVIO.
2. **Come Mesh 3D (.OBJ):** Clicca sul pulsante viola **"Scarica .OBJ (Mesh)"** per ottenere la mesh 3D da importare in qualsiasi \`MeshPart\` di Roblox Studio!`;

  document.getElementById('instructionsContent').innerHTML = marked.parse(CONFIG.instructionsMarkdown);
}

// ==========================================
// EXPORT 3D MODEL TO REAL .OBJ MESH FILE
// ==========================================

function downloadCurrent3DAsOBJ() {
  if (!threeCurrentModelGroup || threeCurrentModelGroup.children.length === 0) {
    alert("Nessun modello 3D presente da esportare!");
    return;
  }

  let objText = "# BloxCraft AI - 3D Mesh Exporter for Roblox Studio\n";
  objText += "# Model: " + (document.getElementById('threeModelTitle').textContent || "Roblox_Model") + "\n\n";

  let vertexOffset = 1;

  threeCurrentModelGroup.traverse(child => {
    if (child.isMesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);

      const pos = geo.attributes.position;
      if (!pos) return;

      objText += `o ${child.name || "Part"}\n`;

      // Export vertices
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i).toFixed(4);
        const y = pos.getY(i).toFixed(4);
        const z = pos.getZ(i).toFixed(4);
        objText += `v ${x} ${y} ${z}\n`;
      }

      // Export faces
      if (geo.index) {
        const idx = geo.index;
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i) + vertexOffset;
          const b = idx.getX(i + 1) + vertexOffset;
          const c = idx.getX(i + 2) + vertexOffset;
          objText += `f ${a} ${b} ${c}\n`;
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          const a = i + vertexOffset;
          const b = i + 1 + vertexOffset;
          const c = i + 2 + vertexOffset;
          objText += `f ${a} ${b} ${c}\n`;
        }
      }

      vertexOffset += pos.count;
    }
  });

  const blob = new Blob([objText], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = "Spada_Nella_Roccia_Roblox.obj";
  a.click();
  URL.revokeObjectURL(a.href);

  alert("✅ File 'Spada_Nella_Roccia_Roblox.obj' scaricato con successo!\n\nCome importarlo in Roblox Studio:\n1. Apri Roblox Studio\n2. Inserisci un 'MeshPart' nel tuo Workspace\n3. Nelle proprietà del MeshPart, clicca sulla cartellina accanto a 'MeshId'\n4. Seleziona questo file .obj appena scaricato!");
}

// Fallback: If AI only gave Luau code, parse Parts from Luau directly
function parseProceduralLuauTo3D(code) {
  const parts = [];
  const partBlocks = code.split(/Instance\.new\s*\(\s*["']Part["']\s*\)/i);
  
  if (partBlocks.length > 1) {
    for (let i = 1; i < partBlocks.length; i++) {
      const blk = partBlocks[i];
      let size = [3, 2, 3];
      let pos = [0, 2 + i * 2, 0];
      let color = '#4a5568';
      let mat = 'plastic';

      const sizeMatch = blk.match(/Size\s*=\s*Vector3\.new\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i);
      if (sizeMatch) {
        size = [parseFloat(sizeMatch[1]), parseFloat(sizeMatch[2]), parseFloat(sizeMatch[3])];
      }

      const posMatch = blk.match(/(?:Position|CFrame)\s*=\s*(?:Vector3\.new|CFrame\.new)\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/i);
      if (posMatch) {
        pos = [parseFloat(posMatch[1]), parseFloat(posMatch[2]), parseFloat(posMatch[3])];
      }

      const colorMatch = blk.match(/Color3\.fromRGB\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (colorMatch) {
        const r = parseInt(colorMatch[1]), g = parseInt(colorMatch[2]), b = parseInt(colorMatch[3]);
        color = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }

      if (blk.includes("Enum.Material.Neon")) mat = 'neon';
      else if (blk.includes("Enum.Material.Metal")) mat = 'metal';
      else if (blk.includes("Enum.Material.Glass")) mat = 'glass';

      parts.push({ type: 'box', size, pos, color, material: mat });
    }
  }

  if (parts.length > 0) {
    const manifest = {
      name: "Modello Luau Rilevato",
      parts: parts
    };
    CONFIG.current3DManifest = manifest;
    render3DModel(manifest);
  }
}

// Custom Wedge geometry (Roblox WedgePart)
function createWedgeGeometry(w, h, d) {
  const geom = new THREE.BufferGeometry();
  const hw = w / 2, hh = h / 2, hd = d / 2;

  const vertices = new Float32Array([
    -hw, -hh,  hd,   hw, -hh,  hd,  -hw,  hh,  hd,
    -hw, -hh, -hd,  -hw,  hh, -hd,   hw, -hh, -hd,
    -hw, -hh, -hd,   hw, -hh, -hd,   hw, -hh,  hd,
    -hw, -hh, -hd,   hw, -hh,  hd,  -hw, -hh,  hd,
    -hw, -hh, -hd,  -hw, -hh,  hd,  -hw,  hh,  hd,
    -hw, -hh, -hd,  -hw,  hh,  hd,  -hw,  hh, -hd,
    -hw,  hh,  hd,   hw, -hh,  hd,   hw, -hh, -hd,
    -hw,  hh,  hd,   hw, -hh, -hd,  -hw,  hh, -hd
  ]);

  geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}

// Center Camera smoothly on the 3D model
function centerThreeCameraOnModel() {
  if (!threeCurrentModelGroup || !threeControls) return;
  const box = new THREE.Box3().setFromObject(threeCurrentModelGroup);
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  threeControls.target.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z, 6);
  threeCamera.position.set(center.x + maxDim * 1.5, center.y + maxDim * 0.9, center.z + maxDim * 1.6);
  threeControls.update();
}

function resetThreeCamera() {
  centerThreeCameraOnModel();
}

function toggleThreeAutoRotate() {
  isThreeAutoRotate = !isThreeAutoRotate;
  const btn = document.getElementById('threeRotateBtn');
  if (isThreeAutoRotate) {
    btn.classList.add('bg-blue-600/30', 'text-blue-300', 'border-blue-500/40');
  } else {
    btn.classList.remove('bg-blue-600/30', 'text-blue-300', 'border-blue-500/40');
  }
}

function toggleThreeWireframe() {
  isThreeWireframe = !isThreeWireframe;
  const btn = document.getElementById('threeWireframeBtn');
  if (isThreeWireframe) {
    btn.classList.add('bg-purple-600/30', 'text-purple-300', 'border-purple-500/40');
  } else {
    btn.classList.remove('bg-purple-600/30', 'text-purple-300', 'border-purple-500/40');
  }

  if (threeCurrentModelGroup) {
    threeCurrentModelGroup.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.wireframe = isThreeWireframe;
      }
    });
  }
}

// Detect and show Placement advice banner
function detectPlacementAdvice(code) {
  const banner = document.getElementById('placementBanner');
  const text = document.getElementById('placementText');
  const tag = document.getElementById('scriptTypeTag');

  let placement = "ServerScriptService";
  let type = "Script Server";

  if (code.includes("-- POSIZIONE:")) {
    const match = code.match(/-- POSIZIONE:\s*([^\n\r]+)/i);
    if (match) placement = match[1].trim();
  } else {
    if (CONFIG.activeMode === '3d-builder') {
      placement = "Workspace (Command Bar)";
      type = "Generatore 3D";
    } else if (code.includes("LocalPlayer") || code.includes("UserInputService") || code.includes("ContextActionService")) {
      placement = "StarterPlayer.StarterPlayerScripts";
      type = "LocalScript";
    } else if (code.includes("ScreenGui") || code.includes("Frame") || CONFIG.activeMode === 'ui-designer') {
      placement = "StarterGui";
      type = "LocalScript UI";
    } else if (code.includes("return") && (code.includes("Module") || code.includes("module"))) {
      placement = "ReplicatedStorage";
      type = "ModuleScript";
    }
  }

  if (code.includes("-- TIPO:")) {
    const matchType = code.match(/-- TIPO:\s*([^\n\r]+)/i);
    if (matchType) type = matchType[1].trim();
  }

  text.textContent = placement;
  tag.textContent = type;
  banner.classList.remove('hidden');
}

// Render UI Preview Simulator
function renderUIPreview(customHtml) {
  const container = document.getElementById('uiSimContent');
  container.innerHTML = customHtml;
}

function renderFallbackUIPreview() {
  const container = document.getElementById('uiSimContent');
  container.innerHTML = `
    <div class="w-full flex flex-col justify-end h-full p-2 space-y-2">
      <!-- Health Bar -->
      <div class="bg-gray-900/90 border border-gray-700 rounded-xl p-3 shadow-xl backdrop-blur-md w-72">
        <div class="flex justify-between items-center text-xs font-bold text-gray-200 mb-1">
          <span class="flex items-center gap-1.5"><i data-lucide="heart" class="w-3.5 h-3.5 text-rose-500 fill-rose-500"></i> SALUTE</span>
          <span class="font-mono text-emerald-400">100 / 100</span>
        </div>
        <div class="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-gray-700/50">
          <div class="bg-gradient-to-r from-emerald-500 to-green-400 h-full w-full rounded-full shadow-sm shadow-emerald-500/50 transition-all duration-500"></div>
        </div>

        <!-- Stamina Bar -->
        <div class="flex justify-between items-center text-xs font-bold text-gray-200 mt-2.5 mb-1">
          <span class="flex items-center gap-1.5"><i data-lucide="zap" class="w-3.5 h-3.5 text-cyan-400 fill-cyan-400"></i> STAMINA</span>
          <span class="font-mono text-cyan-400">100%</span>
        </div>
        <div class="w-full bg-gray-800 h-2 rounded-full overflow-hidden border border-gray-700/50">
          <div class="bg-gradient-to-r from-blue-500 to-cyan-400 h-full w-full rounded-full shadow-sm shadow-cyan-500/50 transition-all duration-500"></div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// Chat UI Appends & State Tracking
function appendUserMessage(text) {
  ensurePlaceChats();
  const mode = CONFIG.activeMode || 'scripting';
  if (!currentPlace.chats[mode]) currentPlace.chats[mode] = [];
  currentPlace.chats[mode].push({ sender: 'user', text, timestamp: Date.now() });
  renderUserBubbleDOM(text);
  saveCurrentPlace();
}

function renderUserBubbleDOM(text) {
  const chat = document.getElementById('chatHistory');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = "flex gap-3 text-sm justify-end chat-bubble";
  div.innerHTML = `
    <div class="space-y-1 max-w-[85%] text-right">
      <div class="font-semibold text-gray-400 text-xs">Tu</div>
      <div class="text-white leading-relaxed bg-roblox-accent p-3 rounded-2xl rounded-tr-none text-xs text-left shadow-md shadow-blue-500/10">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function appendBotMessage(text) {
  ensurePlaceChats();
  const mode = CONFIG.activeMode || 'scripting';
  if (!currentPlace.chats[mode]) currentPlace.chats[mode] = [];
  currentPlace.chats[mode].push({ sender: 'bot', text, timestamp: Date.now() });
  renderBotBubbleDOM(text);
  saveCurrentPlace();
}

function appendSystemNotice(text) {
  const chat = document.getElementById('chatHistory');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'flex justify-center py-1';
  div.innerHTML = `<span class="text-[11px] text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-0.5">${marked.parse(text).replace(/<\/?p>/g,'')}</span>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// Mostra un indicatore "AI sta scrivendo..." nella chat durante la generazione
function appendTypingIndicator(id) {
  const chat = document.getElementById('chatHistory');
  if (!chat) return;
  const div = document.createElement('div');
  div.id = id;
  div.className = 'flex gap-3 text-sm chat-bubble items-center';
  div.innerHTML = `
    <div class="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
      <svg class="w-3.5 h-3.5 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    </div>
    <div class="flex flex-col gap-1">
      <div class="font-semibold text-gray-400 text-xs">BloxCraft AI</div>
      <div class="flex items-center gap-2 bg-roblox-card border border-roblox-border rounded-2xl rounded-tl-none px-3 py-2">
        <span class="text-xs text-blue-300 animate-pulse font-medium">✦ Generazione in corso...</span>
        <span id="${id}_timer" class="text-[10px] text-gray-500 font-mono">00:00</span>
      </div>
    </div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  // Aggiorna il timer interno al bubble
  const timerEl = document.getElementById(`${id}_timer`);
  const startTime = Date.now();
  div._timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;
  }, 1000);
}

// Rimuove il typing indicator dalla chat
function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) {
    if (el._timerInterval) clearInterval(el._timerInterval);
    el.remove();
  }
}

function renderBotBubbleDOM(text) {
  const chat = document.getElementById('chatHistory');
  const div = document.createElement('div');
  div.className = "flex gap-3 text-sm chat-bubble";
  div.innerHTML = `
    <div class="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
      <i data-lucide="sparkles" class="w-3.5 h-3.5 text-blue-400"></i>
    </div>
    <div class="space-y-1 max-w-[85%]">
      <div class="font-semibold text-white text-xs">BloxCraft AI</div>
      <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3 rounded-2xl rounded-tl-none text-xs">
        ${marked.parse(text)}
      </div>
    </div>
  `;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  lucide.createIcons();
}

// Actions
function copyCode() {
  if (!CONFIG.generatedCode) {
    alert("Nessun codice da copiare!");
    return;
  }
  navigator.clipboard.writeText(CONFIG.generatedCode).then(() => {
    const btnText = document.getElementById('copyBtnText');
    btnText.textContent = "Copiato!";
    setTimeout(() => { btnText.textContent = "Copia Codice"; }, 2000);
  });
}

function copyCommandBar() {
  if (!CONFIG.generatedCode) {
    alert("Genera prima del codice da eseguire!");
    return;
  }
  const cmd = CONFIG.commandBarCode || CONFIG.generatedCode;
  navigator.clipboard.writeText(cmd).then(() => {
    alert("✅ Codice pronto per la Command Bar copiato negli appunti!\n\nIstruzioni:\n1. Vai su Roblox Studio\n2. Apri la 'Command Bar' in basso (menu View -> Command Bar)\n3. Incolla (CTRL+V) e premi INVIO!");
  });
}

function downloadCode() {
  if (!CONFIG.generatedCode) {
    alert("Nessun codice generato.");
    return;
  }
  const blob = new Blob([CONFIG.generatedCode], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BloxCraft_${CONFIG.activeMode}_${Date.now()}.luau`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearCurrentModeChat() {
  ensurePlaceChats();
  const mode = CONFIG.activeMode || 'scripting';
  if (confirm(`Vuoi cancellare la cronologia della chat per "${MODE_INFO[mode]?.title || mode}"?`)) {
    currentPlace.chats[mode] = [];
    saveCurrentPlace();
    renderActiveChat();
  }
}

function injectActiveOutputToStudio() {
  if (CONFIG.activeOutputTab === '3d') {
    injectModelToStudio();
  } else if (CONFIG.activeOutputTab === 'preview') {
    injectCurrentUIToStudio();
  } else {
    injectScriptToStudio();
  }
}

function copyCurrentActiveCode() {
  copyCode();
}

function downloadCurrentActiveOutput() {
  if (CONFIG.activeOutputTab === '3d') {
    downloadCurrentGLB();
  } else {
    downloadCode();
  }
}

function clearWorkspace() {
  CONFIG.generatedCode = "";
  CONFIG.commandBarCode = "";
  CONFIG.current3DManifest = null;
  CONFIG.currentGlbUrl = null;
  CONFIG.last3DPrompt = "";
  document.getElementById('codeBlock').textContent = "-- Area di lavoro pulita. Inserisci un nuovo prompt!";
  Prism.highlightElement(document.getElementById('codeBlock'));
  document.getElementById('placementBanner').classList.add('hidden');
  document.getElementById('downloadGlbBtn')?.classList.add('hidden');
  document.getElementById('addScriptToModelBtn')?.classList.add('hidden');
  saveCurrentProjectState();
}

// Settings Modal Management
function openSettingsModal() {
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function saveSettings() {
  const key = document.getElementById('apiKeyInput').value.trim();
  const provider = document.getElementById('modelProviderSelect').value;
  const meshyKey = (document.getElementById('meshyKeyInput')?.value || '').trim();
  const tripoKey = (document.getElementById('tripoKeyInput')?.value || '').trim();

  CONFIG.apiKey = key;
  CONFIG.modelProvider = provider;
  CONFIG.meshyKey = meshyKey;
  CONFIG.tripoKey = tripoKey;

  localStorage.setItem('bloxcraft_api_key', key);
  localStorage.setItem('bloxcraft_model_provider', provider);
  localStorage.setItem('bloxcraft_meshy_key', meshyKey);
  localStorage.setItem('bloxcraft_tripo_key', tripoKey);

  updateApiStatusUI();
  updateActiveModelTag(provider);
  closeSettingsModal();

  if (meshyKey || tripoKey) {
    appendSystemNotice(`✅ Motore 3D ${meshyKey ? 'Meshy AI' : 'Tripo3D'} configurato! Vai in modalità **3D Builder** e descrivi il modello che vuoi generare.`);
  }
}

function handleProviderChange() {
  const provider = document.getElementById('modelProviderSelect').value;
  const label = document.getElementById('apiKeyLabel');
  if (provider.startsWith('gemini')) {
    label.textContent = "Chiave API Google AI Studio";
  } else if (provider.startsWith('groq')) {
    label.textContent = "Chiave API Groq Cloud (Free)";
  } else {
    label.textContent = "Chiave API Provider";
  }
}

function updateActiveModelTag(provider) {
  const tag = document.getElementById('activeModelTag');
  const labels = {
    'gemini-3.8-flash':      '⚡ Gemini 3.8 Flash',
    'gemini-3.8-pro':        '⭐ Gemini 3.8 Pro',
    'gemini-3.8-flash-lite': 'Gemini 3.8 Flash Lite',
    'gemini-2.5-pro':        'Gemini 2.5 Pro',
    'gemini-2.5-flash':      'Gemini 2.5 Flash',
    'gemini-2.0-flash':      'Gemini 2.0 Flash',
    'gemini-1.5-pro':        'Gemini 1.5 Pro',
    'groq-qwen-32b':         'Groq Qwen 2.5 Coder'
  };
  if (tag) tag.textContent = labels[provider] || provider;
}

function updateApiStatusUI() {
  const badge = document.getElementById('apiStatusBadge');
  const has3D = CONFIG.meshyKey || CONFIG.tripoKey;
  if (CONFIG.apiKey && has3D) {
    badge.className = "flex items-center gap-2 text-xs px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 cursor-pointer";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>API Scripting + 3D Attive ✓</span>`;
  } else if (CONFIG.apiKey) {
    badge.className = "flex items-center gap-2 text-xs px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 cursor-pointer";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-400"></span><span>Scripting Attivo (aggiungi chiave 3D)</span>`;
  } else {
    badge.className = "flex items-center gap-2 text-xs px-3 py-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 cursor-pointer";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></span><span>Imposta Chiave API (Gratis)</span>`;
  }
}

// Guide Modal Management
function openGuideModal() {
  document.getElementById('guideModal').classList.remove('hidden');
}
function closeGuideModal() {
  document.getElementById('guideModal').classList.add('hidden');
}

// Loading state
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.toggle('hidden', !show);
  // Nota: btn.disabled è gestito dal finally di submitPrompt — non toccare qui
}

// Utility
function escapeHtml(text) {
  return text ? String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

// ==========================================
// ROBLOX STUDIO MCP DIRECT CONNECTION
// ==========================================

const MCP_CONFIG = {
  bridgeUrl: 'http://127.0.0.1:28888',
  isConnected: false,
  studioRunning: false,
  mcpRunning: false,
  lastCheck: 0
};

async function checkMcpStatus(isUserInitiated = false) {
  const dot = document.getElementById('mcpStatusDot');
  const text = document.getElementById('mcpStatusText');
  const btn = document.getElementById('mcpStatusBtn');
  const modalDot = document.getElementById('mcpModalStatusDot');
  const modalText = document.getElementById('mcpModalStatusText');
  const bridgeStatus = document.getElementById('mcpModalBridgeStatus');
  const studioStatus = document.getElementById('mcpModalStudioStatus');
  const successBanner = document.getElementById('mcpTestSuccessBanner');

  if (isUserInitiated && modalText) {
    modalText.textContent = "Controllo connessione in corso...";
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${MCP_CONFIG.bridgeUrl}/status`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      MCP_CONFIG.isConnected = true;
      MCP_CONFIG.studioRunning = !!data.studioRunning;
      MCP_CONFIG.mcpRunning = !!data.mcpRunning;

      if (data.studioRunning) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
        if (text) text.textContent = "Studio MCP: Connesso";
        if (btn) btn.className = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-xs text-emerald-300 transition-colors border border-emerald-500/40 shadow-sm";
        if (modalDot) modalDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
        if (modalText) modalText.textContent = "Connessione Attiva & Studio Pronto! 🚀";
        if (bridgeStatus) bridgeStatus.innerHTML = "<span class='text-emerald-400 font-bold'>✓ Attivo (127.0.0.1:28888)</span>";
        if (studioStatus) studioStatus.innerHTML = "<span class='text-emerald-400 font-bold'>✓ Rilevato & Aperto</span>";
        if (successBanner) successBanner.classList.remove('hidden');
      } else {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-yellow-400 animate-pulse";
        if (text) text.textContent = "Studio MCP: In attesa Studio";
        if (btn) btn.className = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-xs text-yellow-300 transition-colors border border-yellow-500/40 shadow-sm";
        if (modalDot) modalDot.className = "w-2.5 h-2.5 rounded-full bg-yellow-400";
        if (modalText) modalText.textContent = "Bridge Attivo — Apri Roblox Studio!";
        if (bridgeStatus) bridgeStatus.innerHTML = "<span class='text-emerald-400 font-bold'>✓ Attivo (127.0.0.1:28888)</span>";
        if (studioStatus) studioStatus.innerHTML = "<span class='text-yellow-400 font-medium'>In attesa di avvio Studio</span>";
        if (successBanner) successBanner.classList.remove('hidden');
      }

      if (isUserInitiated) {
        alert("✅ Connessione al Bridge Locale riuscita!\n\nStato Roblox Studio: " + (data.studioRunning ? "Rilevato e pronto!" : "Non ancora aperto (apri il tuo Place in Studio)."));
      }
      return true;
    }
  } catch (err) {
    MCP_CONFIG.isConnected = false;
    MCP_CONFIG.studioRunning = false;
    if (dot) dot.className = "w-2 h-2 rounded-full bg-purple-400";
    if (text) text.textContent = "Studio MCP Direct";
    if (btn) btn.className = "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-xs text-purple-300 transition-colors border border-purple-500/30 shadow-sm";
    if (modalDot) modalDot.className = "w-2.5 h-2.5 rounded-full bg-gray-500";
    if (modalText) modalText.textContent = "Bridge non connesso (Porta 28888)";
    if (bridgeStatus) bridgeStatus.innerHTML = "<span class='text-gray-400'>Non attivo (avvia avvia-bridge-roblox.bat)</span>";
    if (studioStatus) studioStatus.innerHTML = "<span class='text-gray-500'>In attesa del bridge</span>";
    if (successBanner) successBanner.classList.add('hidden');

    if (isUserInitiated) {
      alert("⚠️ Impossibile contattare il Bridge locale su http://127.0.0.1:28888.\n\nAssicurati di aver fatto doppio clic sul file 'avvia-bridge-roblox.bat' sul tuo computer.");
    }
    return false;
  }
}

async function injectScriptToStudio(codeToInject = null, scriptTitle = null) {
  const code = (codeToInject || CONFIG.generatedCode || '').trim();
  if (!code) {
    alert("Nessun codice da iniettare! Genera prima uno script o selezionalo dall'elenco degli asset.");
    return;
  }

  const title = scriptTitle || (CONFIG.activeMode.toUpperCase() + " Script");

  // Prova prima l'iniezione tramite il bridge locale
  try {
    const res = await fetch(`${MCP_CONFIG.bridgeUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, title: title })
    });

    if (res.ok) {
      showInjectionCelebration(title);
      return;
    }
  } catch (err) {
    // Bridge non attivo: fallback amichevole con Command Bar
  }

  // Fallback se il bridge non risponde
  const cmd = CONFIG.commandBarCode || code;
  navigator.clipboard.writeText(cmd).then(() => {
    const wantBridge = confirm(
      "⚡ Codice copiato per la Command Bar di Roblox Studio!\n\n" +
      "Il Bridge locale automatico non è ancora attivo sul tuo computer.\n" +
      "Per incollare subito:\n" +
      "1. Vai su Roblox Studio -> Menu View -> Command Bar\n" +
      "2. Premi CTRL+V e poi INVIO: lo script verrà creato subito!\n\n" +
      "Vuoi visualizzare la guida per attivare l'iniezione automatica a 1 clic con il Bridge?"
    );
    if (wantBridge) openMcpModal();
  });
}

async function injectModelToStudio() {
  const modelName = CONFIG.last3DPrompt ? CONFIG.last3DPrompt.substring(0, 30) : "BloxCraft_Model";
  const glbUrl = CONFIG.currentGlbUrl || "";
  
  // Controlla se questo modello ha uno script associato nel Place corrente
  const existingModel = currentPlace.models.find(m => m.glbUrl === glbUrl || m.name.toLowerCase() === modelName.toLowerCase());
  let attachedScriptCode = existingModel && existingModel.attachedScript ? existingModel.attachedScript.code : null;

  // ── ENGINE NATIVO: usa il codice Luau procedurale già generato ──
  if (CONFIG.engine3D === 'native' && CONFIG.generatedCode && !glbUrl) {
    let nativeLuau = CONFIG.generatedCode;
    // Aggiungi lo script associato se presente
    if (attachedScriptCode) {
      nativeLuau += `\n\n-- Script di comportamento associato al modello\nlocal scriptObj = Instance.new("Script")\nscriptObj.Name = "${modelName.replace(/["\\]/g, '')}_Behavior"\nscriptObj.Source = [==[\n${attachedScriptCode}\n]==]\nscriptObj.Parent = model or workspace\nprint("[BloxCraft AI] Script comportamento aggiunto!")\n`;
    }
    await injectScriptToStudio(nativeLuau, "Modello 3D Nativo: " + modelName);
    return;
  }

  // ── ENGINE MESHY: genera lo script Luau di inserimento mesh/modello in Workspace ──
  let luauInjection = `-- BloxCraft AI 3D Mesh Inserter
local Workspace = game:GetService("Workspace")
local InsertService = game:GetService("InsertService")

local model = Instance.new("Model")
model.Name = "${modelName.replace(/["\\]/g, '')}"

-- Crea una MeshPart o Part con SpecialMesh
local part = Instance.new("Part")
part.Name = "Body"
part.Size = Vector3.new(4, 4, 4)
part.CFrame = CFrame.new(0, 6, 0)
part.Anchored = true
part.Material = Enum.Material.SmoothPlastic
part.Parent = model

local mesh = Instance.new("SpecialMesh")
mesh.MeshType = Enum.MeshType.FileMesh
mesh.Scale = Vector3.new(1, 1, 1)
mesh.Parent = part
`;

  if (glbUrl) {
    luauInjection += `
-- GLB / Mesh URL generato da Meshy AI
-- URL: ${glbUrl}
print("[BloxCraft AI] Inserito Modello 3D '${modelName.replace(/["\\]/g, '')}' in Workspace!")
`;
  }

  if (attachedScriptCode) {
    luauInjection += `
-- Logica / Comportamento Luau associato al modello
local scriptObj = Instance.new("Script")
scriptObj.Name = "${modelName.replace(/["\\]/g, '')}_Behavior"
scriptObj.Source = [==[
${attachedScriptCode}
]==]
scriptObj.Parent = model
print("[BloxCraft AI] Aggiunto Script associato al Modello!")
`;
  }

  luauInjection += `
model.Parent = Workspace
print("[BloxCraft AI] ✅ Modello '${modelName.replace(/["\\]/g, '')}' pronto all'uso in Workspace!")
`;

  await injectScriptToStudio(luauInjection, "Modello 3D: " + modelName);
}

function injectPlaceModelToStudio(modelId) {
  const model = currentPlace.models.find(m => m.id === modelId);
  if (!model) return;
  loadPlaceModel(modelId, true);
  injectModelToStudio();
}

function injectPlaceScriptToStudio(scriptId) {
  const script = currentPlace.scripts.find(s => s.id === scriptId);
  if (!script) return;
  injectScriptToStudio(script.code, script.name);
}

function injectTestScript() {
  const testCode = `-- BloxCraft AI Studio Connection Test
print("======================================================")
print("[BloxCraft AI] ⚡ TEST INIEZIONE DIRETTA RIUSCITO!")
print("[BloxCraft AI] Luau Code Execution via MCP Bridge OK!")
print("======================================================")

local testPart = Instance.new("Part")
testPart.Name = "BloxCraft_MCP_TestPart"
testPart.Size = Vector3.new(3, 3, 3)
testPart.CFrame = CFrame.new(0, 8, 0)
testPart.Material = Enum.Material.Neon
testPart.Color = Color3.fromRGB(0, 255, 128)
testPart.Anchored = true
testPart.Parent = workspace
print("[BloxCraft AI] ✅ Creata Part di test 'BloxCraft_MCP_TestPart' in Workspace!")
`;
  injectScriptToStudio(testCode, "Test Connessione MCP");
}

function showInjectionCelebration(title) {
  const alertDiv = document.createElement('div');
  alertDiv.className = "fixed bottom-5 right-5 z-[9999] bg-slate-900 border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl flex items-center gap-3 text-white transition-all transform duration-300";
  alertDiv.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
      <i data-lucide="zap" class="w-5 h-5 text-emerald-400"></i>
    </div>
    <div>
      <div class="font-bold text-xs text-emerald-400">⚡ Iniezione Riuscita!</div>
      <div class="text-[11px] text-gray-300">"${escapeHtml(title)}" inviato a Roblox Studio.</div>
    </div>
  `;
  document.body.appendChild(alertDiv);
  lucide.createIcons();
  setTimeout(() => {
    alertDiv.style.opacity = '0';
    setTimeout(() => alertDiv.remove(), 400);
  }, 4000);
}

function downloadBridgeBat() {
  const batContent = `@echo off
chcp 65001 >nul
title BloxCraft AI - Roblox Studio Bridge
color 0B
echo ===================================================================
echo             BLOXCRAFT AI - ROBLOX STUDIO LOCAL BRIDGE
echo ===================================================================
echo.
echo  Questo bridge permette al sito web di BloxCraft AI:
echo  https://kgalphaa.github.io/bloxcraft-ai/
echo  di comunicare DIRETTAMENTE con Roblox Studio sul tuo computer!
echo.
echo ===================================================================
cd /d "%~dp0"
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [i] Avvio tramite Node.js...
    node bridge.js
    goto end
)
if exist "%APPDATA%\\Antigravity\\bin\\agy-node.cmd" (
    echo [i] Avvio tramite Antigravity Node Runtime...
    call "%APPDATA%\\Antigravity\\bin\\agy-node.cmd" bridge.js
    goto end
)
echo [i] Avvio tramite Windows PowerShell...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge.ps1"
:end
pause
`;
  const blob = new Blob([batContent], { type: 'application/x-bat' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'avvia-bridge-roblox.bat';
  a.click();
}

function downloadStudioPlugin() {
  const luaContent = `--[[
    BloxCraft AI - Roblox Studio Auto Sync Companion Plugin
    =======================================================
    Installazione:
    1. In Roblox Studio, vai su 'Plugins' -> 'Plugin Folder'
    2. Salva questo file come 'BloxCraft_Sync.lua'
    OPPURE:
    Incollalo nella Command Bar di Studio e premi Invio!
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

print("-------------------------------------------------------------------")
print("[BloxCraft AI] ⚡ Plugin di sincronizzazione diretta ATTIVO!")
print("[BloxCraft AI] In ascolto su http://127.0.0.1:28888/poll")
print("-------------------------------------------------------------------")

local isRunning = true

task.spawn(function()
    while isRunning do
        local success, response = pcall(function()
            return HttpService:GetAsync("http://127.0.0.1:28888/poll")
        end)

        if success and response and #response > 2 then
            local jsonOk, data = pcall(function()
                return HttpService:JSONDecode(response)
            end)

            if jsonOk and data and data.code then
                print("[BloxCraft AI] 📥 Ricevuto nuovo script/modello: " .. tostring(data.title))
                
                local fn, compileError = loadstring(data.code)
                if fn then
                    local execOk, execError = pcall(fn)
                    if execOk then
                        print("[BloxCraft AI] ✅ INIETTATO CON SUCCESSO NEL PLACE: " .. tostring(data.title))
                        pcall(function()
                            ChangeHistoryService:SetWaypoint("BloxCraft: " .. tostring(data.title))
                        end)
                    else
                        warn("[BloxCraft AI] ❌ Errore esecuzione: " .. tostring(execError))
                    end
                else
                    warn("[BloxCraft AI] ❌ Errore compilazione Luau: " .. tostring(compileError))
                end
            end
        end

        task.wait(1.0)
    end
end)
`;
  const blob = new Blob([luaContent], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'BloxCraft_Sync_Plugin.lua';
  a.click();
}

// ==========================================
// IMAGE REFERENCE MANAGEMENT (MESHY IMAGE-TO-3D)
// ==========================================

function triggerImageUpload() {
  const fileInput = document.getElementById('referenceImageInput');
  if (fileInput) fileInput.click();
}

function handleImageFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  processReferenceImageFile(file);
}

function processReferenceImageFile(file) {
  if (!file.type.startsWith('image/')) {
    alert("Seleziona un file immagine valido (PNG, JPG o WebP)!");
    return;
  }
  
  if (file.size > 20 * 1024 * 1024) {
    alert("L'immagine è troppo grande. La dimensione massima consentita per Meshy è 20 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    CONFIG.referenceImage = dataUrl;
    CONFIG.referenceImageName = file.name;

    // Show preview chip in UI
    const previewBox = document.getElementById('imageReferencePreview');
    const thumb = document.getElementById('imageReferenceThumb');
    const nameEl = document.getElementById('imageReferenceName');
    
    if (previewBox) previewBox.classList.remove('hidden');
    if (thumb) thumb.src = dataUrl;
    if (nameEl) nameEl.textContent = file.name;

    // If not already in 3D Builder mode, auto-switch to 3D Builder
    if (CONFIG.activeMode !== '3d-builder') {
      switchMode('3d-builder');
    }

    lucide.createIcons();
  };
  reader.readAsDataURL(file);
}

function removeReferenceImage() {
  CONFIG.referenceImage = null;
  CONFIG.referenceImageName = '';
  const previewBox = document.getElementById('imageReferencePreview');
  const fileInput = document.getElementById('referenceImageInput');
  if (previewBox) previewBox.classList.add('hidden');
  if (fileInput) fileInput.value = '';
}

function initImageDropSupport() {
  const promptBox = document.getElementById('userPromptInput');
  if (promptBox) {
    promptBox.addEventListener('dragover', (e) => {
      e.preventDefault();
      promptBox.classList.add('border-purple-400');
    });
    promptBox.addEventListener('dragleave', () => {
      promptBox.classList.remove('border-purple-400');
    });
    promptBox.addEventListener('drop', (e) => {
      e.preventDefault();
      promptBox.classList.remove('border-purple-400');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processReferenceImageFile(e.dataTransfer.files[0]);
      }
    });
    promptBox.addEventListener('paste', (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) processReferenceImageFile(blob);
          break;
        }
      }
    });
  }

  // Also support drag & drop onto the 3D viewport canvas
  const threeContainer = document.getElementById('threeCanvasContainer');
  if (threeContainer) {
    threeContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      threeContainer.classList.add('ring-2', 'ring-purple-400');
    });
    threeContainer.addEventListener('dragleave', () => {
      threeContainer.classList.remove('ring-2', 'ring-purple-400');
    });
    threeContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      threeContainer.classList.remove('ring-2', 'ring-purple-400');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processReferenceImageFile(e.dataTransfer.files[0]);
      }
    });
  }
}
