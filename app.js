// BloxCraft AI - Dedicated Roblox Assistant Core Engine

// Migration to Gemini 3.8
let savedProvider = localStorage.getItem('bloxcraft_model_provider');
if (!savedProvider || savedProvider.includes('2.0') || savedProvider.includes('1.5')) {
  savedProvider = 'gemini-3.8-flash';
  localStorage.setItem('bloxcraft_model_provider', 'gemini-3.8-flash');
}

const CONFIG = {
  activeMode: 'scripting',
  activeOutputTab: 'code',
  apiKey: localStorage.getItem('bloxcraft_api_key') || '',
  meshyKey: localStorage.getItem('bloxcraft_meshy_key') || '',
  tripoKey: localStorage.getItem('bloxcraft_tripo_key') || '',
  modelProvider: savedProvider,
  generatedCode: '',
  commandBarCode: '',
  instructionsMarkdown: '',
  current3DManifest: null,
  currentGlbUrl: null,        // URL of last GLB loaded from Meshy/Tripo
  currentGlbBlob: null,       // Blob for download
  chatMessages: [],
  currentProjectId: localStorage.getItem('bloxcraft_current_project_id') || 'project_default'
};

// Network & Timer variables
let activeAbortController = null;
let loadingTimerInterval = null;
let loadingStartTime = 0;

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

  '3d-builder': `Sei BloxCraft 3D Builder per Roblox Studio.
Il tuo compito è scrivere codice Luau che costruisce il modello 3D descritto programmaticamente in Roblox Studio.

Linee guida:
1. Crea un Model in Workspace con tutte le Parts raggruppate e PrimaryPart assegnata.
2. Usa materiali Roblox realistici: Enum.Material.SmoothPlastic, Metal, Wood, Slate, Marble, Neon, Glass ecc.
3. Usa colori Color3.fromRGB() realistici.
4. Âncora tutte le parti (Anchored = true) e imposta dimensioni proporzionate (usa le studs Roblox).
5. Aggiungi commenti in italiano per ogni sezione del modello.
6. Fornisci solo il blocco di codice lua senza lunghe spiegazioni.`,

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
    desc: 'Crea logiche server, client, moduli e networking',
    placeholder: "Descrivi cosa vuoi creare (es. 'Crea un sistema di spade con combo di 3 colpi, hitbox con Raycast e animazione')..."
  },
  '3d-builder': {
    title: '3D Builder — Meshy AI',
    icon: 'cuboid',
    color: 'text-emerald-400',
    desc: 'Genera mesh 3D GLB reali con Meshy AI + Script Luau per Roblox Studio',
    placeholder: "Descrivi il modello 3D da generare (es. 'Una spada medievale in acciaio blu con incisioni runiche', 'Un castello medievale con torri e mura', 'Un dragone stilizzato')..."
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
    // Load previously saved project / state
    restoreCurrentProjectState();
  }, 100);
});

// ==========================================
// PROJECT STATE & LOCALSTORAGE PERSISTENCE
// ==========================================

function saveCurrentProjectState() {
  const projectData = {
    id: CONFIG.currentProjectId,
    name: getProjectAutoName(),
    mode: CONFIG.activeMode,
    chatMessages: CONFIG.chatMessages,
    generatedCode: CONFIG.generatedCode,
    current3DManifest: CONFIG.current3DManifest,
    instructionsMarkdown: CONFIG.instructionsMarkdown,
    updatedAt: Date.now()
  };

  localStorage.setItem(`bloxcraft_proj_${CONFIG.currentProjectId}`, JSON.stringify(projectData));
  localStorage.setItem('bloxcraft_current_project_id', CONFIG.currentProjectId);

  // Update projects index
  let projectsList = getSavedProjectsIndex();
  const existingIdx = projectsList.findIndex(p => p.id === CONFIG.currentProjectId);
  if (existingIdx >= 0) {
    projectsList[existingIdx] = { id: projectData.id, name: projectData.name, updatedAt: projectData.updatedAt };
  } else {
    projectsList.unshift({ id: projectData.id, name: projectData.name, updatedAt: projectData.updatedAt });
  }
  localStorage.setItem('bloxcraft_projects_index', JSON.stringify(projectsList.slice(0, 30)));
}

