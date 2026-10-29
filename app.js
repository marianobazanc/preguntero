/* Preguntero — cliente (SPA sin dependencias) */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const AVATARS = [
    ['cell', 'Célula'], ['bacteria', 'Bacteria'], ['virus', 'Virus'], ['frog', 'Rana'],
    ['mushroom', 'Hongo'], ['fish', 'Pez'], ['leaf', 'Hoja'], ['dna', 'ADN'],
  ];
  const AVATAR_IDS = AVATARS.map(([id]) => id);
  const ANSWER_ICONS = ['ico-cell', 'ico-dna', 'ico-leaf', 'ico-bacteria'];

  const state = {
    info: null,
    player: loadPlayer(),
    game: null,
    lastGameId: null,
    pin: sessionStorage.getItem('preguntero-pin') || '',
    sound: localStorage.getItem('preguntero-sound') !== 'off',
  };

  let cleanup = () => {};

  // ---------- utilidades ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const ic = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const art = (id, cls = '') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#${id}"/></svg>`;
  const avatar = (id, cls = '') => art('ico-' + (AVATAR_IDS.includes(id) ? id : 'cell'), cls);
  const mascot = (cls = 'mascot') => `<svg class="${cls}" viewBox="0 0 200 200" role="img" aria-label="Celu, la mascota"><use href="#mascot"/></svg>`;
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');

  function loadPlayer() {
    const def = { name: '', avatar: 'cell' };
    try {
      const p = JSON.parse(localStorage.getItem('preguntero-player')) || def;
      if (!AVATARS.some(([id]) => id === p.avatar)) p.avatar = 'cell';
      return p;
    } catch { return def; }
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.admin) headers['X-Admin-Pin'] = state.pin;
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Error de conexión'), { status: res.status });
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false, sound = isError ? 'error' : 'notify') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    if (sound) sfx(sound);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------- sonido (Howler.js + efectos de Kenney, CC0) ----------
  // nombre -> volumen base. Los archivos están en /sounds/<nombre>.mp3
  const SOUNDS = {
    click: 0.45, select: 0.5, hover: 0.12, toggle: 0.5,
    'whoosh-in': 0.22, 'whoosh-out': 0.18, panel: 0.3, pop: 0.3, pluck: 0.3,
    count: 0.6, go: 0.45, tick: 0.22, 'tick-hard': 0.5, timeup: 0.45,
    correct: 0.55, streak: 0.5, wrong: 0.45, points: 0.35, rise: 0.4,
    notify: 0.3, error: 0.4, save: 0.45, delete: 0.4, win: 0.55, finish: 0.5,
  };
  const howls = {};
  if (window.Howl) {
    for (const [name, volume] of Object.entries(SOUNDS)) {
      howls[name] = new Howl({ src: [`/sounds/${name}.mp3`], volume, preload: true });
    }
  }
  function sfx(name, { rate = 1, volume, delay = 0 } = {}) {
    if (!state.sound || !howls[name]) return;
    const play = () => {
      const h = howls[name];
      const id = h.play();
      if (rate !== 1) h.rate(rate, id);
      if (volume !== undefined) h.volume(volume, id);
    };
    if (delay) setTimeout(play, delay);
    else play();
  }

  // Sonido de clic para todos los botones; data-sfx cambia o anula el sonido
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.btn, .navbtn, .tab, .iconbtn, .teacher-link');
    if (!el || el.disabled || el.id === 'soundToggle') return;
    const name = el.closest('[data-sfx]')?.dataset.sfx ?? 'click';
    if (name !== 'none') sfx(name);
  });
  // Sonido suave al pasar el mouse (solo en dispositivos con puntero)
  let lastHover = 0;
  let hoverEl = null;
  if (matchMedia('(hover: hover)').matches) {
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('.btn, .ans:not(:disabled), .avatar-opt, .tab');
      if (!el || el === hoverEl || el.disabled) { hoverEl = el; return; }
      hoverEl = el;
      const now = performance.now();
      if (now - lastHover > 70) { lastHover = now; sfx('hover'); }
    });
  }

  const soundBtn = document.getElementById('soundToggle');
  const paintSound = () => { soundBtn.innerHTML = ic(state.sound ? 'sound' : 'mute'); };
  soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    localStorage.setItem('preguntero-sound', state.sound ? 'on' : 'off');
    paintSound();
    sfx('toggle');
  });
  paintSound();

  // ---------- confeti (formas planas) ----------
  function confetti(duration = 3500) {
    const cv = document.getElementById('confetti');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#3fae6a', '#3b82c4', '#ef7c5f', '#f5c341', '#7d5ba6'];
    const parts = Array.from({ length: 120 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      s: 7 + Math.random() * 7,
      c: colors[(Math.random() * colors.length) | 0],
      round: Math.random() < 0.4,
    }));
    const end = performance.now() + duration;
    (function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.04;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.strokeStyle = '#1e2b2b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (p.round) ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2);
        else ctx.rect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      if (now < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(performance.now());
  }

  // ---------- router ----------
  const routes = {
    '': renderHome,
    jugar: renderJoin,
    partida: renderGame,
    resultado: renderResult,
    ranking: renderRanking,
    profesor: renderAdmin,
  };

  let firstRoute = true;
  function router() {
    cleanup();
    cleanup = () => {};
    const key = location.hash.replace(/^#\/?/, '').split('/')[0];
    const fn = routes[key] || renderHome;
    if (!firstRoute) sfx('whoosh-in');
    firstRoute = false;
    $app.innerHTML = '';
    window.scrollTo(0, 0);
    fn();
    $app.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', router);

  function go(hash) {
    if (location.hash === hash) router();
    else location.hash = hash;
  }

  async function getInfo() {
    try { state.info = await api('/info'); } catch { /* sin conexión */ }
    return state.info;
  }

  // ---------- pantalla: inicio ----------
  async function renderHome() {
    $app.innerHTML = `
      <section class="screen hero">
        ${mascot()}
        <h1 class="title">Pregun<span>tero</span></h1>
        <p class="subtitle" id="homeSubtitle">Poné a prueba lo que sabés de Biología</p>
        <span class="chip" id="homeChip">Cargando preguntas…</span>
        <div class="home-actions">
          <a class="btn big" href="#/jugar">${ic('play')} Jugar</a>
          <a class="btn ghost" href="#/ranking">${ic('trophy')} Ver ranking</a>
        </div>
        <div class="feature-row">
          <div class="feature">${art('ico-microscope')}<div><b>Respondé rápido</b><small>Más velocidad, más puntos</small></div></div>
          <div class="feature">${art('ico-dna')}<div><b>Hacé rachas</b><small>Acertá seguido y sumá bonus</small></div></div>
          <div class="feature">${art('ico-cell')}<div><b>Llegá al podio</b><small>Los 3 mejores se destacan</small></div></div>
        </div>
        <a class="teacher-link" href="#/profesor">${ic('lock')} Panel docente</a>
      </section>`;
    const info = await getInfo();
    if (!info) return;
    document.getElementById('homeSubtitle').textContent = `${info.title} · Poné a prueba lo que sabés`;
    document.getElementById('homeChip').textContent = info.totalQuestions
      ? `${info.questionsPerGame} preguntas por partida`
      : 'Todavía no hay preguntas cargadas';
  }

  // ---------- pantalla: ingreso de nombre ----------
  function renderJoin() {
    const p = state.player;
    $app.innerHTML = `
      <section class="screen card join stack">
        <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
          <div>
            <h2>¿Quién juega?</h2>
            <p class="muted" style="margin:4px 0 0;font-weight:700">Escribí tu nombre y elegí tu personaje.</p>
          </div>
          ${mascot('mascot-sm')}
        </div>
        <form id="joinForm" class="stack" autocomplete="off">
          <div>
            <label class="label" for="name">Tu nombre</label>
            <input class="input" id="name" maxlength="24" placeholder="Ej: Martina G." value="${esc(p.name)}" required>
          </div>
          <div>
            <span class="label">Tu personaje</span>
            <div class="avatars" role="group" aria-label="Elegí un personaje">
              ${AVATARS.map(([id, label]) => `<button type="button" class="avatar-opt" data-av="${id}" aria-pressed="${id === p.avatar}" aria-label="${label}" title="${label}">${avatar(id)}</button>`).join('')}
            </div>
          </div>
          <button class="btn big" type="submit" id="startBtn">Empezar ${ic('arrow')}</button>
        </form>
      </section>`;
    $app.querySelector('.mascot-sm').style.cssText = 'width:80px;height:80px;flex:none';
    let chosen = p.avatar;
    $app.querySelectorAll('.avatar-opt').forEach((b) =>
      b.addEventListener('click', () => {
        chosen = b.dataset.av;
        $app.querySelectorAll('.avatar-opt').forEach((x) => x.setAttribute('aria-pressed', x === b));
        sfx('select', { rate: 0.9 + Math.random() * 0.2 });
      })
    );
    const nameInput = document.getElementById('name');
    if (!p.name) nameInput.focus();
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (name.length < 2) return toast('Escribí tu nombre (mínimo 2 letras)', true);
      const btn = document.getElementById('startBtn');
      btn.disabled = true;
      try {
        state.player = { name, avatar: chosen };
        localStorage.setItem('preguntero-player', JSON.stringify(state.player));
        const g = await api('/games', { method: 'POST', body: { name, avatar: chosen } });
        state.game = { ...g, index: 0, score: 0, streak: 0 };
        go('#/partida');
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
  }

  // ---------- pantalla: partida ----------
  function renderGame() {
    const g = state.game;
    if (!g) return go('#/jugar');
    let n = 3;
    $app.innerHTML = `<section class="countdown"><div class="num" id="cd">3</div></section>`;
    const cd = document.getElementById('cd');
    const restart = () => { cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = ''; };
    sfx('count');
    let go;
    const iv = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(iv);
        sfx('go');
        cd.textContent = '¡Ya!';
        restart();
        go = setTimeout(showQuestion, 600);
        return;
      }
      sfx('count', { rate: 1 + (3 - n) * 0.12 });
      cd.textContent = n;
      restart();
    }, 900);
    cleanup = () => { clearInterval(iv); clearTimeout(go); };
  }

  function showQuestion() {
    const g = state.game;
    const q = g.questions[g.index];
    const total = g.questions.length;
    const timeMs = g.questionTimeMs;
    $app.innerHTML = `
      <section class="screen">
        <div class="hud">
          <div class="player">${avatar(state.player.avatar)}<span class="nm">${esc(state.player.name)}</span></div>
          <div class="row" style="gap:10px;flex-wrap:nowrap">
            ${g.streak >= 2 ? `<span class="streak">${ic('flame')} x${g.streak}</span>` : ''}
            <span class="score-pill">${ic('star')} <span id="scoreVal">${fmt(g.score)}</span></span>
          </div>
        </div>
        <div class="progress" aria-hidden="true"><i style="width:${(g.index / total) * 100}%"></i></div>
        <article class="card qcard">
          <div class="qmeta">
            <div>
              <div class="qnum">Pregunta ${g.index + 1} de ${total}</div>
              <span class="chip blue">${esc(q.topic)}</span>
            </div>
            <div class="timer" id="timer" role="timer" aria-label="Tiempo restante">
              <svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="28"/><circle class="bar" cx="32" cy="32" r="28"/><circle class="rim" cx="32" cy="32" r="31"/><circle class="rim" cx="32" cy="32" r="24.5"/></svg>
              <b id="timerNum">${Math.round(timeMs / 1000)}</b>
            </div>
          </div>
          <h2 class="qtext">${esc(q.text)}</h2>
          ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="Imagen de la pregunta">` : ''}
          <div class="answers">
            ${q.answers.map((a, i) => `
              <button class="ans enter" data-i="${i}" style="--d:${i}">
                <span class="ico">${art(ANSWER_ICONS[i])}</span>
                <span>${esc(a)}</span>
              </button>`).join('')}
          </div>
          <div id="feedback"></div>
        </article>
      </section>`;

    const timerEl = document.getElementById('timer');
    const timerNum = document.getElementById('timerNum');
    // Las opciones entran de a una, con un "pop" que sube de tono
    const pops = q.answers.map((_, i) => setTimeout(() => sfx('pop', { rate: 1 + i * 0.12 }), 150 + i * 90));

    const start = performance.now();
    let done = false;
    let lastHalf = Math.ceil(timeMs / 500);
    let raf;

    // Contrarreloj: un tic suave por segundo; en los últimos 5 segundos,
    // tic fuerte cada medio segundo y cada vez más agudo.
    const tick = () => {
      const left = Math.max(0, timeMs - (performance.now() - start));
      const p = left / timeMs;
      timerEl.style.setProperty('--p', p);
      const half = Math.ceil(left / 500);
      if (half !== lastHalf && left > 0) {
        lastHalf = half;
        const sec = Math.ceil(left / 1000);
        const onSecond = half % 2 === 0;
        if (onSecond) timerNum.textContent = sec;
        if (sec <= 5) sfx('tick-hard', { rate: 1 + (5 - sec) * 0.1, volume: onSecond ? 0.55 : 0.3 });
        else if (onSecond) sfx('tick');
      }
      timerEl.classList.toggle('warn', p < 0.5 && p >= 0.25);
      timerEl.classList.toggle('danger', p < 0.25);
      if (left <= 0) {
        timerNum.textContent = 0;
        return answer(-1, timeMs);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanup = () => { cancelAnimationFrame(raf); pops.forEach(clearTimeout); };

    $app.querySelectorAll('.ans').forEach((b) =>
      b.addEventListener('click', () => answer(Number(b.dataset.i), performance.now() - start))
    );

    async function answer(choice, elapsed) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      if (choice < 0) sfx('timeup');
      else sfx('click');
      const btns = [...$app.querySelectorAll('.ans')];
      btns.forEach((b) => { b.disabled = true; b.classList.remove('enter'); });
      let r;
      try {
        r = await api(`/games/${g.gameId}/answer`, {
          method: 'POST',
          body: { questionId: q.id, choice: choice >= 0 ? choice : null, timeMs: Math.round(elapsed) },
        });
      } catch (err) {
        toast(err.message, true);
        if (err.status === 404) return go('#/jugar');
        r = { isCorrect: false, points: 0, correctChoice: -1, explanation: '', score: g.score, streak: 0 };
      }
      g.score = r.score;
      g.streak = r.streak;
      document.getElementById('scoreVal').textContent = fmt(g.score);

      btns.forEach((b, i) => {
        if (i === r.correctChoice) {
          b.classList.add('correct');
          b.insertAdjacentHTML('beforeend', `<span class="mark">${ic('check')}</span>`);
        } else if (i === choice) {
          b.classList.add('wrong');
          b.insertAdjacentHTML('beforeend', `<span class="mark">${ic('x')}</span>`);
        } else b.classList.add('dim');
      });

      if (r.isCorrect) {
        sfx(g.streak >= 3 ? 'streak' : 'correct');
        sfx('points', { rate: 1 + Math.min(g.streak, 5) * 0.08, delay: 280 });
        const pop = document.createElement('div');
        pop.className = 'points-pop';
        pop.textContent = `+${fmt(r.points)}`;
        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1200);
      } else if (choice >= 0) sfx('wrong');

      const praise = ['¡Excelente!', '¡Genial!', '¡Bien ahí!', '¡Sos crack!', '¡Impecable!'];
      const title = r.isCorrect
        ? praise[(Math.random() * praise.length) | 0]
        : choice < 0 ? '¡Se terminó el tiempo!' : '¡Uy, casi!';
      const last = g.index + 1 >= g.questions.length;
      const fb = document.getElementById('feedback');
      fb.innerHTML = `
        <div class="feedback ${r.isCorrect ? 'ok' : 'bad'}">
          ${mascot('mascot-sm ' + (r.isCorrect ? 'happy' : 'sad'))}
          <div>
            <h3>${esc(title)}${r.isCorrect && g.streak >= 2 ? ` <span class="streak">${ic('flame')} Racha x${g.streak}</span>` : ''}</h3>
            ${r.explanation ? `<p>${ic('bulb')}<span>${esc(r.explanation)}</span></p>` : ''}
          </div>
          <div class="actions"><button class="btn ${last ? 'yellow' : ''}" id="nextBtn">${last ? `Ver resultados ${ic('flag')}` : `Siguiente ${ic('arrow')}`}</button></div>
        </div>`;
      sfx('panel', { delay: 450 });
      const next = document.getElementById('nextBtn');
      next.focus({ preventScroll: true });
      fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      next.addEventListener('click', () => {
        if (last) return go('#/resultado');
        sfx('whoosh-in');
        g.index += 1;
        showQuestion();
      });
    }
  }

  // ---------- pantalla: resultado ----------
  async function renderResult() {
    const g = state.game;
    if (!g) return go('#/ranking');
    $app.innerHTML = `<div class="loader">${art('ico-dna')}</div>`;
    let r;
    try {
      r = await api(`/games/${g.gameId}/finish`, { method: 'POST' });
    } catch (err) {
      toast(err.message, true);
      return go('#/ranking');
    }
    state.lastGameId = g.gameId;
    const pct = r.total ? r.correct / r.total : 0;
    const msg = pct === 1 ? '¡Perfecto! Sabés muchísimo de biología.'
      : pct >= 0.7 ? '¡Muy buen trabajo!'
      : pct >= 0.4 ? 'Vas bien. Repasá un poco y volvé a intentar.'
      : 'A seguir estudiando: cada error también enseña.';
    $app.innerHTML = `
      <section class="screen card results">
        ${mascot()}
        <h2 class="who">${avatar(state.player.avatar)} ${esc(state.player.name)}</h2>
        <div class="big-score" id="bigScore">0</div>
        <div class="muted" style="font-weight:800">puntos</div>
        <div class="stats">
          <div class="stat"><b>${r.correct}/${r.total}</b><span>correctas</span></div>
          <div class="stat"><b>${r.position}°</b><span>de ${r.players} jugadores</span></div>
          <div class="stat"><b>${r.bestStreak}</b><span>mejor racha</span></div>
        </div>
        <p class="result-msg">${msg}</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <a class="btn yellow" href="#/ranking">${ic('trophy')} Ver ranking</a>
          <a class="btn ghost" href="#/jugar">${ic('refresh')} Jugar otra vez</a>
        </div>
      </section>`;
    state.game = null;

    // El puntaje sube contando, con tics que se aceleran
    const el = document.getElementById('bigScore');
    const dur = r.score ? 1100 : 0;
    const t0 = performance.now();
    let lastStep = -1;
    let raf;
    const count = (now) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(r.score * eased));
      const step = Math.floor(eased * 14);
      if (step !== lastStep && k < 1) { lastStep = step; sfx('tick', { rate: 1 + step * 0.05, volume: 0.3 }); }
      if (k < 1) raf = requestAnimationFrame(count);
      else {
        const great = r.position <= 3 || pct >= 0.7;
        sfx(great ? 'win' : 'finish');
        if (great) confetti();
      }
    };
    raf = requestAnimationFrame(count);
    cleanup = () => cancelAnimationFrame(raf);
  }

  // ---------- pantalla: ranking ----------
  async function renderRanking() {
    $app.innerHTML = `
      <section class="screen">
        <div class="rank-head">
          <h2>${ic('trophy')} Ranking</h2>
          <div class="row">
            <span class="hint" id="rankCount"></span>
            <a class="btn small" href="#/jugar">${ic('play')} Jugar</a>
          </div>
        </div>
        <div id="rankBody"><div class="loader">${art('ico-dna')}</div></div>
      </section>`;
    let first = true;
    let lastSig = '';
    const load = async () => {
      let list;
      try { list = await api('/ranking'); } catch (err) { if (first) toast(err.message, true); return; }
      const sig = JSON.stringify(list.map((r) => [r.id, r.score]));
      if (sig === lastSig) return;
      lastSig = sig;
      if (!first) sfx('pluck'); // alguien nuevo terminó de jugar
      paintRanking(list, first);
      first = false;
    };
    await load();
    const iv = setInterval(load, 5000); // se actualiza solo (ideal para proyectar en el aula)
    cleanup = () => clearInterval(iv);
  }

  function paintRanking(list, celebrate) {
    const body = document.getElementById('rankBody');
    if (!body) return;
    document.getElementById('rankCount').textContent = list.length ? `${list.length} jugador${list.length === 1 ? '' : 'es'}` : '';
    if (!list.length) {
      body.innerHTML = `
        <div class="card empty-state">
          ${art('ico-microscope')}
          <h3 style="font-size:1.6rem;margin-top:8px">Todavía no jugó nadie</h3>
          <p class="muted" style="font-weight:700">¡Sé el primero en llegar al podio!</p>
          <a class="btn" href="#/jugar">${ic('play')} Jugar ahora</a>
        </div>`;
      return;
    }
    const podiumSlot = (r, place) => {
      if (!r) return `<div class="pod p${place} empty"><div class="pav">${avatar('cell')}</div><div class="pname">—</div><div class="ppts">&nbsp;</div><div class="block">${place}</div></div>`;
      const me = r.id === state.lastGameId;
      return `
        <div class="pod p${place}">
          ${place === 1 ? '<svg class="crown" aria-hidden="true"><use href="#i-crown"/></svg>' : ''}
          <div class="pav">${avatar(r.avatar)}</div>
          <div class="pname" title="${esc(r.name)}">${esc(r.name)}${me ? ' (vos)' : ''}</div>
          <div class="ppts">${fmt(r.score)} pts</div>
          <div class="block">${place}</div>
        </div>`;
    };
    const rest = list.slice(3);
    body.innerHTML = `
      <div class="podium">${podiumSlot(list[1], 2)}${podiumSlot(list[0], 1)}${podiumSlot(list[2], 3)}<div class="podium-base"></div></div>
      ${rest.length ? `<ol class="rank-list" start="4">
        ${rest.map((r, i) => `
          <li class="${r.id === state.lastGameId ? 'me' : ''}" style="animation-delay:${Math.min(i, 15) * 40}ms">
            <span class="pos">${i + 4}</span>
            ${avatar(r.avatar, 'av')}
            <span class="nm">${esc(r.name)}<small>${r.correct}/${r.total} correctas · racha ${r.bestStreak}</small></span>
            <span class="pts">${fmt(r.score)}</span>
          </li>`).join('')}
      </ol>` : ''}`;
    if (celebrate) {
      // Los escalones suben 3° → 2° → 1°, cada uno con su sonido
      const n = Math.min(list.length, 3);
      if (n >= 3) sfx('rise', { rate: 0.9, delay: 150 });
      if (n >= 2) sfx('rise', { rate: 1.0, delay: 350 });
      sfx('rise', { rate: 1.15, delay: 550 });
      sfx('streak', { delay: 950 });
      if (rest.length) sfx('pluck', { delay: 1100 });
      if (state.lastGameId && list.slice(0, 3).some((r) => r.id === state.lastGameId)) {
        sfx('win', { delay: 1200 });
        setTimeout(confetti, 1000);
      }
    }
  }

  // ---------- pantalla: panel docente ----------
  async function renderAdmin() {
    if (state.pin) {
      try { await api('/admin/login', { method: 'POST', admin: true }); return adminPanel(); }
      catch { state.pin = ''; sessionStorage.removeItem('preguntero-pin'); }
    }
    $app.innerHTML = `
      <section class="screen card join stack center">
        ${art('ico-microscope')}
        <h2>Panel docente</h2>
        <p class="muted" style="margin:0;font-weight:700">Ingresá el PIN para cargar y editar preguntas.</p>
        <form id="pinForm" class="stack">
          <input class="input" id="pin" type="password" placeholder="PIN" autocomplete="current-password" required style="text-align:center">
          <button class="btn purple" type="submit">${ic('lock')} Entrar</button>
        </form>
      </section>`;
    $app.querySelector('svg').style.cssText = 'width:84px;height:84px;margin:0 auto';
    const pinInput = document.getElementById('pin');
    pinInput.focus();
    document.getElementById('pinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      state.pin = pinInput.value;
      try {
        await api('/admin/login', { method: 'POST', admin: true });
        sessionStorage.setItem('preguntero-pin', state.pin);
        adminPanel();
      } catch (err) {
        state.pin = '';
        toast(err.message, true);
        pinInput.select();
      }
    });
  }

  async function adminPanel(tab = 'preguntas') {
    $app.innerHTML = `
      <section class="screen">
        <div class="admin-head">
          <h2>${art('ico-microscope')} Panel docente</h2>
          <button class="btn small ghost" id="logout">${ic('logout')} Salir</button>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="preguntas">${ic('list')} Preguntas</button>
          <button class="tab" role="tab" data-tab="nueva">${ic('plus')} Nueva pregunta</button>
          <button class="tab" role="tab" data-tab="ajustes">${ic('sliders')} Ajustes</button>
        </div>
        <div id="adminBody"></div>
      </section>`;
    document.getElementById('logout').addEventListener('click', () => {
      state.pin = '';
      sessionStorage.removeItem('preguntero-pin');
      go('#/');
    });
    const tabs = [...$app.querySelectorAll('.tab')];
    const show = (t, payload) => {
      tabs.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
      const body = document.getElementById('adminBody');
      body.innerHTML = '';
      if (t === 'preguntas') adminList(body, show);
      else if (t === 'nueva') adminForm(body, show, payload);
      else adminSettings(body);
    };
    tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    show(tab);
  }

  async function adminList(body, show) {
    body.innerHTML = `<div class="loader">${art('ico-dna')}</div>`;
    let qs;
    try { qs = await api('/admin/questions', { admin: true }); }
    catch (err) { body.innerHTML = ''; return toast(err.message, true); }
    if (!qs.length) {
      body.innerHTML = `
        <div class="card empty-state">
          ${art('ico-leaf')}
          <h3 style="font-size:1.6rem;margin-top:8px">No hay preguntas todavía</h3>
          <p class="muted" style="font-weight:700">Cargá la primera para que los chicos puedan jugar.</p>
          <button class="btn" id="firstQ">${ic('plus')} Crear pregunta</button>
        </div>`;
      document.getElementById('firstQ').addEventListener('click', () => show('nueva'));
      return;
    }
    const topics = [...new Set(qs.map((q) => q.topic))];
    body.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <span class="hint">${qs.length} pregunta${qs.length === 1 ? '' : 's'} · ${topics.length} tema${topics.length === 1 ? '' : 's'}</span>
        <button class="btn small" id="addQ">${ic('plus')} Nueva</button>
      </div>
      <div class="qlist">
        ${qs.map((q, i) => `
          <div class="qitem">
            <span class="n">${i + 1}</span>
            <div>
              <div class="t">${esc(q.text)}</div>
              <div class="tags">
                <span class="tag topic">${esc(q.topic)}</span>
                <span class="tag ok">${ic('check')} ${esc(q.answers[q.correct])}</span>
                <span class="tag">${q.answers.length} opciones</span>
                ${q.image ? `<span class="tag">${ic('image')} imagen</span>` : ''}
              </div>
            </div>
            <div class="acts">
              <button class="iconbtn" data-edit="${esc(q.id)}" title="Editar" aria-label="Editar">${ic('edit')}</button>
              <button class="iconbtn del" data-sfx="none" data-del="${esc(q.id)}" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>
            </div>
          </div>`).join('')}
      </div>`;
    document.getElementById('addQ').addEventListener('click', () => show('nueva'));
    body.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => show('nueva', qs.find((q) => q.id === b.dataset.edit)))
    );
    body.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const q = qs.find((x) => x.id === b.dataset.del);
        if (!confirm(`¿Eliminar la pregunta?\n\n"${q.text}"`)) return;
        try {
          await api('/admin/questions/' + q.id, { method: 'DELETE', admin: true });
          toast('Pregunta eliminada', false, 'delete');
          adminList(body, show);
        } catch (err) { toast(err.message, true); }
      })
    );
  }

  function adminForm(body, show, editing) {
    const q = editing || { text: '', topic: '', answers: ['', '', '', ''], correct: 0, explanation: '', image: '' };
    const answers = q.answers.slice();
    while (answers.length < 2) answers.push('');
    let correct = q.correct;
    let image = q.image || '';
    const TOPICS = ['Célula', 'ADN y genética', 'División celular', 'Evolución', 'Ecología', 'Metabolismo', 'Biomoléculas', 'Cuerpo humano', 'Microorganismos'];

    body.innerHTML = `
      <form class="card form-grid" id="qForm" autocomplete="off">
        <h3>${editing ? `${ic('edit')} Editar pregunta` : `${ic('plus')} Nueva pregunta`}</h3>
        <div>
          <label class="label" for="qText">Pregunta</label>
          <textarea class="input" id="qText" maxlength="300" required placeholder="Ej: ¿Qué organela realiza la fotosíntesis?">${esc(q.text)}</textarea>
        </div>
        <div>
          <label class="label" for="qTopic">Tema</label>
          <input class="input" id="qTopic" list="topicList" maxlength="40" placeholder="Ej: Célula" value="${esc(q.topic)}">
          <datalist id="topicList">${TOPICS.map((t) => `<option value="${t}">`).join('')}</datalist>
        </div>
        <div>
          <span class="label">Respuestas (marcá la correcta)</span>
          <div class="ans-edit" id="ansEdit"></div>
          <div class="row" style="margin-top:10px">
            <button type="button" class="btn small ghost" id="addAns">${ic('plus')} Agregar opción</button>
            <span class="hint">Entre 2 y 4 opciones.</span>
          </div>
        </div>
        <div>
          <span class="label">Imagen (opcional)</span>
          <div id="imgBox"></div>
        </div>
        <div>
          <label class="label" for="qExp">Explicación (se muestra después de responder)</label>
          <textarea class="input" id="qExp" maxlength="400" placeholder="Ej: Los cloroplastos tienen clorofila, que capta la luz.">${esc(q.explanation)}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn ghost" id="cancelQ">Cancelar</button>
          <button type="submit" class="btn" id="saveQ">${ic('save')} Guardar</button>
        </div>
      </form>`;

    const ansEdit = document.getElementById('ansEdit');
    const paintAnswers = () => {
      ansEdit.innerHTML = answers.map((a, i) => `
        <div class="ans-row ${i === correct ? 'is-correct' : ''}">
          <label class="pick"><input type="radio" name="correct" value="${i}" ${i === correct ? 'checked' : ''}><span>Correcta</span></label>
          <input class="input" data-ans="${i}" maxlength="150" placeholder="Opción ${String.fromCharCode(65 + i)}" value="${esc(a)}">
          <button type="button" class="iconbtn" data-rm="${i}" title="Quitar opción" aria-label="Quitar opción" ${answers.length <= 2 ? 'disabled' : ''}>${ic('x')}</button>
        </div>`).join('');
      document.getElementById('addAns').disabled = answers.length >= 4;
      ansEdit.querySelectorAll('[data-ans]').forEach((inp) =>
        inp.addEventListener('input', () => { answers[Number(inp.dataset.ans)] = inp.value; })
      );
      ansEdit.querySelectorAll('input[type=radio]').forEach((r) =>
        r.addEventListener('change', () => { correct = Number(r.value); paintAnswers(); })
      );
      ansEdit.querySelectorAll('[data-rm]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.rm);
          answers.splice(i, 1);
          if (correct === i) correct = 0;
          else if (correct > i) correct -= 1;
          paintAnswers();
        })
      );
    };
    document.getElementById('addAns').addEventListener('click', () => {
      if (answers.length < 4) { answers.push(''); paintAnswers(); ansEdit.querySelector(`[data-ans="${answers.length - 1}"]`).focus(); }
    });
    paintAnswers();

    const imgBox = document.getElementById('imgBox');
    const paintImage = () => {
      if (image) {
        imgBox.innerHTML = `<div class="img-preview"><img src="${esc(image)}" alt="Vista previa"><button type="button" class="iconbtn" id="rmImg" aria-label="Quitar imagen">${ic('x')}</button></div>`;
        document.getElementById('rmImg').addEventListener('click', () => { image = ''; paintImage(); });
        return;
      }
      imgBox.innerHTML = `
        <label class="img-drop" id="drop">
          ${ic('image')}
          <span>Tocá para subir una imagen o arrastrala acá</span>
          <input type="file" accept="image/*" hidden id="imgFile">
        </label>
        <input class="input" id="imgUrl" placeholder="…o pegá un link https:// a una imagen" style="margin-top:8px;font-size:1rem">`;
      const drop = document.getElementById('drop');
      document.getElementById('imgFile').addEventListener('change', (e) => e.target.files[0] && loadImage(e.target.files[0]));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadImage(e.dataTransfer.files[0]));
      document.getElementById('imgUrl').addEventListener('change', (e) => {
        const v = e.target.value.trim();
        if (/^https?:\/\//.test(v)) { image = v; paintImage(); } else if (v) toast('El link tiene que empezar con https://', true);
      });
    };
    // Reducimos la imagen en el navegador para que no pese demasiado
    const loadImage = (file) => {
      if (!file.type.startsWith('image/')) return toast('Ese archivo no es una imagen', true);
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        image = c.toDataURL('image/jpeg', 0.82);
        URL.revokeObjectURL(img.src);
        paintImage();
      };
      img.onerror = () => toast('No se pudo leer la imagen', true);
      img.src = URL.createObjectURL(file);
    };
    paintImage();

    document.getElementById('cancelQ').addEventListener('click', () => show('preguntas'));
    document.getElementById('qForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        text: document.getElementById('qText').value,
        topic: document.getElementById('qTopic').value,
        explanation: document.getElementById('qExp').value,
        answers: answers.map((a) => a.trim()),
        correct,
        image,
      };
      if (payload.answers.some((a) => !a)) return toast('Completá todas las opciones o quitá las vacías', true);
      const btn = document.getElementById('saveQ');
      btn.disabled = true;
      try {
        if (editing) await api('/admin/questions/' + editing.id, { method: 'PUT', body: payload, admin: true });
        else await api('/admin/questions', { method: 'POST', body: payload, admin: true });
        toast(editing ? 'Pregunta actualizada' : 'Pregunta creada', false, 'save');
        show(editing ? 'preguntas' : 'nueva');
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
    document.getElementById('qText').focus();
  }

  async function adminSettings(body) {
    let s;
    try { s = await api('/admin/settings', { admin: true }); }
    catch (err) { return toast(err.message, true); }
    body.innerHTML = `
      <div class="stack">
        <form class="card form-grid" id="sForm">
          <h3>${ic('sliders')} Configuración del juego</h3>
          <div>
            <label class="label" for="sTitle">Nombre de la materia / curso</label>
            <input class="input" id="sTitle" maxlength="60" value="${esc(s.title)}">
          </div>
          <div>
            <label class="label" for="sCount">Preguntas por partida</label>
            <input class="input" id="sCount" type="number" min="1" max="100" value="${s.questionsPerGame}" style="max-width:160px">
          </div>
          <label class="switch"><input type="checkbox" id="sShuffle" ${s.shuffle ? 'checked' : ''}> Mezclar preguntas y respuestas en cada partida</label>
          <div class="form-actions"><button class="btn" type="submit">${ic('save')} Guardar ajustes</button></div>
        </form>

        <div class="card form-grid">
          <h3>${ic('download')} Importar / exportar preguntas</h3>
          <p class="hint" style="margin:0">Descargá un respaldo en JSON o cargá preguntas de otro curso.</p>
          <div class="row">
            <button class="btn small blue" id="exportQ">${ic('download')} Exportar</button>
            <label class="btn small yellow">${ic('upload')} Importar<input type="file" accept="application/json,.json" id="importQ" hidden></label>
          </div>
        </div>

        <div class="card form-grid">
          <h3>${ic('trophy')} Ranking</h3>
          <p class="hint" style="margin:0">Empezá de cero el ranking (por ejemplo, para otra división o clase).</p>
          <div><button class="btn small danger" id="resetRank">${ic('broom')} Reiniciar ranking</button></div>
        </div>
      </div>`;

    document.getElementById('sForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/admin/settings', {
          method: 'PUT', admin: true,
          body: {
            title: document.getElementById('sTitle').value,
            questionsPerGame: Number(document.getElementById('sCount').value),
            shuffle: document.getElementById('sShuffle').checked,
          },
        });
        toast('Ajustes guardados', false, 'save');
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('exportQ').addEventListener('click', async () => {
      try {
        const qs = await api('/admin/questions', { admin: true });
        const blob = new Blob([JSON.stringify(qs.map(({ id, ...rest }) => rest), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `preguntero-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('importQ').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const r = await api('/admin/questions/import', { method: 'POST', body: data, admin: true });
        toast(`Se importaron ${r.added} preguntas${r.errors.length ? ` (${r.errors.length} con errores)` : ''}`, r.errors.length > 0);
      } catch (err) {
        toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido' : err.message, true);
      }
      e.target.value = '';
    });

    document.getElementById('resetRank').addEventListener('click', async () => {
      if (!confirm('¿Seguro que querés borrar todo el ranking? No se puede deshacer.')) return;
      try {
        await api('/admin/ranking', { method: 'DELETE', admin: true });
        toast('Ranking reiniciado', false, 'delete');
      } catch (err) { toast(err.message, true); }
    });
  }

  router();
})();
