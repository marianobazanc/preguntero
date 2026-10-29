/* Preguntero — cliente (SPA sin dependencias) */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const AVATARS = ['🐸', '🦋', '🐙', '🦎', '🐝', '🐢', '🦠', '🧬', '🌻', '🍄', '🐬', '🦜'];
  const ANSWER_ICONS = ['ico-cell', 'ico-dna', 'ico-leaf', 'ico-bacteria'];
  const AVATAR_LABEL = 'avatar';

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
  const svgUse = (id, cls = '') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#${id}"/></svg>`;
  const mascot = (cls = 'mascot') => `<svg class="${cls}" viewBox="0 0 200 200" role="img" aria-label="Celu, la mascota"><use href="#mascot"/></svg>`;
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR');

  function loadPlayer() {
    try { return JSON.parse(localStorage.getItem('preguntero-player')) || { name: '', avatar: AVATARS[0] }; }
    catch { return { name: '', avatar: AVATARS[0] }; }
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
  function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------- sonido (WebAudio, sin archivos) ----------
  let actx;
  function beep(notes) {
    if (!state.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      let t = actx.currentTime;
      for (const [freq, dur, type = 'triangle'] of notes) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
        t += dur * 0.85;
      }
    } catch { /* sin audio */ }
  }
  const sfx = {
    correct: () => beep([[523, 0.12], [659, 0.12], [784, 0.22]]),
    wrong: () => beep([[300, 0.18, 'sawtooth'], [220, 0.3, 'sawtooth']]),
    tick: () => beep([[880, 0.05, 'square']]),
    go: () => beep([[440, 0.1], [880, 0.25]]),
    win: () => beep([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]),
    click: () => beep([[660, 0.05]]),
  };

  const soundBtn = document.getElementById('soundToggle');
  const paintSound = () => { soundBtn.textContent = state.sound ? '🔊' : '🔇'; };
  soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    localStorage.setItem('preguntero-sound', state.sound ? 'on' : 'off');
    paintSound();
    sfx.click();
  });
  paintSound();

  // ---------- confeti ----------
  function confetti(duration = 3500) {
    const cv = document.getElementById('confetti');
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#9be15d', '#4cc9f0', '#ff5d8f', '#ffd23f', '#7b5cff', '#2ec4b6'];
    const shapes = ['●', '🧬', '🍃', '✦', '■'];
    const parts = Array.from({ length: 140 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      s: 10 + Math.random() * 14,
      c: colors[(Math.random() * colors.length) | 0],
      sh: shapes[(Math.random() * shapes.length) | 0],
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
        ctx.font = `${p.s}px sans-serif`;
        ctx.fillText(p.sh, 0, 0);
        ctx.restore();
      }
      if (now < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(performance.now());
  }

  // burbujas del fondo
  (function bubbles() {
    const wrap = document.querySelector('.bubbles');
    for (let i = 0; i < 14; i++) {
      const b = document.createElement('span');
      const s = 6 + Math.random() * 22;
      Object.assign(b.style, {
        width: s + 'px', height: s + 'px', left: Math.random() * 100 + '%',
        animationDuration: 10 + Math.random() * 16 + 's', animationDelay: -Math.random() * 20 + 's',
      });
      wrap.appendChild(b);
    }
  })();

  // ---------- router ----------
  const routes = {
    '': renderHome,
    jugar: renderJoin,
    partida: renderGame,
    resultado: renderResult,
    ranking: renderRanking,
    profesor: renderAdmin,
  };

  function router() {
    cleanup();
    cleanup = () => {};
    const key = location.hash.replace(/^#\/?/, '').split('/')[0];
    const fn = routes[key] || renderHome;
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
    try { state.info = await api('/info'); } catch { state.info = state.info || null; }
    return state.info;
  }

  // ---------- pantalla: inicio ----------
  async function renderHome() {
    $app.innerHTML = `
      <section class="screen hero">
        ${mascot()}
        <h1 class="title">Preguntero</h1>
        <p class="subtitle" id="homeSubtitle">¡Poné a prueba lo que sabés de Biología!</p>
        <span class="chip" id="homeChip">🔬 Cargando preguntas…</span>
        <div class="home-actions">
          <a class="btn big" href="#/jugar">▶ ¡Jugar!</a>
          <a class="btn yellow" href="#/ranking">🏆 Ver ranking</a>
        </div>
        <div class="feature-row">
          <div class="feature">${svgUse('ico-microscope')}<div><b>Respondé rápido</b><small>Más velocidad = más puntos</small></div></div>
          <div class="feature">${svgUse('ico-dna')}<div><b>Hacé rachas</b><small>Acertá seguido y sumá bonus</small></div></div>
          <div class="feature">${svgUse('ico-cell')}<div><b>Llegá al podio</b><small>Los 3 mejores brillan</small></div></div>
        </div>
        <a class="teacher-link" href="#/profesor">👩‍🏫 Panel docente</a>
      </section>`;
    const info = await getInfo();
    if (!info) return;
    document.getElementById('homeSubtitle').textContent = `${info.title} · ¡Poné a prueba lo que sabés!`;
    document.getElementById('homeChip').textContent = info.totalQuestions
      ? `🧪 ${info.questionsPerGame} preguntas por partida`
      : '🧪 Todavía no hay preguntas cargadas';
  }

  // ---------- pantalla: ingreso de nombre ----------
  function renderJoin() {
    const p = state.player;
    $app.innerHTML = `
      <section class="screen card join stack">
        <div class="row" style="justify-content:space-between">
          <div>
            <h2>¿Quién juega?</h2>
            <p class="muted" style="margin:0">Escribí tu nombre y elegí tu personaje.</p>
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
              ${AVATARS.map((a) => `<button type="button" class="avatar-opt" data-av="${a}" aria-pressed="${a === p.avatar}" aria-label="${AVATAR_LABEL} ${a}">${a}</button>`).join('')}
            </div>
          </div>
          <button class="btn big" type="submit" id="startBtn">¡Empezar! 🚀</button>
        </form>
      </section>`;
    const sm = $app.querySelector('.mascot-sm');
    sm.style.cssText = 'width:84px;height:84px';
    let avatar = p.avatar;
    $app.querySelectorAll('.avatar-opt').forEach((b) =>
      b.addEventListener('click', () => {
        avatar = b.dataset.av;
        $app.querySelectorAll('.avatar-opt').forEach((x) => x.setAttribute('aria-pressed', x === b));
        sfx.click();
      })
    );
    const nameInput = document.getElementById('name');
    if (!p.name) nameInput.focus();
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (name.length < 2) return toast('Escribí tu nombre (mínimo 2 letras) ✏️', true);
      const btn = document.getElementById('startBtn');
      btn.disabled = true;
      try {
        state.player = { name, avatar };
        localStorage.setItem('preguntero-player', JSON.stringify(state.player));
        const g = await api('/games', { method: 'POST', body: { name, avatar } });
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
    sfx.tick();
    const iv = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(iv);
        sfx.go();
        cd.textContent = '¡Ya!';
        cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = '';
        setTimeout(showQuestion, 600);
        return;
      }
      sfx.tick();
      cd.textContent = n;
      cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = '';
    }, 900);
    cleanup = () => clearInterval(iv);
  }

  function showQuestion() {
    const g = state.game;
    const q = g.questions[g.index];
    const total = g.questions.length;
    const timeMs = g.questionTimeMs;
    $app.innerHTML = `
      <section class="screen">
        <div class="hud">
          <div class="player"><span class="av">${esc(state.player.avatar)}</span><span class="nm">${esc(state.player.name)}</span></div>
          <div class="row" style="gap:10px;flex-wrap:nowrap">
            ${g.streak >= 2 ? `<span class="streak">🔥 x${g.streak}</span>` : ''}
            <span class="score-pill" id="scorePill">⭐ ${fmt(g.score)}</span>
          </div>
        </div>
        <div class="progress" aria-hidden="true"><i style="width:${(g.index / total) * 100}%"></i></div>
        <article class="card qcard">
          <div class="qmeta">
            <div>
              <div class="qnum">Pregunta ${g.index + 1} de ${total}</div>
              <span class="chip" style="margin-top:6px">🔬 ${esc(q.topic)}</span>
            </div>
            <div class="timer" id="timer" role="timer" aria-label="Tiempo restante">
              <svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="28"/><circle class="bar" cx="32" cy="32" r="28"/></svg>
              <b id="timerNum">${Math.round(timeMs / 1000)}</b>
            </div>
          </div>
          <h2 class="qtext">${esc(q.text)}</h2>
          ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="Imagen de la pregunta">` : ''}
          <div class="answers">
            ${q.answers.map((a, i) => `
              <button class="ans" data-i="${i}">
                <span class="ico">${svgUse(ANSWER_ICONS[i])}</span>
                <span>${esc(a)}</span>
              </button>`).join('')}
          </div>
          <div id="feedback"></div>
        </article>
      </section>`;

    const timerEl = document.getElementById('timer');
    const timerNum = document.getElementById('timerNum');
    const start = performance.now();
    let done = false;
    let lastSec = Math.round(timeMs / 1000);
    let raf;

    const tick = () => {
      const elapsed = performance.now() - start;
      const left = Math.max(0, timeMs - elapsed);
      const p = left / timeMs;
      timerEl.style.setProperty('--p', p);
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        timerNum.textContent = sec;
        if (sec <= 5 && sec > 0) sfx.tick();
      }
      timerEl.classList.toggle('warn', p < 0.5 && p >= 0.25);
      timerEl.classList.toggle('danger', p < 0.25);
      if (left <= 0) return answer(-1, timeMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanup = () => cancelAnimationFrame(raf);

    $app.querySelectorAll('.ans').forEach((b) =>
      b.addEventListener('click', () => answer(Number(b.dataset.i), performance.now() - start))
    );

    async function answer(choice, elapsed) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      timerEl.classList.remove('danger');
      const btns = [...$app.querySelectorAll('.ans')];
      btns.forEach((b) => (b.disabled = true));
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
      document.getElementById('scorePill').textContent = `⭐ ${fmt(g.score)}`;

      btns.forEach((b, i) => {
        if (i === r.correctChoice) {
          b.classList.add('correct');
          b.insertAdjacentHTML('beforeend', '<span class="mark">✅</span>');
        } else if (i === choice) {
          b.classList.add('wrong');
          b.insertAdjacentHTML('beforeend', '<span class="mark">❌</span>');
        } else b.classList.add('dim');
      });

      if (r.isCorrect) {
        sfx.correct();
        const pop = document.createElement('div');
        pop.className = 'points-pop';
        pop.textContent = `+${fmt(r.points)}`;
        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1300);
      } else sfx.wrong();

      const praise = ['¡Excelente!', '¡Genial!', '¡Bien ahí!', '¡Sos crack!', '¡Impecable!'];
      const title = r.isCorrect
        ? praise[(Math.random() * praise.length) | 0] + (g.streak >= 2 ? ` 🔥 Racha x${g.streak}` : '')
        : choice < 0 ? '¡Se terminó el tiempo! ⏰' : '¡Uy, casi!';
      const last = g.index + 1 >= g.questions.length;
      const fb = document.getElementById('feedback');
      fb.innerHTML = `
        <div class="feedback ${r.isCorrect ? 'ok' : 'bad'}">
          ${mascot('mascot-sm ' + (r.isCorrect ? 'happy' : 'sad'))}
          <div>
            <h3>${esc(title)}</h3>
            ${r.explanation ? `<p>💡 ${esc(r.explanation)}</p>` : ''}
          </div>
          <div class="actions"><button class="btn ${last ? 'yellow' : ''}" id="nextBtn">${last ? 'Ver resultados 🏁' : 'Siguiente ➜'}</button></div>
        </div>`;
      const next = document.getElementById('nextBtn');
      next.focus({ preventScroll: true });
      fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      next.addEventListener('click', () => {
        sfx.click();
        if (last) return go('#/resultado');
        g.index += 1;
        showQuestion();
      });
    }
  }

  // ---------- pantalla: resultado ----------
  async function renderResult() {
    const g = state.game;
    if (!g) return go('#/ranking');
    $app.innerHTML = `<div class="loader">${svgUse('ico-dna')}</div>`;
    let r;
    try {
      r = await api(`/games/${g.gameId}/finish`, { method: 'POST' });
    } catch (err) {
      toast(err.message, true);
      return go('#/ranking');
    }
    state.lastGameId = g.gameId;
    const pct = r.total ? r.correct / r.total : 0;
    const msg = pct === 1 ? '¡Perfecto! Sos un/a genio/a de la biología 🧬'
      : pct >= 0.7 ? '¡Muy buen trabajo! 🌱'
      : pct >= 0.4 ? '¡Vas bien! Repasá un poco y volvé a intentar 🔬'
      : '¡A seguir estudiando! Cada error es aprendizaje 🦠';
    const medal = r.position === 1 ? '🥇' : r.position === 2 ? '🥈' : r.position === 3 ? '🥉' : '🎖️';
    $app.innerHTML = `
      <section class="screen card results">
        ${mascot()}
        <h2 style="font-size:2rem">${esc(state.player.avatar)} ${esc(state.player.name)}</h2>
        <div class="big-score">${fmt(r.score)}</div>
        <div class="muted" style="font-weight:800">puntos</div>
        <div class="stats">
          <div class="stat"><b>${r.correct}/${r.total}</b><span>correctas</span></div>
          <div class="stat"><b>${medal} ${r.position}°</b><span>de ${r.players} jugadores</span></div>
          <div class="stat"><b>🔥 ${r.bestStreak}</b><span>mejor racha</span></div>
        </div>
        <p style="font-weight:800;font-size:1.15rem">${msg}</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <a class="btn yellow" href="#/ranking">🏆 Ver ranking</a>
          <a class="btn ghost" href="#/jugar">↻ Jugar otra vez</a>
        </div>
      </section>`;
    state.game = null;
    if (r.position <= 3 || pct >= 0.7) { sfx.win(); confetti(); }
  }

  // ---------- pantalla: ranking ----------
  async function renderRanking() {
    $app.innerHTML = `
      <section class="screen">
        <div class="rank-head">
          <h2>🏆 Ranking</h2>
          <div class="row">
            <span class="hint" id="rankCount"></span>
            <a class="btn small" href="#/jugar">▶ Jugar</a>
          </div>
        </div>
        <div id="rankBody"><div class="loader">${svgUse('ico-dna')}</div></div>
      </section>`;
    let first = true;
    let lastSig = '';
    const load = async () => {
      let list;
      try { list = await api('/ranking'); } catch (err) { if (first) toast(err.message, true); return; }
      const sig = JSON.stringify(list.map((r) => [r.id, r.score]));
      if (sig === lastSig) return;
      lastSig = sig;
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
          ${svgUse('ico-microscope')}
          <h3 style="font-size:1.6rem;margin-top:8px">Todavía no jugó nadie</h3>
          <p class="muted">¡Sé el primero en llegar al podio!</p>
          <a class="btn" href="#/jugar">▶ Jugar ahora</a>
        </div>`;
      return;
    }
    const podiumSlot = (r, place) => {
      if (!r) return `<div class="pod p${place} empty"><div class="pav">❔</div><div class="pname">—</div><div class="ppts">&nbsp;</div><div class="block">${place}</div></div>`;
      const me = r.id === state.lastGameId;
      return `
        <div class="pod p${place}">
          ${place === 1 ? '<div class="crown">👑</div>' : ''}
          <div class="pav">${esc(r.avatar || '🧬')}</div>
          <div class="pname" title="${esc(r.name)}">${esc(r.name)}${me ? ' (vos)' : ''}</div>
          <div class="ppts">${fmt(r.score)} pts</div>
          <div class="block">${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}</div>
        </div>`;
    };
    const rest = list.slice(3);
    body.innerHTML = `
      <div class="podium">${podiumSlot(list[1], 2)}${podiumSlot(list[0], 1)}${podiumSlot(list[2], 3)}</div>
      ${rest.length ? `<ol class="rank-list" start="4">
        ${rest.map((r, i) => `
          <li class="${r.id === state.lastGameId ? 'me' : ''}" style="animation-delay:${Math.min(i, 15) * 40}ms">
            <span class="pos">${i + 4}</span>
            <span class="av">${esc(r.avatar || '🧬')}</span>
            <span class="nm">${esc(r.name)}<small>${r.correct}/${r.total} correctas · racha ${r.bestStreak}</small></span>
            <span class="pts">${fmt(r.score)}</span>
          </li>`).join('')}
      </ol>` : ''}`;
    if (celebrate && state.lastGameId && list.slice(0, 3).some((r) => r.id === state.lastGameId)) confetti();
  }

  // ---------- pantalla: panel docente ----------
  async function renderAdmin() {
    if (state.pin) {
      try { await api('/admin/login', { method: 'POST', admin: true }); return adminPanel(); }
      catch { state.pin = ''; sessionStorage.removeItem('preguntero-pin'); }
    }
    $app.innerHTML = `
      <section class="screen card join stack center">
        ${svgUse('ico-microscope')}
        <h2>Panel docente</h2>
        <p class="muted" style="margin:0">Ingresá el PIN para cargar y editar preguntas.</p>
        <form id="pinForm" class="stack">
          <input class="input" id="pin" type="password" inputmode="text" placeholder="PIN" autocomplete="current-password" required style="text-align:center">
          <button class="btn violet" type="submit">Entrar 🔓</button>
        </form>
      </section>`;
    $app.querySelector('svg').style.cssText = 'width:90px;height:90px;margin:0 auto';
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
          <h2>${svgUse('ico-microscope')} Panel docente</h2>
          <button class="btn small ghost" id="logout">Salir</button>
        </div>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="preguntas">📋 Preguntas</button>
          <button class="tab" role="tab" data-tab="nueva">➕ Nueva pregunta</button>
          <button class="tab" role="tab" data-tab="ajustes">⚙️ Ajustes</button>
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
    body.innerHTML = `<div class="loader">${svgUse('ico-dna')}</div>`;
    let qs;
    try { qs = await api('/admin/questions', { admin: true }); }
    catch (err) { body.innerHTML = ''; return toast(err.message, true); }
    if (!qs.length) {
      body.innerHTML = `
        <div class="card empty-state">
          ${svgUse('ico-leaf')}
          <h3 style="font-size:1.6rem;margin-top:8px">No hay preguntas todavía</h3>
          <p class="muted">Cargá la primera para que los chicos puedan jugar.</p>
          <button class="btn" id="firstQ">➕ Crear pregunta</button>
        </div>`;
      document.getElementById('firstQ').addEventListener('click', () => show('nueva'));
      return;
    }
    const topics = [...new Set(qs.map((q) => q.topic))];
    body.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <span class="hint">${qs.length} pregunta${qs.length === 1 ? '' : 's'} · ${topics.length} tema${topics.length === 1 ? '' : 's'}</span>
        <button class="btn small" id="addQ">➕ Nueva</button>
      </div>
      <div class="qlist">
        ${qs.map((q, i) => `
          <div class="qitem">
            <span class="n">${i + 1}</span>
            <div>
              <div class="t">${esc(q.text)}</div>
              <div class="tags">
                <span class="tag topic">${esc(q.topic)}</span>
                <span class="tag ok">✅ ${esc(q.answers[q.correct])}</span>
                <span class="tag">${q.answers.length} opciones</span>
                ${q.image ? '<span class="tag">🖼️ imagen</span>' : ''}
              </div>
            </div>
            <div class="acts">
              <button class="iconbtn" data-edit="${esc(q.id)}" title="Editar" aria-label="Editar">✏️</button>
              <button class="iconbtn" data-del="${esc(q.id)}" title="Eliminar" aria-label="Eliminar">🗑️</button>
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
          toast('Pregunta eliminada 🗑️');
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
        <h3 style="font-size:1.6rem">${editing ? '✏️ Editar pregunta' : '➕ Nueva pregunta'}</h3>
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
          <span class="label">Respuestas — marcá la correcta ✅</span>
          <div class="ans-edit" id="ansEdit"></div>
          <div class="row" style="margin-top:10px">
            <button type="button" class="btn small ghost" id="addAns">➕ Agregar opción</button>
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
          <button type="submit" class="btn" id="saveQ">💾 Guardar</button>
        </div>
      </form>`;

    const ansEdit = document.getElementById('ansEdit');
    const paintAnswers = () => {
      ansEdit.innerHTML = answers.map((a, i) => `
        <div class="ans-row ${i === correct ? 'is-correct' : ''}">
          <label class="pick"><input type="radio" name="correct" value="${i}" ${i === correct ? 'checked' : ''}><span>Correcta</span></label>
          <input class="input" data-ans="${i}" maxlength="150" placeholder="Opción ${String.fromCharCode(65 + i)}" value="${esc(a)}">
          <button type="button" class="iconbtn" data-rm="${i}" title="Quitar opción" aria-label="Quitar opción" ${answers.length <= 2 ? 'disabled' : ''}>✖</button>
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
        imgBox.innerHTML = `<div class="img-preview"><img src="${esc(image)}" alt="Vista previa"><button type="button" class="iconbtn" id="rmImg" aria-label="Quitar imagen">✖</button></div>`;
        document.getElementById('rmImg').addEventListener('click', () => { image = ''; paintImage(); });
        return;
      }
      imgBox.innerHTML = `
        <label class="img-drop" id="drop">
          <span style="font-size:2rem">🖼️</span>
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
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
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
        toast(editing ? 'Pregunta actualizada ✅' : '¡Pregunta creada! 🎉');
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
          <h3 style="font-size:1.5rem">⚙️ Configuración del juego</h3>
          <div>
            <label class="label" for="sTitle">Nombre de la materia / curso</label>
            <input class="input" id="sTitle" maxlength="60" value="${esc(s.title)}">
          </div>
          <div>
            <label class="label" for="sCount">Preguntas por partida</label>
            <input class="input" id="sCount" type="number" min="1" max="100" value="${s.questionsPerGame}" style="max-width:160px">
          </div>
          <label class="switch"><input type="checkbox" id="sShuffle" ${s.shuffle ? 'checked' : ''}> Mezclar preguntas y respuestas en cada partida</label>
          <div class="form-actions"><button class="btn" type="submit">💾 Guardar ajustes</button></div>
        </form>

        <div class="card form-grid">
          <h3 style="font-size:1.5rem">📦 Importar / exportar preguntas</h3>
          <p class="hint" style="margin:0">Descargá un respaldo en JSON o cargá preguntas de otro curso.</p>
          <div class="row">
            <button class="btn small cyan" id="exportQ">⬇️ Exportar</button>
            <label class="btn small yellow">⬆️ Importar<input type="file" accept="application/json,.json" id="importQ" hidden></label>
          </div>
        </div>

        <div class="card form-grid">
          <h3 style="font-size:1.5rem">🏆 Ranking</h3>
          <p class="hint" style="margin:0">Empezá de cero el ranking (por ejemplo, para otra división o clase).</p>
          <div><button class="btn small danger" id="resetRank">🧹 Reiniciar ranking</button></div>
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
        toast('Ajustes guardados ✅');
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
        toast(`Se importaron ${r.added} preguntas${r.errors.length ? ` (${r.errors.length} con errores)` : ''} 📥`, r.errors.length > 0);
      } catch (err) {
        toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido' : err.message, true);
      }
      e.target.value = '';
    });

    document.getElementById('resetRank').addEventListener('click', async () => {
      if (!confirm('¿Seguro que querés borrar todo el ranking? No se puede deshacer.')) return;
      try {
        await api('/admin/ranking', { method: 'DELETE', admin: true });
        toast('Ranking reiniciado 🧹');
      } catch (err) { toast(err.message, true); }
    });
  }

  router();
})();
