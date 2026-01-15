import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors({
  origin: [
    'https://gta-samp-sektor-weekly-lottery.onrender.com',
    'https://mistgan1.github.io',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(express.json());

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
} = process.env;

// ────────────────────────────────────────────────
// Параметры для ПУБЛИЧНОГО репозитория с логами
// ────────────────────────────────────────────────
const PUBLIC_GH_TOKEN = process.env.GITHUB_PUBLIC_TOKEN;
const PUBLIC_OWNER = 'mistgan1';
const PUBLIC_REPO = 'gta-samp-sektor-weekly-lottery-back';
const PUBLIC_BRANCH = 'main';

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.warn('⚠️ Не заданы ENV: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO');
}

if (!PUBLIC_GH_TOKEN) {
  console.warn('⚠️ GITHUB_PUBLIC_TOKEN не задан — работа с публичным репозиторием будет ограничена');
}

const GH_API = 'https://api.github.com';

function ghHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function publicGhHeaders() {
  return {
    'Authorization': `Bearer ${PUBLIC_GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function encodeBase64Utf8(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function decodeBase64Utf8(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function ghGetFile(filePath) {
  const url = `${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub GET failed (${r.status}): ${text}`);
  }
  const data = await r.json();
  const content = decodeBase64Utf8(data.content || '');
  return { json: JSON.parse(content || '[]'), sha: data.sha };
}

async function ghPutFile(filePath, jsonValue, sha, message) {
  const url = `${GH_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const body = {
    message,
    content: encodeBase64Utf8(JSON.stringify(jsonValue, null, 2)),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub PUT failed (${r.status}): ${text}`);
  }
  return await r.json();
}

async function publicGhPutFile(filePath, jsonValue, sha, message) {
  const url = `${GH_API}/repos/${PUBLIC_OWNER}/${PUBLIC_REPO}/contents/${filePath}`;
  const body = {
    message,
    content: encodeBase64Utf8(JSON.stringify(jsonValue, null, 2)),
    branch: PUBLIC_BRANCH,
  };
  if (sha) body.sha = sha;

  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...publicGhHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Public repo PUT failed (${r.status}): ${text}`);
  }
  return await r.json();
}

// Пути в приватном репо
const PATH_HISTORY = 'data/history.json';
const PATH_NAMES  = 'data/names.json';
const PATH_PRIZES = 'data/prizes.json';

// ────────────────────────────────────────────────
// Основные API-эндпоинты
// ────────────────────────────────────────────────

app.get('/history', async (req, res) => {
  try {
    const { json } = await ghGetFile(PATH_HISTORY);
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to load history' });
  }
});

app.get('/names', async (req, res) => {
  try {
    const { json } = await ghGetFile(PATH_NAMES);
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to load names' });
  }
});

app.get('/prizes', async (req, res) => {
  try {
    const { json } = await ghGetFile(PATH_PRIZES);
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to load prizes' });
  }
});

app.post('/auth', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD не установлен!');
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }

  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }

  res.status(401).json({ success: false, message: 'Неверный пароль' });
});

app.post('/reserve', async (req, res) => {
  try {
    const { number, nickname } = req.body;
    if (!number) return res.status(400).json({ success: false, message: 'Номер не указан' });

    const { json: reserved, sha } = await ghGetFile(PATH_NAMES);

    const filtered = (reserved || []).filter(item => item.number !== Number(number));

    if (nickname && String(nickname).trim() !== '') {
      filtered.push({ number: Number(number), nickname: String(nickname).trim() });
    }

    await ghPutFile(
      PATH_NAMES,
      filtered,
      sha,
      `Update reserve: ${number} -> ${nickname && String(nickname).trim() ? nickname.trim() : 'free'}`
    );

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to update names' });
  }
});

app.post('/update-winner', async (req, res) => { /* ... */ });
app.post('/update-winner-prize', async (req, res) => { /* ... */ });
app.post('/update-prize', async (req, res) => { /* ... */ });
app.delete('/history/:date/:number', async (req, res) => { /* ... */ });
app.post('/save-history', async (req, res) => { /* ... */ });
app.post('/save-to-log', async (req, res) => { /* ... */ });
app.post('/clear-names', async (req, res) => { /* ... */ });

// ────────────────────────────────────────────────
// Логи — список файлов и содержимое отдельного файла
// ────────────────────────────────────────────────

// Список всех файлов в папке log/
app.get('/log', async (req, res) => {
  try {
    const url = `${GH_API}/repos/${PUBLIC_OWNER}/${PUBLIC_REPO}/contents/log/?ref=${encodeURIComponent(PUBLIC_BRANCH)}`;
    
    const r = await fetch(url, { headers: publicGhHeaders() });
    
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`GET /log failed (${r.status}): ${text}`);
    }
    
    const items = await r.json();

    const logFiles = items
      .filter(item => item.type === 'file')
      .filter(item => /^\d{2}_\d{2}_\d{4}\.json$/.test(item.name))
      .map(item => item.name)
      .sort((a, b) => b.localeCompare(a)); // новые сверху

    res.json(logFiles);
  } catch (err) {
    console.error('Ошибка в /log (список):', err.message);
    res.status(500).json({ error: 'Не удалось получить список логов', details: err.message });
  }
});

// Содержимое конкретного файла
app.get('/log/:filename', async (req, res) => {
  const filename = req.params.filename;
  
  if (!/^\d{2}_\d{2}_\d{4}\.json$/.test(filename)) {
    return res.status(400).json({ error: 'Недопустимое имя файла' });
  }

  try {
    const url = `${GH_API}/repos/${PUBLIC_OWNER}/${PUBLIC_REPO}/contents/log/${filename}?ref=${encodeURIComponent(PUBLIC_BRANCH)}`;
    
    const r = await fetch(url, { headers: publicGhHeaders() });
    
    if (!r.ok) {
      if (r.status === 404) {
        return res.status(404).json({ error: `Файл ${filename} не найден` });
      }
      const text = await r.text();
      throw new Error(`Public repo GET failed (${r.status}): ${text}`);
    }
    
    const data = await r.json();
    const content = decodeBase64Utf8(data.content || '[]');
    
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
    
  } catch (err) {
    console.error(`Ошибка при загрузке файла ${filename}:`, err.message);
    res.status(500).json({ 
      error: 'Не удалось загрузить файл',
      details: err.message 
    });
  }
});

// ────────────────────────────────────────────────
// Запуск сервера — ВСЕГДА в самом конце!
// ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
  console.log(`📦 Private data repo: ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH})`);
  if (PUBLIC_GH_TOKEN) {
    console.log(`📦 Public backup repo: ${PUBLIC_OWNER}/${PUBLIC_REPO} (${PUBLIC_BRANCH})`);
  }
});