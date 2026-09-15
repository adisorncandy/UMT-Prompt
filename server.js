import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Increase payload limit to support image uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const dataDir = path.join(__dirname, 'data');
const promptsDbPath = path.join(dataDir, 'prompts-db.json');
const categoryOrderPath = path.join(dataDir, 'category-order.json');
const backupDbPath = path.join(__dirname, '_source-data', 'umt_prompts_db_1789373141761.json');
const thumbsDir = path.join(__dirname, 'assets', 'thumbnails');

const DEFAULT_CATEGORY_ORDER = [
  "Bidding",
  "Catalog",
  "Translation",
  "PDF to Word",
  "Proposal",
  "BOQ",
  "CostSheet",
  "Presentation",
  "User Manual",
  "VDO Presentation",
  "AI Video",
  "AI Image",
  "Technical Spec",
  "Training Material",
  "All-in-One"
];

function getCategoryOrder() {
  if (fs.existsSync(categoryOrderPath)) {
    try {
      const content = fs.readFileSync(categoryOrderPath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {
      console.warn('Error reading category-order.json:', e);
    }
  }
  return DEFAULT_CATEGORY_ORDER;
}

function saveCategoryOrder(order) {
  if (!Array.isArray(order) || order.length === 0) return DEFAULT_CATEGORY_ORDER;
  fs.writeFileSync(categoryOrderPath, JSON.stringify(order, null, 2), 'utf8');
  console.log(`[Server Storage] Saved category order (${order.length} items)`);
  return order;
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(thumbsDir)) {
  fs.mkdirSync(thumbsDir, { recursive: true });
}

// Helper: load prompts database
function getPromptsDatabase() {
  if (fs.existsSync(promptsDbPath)) {
    try {
      const content = fs.readFileSync(promptsDbPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn('Error reading prompts-db.json, falling back:', e);
    }
  }
  if (fs.existsSync(backupDbPath)) {
    try {
      const content = fs.readFileSync(backupDbPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn('Error reading backupDbPath:', e);
    }
  }
  return [];
}

// Helper: save prompts database and convert base64 data URLs to real files
function savePromptsDatabase(prompts) {
  if (!Array.isArray(prompts)) return;

  for (const p of prompts) {
    if (p.id === '1788779257202' && (!p.thumbnailUrl || !p.thumbnailUrl.trim())) {
      p.thumbnailUrl = '/assets/bidding-catalog-comply-thumb.svg';
    }

    if (p.thumbnailUrl && p.thumbnailUrl.startsWith('data:')) {
      const match = p.thumbnailUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const safeId = (p.id || 'thumb_' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `${safeId}.${ext}`;
        const filePath = path.join(thumbsDir, fileName);
        try {
          const buffer = Buffer.from(match[2], 'base64');
          fs.writeFileSync(filePath, buffer);
          const distThumbsDir = path.join(__dirname, 'dist', 'assets', 'thumbnails');
          if (fs.existsSync(distThumbsDir)) {
            fs.writeFileSync(path.join(distThumbsDir, fileName), buffer);
          }
          p.thumbnailUrl = `/assets/thumbnails/${fileName}`;
          console.log(`[Server Storage] Saved thumbnail file: ${fileName}`);
        } catch (err) {
          console.warn(`[Server Storage] Failed saving thumbnail for ${p.id}:`, err);
        }
      }
    }

    if (p.thumbnailUrl && p.thumbnailUrl.startsWith('./assets/')) {
      p.thumbnailUrl = p.thumbnailUrl.replace('./assets/', '/assets/');
    }

    // Protect local thumbnails: If prompt has remote/missing thumbnail but a local thumbnail file exists for this ID, use local file
    if (!p.thumbnailUrl || !p.thumbnailUrl.startsWith('/assets/thumbnails/')) {
      const webp = `${p.id}.webp`;
      const jpg = `${p.id}.jpg`;
      const png = `${p.id}.png`;
      if (fs.existsSync(path.join(thumbsDir, webp))) {
        p.thumbnailUrl = `/assets/thumbnails/${webp}`;
      } else if (fs.existsSync(path.join(thumbsDir, jpg))) {
        p.thumbnailUrl = `/assets/thumbnails/${jpg}`;
      } else if (fs.existsSync(path.join(thumbsDir, png))) {
        p.thumbnailUrl = `/assets/thumbnails/${png}`;
      }
    }
  }

  const jsonStr = JSON.stringify(prompts, null, 2);
  fs.writeFileSync(promptsDbPath, jsonStr, 'utf8');
  try {
    fs.writeFileSync(backupDbPath, jsonStr, 'utf8');
  } catch (e) {
    console.warn('[Server Storage] Backup write failed:', e);
  }
  console.log(`[Server Storage] Database successfully saved (${prompts.length} prompts)`);
  return prompts;
}

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API: Get all prompts database
app.get('/api/prompts', (req, res) => {
  const prompts = getPromptsDatabase();
  res.json({ success: true, count: prompts.length, prompts });
});

// API: Save / Sync prompts database
app.delete('/api/prompts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const prompts = getPromptsDatabase();
    const filtered = prompts.filter(x => x.id !== id);
    savePromptsDatabase(filtered);
    console.log(`[Server Storage] Deleted prompt ${id}, remaining: ${filtered.length}`);
    res.json({ success: true, count: filtered.length, deletedId: id });
  } catch (err) {
    console.error('[Server Storage] Error deleting prompt:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Save / Sync prompts database
app.post('/api/prompts', (req, res) => {
  try {
    const raw = req.body.prompts || req.body;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ success: false, error: 'Expected array of prompts' });
    }
    const saved = savePromptsDatabase(raw);
    res.json({ success: true, count: saved.length });
  } catch (err) {
    console.error('[Server Storage] Error saving prompts:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get category order
app.get('/api/category-order', (req, res) => {
  const order = getCategoryOrder();
  res.json({ success: true, order });
});

// API: Save category order
app.post('/api/category-order', (req, res) => {
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected non-empty array of category IDs' });
    }
    const saved = saveCategoryOrder(order);
    res.json({ success: true, order: saved });
  } catch (err) {
    console.error('[Server Storage] Error saving category order:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Save individual thumbnail
app.post('/api/save-thumbnail', async (req, res) => {
  try {
    const { id, dataUrl, aspectRatio } = req.body || {};
    if (!id || !dataUrl) {
      return res.status(400).json({ success: false, error: 'id and dataUrl are required' });
    }

    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    let fileName = '';
    let isSavedFile = false;

    if (dataUrl.startsWith('data:image/')) {
      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        let ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        if (ext === 'svg+xml') ext = 'svg';
        fileName = `${safeId}.${ext}`;
        const fileBuffer = Buffer.from(match[2], 'base64');

        fs.writeFileSync(path.join(thumbsDir, fileName), fileBuffer);
        const distThumbsDir = path.join(__dirname, 'dist', 'assets', 'thumbnails');
        if (fs.existsSync(distThumbsDir)) {
          fs.writeFileSync(path.join(distThumbsDir, fileName), fileBuffer);
        }
        isSavedFile = true;
      }
    } else if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      try {
        const response = await fetch(dataUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const fileBuffer = Buffer.from(arrayBuffer);
          const contentType = response.headers.get('content-type') || '';
          let ext = 'jpg';
          if (contentType.includes('webp')) ext = 'webp';
          else if (contentType.includes('png')) ext = 'png';
          else if (contentType.includes('svg')) ext = 'svg';
          fileName = `${safeId}.${ext}`;

          fs.writeFileSync(path.join(thumbsDir, fileName), fileBuffer);
          const distThumbsDir = path.join(__dirname, 'dist', 'assets', 'thumbnails');
          if (fs.existsSync(distThumbsDir)) {
            fs.writeFileSync(path.join(distThumbsDir, fileName), fileBuffer);
          }
          isSavedFile = true;
        }
      } catch (dlErr) {
        console.warn('[Server Storage] Could not fetch remote thumbnail:', dlErr);
      }
    } else if (dataUrl.startsWith('/assets/thumbnails/')) {
      fileName = path.basename(dataUrl.split('?')[0]);
      isSavedFile = true;
    }

    const cleanThumbnailUrl = isSavedFile ? `/assets/thumbnails/${fileName}` : dataUrl;

    // Update in database as well
    const prompts = getPromptsDatabase();
    const target = prompts.find(x => x.id === id);
    if (target) {
      target.thumbnailUrl = cleanThumbnailUrl;
      if (aspectRatio) target.aspectRatio = aspectRatio;
      target.lastUpdated = new Date().toISOString();
      savePromptsDatabase(prompts);
    } else {
      console.warn(`[Server Storage] Prompt ID ${id} not found in database to update thumbnail`);
    }

    const clientThumbnailUrl = isSavedFile ? `${cleanThumbnailUrl}?v=${Date.now()}` : cleanThumbnailUrl;
    console.log(`[Server Storage] Saved thumbnail for prompt ${id} -> ${cleanThumbnailUrl}`);
    res.json({
      success: true,
      id,
      thumbnailUrl: clientThumbnailUrl,
      aspectRatio: target ? target.aspectRatio : aspectRatio
    });
  } catch (err) {
    console.error('[Server Storage] Error saving thumbnail:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Generate thumbnail
app.post('/api/generate-thumbnail', async (req, res) => {
  try {
    const {
      title,
      description,
      aspectRatio = '16:9',
      customPrompt
    } = req.body || {};

    let width = 1280;
    let height = 720;
    if (aspectRatio === '1:1') {
      width = 1024;
      height = 1024;
    } else if (aspectRatio === '4:3') {
      width = 1024;
      height = 768;
    } else if (aspectRatio === '9:16') {
      width = 720;
      height = 1280;
    }

    const promptText = (customPrompt || title || description || 'studio prompt thumbnail')
      .replace(/[^\w\s,.-]/gi, ' ')
      .trim();
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

    return res.json({
      success: true,
      imageUrl,
      promptUsed: promptText,
      model: 'pollinations-generative',
      note: 'Contextual AI generation'
    });
  } catch (err) {
    console.error('Error generating thumbnail:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const distPath = path.join(__dirname, 'dist');
const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
const staticDir = hasDist ? distPath : __dirname;

app.use(express.static(staticDir));

const serveHtmlWithServerState = (req, res) => {
  try {
    const indexPath = fs.existsSync(path.join(distPath, 'index.html'))
      ? path.join(distPath, 'index.html')
      : path.join(__dirname, 'index.html');

    let html = fs.readFileSync(indexPath, 'utf8');
    const prompts = getPromptsDatabase();
    const categoryOrder = getCategoryOrder();

    const stateScript = `<script id="umt-server-prompts-data">window.__SERVER_PROMPTS__ = ${JSON.stringify(prompts)};\nwindow.__SERVER_CATEGORY_ORDER__ = ${JSON.stringify(categoryOrder)};</script>`;
    if (html.includes('<script type="module"')) {
      html = html.replace('<script type="module"', `${stateScript}\n    <script type="module"`);
    } else {
      html = html.replace('</head>', `    ${stateScript}\n  </head>`);
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.type('html').send(html);
  } catch (err) {
    console.error('[Server Storage] Error serving HTML with state:', err);
    res.sendFile(path.join(staticDir, 'index.html'));
  }
};

app.get('/', serveHtmlWithServerState);
app.get('/index.html', serveHtmlWithServerState);

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  if (req.accepts('html')) {
    serveHtmlWithServerState(req, res);
  } else {
    res.sendFile(path.join(staticDir, 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
