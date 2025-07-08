import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Исправленный импорт

// Получаем __dirname в ES-модулях
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Пути к файлам
const historyFilePath = path.join(__dirname, 'history.json');
const namesFilePath = path.join(__dirname, 'names.json');
const prizesFilePath = path.join(__dirname, 'prizes.json');

// Загрузка истории из файла
let history = [];
try {
    if (fs.existsSync(historyFilePath)) {
        history = JSON.parse(fs.readFileSync(historyFilePath, 'utf-8')) || [];
    }
} catch (error) {
    console.error('Ошибка чтения history.json:', error);
    history = [];
}

// Загрузка зарезервированных номеров
let reservedNumbers = [];
try {
    if (fs.existsSync(namesFilePath)) {
        reservedNumbers = JSON.parse(fs.readFileSync(namesFilePath, 'utf-8')) || [];
    }
} catch (error) {
    console.error('Ошибка чтения names.json:', error);
    reservedNumbers = [];
}

// Функции сохранения данных
function saveHistory() {
    try {
        fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (error) {
        console.error('Ошибка сохранения history.json:', error);
    }
}

function saveNames() {
    try {
        fs.writeFileSync(namesFilePath, JSON.stringify(reservedNumbers, null, 2), 'utf-8');
    } catch (error) {
        console.error('Ошибка сохранения names.json:', error);
    }
}

// Генерация чисел и планирование
function calculateNextDate() {
    const now = new Date();
    now.setHours(now.getHours() + 3); // MSK
    const dayOfWeek = now.getUTCDay();
    const targetDays = [2, 6]; // Вторник и Суббота

    let daysToAdd = targetDays.find(d => d > dayOfWeek) || (targetDays[0] + 7 - dayOfWeek);
    
    if (dayOfWeek === targetDays[0] || dayOfWeek === targetDays[1]) {
        if (now.getUTCHours() < 21 || (now.getUTCHours() === 21 && now.getUTCMinutes() < 1)) {
            daysToAdd = 0;
        }
    }

    now.setUTCDate(now.getUTCDate() + daysToAdd);
    now.setUTCHours(21, 1, 0, 0); // 00:01 MSK
    return now;
}

function generateNumber() {
    const number = Math.floor(Math.random() * 100) + 1;
    const date = new Date().toLocaleDateString('ru-RU', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    }).replace(/\//g, '.');

    history.push({ date, number, name: "" });
    saveHistory();
    console.log(`Сгенерировано число: ${number}`);
    scheduleNextGeneration();
}

function scheduleNextGeneration() {
    nextDate = calculateNextDate();
    const delay = Math.max(nextDate.getTime() - Date.now(), 0);
    setTimeout(generateNumber, delay);
}

function checkMissedGeneration() {
    if (new Date() >= nextDate) {
        generateNumber();
    } else {
        scheduleNextGeneration();
    }
}

let nextDate = calculateNextDate();
checkMissedGeneration();

// Маршруты API
app.get('/log', (req, res) => {
    const logDir = path.join(__dirname, 'log');
    if (!fs.existsSync(logDir)) {
        return res.status(404).json({ success: false, message: 'Директория /log не найдена' });
    }
    const files = fs.readdirSync(logDir).filter(file => file.endsWith('.json'));
    res.json(files);
});

app.get('/log/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'log', filename);
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        res.json(JSON.parse(fileContent));
    } else {
        res.status(404).json({ success: false, message: 'Файл не найден' });
    }
});

app.get('/names', (req, res) => {
    res.json(reservedNumbers);
});

app.post('/reserve', (req, res) => {
    const { number, nickname } = req.body;
    if (!number) {
        return res.status(400).json({ success: false, message: 'Номер не указан' });
    }

    reservedNumbers = reservedNumbers.filter(item => item.number !== number);
    if (nickname && nickname.trim() !== '') {
        reservedNumbers.push({ number, nickname });
    }

    saveNames();
    res.json({ success: true });
});

app.post('/update-winner', (req, res) => {
    const { date, number, name } = req.body;
    if (!date || !number) {
        return res.status(400).json({ success: false, message: 'Неверные данные' });
    }

    const winner = history.find(item => item.date === date && item.number === number);
    if (winner) {
        winner.name = name || '';
        saveHistory();
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Запись не найдена' });
    }
});

app.post('/auth', (req, res) => {
    const { password } = req.body;
    res.json({ success: password === '1001' });
});

app.get('/prizes', (req, res) => {
    try {
        if (fs.existsSync(prizesFilePath)) {
            const prizesData = JSON.parse(fs.readFileSync(prizesFilePath, 'utf-8'));
            res.json(prizesData);
        } else {
            res.status(404).json({ success: false, message: 'Файл с призами не найден' });
        }
    } catch (error) {
        console.error('Ошибка чтения prizes.json:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/add-history', (req, res) => {
    const { date, number, name } = req.body;
    if (!date || !number) {
        return res.status(400).json({ success: false, message: 'Дата и число обязательны' });
    }

    history.push({ date, number: Number(number), name: name || "Неизвестный" });
    try {
        fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf-8');
        res.json({ success: true, message: 'Запись добавлена' });
    } catch (error) {
        console.error('Ошибка сохранения history.json:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/update-prize', (req, res) => {
    const { prize, count } = req.body;
    if (!prize || count === undefined || isNaN(count) || count < 0) {
        return res.status(400).json({ success: false, message: 'Некорректные данные' });
    }

    let prizes = [];
    try {
        if (fs.existsSync(prizesFilePath)) {
            prizes = JSON.parse(fs.readFileSync(prizesFilePath, 'utf-8')) || [];
        }
    } catch (error) {
        console.error('Ошибка чтения prizes.json:', error);
        return res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }

    const prizeIndex = prizes.findIndex(p => p.prize === prize);
    if (prizeIndex !== -1) {
        prizes[prizeIndex].count = count;
    } else {
        return res.status(404).json({ success: false, message: 'Приз не найден' });
    }

    try {
        fs.writeFileSync(prizesFilePath, JSON.stringify(prizes, null, 2), 'utf-8');
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения prizes.json:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/history', async (req, res) => {
    try {
        if (fs.existsSync(historyFilePath)) {
            const historyData = JSON.parse(await fs.promises.readFile(historyFilePath, 'utf-8')) || [];
            res.json(historyData);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Ошибка чтения history.json:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/update-winner-prize', async (req, res) => {
    const { date, name, prize } = req.body;
    if (!date || !name) {
        return res.status(400).json({ success: false, message: 'Некорректные данные' });
    }

    try {
        let historyData = [];
        if (fs.existsSync(historyFilePath)) {
            historyData = JSON.parse(await fs.promises.readFile(historyFilePath, 'utf-8')) || [];
        }

        const winnerIndex = historyData.findIndex(item => item.date === date && item.name === name);
        if (winnerIndex !== -1) {
            historyData[winnerIndex].prize = prize || "";
        } else {
            return res.status(404).json({ success: false, message: 'Победитель не найден' });
        }

        await fs.promises.writeFile(historyFilePath, JSON.stringify(historyData, null, 2), 'utf-8');
        res.json({ success: true, history: historyData });
    } catch (error) {
        console.error('Ошибка обновления history.json:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));
