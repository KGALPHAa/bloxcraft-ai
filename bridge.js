/**
 * BloxCraft AI - Roblox Studio MCP & Local Sync Bridge
 * Connette in modo 100% autonomo il sito https://kgalphaa.github.io/bloxcraft-ai/
 * con Roblox Studio sul tuo PC.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const PORT = 28888;
const queue = [];

// Funzione per verificare se Roblox Studio o StudioMCP sono attivi
function checkProcesses(callback) {
  exec('powershell -Command "Get-Process -Name RobloxStudioBeta, StudioMCP -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName"', (err, stdout) => {
    const procs = (stdout || '').toLowerCase();
    const studioRunning = procs.includes('robloxstudio');
    const mcpRunning = procs.includes('studiomcp');
    callback({ studioRunning, mcpRunning });
  });
}

// Funzione per copiare codice negli appunti di sistema Windows
function setClipboard(text) {
  try {
    const ps = spawn('powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard']);
    ps.stdin.write(text);
    ps.stdin.end();
  } catch (e) {
    console.error('Errore copia clipboard:', e.message);
  }
}

// Salva copia locale di backup in AppData
function saveSyncFile(code) {
  try {
    const robloxDir = path.join(process.env.LOCALAPPDATA || '', 'Roblox');
    if (!fs.existsSync(robloxDir)) fs.mkdirSync(robloxDir, { recursive: true });
    const syncFile = path.join(robloxDir, 'BloxCraft_Latest.luau');
    fs.writeFileSync(syncFile, code, 'utf8');
  } catch (e) {
    // ignore
  }
}

const server = http.createServer((req, res) => {
  // CORS Headers per abilitare richieste dal sito GitHub Pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // 1. STATO / HEALTH CHECK
  if (req.method === 'GET' && (url === '/status' || url === '/health' || url === '/')) {
    checkProcesses((procs) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: '1.0.0',
        bridge: true,
        studioRunning: procs.studioRunning,
        mcpRunning: procs.mcpRunning,
        queueLength: queue.length
      }));
    });
    return;
  }

  // 2. ESECUZIONE / INIEZIONE CODICE O MODELLO
  if (req.method === 'POST' && (url === '/execute' || url === '/inject')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const code = data.code || '';
        const title = data.title || 'Iniezione BloxCraft';

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Codice mancante' }));
          return;
        }

        console.log(`\n[⚡ INIEZIONE RICEVUTA] ${title} (${code.length} caratteri)`);
        
        // 1. Accoda per il plugin Roblox Studio
        queue.push({
          id: Date.now(),
          title: title,
          code: code,
          time: new Date().toISOString()
        });
        if (queue.length > 20) queue.shift();

        // 2. Salva file di sync in %LOCALAPPDATA%\Roblox\BloxCraft_Latest.luau
        saveSyncFile(code);

        // 3. Copia negli appunti di Windows con avviso
        setClipboard(code);

        console.log(`[✓] Codice accodato per Studio Plugin`);
        console.log(`[✓] Salvato in BloxCraft_Latest.luau`);
        console.log(`[✓] Copiato negli appunti di Windows`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Codice iniettato e sincronizzato con successo!',
          queueLength: queue.length
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 3. POLLING PER IL PLUGIN DI ROBLOX STUDIO
  if (req.method === 'GET' && url === '/poll') {
    if (queue.length > 0) {
      const item = queue.shift();
      console.log(`[Roblox Studio] ⚡ Codice "${item.title}" inviato a Studio!`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ empty: true }));
    }
    return;
  }

  // 404 per altri percorsi
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('========================================================');
  console.log('       BLOXCRAFT AI - ROBLOX STUDIO BRIDGE');
  console.log('========================================================');
  console.log(`[✓] Bridge Server attivo su: http://127.0.0.1:${PORT}`);
  console.log(`[✓] In attesa di comandi da https://kgalphaa.github.io/bloxcraft-ai/`);
  console.log(`[✓] Lascia questa finestra aperta mentre sviluppi su Roblox Studio!`);
  console.log('========================================================\n');
});
