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
// Новый токен и параметры для ПУБЛИЧНОГО репозитория
// ────────────────────────────────────────────────
const PUBLIC_GH_TOKEN = process.env.GITHUB_PUBLIC_TOKEN;
const PUBLIC_OWNER = 'mistgan1';
const PUBLIC_REPO = 'gta-samp-sektor-weekly-lottery-back';
const PUBLIC_BRANCH = 'main'; // если у тебя другая ветка — измени здесь

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.warn('⚠️ Не заданы ENV: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO');
}

if (!PUBLIC_GH_TOKEN) {
  console.warn('⚠️ GITHUB_PUBLIC_TOKEN не задан — бэкапы в публичный репозиторий работать не будут');
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

// --- API ---

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

// Авторизация через ENV
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

// reserve квадратов (приватный репо)
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

// update winner name
app.post('/update-winner', async (req, res) => {
  try {
    const { date, number, name } = req.body;
    if (!date || number === undefined) {
      return res.status(400).json({ success: false, message: 'Неверные данные' });
    }

    const { json: history, sha } = await ghGetFile(PATH_HISTORY);

    const idx = (history || []).findIndex(item => item.date === date && Number(item.number) === Number(number));
    if (idx === -1) return res.status(404).json({ success: false, message: 'Запись не найдена' });

    history[idx].name = name || '';

    await ghPutFile(PATH_HISTORY, history, sha, `Update winner: ${date} #${number}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to update history' });
  }
});

// update winner prize
app.post('/update-winner-prize', async (req, res) => {
  try {
    const { date, name, prize } = req.body;
    if (!date || !name) {
      return res.status(400).json({ success: false, message: 'Некорректные данные' });
    }

    const { json: history, sha } = await ghGetFile(PATH_HISTORY);

    const idx = (history || []).findIndex(item => item.date === date && item.name === name);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Победитель не найден' });

    history[idx].prize = prize || '';

    await ghPutFile(PATH_HISTORY, history, sha, `Update winner prize: ${date} ${name}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to update winner prize' });
  }
});

// update prize counters
app.post('/update-prize', async (req, res) => {
  try {
    const { prize, count } = req.body;

    if (!prize || count === undefined || Number.isNaN(Number(count)) || Number(count) < 0) {
      return res.status(400).json({ success: false, message: 'Некорректные данные' });
    }

    const { json: prizes, sha } = await ghGetFile(PATH_PRIZES);

    const idx = (prizes || []).findIndex(p => p.prize === prize);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Приз не найден' });

    prizes[idx].count = Number(count);

    await ghPutFile(PATH_PRIZES, prizes, sha, `Update prize count: ${prize}=${count}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to update prizes' });
  }
});

// Удаление записи из истории
app.delete('/history/:date/:number', async (req, res) => {
  try {
    const { date, number } = req.params;

    const { json: history, sha } = await ghGetFile(PATH_HISTORY);
    const list = Array.isArray(history) ? history : [];

    const newList = list.filter(
      item => !(item.date === date && Number(item.number) === Number(number))
    );

    if (newList.length === list.length) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    await ghPutFile(
      PATH_HISTORY,
      newList,
      sha,
      `Delete history entry: ${date} #${number}`
    );

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Ошибка при удалении записи' });
  }
});

// Сохранение истории
app.post('/save-history', async (req, res) => {
  try {
    const { date, number, name, chosenNumber, prize, mode } = req.body;

    if (!date || number === undefined) {
      return res.status(400).json({ success: false });
    }

    const { json: history, sha } = await ghGetFile(PATH_HISTORY);
    const list = Array.isArray(history) ? history : [];

    if (mode === 'edit') {
      const idx = list.findIndex(
        item => item.date === date && Number(item.number) === Number(number)
      );
      if (idx === -1) return res.status(404).json({ success: false });

      list[idx] = {
        ...list[idx],
        name: name || '',
        prize: prize || '',
        chosenNumber: chosenNumber || ''
      };
    } else {
      list.push({
        date,
        number: Number(number),
        name: name || '',
        prize: prize || '',
        chosenNumber: chosenNumber || ''
      });
    }

    await ghPutFile(PATH_HISTORY, list, sha, `Save history: ${date} #${number}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

// Сохранение бэкапа в ПУБЛИЧНЫЙ репозиторий
app.post('/save-to-log', async (req, res) => {
  try {
    const { path, content } = req.body;

    if (!path || !path.startsWith('log/') || !path.endsWith('.json')) {
      return res.status(400).json({ success: false, message: 'Некорректный путь' });
    }

    if (!content || typeof content !== 'object') {
      return res.status(400).json({ success: false, message: 'Нет содержимого' });
    }

    if (!PUBLIC_GH_TOKEN) {
      return res.status(500).json({ success: false, message: 'Сервер не настроен для сохранения в публичный репозиторий' });
    }

    const fullPath = path; // log/ДД_ММ_ГГГГ.json

    let sha = null;
    try {
      const url = `${GH_API}/repos/${PUBLIC_OWNER}/${PUBLIC_REPO}/contents/${fullPath}?ref=${encodeURIComponent(PUBLIC_BRANCH)}`;
      const r = await fetch(url, { headers: publicGhHeaders() });
      if (r.ok) {
        const data = await r.json();
        sha = data.sha;
      }
    } catch (e) {
      // файл не существует — это нормально
    }

    await publicGhPutFile(
      fullPath,
      content,
      sha,
      `Backup reserves: ${path}`
    );

    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка сохранения в публичный репозиторий:', e);
    res.status(500).json({ success: false, message: e.message || 'Ошибка сохранения в log' });
  }
});

const PORT = process.env.PORT || 3000;
// Очистка всего names.json (удаление всех резервов)
app.post('/clear-names', async (req, res) => {
  try {
    // Получаем текущий файл (чтобы взять sha)
    let sha = null;
    let currentContent = [];
    try {
      const existing = await ghGetFile(PATH_NAMES);
      sha = existing.sha;
      currentContent = existing.json;
    } catch (e) {
      // Если файла нет — нормально, просто создадим пустой
    }

    // Очищаем содержимое
    await ghPutFile(
      PATH_NAMES,
      [], // пустой массив
      sha,
      'Clear all reserves: reset names.json to empty'
    );

    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка при очистке names.json:', e);
    res.status(500).json({ success: false, message: e.message || 'Ошибка очистки' });
  }
});
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
  console.log(`📦 Private data repo: ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH})`);
  if (PUBLIC_GH_TOKEN) {
    console.log(`📦 Public backup repo: ${PUBLIC_OWNER}/${PUBLIC_REPO} (${PUBLIC_BRANCH})`);
  }
});

app.get('/log', async (req, res) => {
  try {
    const { json: historyFiles, sha } = await ghGetFile('log/'); 
    const logFiles = historyFiles
      .filter(item => item.type === 'file')
      .filter(item => /^\d{2}_\d{2}_\d{4}\.json$/.test(item.name))
      .map(item => item.name);

    res.json(logFiles);
  } catch (err) {
    console.error('Ошибка получения списка логов:', err);
    res.status(500).json({ error: 'Не удалось получить список файлов' });
  }
});