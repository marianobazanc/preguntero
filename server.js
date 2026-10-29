// Preguntero — servidor sin dependencias (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || 'biologia';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed-questions.json');
const RANKING_FILE = path.join(DATA_DIR, 'ranking.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const MAX_BODY = 4 * 1024 * 1024; // imágenes en base64
const QUESTION_TIME_MS = 20000;
const BASE_POINTS = 500;
const SPEED_POINTS = 500;
const STREAK_BONUS = 100;
const AVATARS = ['cell', 'bacteria', 'virus', 'frog', 'mushroom', 'fish', 'leaf', 'dna'];

// ---------- persistencia ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

if (!fs.existsSync(QUESTIONS_FILE)) {
  writeJson(QUESTIONS_FILE, readJson(SEED_FILE, []));
}

let questions = readJson(QUESTIONS_FILE, []);
let ranking = readJson(RANKING_FILE, []);
let settings = Object.assign(
  { title: 'Biología 4° año', questionsPerGame: 10, shuffle: true },
  readJson(SETTINGS_FILE, {})
);

const saveQuestions = () => writeJson(QUESTIONS_FILE, questions);
const saveRanking = () => writeJson(RANKING_FILE, ranking);
const saveSettings = () => writeJson(SETTINGS_FILE, settings);

// Partidas en curso (en memoria; se descartan al reiniciar el servidor)
const games = new Map();
const GAME_TTL_MS = 2 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, g] of games) if (now - g.createdAt > GAME_TTL_MS) games.delete(id);
}, 10 * 60 * 1000).unref();

// ---------- utilidades ----------
const id = () => crypto.randomBytes(8).toString('hex');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

function validateQuestion(body) {
  const text = cleanText(body.text, 300);
  const answers = Array.isArray(body.answers)
    ? body.answers.map((a) => cleanText(a, 150)).filter(Boolean)
    : [];
  const correct = Number(body.correct);
  if (!text) return { error: 'La pregunta no puede estar vacía.' };
  if (answers.length < 2 || answers.length > 4) return { error: 'Cargá entre 2 y 4 respuestas.' };
  if (!Number.isInteger(correct) || correct < 0 || correct >= answers.length)
    return { error: 'Marcá cuál es la respuesta correcta.' };
  let image = '';
  if (typeof body.image === 'string' && body.image) {
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/.test(body.image) || /^https?:\/\//.test(body.image)) {
      image = body.image.slice(0, 3 * 1024 * 1024);
    }
  }
  return {
    value: {
      text,
      answers,
      correct,
      topic: cleanText(body.topic, 40) || 'General',
      explanation: cleanText(body.explanation, 400),
      image,
    },
  };
}

function publicQuestion(q) {
  // Nunca enviamos la respuesta correcta al jugador
  return { id: q.id, text: q.text, answers: q.answers, topic: q.topic, image: q.image };
}

function sortedRanking() {
  return ranking
    .slice()
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.finishedAt - b.finishedAt);
}

