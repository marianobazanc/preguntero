/* Preguntero — datos locales (IndexedDB) + archivo de respaldo en el disco */
window.PregDB = (() => {
  'use strict';

  const DB_NAME = 'preguntero';
  const FILE_KV = 'backupFile';
  const DEFAULT_PIN = 'biologia';
  const DEFAULT_SETTINGS = { title: 'Biología 4° año', questionsPerGame: 6, shuffle: true, pinHash: '' };

  let db;
  const listeners = new Set();
  const backup = {
    supported: 'showSaveFilePicker' in window,
    handle: null,
    status: 'none', // none | ok | permission | error
    lastSaved: null,
    error: '',
  };

  // ---------- IndexedDB ----------
  const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  function open() {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('questions', { keyPath: 'id' });
      d.createObjectStore('ranking', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    return req(r);
  }

  function tx(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const out = Promise.resolve(fn(t));
      t.oncomplete = () => out.then(resolve, reject);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('No se pudo guardar.'));
    });
  }

  const all = (store) => tx(store, 'readonly', (t) => req(t.objectStore(store).getAll()));
  const kvGet = (key) => tx('kv', 'readonly', (t) => req(t.objectStore('kv').get(key)));
  const kvSet = (key, val) => tx('kv', 'readwrite', (t) => { t.objectStore('kv').put(val, key); });
  const kvDel = (key) => tx('kv', 'readwrite', (t) => { t.objectStore('kv').delete(key); });

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- validación ----------
  const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

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

  function validEntry(r) {
    return r && typeof r.name === 'string' && Number.isFinite(Number(r.score));
  }

  // ---------- inicio ----------
  async function init() {
    db = await open();
    // pedimos que el navegador no borre los datos por falta de espacio
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* sin soporte */ }

    if (!(await kvGet('initialized'))) {
      // primera vez en este navegador: cargamos las preguntas de ejemplo
      let seed = [];
      try { seed = await (await fetch('seed-questions.json')).json(); } catch { /* sin preguntas de ejemplo */ }
      await tx(['questions', 'kv'], 'readwrite', (t) => {
        seed.forEach((q, i) => {
          const r = validateQuestion(q);
          if (!r.error) t.objectStore('questions').put({ id: q.id || newId(), createdAt: i, ...r.value });
        });
        t.objectStore('kv').put({ ...DEFAULT_SETTINGS }, 'settings');
        t.objectStore('kv').put(true, 'initialized');
      });
    }

    if (backup.supported) {
      backup.handle = (await kvGet(FILE_KV)) || null;
      if (backup.handle) await checkPermission();
    }
    emit();
  }

  // ---------- preguntas ----------
  async function getQuestions() {
    return (await all('questions')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function saveQuestion(body, id) {
    const r = validateQuestion(body);
    if (r.error) throw new Error(r.error);
    const prev = id ? await tx('questions', 'readonly', (t) => req(t.objectStore('questions').get(id))) : null;
    const q = { id: id || newId(), createdAt: prev ? prev.createdAt : Date.now(), ...r.value };
    await tx('questions', 'readwrite', (t) => { t.objectStore('questions').put(q); });
    changed();
    return q;
  }

  async function deleteQuestion(id) {
    await tx('questions', 'readwrite', (t) => { t.objectStore('questions').delete(id); });
    changed();
  }

  async function importQuestions(list) {
    if (!Array.isArray(list)) throw new Error('El archivo no tiene preguntas.');
    const errors = [];
    let added = 0;
    await tx('questions', 'readwrite', (t) => {
      list.forEach((item, i) => {
        const r = validateQuestion(item || {});
        if (r.error) errors.push(`#${i + 1}: ${r.error}`);
        else { t.objectStore('questions').put({ id: newId(), createdAt: Date.now() + i, ...r.value }); added++; }
      });
    });
    changed();
    return { added, errors };
  }

  // ---------- ranking ----------
  const sortRanking = (list) =>
    list.sort((a, b) => b.score - a.score || b.correct - a.correct || a.finishedAt - b.finishedAt);

  async function getRanking() {
    return sortRanking(await all('ranking'));
  }

  async function addResult(entry) {
    const e = { id: newId(), finishedAt: Date.now(), ...entry };
    await tx('ranking', 'readwrite', (t) => { t.objectStore('ranking').put(e); });
    changed();
    const list = await getRanking();
    return { entry: e, position: list.findIndex((r) => r.id === e.id) + 1, players: list.length };
  }

  async function clearRanking() {
    await tx('ranking', 'readwrite', (t) => { t.objectStore('ranking').clear(); });
    changed();
  }

  // ---------- ajustes y PIN ----------
  async function getSettings() {
    return { ...DEFAULT_SETTINGS, ...((await kvGet('settings')) || {}) };
  }

  async function saveSettings(body) {
    const s = await getSettings();
    const n = Math.round(Number(body.questionsPerGame));
    const next = {
      ...s,
      title: cleanText(body.title, 60) || s.title,
      questionsPerGame: n >= 1 && n <= 50 ? n : s.questionsPerGame,
      shuffle: Boolean(body.shuffle),
    };
    await kvSet('settings', next);
    changed();
    return next;
  }

  async function checkPin(pin) {
    const s = await getSettings();
    return (await sha256(String(pin))) === (s.pinHash || (await sha256(DEFAULT_PIN)));
  }

  async function setPin(pin) {
    pin = String(pin || '').trim();
    if (pin.length < 4) throw new Error('El PIN tiene que tener al menos 4 caracteres.');
    const s = await getSettings();
    await kvSet('settings', { ...s, pinHash: await sha256(pin) });
    changed();
  }

  const usingDefaultPin = async () => !(await getSettings()).pinHash;

  // ---------- copia completa ----------
  async function snapshot() {
    return {
      app: 'preguntero',
      version: 1,
      savedAt: new Date().toISOString(),
      settings: await getSettings(),
      questions: await getQuestions(),
      ranking: await getRanking(),
    };
  }

  function isSnapshot(data) {
    return data && data.app === 'preguntero' && Array.isArray(data.questions) && Array.isArray(data.ranking);
  }

  async function restore(data) {
    if (!isSnapshot(data)) throw new Error('El archivo no es una copia del Preguntero.');
    // el PIN no viaja con los datos: así un PIN olvidado se arregla restaurando en un navegador limpio
    const { pinHash } = await getSettings();
    await tx(['questions', 'ranking', 'kv'], 'readwrite', (t) => {
      const qs = t.objectStore('questions');
      const rk = t.objectStore('ranking');
      qs.clear();
      rk.clear();
      data.questions.forEach((q, i) => {
        const r = validateQuestion(q || {});
        const createdAt = Number.isFinite(q.createdAt) ? q.createdAt : i;
        if (!r.error) qs.put({ id: String(q.id || newId()), createdAt, ...r.value });
      });
      for (const r of data.ranking) if (validEntry(r)) rk.put({ ...r, id: String(r.id || newId()) });
      t.objectStore('kv').put({ ...DEFAULT_SETTINGS, ...(data.settings || {}), pinHash }, 'settings');
    });
    changed();
  }

  function download(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function downloadCopy() {
    download(await snapshot(), `preguntero-copia-${new Date().toISOString().slice(0, 10)}.json`);
  }

  // ---------- archivo de respaldo (File System Access API: Chrome y Edge) ----------
  function emit() { listeners.forEach((fn) => fn(backupState())); }
  const backupState = () => ({
    supported: backup.supported,
    linked: Boolean(backup.handle),
    fileName: backup.handle ? backup.handle.name : '',
    status: backup.status,
    lastSaved: backup.lastSaved,
    error: backup.error,
  });
  function onBackupChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function checkPermission() {
    try {
      const p = await backup.handle.queryPermission({ mode: 'readwrite' });
      backup.status = p === 'granted' ? 'ok' : 'permission';
    } catch {
      backup.status = 'permission';
    }
  }

  let saveTimer = null;
  let pendingSave = false;
  let writing = Promise.resolve();

  function changed() {
    if (!backup.handle) return;
    pendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }

  function flush() {
    clearTimeout(saveTimer);
    if (!pendingSave || !backup.handle || backup.status !== 'ok') return writing;
    pendingSave = false;
    writing = writing.then(writeFile);
    return writing;
  }

  async function writeFile() {
    try {
      const data = JSON.stringify(await snapshot(), null, 2);
      const w = await backup.handle.createWritable();
      await w.write(data);
      await w.close();
      backup.status = 'ok';
      backup.lastSaved = new Date();
      backup.error = '';
    } catch (err) {
      pendingSave = true;
      if (err && err.name === 'NotAllowedError') backup.status = 'permission';
      else { backup.status = 'error'; backup.error = (err && err.message) || 'No se pudo escribir el archivo.'; }
    }
    emit();
  }

  const FILE_TYPES = [{ description: 'Datos del Preguntero', accept: { 'application/json': ['.json'] } }];

  // Crea un archivo nuevo y guarda ahí todos los datos actuales
  async function createBackupFile() {
    const handle = await window.showSaveFilePicker({ suggestedName: 'preguntero-datos.json', types: FILE_TYPES });
    await useHandle(handle);
    pendingSave = true;
    await flush();
  }

  // Abre un archivo existente. Devuelve sus datos (o null si está vacío o no es del Preguntero)
  async function pickExistingFile() {
    const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
    let data = null;
    try {
      const text = await (await handle.getFile()).text();
      data = text.trim() ? JSON.parse(text) : null;
    } catch { data = null; }
    if (data && !isSnapshot(data)) throw new Error('Ese archivo no es un respaldo del Preguntero.');
    return { handle, data };
  }

  // Vincula el archivo elegido. Si loadFromFile es true, primero carga sus datos en la app.
  async function linkExistingFile(handle, data, loadFromFile) {
    const p = await handle.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') throw new Error('Sin permiso para guardar en ese archivo.');
    if (loadFromFile && data) await restore(data);
    await useHandle(handle);
    pendingSave = true;
    await flush();
  }

  async function useHandle(handle) {
    backup.handle = handle;
    await kvSet(FILE_KV, handle);
    await checkPermission();
    emit();
  }

  // Tiene que llamarse desde un clic (el navegador muestra el permiso)
  async function reconnect() {
    if (!backup.handle) return false;
    try {
      const p = await backup.handle.requestPermission({ mode: 'readwrite' });
      backup.status = p === 'granted' ? 'ok' : 'permission';
    } catch {
      backup.status = 'permission';
    }
    emit();
    if (backup.status === 'ok') { pendingSave = true; await flush(); }
    return backup.status === 'ok';
  }

  async function unlinkFile() {
    backup.handle = null;
    backup.status = 'none';
    backup.lastSaved = null;
    pendingSave = false;
    await kvDel(FILE_KV);
    emit();
  }

  // Si se cierra la pestaña con cambios sin escribir, intentamos guardarlos
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  async function storageInfo() {
    const out = { persisted: false, usage: 0 };
    try {
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
      if (navigator.storage && navigator.storage.estimate) out.usage = (await navigator.storage.estimate()).usage || 0;
    } catch { /* sin soporte */ }
    return out;
  }

  return {
    init,
    getQuestions, saveQuestion, deleteQuestion, importQuestions,
    getRanking, addResult, clearRanking,
    getSettings, saveSettings, checkPin, setPin, usingDefaultPin,
    snapshot, restore, isSnapshot, downloadCopy, download,
    backupState, onBackupChange, createBackupFile, pickExistingFile, linkExistingFile, reconnect, unlinkFile, flush,
    storageInfo,
  };
})();