function restoreCurrentProjectState() {
  const currentId = localStorage.getItem('bloxcraft_current_project_id') || 'project_default';
  CONFIG.currentProjectId = currentId;

  const raw = localStorage.getItem(`bloxcraft_proj_${currentId}`);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    CONFIG.activeMode = data.mode || 'scripting';
    CONFIG.generatedCode = data.generatedCode || '';
    CONFIG.current3DManifest = data.current3DManifest || null;
    CONFIG.instructionsMarkdown = data.instructionsMarkdown || '';
    CONFIG.chatMessages = data.chatMessages || [];

    // Switch mode
    switchMode(CONFIG.activeMode);

    // Replay chat messages in DOM
    const chatContainer = document.getElementById('chatHistory');
    chatContainer.innerHTML = '';
    
    // Add initial welcome if empty
    if (CONFIG.chatMessages.length === 0) {
      addInitialWelcomeBubble();
    } else {
      CONFIG.chatMessages.forEach(msg => {
        if (msg.sender === 'user') renderUserBubbleDOM(msg.text);
        else renderBotBubbleDOM(msg.text);
      });
    }

    // Restore Code
    if (CONFIG.generatedCode) {
      CONFIG.commandBarCode = `task.spawn(function()\n${CONFIG.generatedCode}\nend)`;
      const codeElem = document.getElementById('codeBlock');
      codeElem.textContent = CONFIG.generatedCode;
      Prism.highlightElement(codeElem);
      detectPlacementAdvice(CONFIG.generatedCode);
    }

    // Restore 3D Model
    if (CONFIG.current3DManifest) {
      render3DModel(CONFIG.current3DManifest);
    }

    // Restore Instructions
    if (CONFIG.instructionsMarkdown) {
      document.getElementById('instructionsContent').innerHTML = marked.parse(CONFIG.instructionsMarkdown);
    }

  } catch (err) {
    console.error("Errore ripristino stato salvato:", err);
  }
}

function getSavedProjectsIndex() {
  try {
    return JSON.parse(localStorage.getItem('bloxcraft_projects_index')) || [];
  } catch {
    return [];
  }
}

function getProjectAutoName() {
  if (CONFIG.current3DManifest && CONFIG.current3DManifest.name) {
    return CONFIG.current3DManifest.name;
  }
  const firstUserMsg = CONFIG.chatMessages.find(m => m.sender === 'user');
  if (firstUserMsg) {
    return firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '');
  }
  return "Nuovo Progetto";
}

function createNewProject() {
  CONFIG.currentProjectId = 'proj_' + Date.now();
  CONFIG.generatedCode = '';
  CONFIG.commandBarCode = '';
  CONFIG.current3DManifest = null;
  CONFIG.instructionsMarkdown = '';
  CONFIG.chatMessages = [];

  localStorage.setItem('bloxcraft_current_project_id', CONFIG.currentProjectId);

  // Clear UI
  const chatContainer = document.getElementById('chatHistory');
  chatContainer.innerHTML = '';
  addInitialWelcomeBubble();

  clearWorkspace();
  
  if (threeCurrentModelGroup) {
    while (threeCurrentModelGroup.children.length > 0) {
      threeCurrentModelGroup.remove(threeCurrentModelGroup.children[0]);
    }
  }
  document.getElementById('threePlaceholder').classList.remove('hidden');
  document.getElementById('threeModelTitle').textContent = "Roblox 3D Studio Engine";
  document.getElementById('threePartCount').textContent = "0 Parti";

  closeProjectsModal();
}