// ---------- HTTP ----------
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('El contenido es demasiado grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const pin = req.headers['x-admin-pin'] || '';
  const a = Buffer.from(String(pin));
  const b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function api(req, res, pathname) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean).slice(1); // sin "api"

  // --- públicos ---
  if (method === 'GET' && parts[0] === 'info') {
    return send(res, 200, {
      title: settings.title,
      totalQuestions: questions.length,
      questionsPerGame: Math.min(settings.questionsPerGame, questions.length),
      questionTimeMs: QUESTION_TIME_MS,
    });
  }

  if (method === 'GET' && parts[0] === 'ranking') {
    return send(res, 200, sortedRanking().slice(0, 100));
  }

  if (parts[0] === 'games') {
    if (method === 'POST' && parts.length === 1) {
      const body = await readBody(req);
      const name = cleanText(body.name, 24);
      const avatar = AVATARS.includes(body.avatar) ? body.avatar : 'cell';
      if (name.length < 2) return send(res, 400, { error: 'Escribí tu nombre (mínimo 2 letras).' });
      if (!questions.length) return send(res, 409, { error: 'Todavía no hay preguntas cargadas.' });
      const pool = settings.shuffle ? shuffle(questions) : questions.slice();
      const selected = pool.slice(0, Math.max(1, settings.questionsPerGame));
      const game = {
        id: id(),
        name,
        avatar,
        questionIds: selected.map((q) => q.id),
        answered: {},
        orders: {},
        score: 0,
        correct: 0,
        streak: 0,
        bestStreak: 0,
        createdAt: Date.now(),
        finished: false,
      };
      games.set(game.id, game);
      return send(res, 201, {
        gameId: game.id,
        questionTimeMs: QUESTION_TIME_MS,
        questions: selected.map((q) => {
          const pq = publicQuestion(q);
          if (!settings.shuffle) return pq;
          // mezclamos el orden de las opciones guardando el mapeo en la partida
          const order = shuffle(pq.answers.map((_, i) => i));
          game.orders[q.id] = order;
          return { ...pq, answers: order.map((i) => pq.answers[i]) };
        }),
      });
    }

    const game = games.get(parts[1]);
    if (!game) return send(res, 404, { error: 'La partida no existe o expiró.' });

    if (method === 'POST' && parts[2] === 'answer') {
      const body = await readBody(req);
      const qid = String(body.questionId || '');
      if (!game.questionIds.includes(qid)) return send(res, 400, { error: 'Pregunta inválida.' });
      if (game.answered[qid]) return send(res, 409, { error: 'Ya respondiste esta pregunta.' });
      const q = questions.find((x) => x.id === qid);
      if (!q) return send(res, 410, { error: 'La pregunta fue eliminada.' });

      const order = game.orders[qid] || q.answers.map((_, i) => i);
      const shownChoice = Number.isInteger(body.choice) ? body.choice : -1; // -1 = se acabó el tiempo
      const realChoice = shownChoice >= 0 ? order[shownChoice] : -1;
      const isCorrect = realChoice === q.correct;
      const timeMs = Math.min(Math.max(Number(body.timeMs) || QUESTION_TIME_MS, 0), QUESTION_TIME_MS);

      let points = 0;
      if (isCorrect) {
        game.streak += 1;
        game.correct += 1;
        game.bestStreak = Math.max(game.bestStreak, game.streak);
        const speed = Math.round(SPEED_POINTS * (1 - timeMs / QUESTION_TIME_MS));
        const bonus = game.streak >= 2 ? STREAK_BONUS * Math.min(game.streak - 1, 5) : 0;
        points = BASE_POINTS + speed + bonus;
      } else {
        game.streak = 0;
      }
      game.score += points;
      game.answered[qid] = { choice: realChoice, isCorrect, points };

      return send(res, 200, {
        isCorrect,
        points,
        correctChoice: order.indexOf(q.correct),
        explanation: q.explanation,
        score: game.score,
        streak: game.streak,
      });
    }

    if (method === 'POST' && parts[2] === 'finish') {
      if (!game.finished) {
        game.finished = true;
        const entry = {
          id: game.id,
          name: game.name,
          avatar: game.avatar,
          score: game.score,
          correct: game.correct,
          total: game.questionIds.length,
          bestStreak: game.bestStreak,
          finishedAt: Date.now(),
        };
        ranking.push(entry);
        saveRanking();
      }
      const list = sortedRanking();
      const position = list.findIndex((r) => r.id === game.id) + 1;
      return send(res, 200, {
        score: game.score,
        correct: game.correct,
        total: game.questionIds.length,
        bestStreak: game.bestStreak,
        position,
        players: list.length,
      });
    }
  }

  // --- administración (requiere PIN) ---
  if (parts[0] === 'admin') {
    if (!isAdmin(req)) return send(res, 401, { error: 'PIN incorrecto.' });
    const [, resource, rid] = parts;

    if (resource === 'login' && method === 'POST') return send(res, 200, { ok: true });

    if (resource === 'questions') {
      if (method === 'GET') return send(res, 200, questions);
      if (method === 'POST' && !rid) {
        const r = validateQuestion(await readBody(req));
        if (r.error) return send(res, 400, r);
        const q = { id: id(), ...r.value };
        questions.push(q);
        saveQuestions();
        return send(res, 201, q);
      }
      if (method === 'POST' && rid === 'import') {
        const body = await readBody(req);
        const list = Array.isArray(body) ? body : body.questions;
        if (!Array.isArray(list)) return send(res, 400, { error: 'El archivo no tiene preguntas.' });
        let added = 0;
        const errors = [];
        list.forEach((item, i) => {
          const r = validateQuestion(item);
          if (r.error) errors.push(`#${i + 1}: ${r.error}`);
          else {
            questions.push({ id: id(), ...r.value });
            added++;
          }
        });
        saveQuestions();
        return send(res, 200, { added, errors });
      }
      const idx = questions.findIndex((q) => q.id === rid);
      if (idx === -1) return send(res, 404, { error: 'Pregunta no encontrada.' });
      if (method === 'PUT') {
        const r = validateQuestion(await readBody(req));
        if (r.error) return send(res, 400, r);
        questions[idx] = { id: rid, ...r.value };
        saveQuestions();
        return send(res, 200, questions[idx]);
      }
      if (method === 'DELETE') {
        questions.splice(idx, 1);
        saveQuestions();
        return send(res, 200, { ok: true });
      }
    }

    if (resource === 'ranking' && method === 'DELETE') {
      ranking = [];
      saveRanking();
      return send(res, 200, { ok: true });
    }

    if (resource === 'settings') {
      if (method === 'GET') return send(res, 200, settings);
      if (method === 'PUT') {
        const body = await readBody(req);
        const n = Math.round(Number(body.questionsPerGame));
        settings = {
          title: cleanText(body.title, 60) || settings.title,
          questionsPerGame: n >= 1 && n <= 100 ? n : settings.questionsPerGame,
          shuffle: Boolean(body.shuffle),
        };
        saveSettings();
        return send(res, 200, settings);
      }
    }
  }

  send(res, 404, { error: 'Ruta no encontrada.' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else if (req.method === 'GET') serveStatic(req, res, pathname);
    else res.writeHead(405).end();
  } catch (err) {
    send(res, err.status || 500, { error: err.status ? err.message : 'Error interno del servidor.' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`🧬 Preguntero listo en http://localhost:${PORT}`);
  console.log(`   Panel docente: http://localhost:${PORT}/#/profesor  (PIN: ${ADMIN_PIN === 'biologia' ? 'biologia — cambialo con ADMIN_PIN' : '******'})`);
});
