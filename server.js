import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors({
  origin: [
    'https://gta-samp-sektor-weekly-lottery.onrender.com',
    'https://mistgan1.github.io',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.warn('⚠️ Не заданы ENV: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO');
}

const GH_API = 'https://api.github.com';

function ghHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
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
  let history = await ghGetFile('data/history.json');

  if (typeof history === 'string') {
    history = JSON.parse(history);
  }

  if (!Array.isArray(history)) {
    return res.status(500).json({
      success: false,
      message: 'History is not array'
    });
  }

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

// простая авторизация как у тебя сейчас
app.post('/auth', (req, res) => {
  const { password } = req.body;
  if (password === '1001') return res.json({ success: true });
  res.status(401).json({ success: false, message: 'Неверный пароль' });
});

// reserve квадратов (обновляет data/names.json в GitHub)
app.post('/reserve', async (req, res) => {
  try {
    const { number, nickname } = req.body;
    if (!number) return res.status(400).json({ success: false, message: 'Номер не указан' });

    const { json: reserved, sha } = await ghGetFile(PATH_NAMES);

    // удаляем старую запись по number
    const filtered = (reserved || []).filter(item => item.number !== Number(number));

    // если nickname пустой — значит освобождаем
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

// update winner name (history) — если ты всё же хочешь править через UI
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

// update winner prize (history)
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

// update prize counters (prizes.json)
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
  console.log(`📦 Data repo: ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH})`);
});

app.post('/save-history', async (req, res) => {
  try {
    const { date, number, name, prize, mode } = req.body;

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
        prize: prize || ''
      };
    } else {
      list.push({
        date,
        number: Number(number),
        name: name || '',
        prize: prize || ''
      });
    }

    await ghPutFile(PATH_HISTORY, list, sha, `Save history: ${date} #${number}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

app.post('/delete-history', async (req, res) => {
  try {
    const { date, number } = req.body;

    if (!date || number === undefined) {
      return res.status(400).json({ success: false, message: 'Bad request' });
    }

    // 1. Загружаем history.json из приватного репозитория
    const history = await ghGetFile('data/history.json');

    // 2. Удаляем запись по date + number
    const filtered = history.filter(
      item => !(item.date === date && String(item.number) === String(number))
    );

    // 3. Если ничего не удалилось — ошибка
    if (filtered.length === history.length) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }

    // 4. Сохраняем обратно в GitHub
    await ghPutFile(
      'data/history.json',
      filtered,
      `Delete history record: ${date} ${number}`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('delete-history error:', err);
    res.status(500).json({ success: false });
  }
});