function openProjectsModal() {
  const container = document.getElementById('projectsListContainer');
  const projects = getSavedProjectsIndex();

  if (projects.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500 text-xs">
        <i data-lucide="folder-open" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
        Nessun progetto salvato ancora. Ogni volta che generi qualcosa, viene salvato automaticamente qui!
      </div>
    `;
  } else {
    container.innerHTML = projects.map(p => `
      <div class="p-3 rounded-xl bg-roblox-card border border-roblox-border flex items-center justify-between hover:border-roblox-accent/50 transition">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <i data-lucide="cuboid" class="w-4 h-4 text-blue-400"></i>
          </div>
          <div>
            <h4 class="font-bold text-white text-xs">${escapeHtml(p.name)}</h4>
            <span class="text-[10px] text-gray-500">${new Date(p.updatedAt).toLocaleDateString()} ${new Date(p.updatedAt).toLocaleTimeString()}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="loadProject('${p.id}')" class="px-3 py-1 rounded-lg bg-roblox-accent hover:bg-roblox-accentHover text-white text-xs font-semibold shadow-sm transition">
            Apri
          </button>
          <button onclick="deleteProject('${p.id}')" class="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  lucide.createIcons();
  document.getElementById('projectsModal').classList.remove('hidden');
}

function closeProjectsModal() {
  document.getElementById('projectsModal').classList.add('hidden');
}

function loadProject(projectId) {
  CONFIG.currentProjectId = projectId;
  localStorage.setItem('bloxcraft_current_project_id', projectId);
  restoreCurrentProjectState();
  closeProjectsModal();
}

function deleteProject(projectId) {
  localStorage.removeItem(`bloxcraft_proj_${projectId}`);
  let projectsList = getSavedProjectsIndex().filter(p => p.id !== projectId);
  localStorage.setItem('bloxcraft_projects_index', JSON.stringify(projectsList));
  openProjectsModal();
}

function addInitialWelcomeBubble() {
  const chat = document.getElementById('chatHistory');
  chat.innerHTML = `
    <div class="flex gap-3 text-sm">
      <div class="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
        <i data-lucide="sparkles" class="w-3.5 h-3.5 text-blue-400"></i>
      </div>
      <div class="space-y-1">
        <div class="font-semibold text-white text-xs">BloxCraft AI</div>
        <div class="text-gray-300 leading-relaxed bg-roblox-card border border-roblox-border p-3 rounded-2xl rounded-tl-none text-xs">
          Ciao! Sono il tuo assistente dedicato per Roblox. Cosa vuoi creare oggi?
          <ul class="list-disc list-inside mt-2 space-y-1 text-gray-400">
            <li><strong class="text-blue-400">Luau Scripting</strong> — Script server, client, DataStore, sistemi di gioco</li>
            <li><strong class="text-emerald-400">3D Builder (Meshy AI)</strong> — Mesh 3D GLB reali + Script Luau per Studio</li>
            <li><strong class="text-purple-400">GUI Designer</strong> — Interfacce HUD con visual preview live</li>
            <li><strong class="text-rose-400">Debugger</strong> — Correzione errori della console Roblox</li>
          </ul>
          <p class="mt-2 text-yellow-300/80 text-[11px]">⚙️ Per il motore 3D reale, configura la tua chiave <strong>Meshy AI</strong> gratuita in "Impostazioni API".</p>
        </div>
      </div>
    </div>
  `;
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
  const input = document.getElementById('userPromptInput');
  const prompt = input.value.trim();
  if (!prompt) return;

  if (!CONFIG.apiKey && CONFIG.activeMode !== '3d-builder') {
    openSettingsModal();
    alert("Inserisci la tua chiave API Google Gemini nelle impostazioni per procedere.");
    return;
  }

  appendUserMessage(prompt);
  input.value = '';

  if (CONFIG.activeMode === '3d-builder') {
    await handle3DBuilderPrompt(prompt);
  } else {
    showLoading(true);
    startLoadingTimer();

    activeAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
      if (activeAbortController) activeAbortController.abort();
    }, 150000);

    try {
      const responseText = await callCloudAI(prompt, CONFIG.activeMode, activeAbortController.signal);
      clearTimeout(timeoutId);
      processAIResponse(responseText);
    } catch (err) {
      clearTimeout(timeoutId);
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
}

async function handle3DBuilderPrompt(userPrompt) {
  const has3DKey = CONFIG.meshyKey || CONFIG.tripoKey;
  
  // Step 1: Generate Luau script with Gemini (if we have the key)
  if (CONFIG.apiKey) {
    showLoading(true);
    document.getElementById('loadingText').textContent = 'Generazione Script Luau con Gemini...';
    document.getElementById('loadingSubText').textContent = 'Creazione del codice Roblox Studio per questo modello...';
    startLoadingTimer();
    
    activeAbortController = new AbortController();
    const luauSystemPrompt = `Sei BloxCraft Script Architect. Per il modello 3D descritto dall'utente, scrivi SOLO il codice Luau completo per Roblox Studio che costruisce questo modello in Workspace usando Parts raggruppate in un Model. Usa i materiali corretti di Roblox (Enum.Material.SmoothPlastic, Metal, Wood, Slate, Neon etc.) e colori realistici. Non includere spiegazioni lunghe - dai solo il blocco codice lua con un breve commento di introduzione. L'utente vedrà il modello 3D reale generato da Meshy AI separatamente.`;
    
    try {
      const luauUrl = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.modelProvider.startsWith('gemini') ? CONFIG.modelProvider : 'gemini-3.8-flash'}:generateContent?key=${CONFIG.apiKey}`;
      const luauPayload = {
        contents: [{ role: "user", parts: [{ text: `Crea il codice Luau per: ${userPrompt}` }] }],
        systemInstruction: { parts: [{ text: luauSystemPrompt }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
      };
      
      const res = await fetch(luauUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(luauPayload),
        signal: activeAbortController.signal
      });
      
      if (res.ok) {
        const data = await res.json();
        const luauText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const luaRegex = /```(?:lua|luau)\n([\s\S]*?)```/i;
        const luaMatch = luauText.match(luaRegex);
        const luaCode = luaMatch ? luaMatch[1].trim() : luauText.trim();
        
        if (luaCode) {
          CONFIG.generatedCode = luaCode;
          CONFIG.commandBarCode = `task.spawn(function()\n${luaCode}\nend)`;
          const codeElem = document.getElementById('codeBlock');
          codeElem.textContent = luaCode;
          Prism.highlightElement(codeElem);
          detectPlacementAdvice(luaCode);
        }
      }
    } catch(e) {
      console.warn('Luau generation failed:', e);
    } finally {
      stopLoadingTimer();
      showLoading(false);
      activeAbortController = null;
    }
  }
  
  // Step 2: Generate real 3D mesh with Meshy AI or Tripo3D
  if (!has3DKey) {
    // No 3D key: show helpful message
    appendBotMessage(`🎯 **Script Luau generato!** Trovi il codice nella scheda "Codice Luau".\n\n⚠️ **Per il modello 3D reale**: Configura la tua chiave **Meshy AI** (gratuita) nelle Impostazioni API per generare mesh 3D GLB reali del tuo modello da importare in Roblox Studio!\n\n📌 Vai su [app.meshy.ai](https://app.meshy.ai) → crea account gratuito → copia la tua API key → incollala nelle ⚙️ Impostazioni.`);
    switchOutputTab('code');
    saveCurrentProjectState();
    return;
  }
  
  appendBotMessage(`🎨 **Avvio generazione mesh 3D reale...** Sto inviando il prompt a ${CONFIG.meshyKey ? 'Meshy AI' : 'Tripo3D'} per creare un modello GLB professionale. Questo richiede 1-3 minuti. Puoi vedere il progresso nel viewport 3D.`);
  switchOutputTab('3d');
  
  if (CONFIG.meshyKey) {
    await generateMeshyModel(userPrompt);
  } else {
    await generateTripoModel(userPrompt);
  }
}

async function generateMeshyModel(prompt) {
  showMeshyStatus(true, 'Invio richiesta a Meshy AI...');
  setMeshyStep(1);
  
  try {
    // Step 1: Create preview task
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
      // Try Tripo fallback
      if (CONFIG.tripoKey) {
        showMeshyStatus(true, 'Meshy non disponibile, passo a Tripo3D...');
        await generateTripoModel(prompt);
        return;
      }
      throw new Error(errData.message || `Errore Meshy ${createRes.status}: ${createRes.statusText}`);
    }
    
    const createData = await createRes.json();
    const taskId = createData.result;
    
    if (!taskId) throw new Error('Meshy non ha restituito un task ID valido.');
    
    showMeshyStatus(true, 'Generazione geometria in corso...');
    setMeshyStep(1, 'active');
    
    // Step 2: Poll until SUCCEEDED
    startMeshyTimer();
    const glbUrl = await pollMeshyTask(taskId, 'preview');
    
    if (!glbUrl) throw new Error('Meshy non ha restituito un URL GLB valido.');
    
    setMeshyStep(2, 'active');
    showMeshyStatus(true, 'Caricamento del modello GLB nel viewer...');
    
    // Step 3: Load GLB into Three.js
    await loadGLBFromUrl(glbUrl);
    
    setMeshyStep(3, 'done');
    showMeshyStatus(false);
    stopMeshyTimer();
    
    appendBotMessage(`✅ **Modello 3D GLB generato con Meshy AI!**\n\nPuoi:\n- 🔄 Ruotarlo a 360° con il mouse nel viewport\n- ⬇️ Scaricarlo come **.GLB** con il pulsante verde per importarlo come **MeshPart** in Roblox Studio\n- 📄 Usare lo **Script Luau** nella scheda Codice per ricreare il modello programmaticamente`);
    saveCurrentProjectState();
    
  } catch(err) {
    stopMeshyTimer();
    showMeshyStatus(false);
    console.error('Meshy error:', err);
    
    if (CONFIG.tripoKey) {
      appendBotMessage(`⚠️ Meshy AI non disponibile (${err.message}). Passo a Tripo3D come backup...`);
      await generateTripoModel(prompt);
    } else {
      appendBotMessage(`❌ **Errore Meshy AI**: ${err.message}\n\nVerifica che la tua chiave Meshy sia valida su [app.meshy.ai](https://app.meshy.ai) e che tu abbia crediti disponibili.`);
    }
  }
}

async function pollMeshyTask(taskId, mode) {
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
        const pollRes = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
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
    appendBotMessage(`❌ **Errore Tripo3D**: ${err.message}\n\nVerifica la chiave API su [platform.tripo3d.ai](https://platform.tripo3d.ai).`);
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

async function loadGLBFromUrl(glbUrl) {
  return new Promise((resolve, reject) => {
    if (!threeScene || !threeCurrentModelGroup) initThreeEngine();
    
    // Clear old model
    while (threeCurrentModelGroup.children.length > 0) {
      const obj = threeCurrentModelGroup.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
      threeCurrentModelGroup.remove(obj);
    }
    
    // Cleanup old object URL
    if (currentGlbObjectUrl) {
      URL.revokeObjectURL(currentGlbObjectUrl);
      currentGlbObjectUrl = null;
    }
    
    document.getElementById('threePlaceholder').classList.add('hidden');
    
    // Use GLTFLoader
    const loader = new THREE.GLTFLoader();
    
    // Try direct load first (works if CORS is enabled on the CDN)
    loader.load(
      glbUrl,
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
        
        // Count meshes
        let meshCount = 0;
        model.traverse(c => { if (c.isMesh) meshCount++; });
        document.getElementById('threeModelTitle').textContent = '🎨 Modello 3D Reale (Meshy AI)';
        document.getElementById('threePartCount').textContent = `${meshCount} mesh`;
        
        // Store GLB URL for download
        CONFIG.currentGlbUrl = glbUrl;
        
        // Show download button
        const dlBtn = document.getElementById('downloadGlbBtn');
        if (dlBtn) dlBtn.classList.remove('hidden');
        
        resolve();
      },
      (progress) => {
        const pct = Math.round((progress.loaded / (progress.total || 1)) * 100);
        const statusEl = document.getElementById('meshyStatusText');
        if (statusEl) statusEl.textContent = `Caricamento GLB: ${pct}%`;
      },
      (error) => {
        // CORS blocked — try via corsproxy.io
        console.warn('Direct GLB load failed, trying CORS proxy:', error);
        const proxiedUrl = 'https://corsproxy.io/?' + encodeURIComponent(glbUrl);
        loader.load(
          proxiedUrl,
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
            
            CONFIG.currentGlbUrl = glbUrl;
            const dlBtn = document.getElementById('downloadGlbBtn');
            if (dlBtn) dlBtn.classList.remove('hidden');
            
            resolve();
          },
          undefined,
          (err2) => {
            reject(new Error(`Impossibile caricare il GLB nel viewer 3D: ${err2.message}. Il file GLB è comunque disponibile per il download diretto.`));
          }
        );
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

// Call Cloud AI (Gemini or Groq)
async function callCloudAI(userPrompt, mode, abortSignal) {
  const systemInstruction = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.scripting;

  if (CONFIG.modelProvider.startsWith('gemini')) {
    const model = CONFIG.modelProvider;
    console.log(`[BloxCraft] Chiamata a Google Generative AI (${model})...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.apiKey}`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

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
  
  // 2. Prepare Command Bar Code
  if (luaCode) {
    CONFIG.commandBarCode = `task.spawn(function()\n${luaCode}\nend)`;
    const codeElem = document.getElementById('codeBlock');
    codeElem.textContent = luaCode;
    Prism.highlightElement(codeElem);
    detectPlacementAdvice(luaCode);
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
  } else if (CONFIG.activeMode === '3d-builder' && luaCode) {
    parseProceduralLuauTo3D(luaCode);
    switchOutputTab('3d');
  }

  // 4. Extract HTML preview (if in UI mode)
  const htmlRegex = /```html_preview\n([\s\S]*?)```/i;
  const htmlMatch = rawText.match(htmlRegex);
  if (htmlMatch) {
    renderUIPreview(htmlMatch[1]);
    if (CONFIG.activeMode === 'ui-designer') switchOutputTab('preview');
  } else if (CONFIG.activeMode === 'ui-designer') {
    renderFallbackUIPreview();
    switchOutputTab('preview');
  }

  // 5. Instructions view
  const explanation = rawText.replace(/```(?:lua|luau|html_preview|3d_manifest)[\s\S]*?```/gi, '').trim();
  CONFIG.instructionsMarkdown = explanation;
  document.getElementById('instructionsContent').innerHTML = marked.parse(explanation);

  // 6. Append Bot message to chat
  const previewSnippet = explanation.substring(0, 280) + (explanation.length > 280 ? '...' : '');
  appendBotMessage(previewSnippet || "Ho generato la soluzione richiesta. Esplora il modello 3D, il codice o l'interfaccia nel pannello a destra!");

  if (CONFIG.activeMode === 'scripting') {
    switchOutputTab('code');
  }

  // Save full state!
  saveCurrentProjectState();
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
  CONFIG.chatMessages.push({ sender: 'user', text, timestamp: Date.now() });
  renderUserBubbleDOM(text);
  saveCurrentProjectState();
}

function renderUserBubbleDOM(text) {
  const chat = document.getElementById('chatHistory');
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
  CONFIG.chatMessages.push({ sender: 'bot', text, timestamp: Date.now() });
  renderBotBubbleDOM(text);
  saveCurrentProjectState();
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

function clearWorkspace() {
  CONFIG.generatedCode = "";
  CONFIG.commandBarCode = "";
  CONFIG.current3DManifest = null;
  document.getElementById('codeBlock').textContent = "-- Area di lavoro pulita. Inserisci un nuovo prompt!";
  Prism.highlightElement(document.getElementById('codeBlock'));
  document.getElementById('placementBanner').classList.add('hidden');
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
  if (provider === 'gemini-3.8-flash') tag.textContent = 'Gemini 3.8 Flash';
  else if (provider === 'gemini-3.8-flash-lite') tag.textContent = 'Gemini 3.8 Flash Lite';
  else if (provider === 'gemini-3.8-pro') tag.textContent = 'Gemini 3.8 Pro';
  else if (provider === 'groq-qwen-32b') tag.textContent = 'Groq Qwen 2.5 Coder 32B';
  else tag.textContent = provider;
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
  const btn = document.getElementById('sendPromptBtn');
  overlay.classList.toggle('hidden', !show);
  btn.disabled = show;
}

// Utility
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
