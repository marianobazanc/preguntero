/* Preguntero — juego (PWA sin conexión, datos en PregDB) */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const AVATARS = [
    ['cell', 'Célula'], ['bacteria', 'Bacteria'], ['virus', 'Virus'], ['frog', 'Rana'],
    ['mushroom', 'Hongo'], ['fish', 'Pez'], ['leaf', 'Hoja'], ['dna', 'ADN'],
  ];
  const AVATAR_IDS = AVATARS.map(([id]) => id);
  const ANSWER_ICONS = ['ico-cell', 'ico-dna', 'ico-leaf', 'ico-bacteria'];

  const DB = window.PregDB;
  const QUESTION_TIME_MS = 20000;
  const BASE_POINTS = 500;
  const SPEED_POINTS = 500;
  const STREAK_BONUS = 100;
  const RESULT_SECONDS = 20; // la pantalla de resultado vuelve sola al inicio
  const IDLE_MS = 90000; // si nadie toca nada, volvemos al inicio (stand de feria)

  const state = {
    player: { name: '', course: '', avatar: 'cell' },
    game: null,
    result: null,
    lastGameId: null,
    admin: false, // se pierde al salir del panel: el público nunca lo encuentra abierto
    updateReady: false,
    installPrompt: null,
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

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- motor del juego ----------
  async function newGame(player) {
    const [qs, s] = await Promise.all([DB.getQuestions(), DB.getSettings()]);
    if (!qs.length) throw new Error('Todavía no hay preguntas cargadas.');
    const pool = s.shuffle ? shuffle(qs) : qs;
    return {
      questionTimeMs: QUESTION_TIME_MS,
      index: 0, score: 0, correct: 0, streak: 0, bestStreak: 0,
      player,
      questions: pool.slice(0, Math.max(1, s.questionsPerGame)).map((q) => {
        // mezclamos el orden de las opciones y reubicamos la correcta
        const order = s.shuffle ? shuffle(q.answers.map((_, i) => i)) : q.answers.map((_, i) => i);
        return { ...q, answers: order.map((i) => q.answers[i]), correct: order.indexOf(q.correct) };
      }),
    };
  }

  function scoreAnswer(g, q, choice, elapsed) {
    const isCorrect = choice === q.correct;
    const timeMs = Math.min(Math.max(elapsed, 0), g.questionTimeMs);
    let points = 0;
    if (isCorrect) {
      g.streak += 1;
      g.correct += 1;
      g.bestStreak = Math.max(g.bestStreak, g.streak);
      const speed = Math.round(SPEED_POINTS * (1 - timeMs / g.questionTimeMs));
      const bonus = g.streak >= 2 ? STREAK_BONUS * Math.min(g.streak - 1, 5) : 0;
      points = BASE_POINTS + speed + bonus;
    } else {
      g.streak = 0;
    }
    g.score += points;
    return { isCorrect, points, correctChoice: q.correct, explanation: q.explanation };
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

  // Diálogo con el estilo del juego (reemplaza al confirm() del navegador).
  // Devuelve el value del botón elegido, o null si se cierra con Esc o tocando afuera.
  function ask({ icon = 'bulb', tone = '', title, message = '', quote = '', buttons }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = `modal ${tone}`;
      dlg.innerHTML = `
        <div class="modal-ico">${ic(icon)}</div>
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${quote ? `<blockquote>${esc(quote)}</blockquote>` : ''}
        <div class="modal-actions">
          ${buttons.map((b, i) => `<button type="button" class="btn small ${b.cls || ''}" data-i="${i}">${b.icon ? ic(b.icon) : ''} ${esc(b.label)}</button>`).join('')}
        </div>`;
      document.body.appendChild(dlg);
      let value = null;
      dlg.querySelectorAll('[data-i]').forEach((btn) =>
        btn.addEventListener('click', () => { value = buttons[Number(btn.dataset.i)].value; sfx.click(); dlg.close(); })
      );
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => { dlg.remove(); resolve(value); });
      dlg.showModal();
      // el foco arranca en "Cancelar" para que un Enter apurado no borre nada
      dlg.querySelector('[data-i="0"]').focus();
    });
  }

  const confirmBox = ({ ok, danger, ...opts }) => ask({
    tone: danger ? 'danger' : '',
    ...opts,
    buttons: [
      { label: 'Cancelar', value: false, cls: 'ghost' },
      { label: ok, value: true, cls: danger ? 'danger' : '', icon: danger ? 'trash' : 'check' },
    ],
  }).then(Boolean);

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
  const paintSound = () => { soundBtn.innerHTML = ic(state.sound ? 'sound' : 'mute'); };
  soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    localStorage.setItem('preguntero-sound', state.sound ? 'on' : 'off');
    paintSound();
    sfx.click();
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
    ayuda: renderHelpPage,
  };

  const routeKey = () => location.hash.replace(/^#\/?/, '').split('/')[0];

  function router() {
    cleanup();
    cleanup = () => {};
    const key = routeKey();
    if (key !== 'profesor') state.admin = false;
    const fn = routes[key] || renderHome;
    $app.innerHTML = '';
    window.scrollTo(0, 0);
    fn();
    $app.focus({ preventScroll: true });
    armIdle();
  }
  window.addEventListener('hashchange', router);

  // Si alguien deja el juego a medias, a los 90 s sin tocar nada vuelve al inicio
  let idleTimer;
  function armIdle() {
    clearTimeout(idleTimer);
    if (!['jugar', 'partida', 'resultado', 'ranking'].includes(routeKey())) return;
    idleTimer = setTimeout(() => { state.game = null; go('#/'); }, IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, armIdle, true));

  function go(hash) {
    if (location.hash === hash) router();
    else location.hash = hash;
  }

  // ---------- pantalla: inicio ----------
  async function renderHome() {
    // si hay una versión nueva instalada, la aplicamos acá, nunca a mitad de una partida
    if (state.updateReady) return location.reload();
    $app.innerHTML = `
      <section class="screen hero">
        ${mascot()}
        <h1 class="title">Pregun<span>tero</span></h1>
        <span class="chip" id="homeChip" hidden>Todavía no hay preguntas cargadas</span>
        <div class="home-actions">
          <a class="btn big" href="#/jugar">${ic('play')} Jugar</a>
          <a class="btn ghost" href="#/ranking">${ic('trophy')} Ver ranking</a>
        </div>
        <div id="homeExtra" class="home-extra"></div>
        <a class="teacher-link" href="#/profesor" aria-label="Panel docente" title="Panel docente">${ic('lock')}</a>
      </section>`;
    const [qs, list] = await Promise.all([DB.getQuestions(), DB.getRanking()]);
    if (!document.getElementById('homeExtra')) return;
    document.getElementById('homeChip').hidden = qs.length > 0;
    const extra = document.getElementById('homeExtra');
    if (!list.length) {
      extra.innerHTML = `
        <div class="feature-row">
          <div class="feature">${art('ico-microscope')}<div><b>Respondé rápido</b><small>Más velocidad, más puntos</small></div></div>
          <div class="feature">${art('ico-dna')}<div><b>Hacé rachas</b><small>Acertá seguido y sumá bonus</small></div></div>
          <div class="feature">${art('ico-cell')}<div><b>Llegá al podio</b><small>Los 3 mejores se destacan</small></div></div>
        </div>`;
      return;
    }
    extra.innerHTML = `
      <div class="card top5">
        <h3>${ic('trophy')} Los mejores</h3>
        <ol class="rank-list compact">
          ${list.slice(0, 5).map((r, i) => `
            <li>
              <span class="pos">${i + 1}</span>
              ${avatar(r.avatar, 'av')}
              <span class="nm">${esc(r.name)}${r.course ? `<small>${esc(r.course)}</small>` : ''}</span>
              <span class="pts">${fmt(r.score)}</span>
            </li>`).join('')}
        </ol>
        <a class="btn small ghost" href="#/ranking">Ver ranking completo (${list.length})</a>
      </div>`;
  }

  // ---------- pantalla: ingreso de nombre ----------
  function renderJoin() {
    // en el stand cada persona empieza de cero: no recordamos al jugador anterior
    const p = { name: '', course: '', avatar: AVATAR_IDS[(Math.random() * AVATAR_IDS.length) | 0] };
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
            <label class="label" for="course">Curso <span class="opt">(opcional)</span></label>
            <input class="input" id="course" maxlength="20" placeholder="Ej: 4° B" value="${esc(p.course)}">
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
        sfx.click();
      })
    );
    const nameInput = document.getElementById('name');
    nameInput.focus();
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim().slice(0, 24);
      const course = document.getElementById('course').value.trim().slice(0, 20);
      if (name.length < 2) return toast('Escribí tu nombre (mínimo 2 letras)', true);
      const btn = document.getElementById('startBtn');
      btn.disabled = true;
      try {
        state.player = { name, course, avatar: chosen };
        state.game = await newGame(state.player);
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
    sfx.tick();
    const iv = setInterval(() => {
      n -= 1;
      if (n === 0) {
        clearInterval(iv);
        sfx.go();
        cd.textContent = '¡Ya!';
        restart();
        setTimeout(showQuestion, 600);
        return;
      }
      sfx.tick();
      cd.textContent = n;
      restart();
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
          <div class="player">${avatar(g.player.avatar)}<span class="nm">${esc(g.player.name)}</span></div>
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
              <button class="ans" data-i="${i}">
                <span class="ico">${art(ANSWER_ICONS[i])}</span>
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
      const left = Math.max(0, timeMs - (performance.now() - start));
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
      const btns = [...$app.querySelectorAll('.ans')];
      btns.forEach((b) => (b.disabled = true));
      const r = scoreAnswer(g, q, choice, elapsed);
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
        sfx.correct();
        const pop = document.createElement('div');
        pop.className = 'points-pop';
        pop.textContent = `+${fmt(r.points)}`;
        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1200);
      } else sfx.wrong();

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
      const next = document.getElementById('nextBtn');
      next.focus({ preventScroll: true });
      fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      next.addEventListener('click', async () => {
        sfx.click();
        if (!last) {
          g.index += 1;
          return showQuestion();
        }
        next.disabled = true;
        try {
          const p = g.player;
          const saved = await DB.addResult({
            name: p.name, course: p.course, avatar: p.avatar,
            score: g.score, correct: g.correct, total: g.questions.length, bestStreak: g.bestStreak,
          });
          state.result = { ...saved, player: p };
          state.lastGameId = saved.entry.id;
          state.game = null;
          go('#/resultado');
        } catch (err) {
          toast('No se pudo guardar el resultado: ' + err.message, true);
          next.disabled = false;
        }
      });
    }
  }

  // ---------- pantalla: resultado ----------
  function renderResult() {
    const res = state.result;
    if (!res) return go('#/');
    const r = { ...res.entry, position: res.position, players: res.players };
    const pct = r.total ? r.correct / r.total : 0;
    const msg = pct === 1 ? '¡Perfecto! Sabés muchísimo de biología.'
      : pct >= 0.7 ? '¡Muy buen trabajo!'
      : pct >= 0.4 ? 'Vas bien. Repasá un poco y volvé a intentar.'
      : 'A seguir estudiando: cada error también enseña.';
    $app.innerHTML = `
      <section class="screen card results">
        ${mascot()}
        <h2 class="who">${avatar(r.avatar)} ${esc(r.name)}</h2>
        ${r.course ? `<div class="muted" style="font-weight:800">${esc(r.course)}</div>` : ''}
        <div class="big-score">${fmt(r.score)}</div>
        <div class="muted" style="font-weight:800">puntos</div>
        <div class="place">Quedaste <b>${r.position}°</b> de ${fmt(r.players)}</div>
        <div class="stats">
          <div class="stat"><b>${r.correct}/${r.total}</b><span>correctas</span></div>
          <div class="stat"><b>${r.position}°</b><span>en el ranking</span></div>
          <div class="stat"><b>${r.bestStreak}</b><span>mejor racha</span></div>
        </div>
        <p class="result-msg">${msg}</p>
        <div class="row" style="justify-content:center;margin-top:12px">
          <a class="btn yellow" href="#/ranking">${ic('trophy')} Ver ranking</a>
          <a class="btn" href="#/">${ic('arrow')} Siguiente jugador</a>
        </div>
        <p class="hint auto-back">Volviendo al inicio en <b id="backIn">${RESULT_SECONDS}</b> s</p>
      </section>`;
    state.result = null;
    if (r.position <= 3 || pct >= 0.7) { sfx.win(); confetti(); }
    let left = RESULT_SECONDS;
    const iv = setInterval(() => {
      left -= 1;
      const el = document.getElementById('backIn');
      if (el) el.textContent = left;
      if (left <= 0) { clearInterval(iv); go('#/'); }
    }, 1000);
    cleanup = () => clearInterval(iv);
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
    paintRanking(await DB.getRanking(), true);
  }

  function paintRanking(list, celebrate) {
    const body = document.getElementById('rankBody');
    if (!body) return;
    document.getElementById('rankCount').textContent = list.length ? `${fmt(list.length)} jugador${list.length === 1 ? '' : 'es'}` : '';
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
          ${r.course ? `<div class="pcourse">${esc(r.course)}</div>` : ''}
          <div class="ppts">${fmt(r.score)} pts</div>
          <div class="block">${place}</div>
        </div>`;
    };
    const rest = list.slice(3, 200);
    body.innerHTML = `
      <div class="podium">${podiumSlot(list[1], 2)}${podiumSlot(list[0], 1)}${podiumSlot(list[2], 3)}<div class="podium-base"></div></div>
      ${rest.length ? `<ol class="rank-list" start="4">
        ${rest.map((r, i) => `
          <li class="${r.id === state.lastGameId ? 'me' : ''}" style="animation-delay:${Math.min(i, 15) * 40}ms">
            <span class="pos">${i + 4}</span>
            ${avatar(r.avatar, 'av')}
            <span class="nm">${esc(r.name)}<small>${r.course ? `${esc(r.course)} · ` : ''}${r.correct}/${r.total} correctas · racha ${r.bestStreak}</small></span>
            <span class="pts">${fmt(r.score)}</span>
          </li>`).join('')}
      </ol>` : ''}`;
    if (celebrate && state.lastGameId && list.slice(0, 3).some((r) => r.id === state.lastGameId)) confetti();
  }

  // ---------- ayuda para el docente ----------
  // Botón "de mentira" para mostrar en la ayuda cómo se ve cada botón real
  const fake = (icon, label, cls = '') => `<span class="fake-btn ${cls}">${icon ? ic(icon) : ''}${esc(label)}</span>`;

  function helpHtml(inAdmin = true) {
    // dentro del panel, los nombres de pestañas son links que llevan a ellas
    const tab = (id, icon, label) => inAdmin
      ? `<a href="#" class="fake-btn tabby" data-goto="${id}">${ic(icon)}${esc(label)}</a>`
      : fake(icon, label, 'tabby');
    return `
      <div class="help stack">
        <div class="card help-intro">
          ${mascot('mascot-sm')}
          <div>
            <h3>Guía rápida del Preguntero</h3>
            <p>Un juego de preguntas para una sola compu: la gente se acerca, pone su nombre, responde y ve en qué puesto quedó. Vos cargás las preguntas y cuidás los datos. <b>No hace falta saber de computación.</b></p>
            <p class="hint">Tocá cada tema para abrirlo.</p>
          </div>
        </div>

        <details class="card help-sec" open>
          <summary><span class="help-num">1</span> Antes de la feria: dejar todo listo (10 minutos)</summary>
          <ol class="steps">
            <li><b>Abrí el Preguntero en Chrome o Edge</b> con internet. Es la única vez que hace falta conexión.</li>
            <li><b>Instalalo</b> con el botón ${fake('download', 'Instalar app', 'blue')} de arriba en este panel (o con el ícono de instalar en la barra de direcciones). Te queda un ícono en el escritorio, como cualquier programa.</li>
            <li><b>Cambiá el PIN</b> en ${tab('ajustes', 'sliders', 'Ajustes')}. Elegí uno fácil de recordar para vos, pero que el público no adivine. <span class="example">Ejemplo: <code>feria2026</code></span></li>
            <li><b>Creá el archivo de respaldo</b> en ${tab('datos', 'save', 'Datos y respaldo')} → ${fake('plus', 'Crear archivo de respaldo')}. Guardalo en <b>Documentos</b> con el nombre que te propone. Desde ese momento, todo se guarda solo ahí.</li>
            <li><b>Revisá las preguntas</b> en ${tab('preguntas', 'list', 'Preguntas')}. Vienen 16 de ejemplo: podés editarlas, borrarlas o sumar las tuyas.</li>
            <li><b>Elegí cuántas preguntas responde cada persona</b> en ${tab('ajustes', 'sliders', 'Ajustes')}. Por defecto son 6, que es un buen número para que la fila avance.</li>
            <li><b>Probá una partida</b> vos mismo/a, para ver cómo se ve. Después podés borrar ese resultado con ${fake('broom', 'Reiniciar ranking', 'danger')} en ${tab('datos', 'save', 'Datos y respaldo')}.</li>
          </ol>
          <p class="tip">${ic('bulb')}<span><b>Consejo:</b> dejá la compu enchufada y desactivá la suspensión de pantalla, así no se apaga en medio de la feria.</span></p>
        </details>

        <details class="card help-sec">
          <summary><span class="help-num">2</span> Cargar una pregunta, paso a paso</summary>
          <p>Andá a ${tab('nueva', 'plus', 'Nueva pregunta')} y completá:</p>
          <div class="example-card">
            <div class="ex-row"><span class="ex-label">Pregunta</span><span>¿Dónde se realiza la fotosíntesis?</span></div>
            <div class="ex-row"><span class="ex-label">Tema</span><span>Célula</span></div>
            <div class="ex-row"><span class="ex-label">Respuestas</span>
              <span class="ex-answers">
                <span>Mitocondria</span>
                <span class="ok">${ic('check')} Cloroplasto <small>(marcada como correcta)</small></span>
                <span>Núcleo</span>
                <span>Ribosoma</span>
              </span>
            </div>
            <div class="ex-row"><span class="ex-label">Explicación</span><span>Los cloroplastos tienen clorofila, que capta la luz del sol.</span></div>
          </div>
          <ul class="bullets">
            <li>Puede tener <b>de 2 a 4 respuestas</b>. Marcá la correcta con el círculo <b>Correcta</b>.</li>
            <li>La <b>explicación</b> aparece después de responder. Es opcional, pero ayuda a que aprendan del error.</li>
            <li>La <b>imagen</b> es opcional. Subila desde la compu así se ve sin internet (las que se pegan como link necesitan conexión).</li>
            <li>El orden de las respuestas se mezcla solo en cada partida: podés poner la correcta en cualquier lugar.</li>
            <li>Para corregir una pregunta tocá ${fake('edit', 'Editar', 'ghost icon-only')} y para borrarla ${fake('trash', 'Eliminar', 'ghost icon-only')}.</li>
          </ul>
        </details>

        <details class="card help-sec">
          <summary><span class="help-num">3</span> Cómo juega el público</summary>
          <ol class="steps">
            <li>En la pantalla de inicio tocan ${fake('play', 'Jugar')}.</li>
            <li>Escriben su <b>nombre</b> (el <b>curso</b> es opcional) y eligen un personaje.</li>
            <li>Responden las preguntas. Cada una tiene <b>20 segundos</b>.</li>
            <li>Al final ven sus puntos y su lugar: <span class="example">“Quedaste <b>7°</b> de 43”</span>.</li>
            <li>A los 20 segundos la pantalla <b>vuelve sola al inicio</b> para la próxima persona.</li>
          </ol>
          <h4>¿Cómo se calculan los puntos?</h4>
          <ul class="bullets">
            <li><b>500 puntos</b> por cada respuesta correcta.</li>
            <li><b>Hasta 500 más</b> por rapidez: cuanto antes responde, más suma.</li>
            <li><b>Bonus por racha</b>: 100 extra desde la segunda correcta seguida, 200 en la tercera, y así.</li>
          </ul>
          <p class="example-box"><b>Ejemplo:</b> Martina acierta la primera en 5 segundos: 500 + 375 por rapidez = <b>875</b>. Acierta la segunda en 10 segundos: 500 + 250 + 100 de racha = <b>850</b>. Lleva <b>1.725 puntos</b>.</p>
          <p class="tip">${ic('bulb')}<span>Si alguien se va en medio de una partida, a los 90 segundos sin que nadie toque nada, el juego vuelve solo al inicio. Esa partida no se guarda.</span></p>
        </details>

        <details class="card help-sec">
          <summary><span class="help-num">4</span> Durante la feria</summary>
          <ul class="bullets">
            <li><b>No hace falta hacer nada.</b> Cada partida se guarda sola en la compu y en el archivo de respaldo.</li>
            <li>Para que el público no salga del juego, tocá ${fake('expand', 'Pantalla completa', 'ghost')} acá arriba antes de salir del panel. Para salir de pantalla completa: tecla <kbd>Esc</kbd>.</li>
            <li>Al salir del panel con ${fake('logout', 'Salir', 'ghost')} (o yendo a otra pantalla) se cierra solo: nadie del público puede entrar sin el PIN.</li>
            <li>El panel se abre desde el <b>candadito gris</b> ${ic('lock')} que está abajo de todo en la pantalla de inicio.</li>
          </ul>
          <h4>Si aparece este aviso arriba de la pantalla:</h4>
          <div class="backup-bar demo"><span>${ic('save')} El guardado en archivo está en pausa.</span>${fake('refresh', 'Reanudar')}</div>
          <p>Pasa a veces cuando se vuelve a abrir el navegador: Chrome pide permiso de nuevo para escribir el archivo. <b>Tocá Reanudar</b> y elegí <b>Permitir</b> (si ofrece “Permitir en cada visita”, mejor: no vuelve a preguntar). Mientras tanto, los datos <b>no se pierden</b>: siguen guardados en el navegador.</p>
        </details>

        <details class="card help-sec">
          <summary><span class="help-num">5</span> Al terminar: guardar y pasar a otra compu</summary>
          <ul class="bullets">
            <li>Si configuraste el archivo de respaldo, <b>ya está todo guardado</b> en ese archivo (por ejemplo <code>Documentos/preguntero-datos.json</code>). Podés copiarlo a un pendrive.</li>
            <li>Si no, en ${tab('datos', 'save', 'Datos y respaldo')} tocá ${fake('download', 'Descargar copia', 'blue')}: se baja un archivo con todo (preguntas, ranking y ajustes).</li>
            <li><b>Para usar todo en otra compu:</b> instalá el Preguntero ahí, entrá al panel y en ${tab('datos', 'save', 'Datos y respaldo')} tocá ${fake('upload', 'Usar un archivo existente')} → elegí el archivo → ${fake('upload', 'Cargar sus datos')}.</li>
            <li>¿Nueva feria y ranking de cero? Primero descargá una copia y después tocá ${fake('broom', 'Reiniciar ranking', 'danger')}.</li>
          </ul>
        </details>

        <details class="card help-sec">
          <summary><span class="help-num">?</span> Preguntas frecuentes</summary>
          <dl class="faq">
            <dt>¿Se borra todo si cierro el navegador o apago la compu?</dt>
            <dd>No. Los datos quedan guardados en la compu. Solo se pierden si alguien borra los “datos de navegación” de Chrome, y para eso está el archivo de respaldo.</dd>
            <dt>¿Necesito internet en la feria?</dt>
            <dd>No. Solo la primera vez, para instalarlo. Después funciona sin conexión.</dd>
            <dt>Se borraron los datos del navegador, ¿cómo los recupero?</dt>
            <dd>Entrá al panel, andá a ${tab('datos', 'save', 'Datos y respaldo')} → ${fake('upload', 'Usar un archivo existente')}, elegí tu <code>preguntero-datos.json</code> y tocá ${fake('upload', 'Cargar sus datos')}. Vuelve todo: preguntas, ranking y ajustes.</dd>
            <dt>Me olvidé el PIN.</dt>
            <dd>En Chrome, borrá los datos de este sitio (candado de la barra de direcciones → Configuración del sitio → Borrar datos). El Preguntero vuelve a empezar con el PIN inicial que te pasó quien lo instaló. Entrá, recuperá tus datos desde el archivo de respaldo como en la pregunta anterior y elegí un PIN nuevo.</dd>
            <dt>¿Puedo usarlo en Firefox o Safari?</dt>
            <dd>Sí, el juego funciona. Pero el guardado automático en archivo solo anda en Chrome y Edge: en otros navegadores, descargá una copia a mano al terminar.</dd>
            <dt>¿Puedo compartir mis preguntas con otro docente?</dt>
            <dd>Sí. En ${tab('datos', 'save', 'Datos y respaldo')} → ${fake('download', 'Exportar', 'blue')} se bajan solo las preguntas. El otro docente las suma con ${fake('upload', 'Importar', 'yellow')}.</dd>
            <dt>¿Dos personas pueden jugar a la vez?</dt>
            <dd>No: está pensado para una persona por vez en la misma compu. Mientras una juega, la siguiente espera su turno.</dd>
          </dl>
        </details>
      </div>`;
  }

  function renderHelpPage() {
    $app.innerHTML = `
      <section class="screen">
        <div class="admin-head">
          <h2>${ic('help')} Cómo se usa</h2>
          <a class="btn small ghost" href="#/profesor">${ic('lock')} Ir al panel docente</a>
        </div>
        ${helpHtml(false)}
      </section>`;
  }

  // ---------- pantalla: panel docente ----------
  function renderAdmin() {
    if (state.admin) return adminPanel();
    $app.innerHTML = `
      <section class="screen card join stack center">
        ${art('ico-microscope')}
        <h2>Panel docente</h2>
        <p class="muted" style="margin:0;font-weight:700">Ingresá el PIN para cargar y editar preguntas.</p>
        <form id="pinForm" class="stack">
          <input class="input" id="pin" type="password" placeholder="PIN" autocomplete="current-password" required style="text-align:center">
          <button class="btn purple" type="submit">${ic('lock')} Entrar</button>
        </form>
        <a class="help-link" href="#/ayuda">${ic('help')} ¿Primera vez? Mirá cómo se usa</a>
      </section>`;
    $app.querySelector('svg').style.cssText = 'width:84px;height:84px;margin:0 auto';
    const pinInput = document.getElementById('pin');
    pinInput.focus();
    document.getElementById('pinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await DB.checkPin(pinInput.value)) {
        state.admin = true;
        adminPanel();
      } else {
        toast('PIN incorrecto', true);
        pinInput.select();
      }
    });
  }

  async function adminPanel(tab = 'preguntas') {
    $app.innerHTML = `
      <section class="screen">
        <div class="admin-head">
          <h2>${art('ico-microscope')} Panel docente</h2>
          <div class="row">
            ${state.installPrompt ? `<button class="btn small blue" id="installApp">${ic('download')} Instalar app</button>` : ''}
            <button class="btn small ghost" id="fullscreen">${ic('expand')} Pantalla completa</button>
            <button class="btn small ghost" id="logout">${ic('logout')} Salir</button>
          </div>
        </div>
        <div id="adminNotes"></div>
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="preguntas">${ic('list')} Preguntas</button>
          <button class="tab" role="tab" data-tab="nueva">${ic('plus')} Nueva pregunta</button>
          <button class="tab" role="tab" data-tab="ajustes">${ic('sliders')} Ajustes</button>
          <button class="tab" role="tab" data-tab="datos">${ic('save')} Datos y respaldo</button>
          <button class="tab" role="tab" data-tab="ayuda">${ic('help')} Ayuda</button>
        </div>
        <div id="adminBody"></div>
      </section>`;
    document.getElementById('logout').addEventListener('click', () => {
      state.admin = false;
      go('#/');
    });
    document.getElementById('fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => toast('Este navegador no permite pantalla completa', true));
    });
    const install = document.getElementById('installApp');
    if (install) install.addEventListener('click', async () => {
      const prompt = state.installPrompt;
      state.installPrompt = null;
      install.remove();
      prompt.prompt();
    });
    paintAdminNotes();
    const tabs = [...$app.querySelectorAll('.tab')];
    const show = (t, payload) => {
      tabs.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
      const body = document.getElementById('adminBody');
      body.innerHTML = '';
      if (t === 'preguntas') adminList(body, show);
      else if (t === 'nueva') adminForm(body, show, payload);
      else if (t === 'ajustes') adminSettings(body);
      else if (t === 'ayuda') body.innerHTML = helpHtml();
      else adminData(body);
    };
    // atajos dentro de la ayuda que llevan a otra pestaña
    document.getElementById('adminBody').addEventListener('click', (e) => {
      const a = e.target.closest('[data-goto]');
      if (a) { e.preventDefault(); show(a.dataset.goto); window.scrollTo(0, 0); }
    });
    tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    show(tab);
  }

  async function adminList(body, show) {
    body.innerHTML = `<div class="loader">${art('ico-dna')}</div>`;
    let qs;
    try { qs = await DB.getQuestions(); }
    catch (err) { body.innerHTML = ''; return toast(err.message, true); }
    if (!body.isConnected) return; // el docente ya se fue del panel
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
              <button class="iconbtn del" data-del="${esc(q.id)}" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>
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
        if (!(await confirmBox({ icon: 'trash', danger: true, title: '¿Eliminar la pregunta?', quote: q.text, ok: 'Eliminar' }))) return;
        try {
          await DB.deleteQuestion(q.id);
          toast('Pregunta eliminada');
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
        <input class="input" id="imgUrl" placeholder="…o pegá un link https:// (solo se ve con internet)" style="margin-top:8px;font-size:1rem">`;
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
        await DB.saveQuestion(payload, editing ? editing.id : undefined);
        toast(editing ? 'Pregunta actualizada' : 'Pregunta creada');
        show(editing ? 'preguntas' : 'nueva');
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
    document.getElementById('qText').focus();
  }

  // Avisos que el docente tiene que ver al entrar al panel
  async function paintAdminNotes() {
    const el = document.getElementById('adminNotes');
    if (!el) return;
    const b = DB.backupState();
    const notes = [];
    if (await DB.usingDefaultPin())
      notes.push(`<div class="note warn">${ic('lock')}<span>Todavía usás el PIN de fábrica (<b>biologia</b>). Cambialo en <b>Ajustes</b>. ¿Primera vez? Mirá la pestaña <b>Ayuda</b>.</span></div>`);
    if (!b.supported)
      notes.push(`<div class="note warn">${ic('save')}<span>Este navegador no puede guardar solo en un archivo. Usá <b>Chrome</b> o <b>Edge</b>, o descargá copias a mano desde <b>Datos y respaldo</b>.</span></div>`);
    else if (!b.linked)
      notes.push(`<div class="note warn">${ic('save')}<span>No hay archivo de respaldo elegido. Configuralo en <b>Datos y respaldo</b> para no perder nada.</span></div>`);
    el.innerHTML = notes.join('');
  }

  async function adminSettings(body) {
    const [s, qs] = await Promise.all([DB.getSettings(), DB.getQuestions()]);
    if (!body.isConnected) return;
    body.innerHTML = `
      <div class="stack">
        <form class="card form-grid" id="sForm">
          <h3>${ic('sliders')} Configuración del juego</h3>
          <div>
            <label class="label" for="sTitle">Nombre de la materia / evento</label>
            <input class="input" id="sTitle" maxlength="60" value="${esc(s.title)}">
          </div>
          <div>
            <label class="label" for="sCount">Preguntas por persona</label>
            <input class="input" id="sCount" type="number" min="1" max="50" value="${s.questionsPerGame}" style="max-width:160px">
            <p class="hint" style="margin:6px 0 0">Por defecto son 6. Hay ${qs.length} pregunta${qs.length === 1 ? '' : 's'} cargada${qs.length === 1 ? '' : 's'}.</p>
          </div>
          <label class="switch"><input type="checkbox" id="sShuffle" ${s.shuffle ? 'checked' : ''}> Mezclar preguntas y respuestas en cada partida</label>
          <div class="form-actions"><button class="btn" type="submit">${ic('save')} Guardar ajustes</button></div>
        </form>

        <form class="card form-grid" id="newPinForm" autocomplete="off">
          <h3>${ic('lock')} Cambiar PIN del panel</h3>
          <div class="row" style="align-items:flex-end">
            <div><label class="label" for="pin1">PIN nuevo</label><input class="input" id="pin1" type="password" minlength="4" autocomplete="new-password" required></div>
            <div><label class="label" for="pin2">Repetilo</label><input class="input" id="pin2" type="password" minlength="4" autocomplete="new-password" required></div>
          </div>
          <div class="form-actions"><button class="btn purple" type="submit">${ic('lock')} Cambiar PIN</button></div>
        </form>
      </div>`;

    document.getElementById('sForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await DB.saveSettings({
          title: document.getElementById('sTitle').value,
          questionsPerGame: Number(document.getElementById('sCount').value),
          shuffle: document.getElementById('sShuffle').checked,
        });
        toast('Ajustes guardados');
      } catch (err) { toast(err.message, true); }
    });

    document.getElementById('newPinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = document.getElementById('pin1').value;
      if (a !== document.getElementById('pin2').value) return toast('Los PIN no coinciden', true);
      try {
        await DB.setPin(a);
        e.target.reset();
        toast('PIN cambiado');
        paintAdminNotes();
      } catch (err) { toast(err.message, true); }
    });
  }

  async function adminData(body) {
    const [qs, list, info] = await Promise.all([DB.getQuestions(), DB.getRanking(), DB.storageInfo()]);
    if (!body.isConnected) return;
    body.innerHTML = `
      <div class="stack">
        <div class="card form-grid" id="fileCard"></div>

        <div class="card form-grid">
          <h3>${ic('download')} Copia completa</h3>
          <p class="hint" style="margin:0">Preguntas, ranking y ajustes en un solo archivo. Sirve para pasar todo a otra compu o recuperar los datos si se borran del navegador.</p>
          <div class="row">
            <button class="btn small blue" id="dlCopy">${ic('download')} Descargar copia</button>
            <label class="btn small yellow">${ic('upload')} Restaurar desde archivo<input type="file" accept="application/json,.json" id="restoreFile" hidden></label>
          </div>
          <p class="hint" style="margin:0">En este navegador: ${qs.length} preguntas · ${fmt(list.length)} jugadores · ${(info.usage / 1048576).toFixed(1)} MB${info.persisted ? ' · almacenamiento protegido' : ''}</p>
        </div>

        <div class="card form-grid">
          <h3>${ic('list')} Importar / exportar preguntas</h3>
          <p class="hint" style="margin:0">Solo las preguntas, para compartirlas con otro docente o sumar las de otro curso.</p>
          <div class="row">
            <button class="btn small blue" id="exportQ">${ic('download')} Exportar</button>
            <label class="btn small yellow">${ic('upload')} Importar<input type="file" accept="application/json,.json" id="importQ" hidden></label>
          </div>
        </div>

        <div class="card form-grid">
          <h3>${ic('trophy')} Ranking</h3>
          <p class="hint" style="margin:0">Empezá de cero el ranking. Antes conviene descargar una copia.</p>
          <div><button class="btn small danger" id="resetRank">${ic('broom')} Reiniciar ranking</button></div>
        </div>
      </div>`;

    const paintFile = (b) => {
      const card = document.getElementById('fileCard');
      if (!card) return;
      const head = `<h3>${ic('save')} Archivo de respaldo automático</h3>`;
      if (!b.supported) {
        card.innerHTML = `${head}
          <p class="hint" style="margin:0">Este navegador no permite guardar solo en un archivo. Abrí el Preguntero en <b>Chrome</b> o <b>Edge</b> para activarlo. Mientras tanto, descargá una copia al terminar cada jornada.</p>`;
        return;
      }
      const when = b.lastSaved ? b.lastSaved.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      const status = !b.linked
        ? `<div class="note warn">${ic('save')}<span>Todavía no elegiste un archivo. Los datos están solo en el navegador.</span></div>`
        : b.status === 'ok'
          ? `<div class="note ok">${ic('check')}<span>Guardando en <b>${esc(b.fileName)}</b>${when ? ` · último guardado ${when}` : ''}</span></div>`
          : b.status === 'permission'
            ? `<div class="note warn">${ic('lock')}<span>El navegador necesita permiso para seguir guardando en <b>${esc(b.fileName)}</b>.</span></div>`
            : `<div class="note bad">${ic('x')}<span>No se pudo guardar en <b>${esc(b.fileName)}</b>: ${esc(b.error)}</span></div>`;
      card.innerHTML = `${head}
        <p class="hint" style="margin:0">Cada partida y cada cambio se guardan solos en un archivo de la compu (por ejemplo en Documentos). Si se borran los datos del navegador, se recupera todo con <b>Restaurar desde archivo</b>.</p>
        ${status}
        <div class="row">
          ${b.linked && b.status !== 'ok' ? `<button class="btn small" id="fReconnect">${ic('refresh')} Dar permiso</button>` : ''}
          <button class="btn small ${b.linked ? 'ghost' : ''}" id="fCreate">${ic('plus')} ${b.linked ? 'Usar un archivo nuevo' : 'Crear archivo de respaldo'}</button>
          <button class="btn small ghost" id="fOpen">${ic('upload')} Usar un archivo existente</button>
          ${b.linked ? `<button class="btn small ghost" id="fUnlink">${ic('x')} Dejar de usar</button>` : ''}
        </div>`;
      const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      on('fReconnect', async () => { if (!(await DB.reconnect())) toast('No se dio permiso', true); });
      on('fCreate', async () => {
        try { await DB.createBackupFile(); toast('Archivo de respaldo listo'); paintAdminNotes(); }
        catch (err) { if (err.name !== 'AbortError') toast(err.message, true); }
      });
      on('fOpen', async () => {
        try {
          const { handle, data } = await DB.pickExistingFile();
          let load = false;
          if (data) {
            const choice = await ask({
              icon: 'save',
              title: 'Este archivo ya tiene datos',
              message: `Tiene ${data.questions.length} preguntas y ${data.ranking.length} jugadores. ¿Qué querés hacer?`,
              buttons: [
                { label: 'Cancelar', value: null, cls: 'ghost' },
                { label: 'Sobrescribir el archivo', value: 'overwrite', cls: 'yellow', icon: 'save' },
                { label: 'Cargar sus datos', value: 'load', icon: 'upload' },
              ],
            });
            if (!choice) return;
            load = choice === 'load';
          }
          await DB.linkExistingFile(handle, data, load);
          toast(load ? 'Datos cargados desde el archivo' : 'Archivo de respaldo listo');
          paintAdminNotes();
          if (load) adminData(body);
        } catch (err) { if (err.name !== 'AbortError') toast(err.message, true); }
      });
      on('fUnlink', async () => {
        if (!(await confirmBox({ icon: 'save', title: '¿Dejar de guardar en el archivo?', message: 'Los datos siguen en el navegador y el archivo no se borra.', ok: 'Dejar de usar' }))) return;
        await DB.unlinkFile();
        paintAdminNotes();
      });
    };
    paintFile(DB.backupState());
    const off = DB.onBackupChange(paintFile);
    const prevCleanup = cleanup;
    cleanup = () => { off(); prevCleanup(); };

    document.getElementById('dlCopy').addEventListener('click', () => DB.downloadCopy());

    document.getElementById('restoreFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!DB.isSnapshot(data)) throw new Error('El archivo no es una copia del Preguntero.');
        if (!(await confirmBox({
          icon: 'upload', danger: true, title: '¿Restaurar desde el archivo?',
          message: `Se reemplazan todas las preguntas, el ranking y los ajustes por los del archivo (${data.questions.length} preguntas, ${data.ranking.length} jugadores). Tu PIN no cambia.`,
          ok: 'Restaurar',
        }))) return;
        await DB.restore(data);
        toast('Datos restaurados');
        adminData(body);
      } catch (err) {
        toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido' : err.message, true);
      }
    });

    document.getElementById('exportQ').addEventListener('click', async () => {
      const list = await DB.getQuestions();
      DB.download(list.map(({ id, createdAt, ...rest }) => rest), `preguntero-preguntas-${new Date().toISOString().slice(0, 10)}.json`);
    });

    document.getElementById('importQ').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const r = await DB.importQuestions(Array.isArray(data) ? data : data.questions);
        toast(`Se importaron ${r.added} preguntas${r.errors.length ? ` (${r.errors.length} con errores)` : ''}`, r.errors.length > 0);
      } catch (err) {
        toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido' : err.message, true);
      }
    });

    document.getElementById('resetRank').addEventListener('click', async () => {
      if (!(await confirmBox({ icon: 'broom', danger: true, title: '¿Borrar todo el ranking?', message: 'No se puede deshacer. Antes conviene descargar una copia.', ok: 'Borrar ranking' }))) return;
      await DB.clearRanking();
      toast('Ranking reiniciado');
      adminData(body);
    });
  }

  // ---------- aviso de respaldo en pausa (visible para quien atiende el stand) ----------
  const backupBar = document.getElementById('backupBar');
  function paintBackupBar(b) {
    const show = b.supported && b.linked && b.status !== 'ok';
    backupBar.hidden = !show;
    if (!show) return;
    backupBar.innerHTML = `
      <span>${ic('save')} ${b.status === 'permission' ? 'El guardado en archivo está en pausa.' : 'No se pudo guardar en el archivo de respaldo.'}</span>
      <button class="btn small" id="barReconnect">${ic('refresh')} Reanudar</button>`;
    document.getElementById('barReconnect').addEventListener('click', async () => {
      if (await DB.reconnect()) toast('Guardado en archivo reanudado');
      else toast('No se dio permiso', true);
    });
  }
  DB.onBackupChange(paintBackupBar);

  // ---------- app instalable y sin conexión ----------
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      state.updateReady = true;
      if (routeKey() === '') location.reload();
    });
  }

  DB.init()
    .then(router)
    .catch((err) => {
      $app.innerHTML = `
        <section class="screen card center stack">
          <h2>No se pudo abrir el Preguntero</h2>
          <p class="muted" style="font-weight:700">El navegador no deja guardar datos (¿modo incógnito?). Abrilo en una ventana normal de Chrome o Edge.</p>
          <p class="hint">${esc(err && err.message)}</p>
        </section>`;
    });
})();
