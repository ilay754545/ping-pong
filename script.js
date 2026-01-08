// Ultimate Ping Pong - Web Canvas Game
// Built for performance, smoothness, and fun.

(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // UI Elements
  const scoreLeftEl = document.getElementById('scoreLeft');
  const scoreRightEl = document.getElementById('scoreRight');
  const statusTextEl = document.getElementById('statusText');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnReset = document.getElementById('btnReset');
  const modeSelect = document.getElementById('mode');
  const difficultySelect = document.getElementById('difficulty');
  const btnQuickMatch = document.getElementById('btnQuickMatch');
  const btnGoogle = document.getElementById('btnGoogle');
  const userBadge = document.getElementById('userBadge');

  // Firebase init (optional)
  let firebaseApp = null, auth = null, db = null;
  if (window.FIREBASE_CONFIG) {
    firebaseApp = firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
  }

  // If Firebase config missing, gracefully disable online features (no alerts)
  if (!window.FIREBASE_CONFIG) {
    if (btnGoogle) { btnGoogle.disabled = true; btnGoogle.title = 'Enable Firebase to use Google sign-in'; btnGoogle.textContent = 'Sign in (disabled)'; }
    if (btnQuickMatch) { btnQuickMatch.disabled = true; btnQuickMatch.style.display = 'none'; }
    const onlineOpt = Array.from(modeSelect.options).find(o => o.value === 'pvp-online');
    if (onlineOpt) onlineOpt.disabled = true;
    if (modeSelect.value === 'pvp-online') modeSelect.value = 'pve';
  }

  function setUserBadge(user) {
    userBadge.textContent = user ? `Signed in: ${user.displayName || user.email}` : '';
    btnGoogle.textContent = user ? 'Sign out' : 'Sign in';
  }

  if (auth) {
    auth.onAuthStateChanged(setUserBadge);
    btnGoogle.addEventListener('click', async () => {
      if (!auth) return;
      if (auth.currentUser) { await auth.signOut(); return; }
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
      } catch (e) {
        console.warn('Google sign-in failed', e);
      }
    });
  } else {
    // Remove alert behavior; keep button disabled from above
    if (btnGoogle) btnGoogle.addEventListener('click', () => {});
  }

  // Online PvP quick match (very simple room matchmaking)
  let roomRef = null; let isHost = false;
  async function joinQuickMatch() {
    if (!db) { alert('Configure Firebase Realtime Database to enable Online PvP.'); return; }
    const roomsRef = db.ref('pongRooms');
    const snap = await roomsRef.orderByChild('status').equalTo('waiting').limitToFirst(1).get();
    let roomKey;
    if (!snap.exists()) {
      // create room
      const newRef = roomsRef.push();
      roomKey = newRef.key; isHost = true;
      await newRef.set({ status: 'waiting', createdAt: Date.now(), hostScore: 0, guestScore: 0 });
    } else {
      roomKey = Object.keys(snap.val())[0]; isHost = false;
      await roomsRef.child(roomKey).update({ status: 'ready' });
    }
    roomRef = roomsRef.child(roomKey);
    statusTextEl.textContent = `Online room: ${roomKey} (${isHost ? 'Host' : 'Guest'})`;

    // Sync minimal state: host authoritative ball and scores
    if (isHost) {
      // push updates periodically
      setInterval(() => {
        const b = State.balls[0] || null;
        roomRef.child('state').set({
          leftY: left.y, rightY: right.y,
          ball: b ? { x: b.x, y: b.y, vx: b.vx, vy: b.vy } : null,
          leftScore: State.leftScore, rightScore: State.rightScore,
        });
      }, 50);
    } else {
      roomRef.child('state').on('value', (s) => {
        const val = s.val(); if (!val) return;
        left.y = val.leftY; right.y = val.rightY;
        if (val.ball) {
          if (!State.balls[0]) State.balls = [new Ball(val.ball.x, val.ball.y, Math.hypot(val.ball.vx, val.ball.vy))];
          const b = State.balls[0];
          b.x = val.ball.x; b.y = val.ball.y; b.vx = val.ball.vx; b.vy = val.ball.vy;
        } else { State.balls = []; }
        State.leftScore = val.leftScore; State.rightScore = val.rightScore;
      });
    }
  }

  if (btnQuickMatch) btnQuickMatch.addEventListener('click', joinQuickMatch);

  // In online mode, map local controls to left/right depending on host/guest
  function applyOnlineControls(dt) {
    if (!roomRef) return false;
    // Host controls left, guest controls right
    if (isHost) {
      left.update(dt, 'w', 's');
    } else {
      right.update(dt, 'w', 's');
    }
    return true;
  }

  // Audio
  const sfx = {
    paddle: new Audio('https://cdn.jsdelivr.net/gh/jshaw/asset-host/pingpong/paddle.wav'),
    wall: new Audio('https://cdn.jsdelivr.net/gh/jshaw/asset-host/pingpong/wall.wav'),
    score: new Audio('https://cdn.jsdelivr.net/gh/jshaw/asset-host/pingpong/score.wav'),
    power: new Audio('https://cdn.jsdelivr.net/gh/jshaw/asset-host/pingpong/power.wav'),
    multi: new Audio('https://cdn.jsdelivr.net/gh/jshaw/asset-host/pingpong/multi.wav'),
  };
  Object.values(sfx).forEach(a => { a.volume = 0.4; });

  // Game State
  const State = {
    running: false,
    paused: false,
    mode: 'pve', // 'pve' | 'pvp'
    difficulty: 'normal',
    leftScore: 0,
    rightScore: 0,
    balls: [],
    powerUps: [],
    stickyLeft: false,
    stickyRight: false,
    shieldLeft: 0,
    shieldRight: 0,
  };

  // Auto-serve scheduler (so user never needs to serve)
  let serveTimeout = null;
  function scheduleServe(delay = 900) {
    if (serveTimeout || !State.running || State.paused) return;
    statusTextEl.textContent = 'Serving...';
    serveTimeout = setTimeout(() => {
      serve(Math.random() < 0.5 ? -1 : 1);
      serveTimeout = null;
    }, delay);
  }

  const Keys = { w: false, s: false, ArrowUp: false, ArrowDown: false, space: false, p: false };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => Math.random() * (max - min) + min;

  // Predict the Y of a ball when it reaches a given X, accounting for top/bottom bounces
  function predictBallYAtX(ball, targetX) {
    if (ball.vx === 0) return ball.y;
    const time = (targetX - ball.x) / ball.vx; // time to reach target X (can be negative)
    let predictedY = ball.y + ball.vy * time;
    const minY = ball.r + 6;
    const maxY = H - ball.r - 6;
    const span = maxY - minY;
    // Reflect predictedY within [minY,maxY] like a mirror (handle multiple bounces)
    if (predictedY < minY || predictedY > maxY) {
      // convert to a sawtooth then mirror
      let m = (predictedY - minY) % (2 * span);
      if (m < 0) m += 2 * span;
      predictedY = m <= span ? minY + m : maxY - (m - span);
    }
    return clamp(predictedY, minY, maxY);
  }

  // Entities
  class Paddle {
    constructor(x) {
      this.x = x;
      this.y = H / 2;
      this.w = 18;
      this.h = 110;
      this.speed = 640;
      this.color = '#e5e7eb';
      this.trail = [];
    }
    update(dt, upKey, downKey) {
      let vy = 0;
      if (Keys[upKey]) vy -= 1;
      if (Keys[downKey]) vy += 1;
      this.y += vy * this.speed * dt;
      this.y = clamp(this.y, this.h / 2 + 8, H - this.h / 2 - 8);
      this.trail.push(this.y);
      if (this.trail.length > 8) this.trail.shift();
    }
    aiFollow(dt, ball, strength = 1) {
      // If ball is moving toward the AI, predict intercept; otherwise drift to center
      let target;
      if (ball && ball.vx > 0) {
        // Predict where the ball will cross the paddle X
        target = predictBallYAtX(ball, this.x - this.w / 2);
        // Add slight offset to avoid perfect center hits (creates realistic angles)
        const offset = clamp((ball.y - this.y) * 0.2, -40, 40);
        target += offset;
      } else {
        target = H / 2;
      }
      const diff = target - this.y;
      // Move with capped speed; scale by AI strength
      const maxStep = this.speed * dt * strength;
      this.y += clamp(diff, -maxStep, maxStep);
      this.y = clamp(this.y, this.h / 2 + 8, H - this.h / 2 - 8);
    }
    draw() {
      // Glow trail
      for (let i = 0; i < this.trail.length; i++) {
        const t = i / this.trail.length;
        ctx.fillStyle = `rgba(59,130,246,${0.08 * (1 - t)})`;
        const ty = this.trail[i];
        ctx.fillRect(this.x - this.w / 2 - 3, ty - this.h / 2, this.w + 6, this.h);
      }
      // Paddle
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h);
      // Shields
      if (this === left && State.shieldLeft > 0) drawShield(this.x, this.y, State.shieldLeft);
      if (this === right && State.shieldRight > 0) drawShield(this.x, this.y, State.shieldRight);
    }
  }

  class Ball {
    constructor(x, y, speed = 540) {
      this.x = x; this.y = y;
      this.lastX = x; this.lastY = y;
      const angle = rand(-0.35, 0.35) + (Math.random() < 0.5 ? Math.PI : 0);
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.r = 10;
      this.color = '#22d3ee';
      this.spin = 0; // adds curve on bounce
    }
    update(dt) {
      this.lastX = this.x; this.lastY = this.y;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += this.spin * dt;
      // walls
      if (this.y < this.r + 6) { this.y = this.r + 6; this.vy *= -1; sfx.wall.play(); }
      if (this.y > H - this.r - 6) { this.y = H - this.r - 6; this.vy *= -1; sfx.wall.play(); }
    }
    draw() {
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 10;
      ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  class PowerUp {
    constructor(type, x, y) {
      this.type = type; this.x = x; this.y = y; this.size = 26; this.ttl = 10; // seconds
    }
    update(dt) { this.ttl -= dt; }
    draw() {
      ctx.save();
      const icons = {
        speed: '⚡', sticky: '🧲', multi: '🔮', shield: '🛡️'
      };
      ctx.translate(this.x, this.y);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size);
      ctx.font = '20px Segoe UI Emoji';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icons[this.type], 0, 0);
      ctx.restore();
    }
  }

  // Game entities
  const left = new Paddle(40);
  const right = new Paddle(W - 40);

  function serve(direction = Math.random() < 0.5 ? -1 : 1) {
    // Clear any pending auto-serve
    if (serveTimeout) { clearTimeout(serveTimeout); serveTimeout = null; }
    const b = new Ball(W / 2, H / 2, 540);
    b.vx = Math.abs(b.vx) * direction;
    State.balls = [b];
    State.stickyLeft = false; State.stickyRight = false;
    statusTextEl.textContent = 'Game on!';
  }

  function collideBallWithPaddle(ball, paddle) {
    const padRect = { x: paddle.x - paddle.w / 2, y: paddle.y - paddle.h / 2, w: paddle.w, h: paddle.h };
    let hit = false;

    // Swept collision on the paddle front face to prevent tunneling
    if (paddle === right && ball.vx > 0) {
      const front = padRect.x; // left side of right paddle
      if (
        ball.lastX + ball.r <= front &&
        ball.x + ball.r >= front &&
        ball.y >= padRect.y - ball.r &&
        ball.y <= padRect.y + padRect.h + ball.r
      ) hit = true;
    } else if (paddle === left && ball.vx < 0) {
      const front = padRect.x + padRect.w; // right side of left paddle
      if (
        ball.lastX - ball.r >= front &&
        ball.x - ball.r <= front &&
        ball.y >= padRect.y - ball.r &&
        ball.y <= padRect.y + padRect.h + ball.r
      ) hit = true;
    }

    // Overlap check as fallback
    if (!hit) {
      const dx = Math.abs(ball.x - (padRect.x + padRect.w / 2));
      const dy = Math.abs(ball.y - (padRect.y + padRect.h / 2));
      if (dx <= padRect.w / 2 + ball.r && dy <= padRect.h / 2 + ball.r) hit = true;
    }

    if (hit) {
      // Place the ball outside the paddle and reflect with angle based on contact offset
      if (paddle === left) ball.x = padRect.x + padRect.w + ball.r; else ball.x = padRect.x - ball.r;
      const offset = (ball.y - paddle.y) / (paddle.h / 2);
      const speed = Math.min(900, Math.hypot(ball.vx, ball.vy) * 1.04);
      const base = paddle === left ? 0 : Math.PI; // direction to send the ball
      const angle = base + offset * 0.7;
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      ball.spin = offset * 80;
      sfx.paddle.play();
      // Sticky slows down after hit
      if ((paddle === left && State.stickyLeft) || (paddle === right && State.stickyRight)) {
        ball.vx *= 0.75; ball.vy *= 0.75;
      }
    }
  }

  function spawnPowerUp() {
    const types = ['speed', 'sticky', 'multi', 'shield'];
    const type = types[Math.floor(Math.random() * types.length)];
    State.powerUps.push(new PowerUp(type, rand(200, W - 200), rand(120, H - 120)));
  }

  function applyPowerUp(pu, hitter) {
    switch (pu.type) {
      case 'speed':
        State.balls.forEach(b => { b.vx *= 1.25; b.vy *= 1.25; });
        sfx.power.play();
        break;
      case 'sticky':
        if (hitter === 'left') State.stickyLeft = true; else State.stickyRight = true;
        setTimeout(() => { State.stickyLeft = false; State.stickyRight = false; }, 5000);
        sfx.power.play();
        break;
      case 'multi':
        if (State.balls.length < 4) {
          const clones = State.balls.map(b => { const c = new Ball(b.x, b.y, Math.hypot(b.vx, b.vy)); c.vx = -b.vx; c.vy = b.vy; return c; });
          State.balls.push(...clones);
          sfx.multi.play();
        }
        break;
      case 'shield':
        if (hitter === 'left') State.shieldLeft = 3; else State.shieldRight = 3;
        setTimeout(() => { State.shieldLeft = Math.max(0, State.shieldLeft - 1); State.shieldRight = Math.max(0, State.shieldRight - 1); }, 6000);
        sfx.power.play();
        break;
    }
  }

  function drawShield(x, y, strength) {
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 70, -Math.PI/3, Math.PI/3);
    ctx.stroke();
    // pips
    for (let i = 0; i < strength; i++) {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.arc(x + 80 + i*12, y - 30 + i*6, 4, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // Rendering
  function drawNet() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(W/2, 20); ctx.lineTo(W/2, H-20);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackground() {
    ctx.save();
    // side gradients
    const gradL = ctx.createLinearGradient(0, 0, 200, 0);
    gradL.addColorStop(0, 'rgba(59,130,246,0.12)'); gradL.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = gradL; ctx.fillRect(0, 0, 200, H);

    const gradR = ctx.createLinearGradient(W, 0, W-200, 0);
    gradR.addColorStop(0, 'rgba(34,211,238,0.12)'); gradR.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = gradR; ctx.fillRect(W-200, 0, 200, H);
    ctx.restore();
  }

  // Collision helpers
  function rectCircleCollide(rx, ry, rw, rh, cx, cy, cr) {
    const nearestX = clamp(cx, rx, rx + rw);
    const nearestY = clamp(cy, ry, ry + rh);
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return dx * dx + dy * dy <= cr * cr;
  }

  // Input
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') Keys.space = true;
    if (e.key.toLowerCase() === 'w') Keys.w = true;
    if (e.key.toLowerCase() === 's') Keys.s = true;
    if (e.key === 'ArrowUp') Keys.ArrowUp = true;
    if (e.key === 'ArrowDown') Keys.ArrowDown = true;
    if (e.key.toLowerCase() === 'p') Keys.p = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') Keys.space = false;
    if (e.key.toLowerCase() === 'w') Keys.w = false;
    if (e.key.toLowerCase() === 's') Keys.s = false;
    if (e.key === 'ArrowUp') Keys.ArrowUp = false;
    if (e.key === 'ArrowDown') Keys.ArrowDown = false;
    if (e.key.toLowerCase() === 'p') Keys.p = false;
  });

  // AI difficulty
  function aiStrength() {
    switch (State.difficulty) {
      case 'easy': return 0.6;
      case 'normal': return 0.85;
      case 'hard': return 1.05;
      case 'insane': return 1.25;
    }
    return 0.85;
  }

  // Game loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (!State.running || State.paused) { requestAnimationFrame(loop); return; }

    // Update
    if (State.mode === 'pvp') {
      left.update(dt, 'w', 's');
      right.update(dt, 'ArrowUp', 'ArrowDown');
    } else if (State.mode === 'pve') {
      left.update(dt, 'w', 's');
      const targetBall = State.balls.reduce((acc, b) => acc == null || b.vx > 0 && Math.abs(b.x - right.x) < Math.abs(acc.x - right.x) ? b : acc, null);
      right.aiFollow(dt, targetBall, aiStrength());
    } else if (State.mode === 'pvp-online') {
      if (!applyOnlineControls(dt)) {
        statusTextEl.textContent = 'Click Quick Match to join an online room.';
      }
    }

    State.balls.forEach(b => b.update(dt));

    // Collisions with paddles
    State.balls.forEach(b => { collideBallWithPaddle(b, left); collideBallWithPaddle(b, right); });

    // Auto-return if ball gets stuck near AI side (realistic nudge back)
    for (const b of State.balls) {
      const nearRight = b.x > right.x - right.w && b.vx > 0;
      const stalled = Math.abs(b.vx) < 40 && Math.abs(b.vy) < 40;
      if (nearRight && stalled) {
        // Aim back toward left paddle area with slight randomness
        const targetY = left.y + rand(-50, 50);
        const speed = 560 + rand(-40, 40);
        const dx = (left.x + left.w) - b.x;
        const dy = targetY - b.y;
        const len = Math.hypot(dx, dy) || 1;
        b.vx = (dx / len) * speed;
        b.vy = (dy / len) * speed;
        b.spin = (dy / len) * 80;
        sfx.paddle.play();
      }
    }

    // PowerUp pickup
    for (const pu of State.powerUps) {
      for (const b of State.balls) {
        if (rectCircleCollide(pu.x - pu.size/2, pu.y - pu.size/2, pu.size, pu.size, b.x, b.y, b.r)) {
          const hitter = b.vx < 0 ? 'left' : 'right';
          applyPowerUp(pu, hitter);
          pu.ttl = 0;
        }
      }
    }
    State.powerUps = State.powerUps.filter(p => p.ttl > 0);

    // Scoring
    for (const b of [...State.balls]) {
      if (b.x < -40) { State.rightScore++; sfx.score.play(); State.balls.splice(State.balls.indexOf(b), 1); }
      if (b.x > W + 40) { State.leftScore++; sfx.score.play(); State.balls.splice(State.balls.indexOf(b), 1); }
    }
    if (State.balls.length === 0) {
      scheduleServe(900);
    } else if (serveTimeout) {
      clearTimeout(serveTimeout); serveTimeout = null;
    }

    // Random power-up spawns
    if (Math.random() < 0.004) spawnPowerUp();

    // Input actions
    // Remove need to press Space to serve; keep pause toggle only
    if (Keys.p) { State.paused = !State.paused; statusTextEl.textContent = State.paused ? 'Paused' : 'Game on!';
      // Handle auto-serve on unpause
      if (!State.paused && State.balls.length === 0) scheduleServe(600);
      Keys.p = false; }

    // Draw
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawNet();

    // Side glow based on scores
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(0, 0, clamp(State.leftScore * 12, 0, 180), H);
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(W - clamp(State.rightScore * 12, 0, 180), 0, clamp(State.rightScore * 12, 0, 180), H);
    ctx.restore();

    left.draw(); right.draw();
    State.balls.forEach(b => b.draw());
    State.powerUps.forEach(p => p.draw());

    // HUD
    scoreLeftEl.textContent = State.leftScore;
    scoreRightEl.textContent = State.rightScore;

    requestAnimationFrame(loop);
  }

  // Controls
  btnStart.addEventListener('click', () => {
    if (!State.running) {
      State.running = true;
      scheduleServe(400);
    }
  });
  btnPause.addEventListener('click', () => {
    State.paused = !State.paused; statusTextEl.textContent = State.paused ? 'Paused' : 'Game on!';
    if (State.paused && serveTimeout) { clearTimeout(serveTimeout); serveTimeout = null; }
    if (!State.paused && State.balls.length === 0) scheduleServe(600);
  });
  btnReset.addEventListener('click', () => {
    State.leftScore = 0; State.rightScore = 0; State.balls = []; State.powerUps = [];
    if (serveTimeout) { clearTimeout(serveTimeout); serveTimeout = null; }
    if (State.running && !State.paused) scheduleServe(500);
  });
  modeSelect.addEventListener('change', (e) => { State.mode = e.target.value; });
  difficultySelect.addEventListener('change', (e) => { State.difficulty = e.target.value; });

  statusTextEl.textContent = 'Press Start';
  requestAnimationFrame(loop);
})();
