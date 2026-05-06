/* ============================================================
   NEON SIEGE — game.js
   Plain JS / HTML5 Canvas arcade roguelike prototype
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const COLS = 7;
const BALL_SPEED = 9;
const BALL_RADIUS = 7;
const BLOCK_ROWS_MAX = 10;  // rows visible at once
const DANGER_ROW = 11;      // blocks past this row = game over
const UPGRADE_INTERVAL = 5; // every N stages show upgrade choice
const BOSS_INTERVAL = 10;   // every N stages add boss block
const FIRE_DELAY = 40;      // ms between successive ball launches

// Permanent upgrades config
const PERM_UPGRADES = [
  {
    id: 'extra_ball',
    name: 'EXTRA BALL',
    desc: 'Start each run with +1 ball',
    baseCost: 80,
    maxLevel: 5,
    costMultiplier: 1.6,
    apply: (lvl, state) => { state.ballCount += lvl; }
  },
  {
    id: 'shard_boost',
    name: 'SHARD COLLECTOR',
    desc: 'Gain +10% shards per level',
    baseCost: 60,
    maxLevel: 5,
    costMultiplier: 1.5,
    apply: (lvl, state) => { state.shardMultiplier += lvl * 0.1; }
  },
  {
    id: 'start_shield',
    name: 'SHIELD MATRIX',
    desc: 'Start each run with a shield block barrier',
    baseCost: 100,
    maxLevel: 3,
    costMultiplier: 2.0,
    apply: (lvl, state) => { state.startShieldLevel = lvl; }
  }
];

// Roguelike run upgrades
const RUN_UPGRADES = [
  { id: 'ball_plus',    icon: '🔵', name: '+1 BALL',          desc: 'Fire one additional ball each turn.' },
  { id: 'dmg_plus',     icon: '⚔️', name: '+1 DAMAGE',         desc: 'Each ball deals +1 damage per hit.' },
  { id: 'explode_hit',  icon: '💥', name: 'CHAIN REACTION',    desc: 'First hit each turn causes a small explosion.' },
  { id: 'crit_chance',  icon: '🎯', name: 'CRITICAL HIT',      desc: '15% chance for triple damage on any hit.' },
  { id: 'laser_strike', icon: '🔱', name: 'LASER BARRAGE',     desc: 'Every 3 turns, an auto-laser damages a column.' },
  { id: 'slow_descent', icon: '🧲', name: 'GRAVITY DAMPENER',  desc: 'Blocks descend one fewer row every 8 stages.' },
  { id: 'piercing',     icon: '🏹', name: 'PIERCING SHOT',      desc: 'First 3 bounces pass through blocks.' },
  { id: 'magnet',       icon: '⭐', name: 'MAGNET FIELD',       desc: 'Collect crystals automatically without hitting.' },
  { id: 'multishot',    icon: '🌀', name: 'MULTISHOT',          desc: 'Launch balls in a spread fan pattern.' },
  { id: 'regen',        icon: '💜', name: 'SHARD PULSE',        desc: 'Earn 5 bonus shards at end of each turn.' },
];

// ============================================================
// SAVE DATA
// ============================================================

const Save = {
  load() {
    try {
      const raw = localStorage.getItem('neonSiegeSave');
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { bestStage: 0, totalShards: 0, permLevels: {} };
  },
  save(data) {
    try { localStorage.setItem('neonSiegeSave', JSON.stringify(data)); } catch(e) {}
  }
};

let saveData = Save.load();

// ============================================================
// SCREEN MANAGER
// ============================================================

const OVERLAY_SCREENS = new Set(['pause', 'upgrade-choice', 'gameover']);

const Screens = {
  current: null,
  show(id) {
    // Overlays sit on top of the game screen — keep game active under them
    if (OVERLAY_SCREENS.has(id)) {
      document.querySelectorAll('.screen.overlay').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-game').classList.add('active');
    } else {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    }
    const el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
    this.current = id;
  }
};

// ============================================================
// UTILITIES
// ============================================================

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ============================================================
// CANVAS / RESIZE
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, blockW = 0, blockH = 0, blockPad = 0;
let launcherY = 0;

function resizeCanvas() {
  const parent = canvas.parentElement;
  const availW = Math.min(parent.clientWidth, 480);
  const availH = parent.clientHeight - 60; // hud + power bar

  // Force portrait
  W = availW;
  H = availH;
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  blockPad = 4;
  blockW = (W - blockPad * (COLS + 1)) / COLS;
  blockH = blockW * 0.55;
  launcherY = H - 48;
}

// ============================================================
// PARTICLES
// ============================================================

class Particle {
  constructor(x, y, color, opts = {}) {
    this.x = x; this.y = y;
    this.color = color;
    const speed = opts.speed || (Math.random() * 3 + 1);
    const angle = opts.angle !== undefined ? opts.angle : Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 1.0;
    this.decay = opts.decay || (Math.random() * 0.04 + 0.025);
    this.size = opts.size || (Math.random() * 3 + 1.5);
    this.gravity = opts.gravity || 0.06;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.life -= this.decay;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  get dead() { return this.life <= 0; }
}

let particles = [];

function spawnParticles(x, y, color, count = 10, opts = {}) {
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, color, opts));
  }
}

function spawnExplosionParticles(x, y, color) {
  spawnParticles(x, y, color, 16, { speed: 5, decay: 0.03, size: 3.5 });
  spawnParticles(x, y, '#ffffff', 6, { speed: 7, decay: 0.05, size: 2 });
}

// ============================================================
// SCREEN SHAKE
// ============================================================

let shakeFrames = 0, shakeAmt = 0;
function screenShake(frames, amt) {
  shakeFrames = Math.max(shakeFrames, frames);
  shakeAmt = Math.max(shakeAmt, amt);
}

// ============================================================
// BLOCK TYPES
// ============================================================

const BlockType = {
  NORMAL:    'normal',
  EXPLOSIVE: 'explosive',
  SHIELD:    'shield',
  CRYSTAL:   'crystal',
  BOSS:      'boss',
};

const BLOCK_COLORS = {
  [BlockType.NORMAL]:    { fill: '#1a1050', stroke: '#6644ff', glow: '#6644ff' },
  [BlockType.EXPLOSIVE]: { fill: '#2a0808', stroke: '#ff3300', glow: '#ff5500' },
  [BlockType.SHIELD]:    { fill: '#051525', stroke: '#00ccff', glow: '#00ccff' },
  [BlockType.CRYSTAL]:   { fill: '#120b28', stroke: '#cc00ff', glow: '#ee88ff' },
  [BlockType.BOSS]:      { fill: '#1a0005', stroke: '#ff0044', glow: '#ff0044' },
};

class Block {
  constructor(col, row, type, hp) {
    this.col = col;
    this.row = row;
    this.type = type;
    this.maxHp = hp;
    this.hp = hp;
    this.shieldActive = (type === BlockType.SHIELD);
    this.hitFlash = 0; // frames of white flash
    this.alive = true;
  }

  get x() { return blockPad + this.col * (blockW + blockPad); }
  get y() { return blockPad + this.row * (blockH + blockPad); }
  get cx() { return this.x + blockW / 2; }
  get cy() { return this.y + blockH / 2; }

  hit(dmg, game) {
    if (this.shieldActive) {
      // shield absorbs first hit
      this.shieldActive = false;
      this.hitFlash = 4;
      spawnParticles(this.cx, this.cy, '#00ccff', 5, { speed: 2, decay: 0.07 });
      return false; // block not destroyed
    }
    this.hp -= dmg;
    this.hitFlash = 3;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.onDestroy(game);
      return true; // destroyed
    }
    return false;
  }

  onDestroy(game) {
    const colors = BLOCK_COLORS[this.type];
    spawnExplosionParticles(this.cx, this.cy, colors.glow);

    if (this.type === BlockType.EXPLOSIVE) {
      game.explodeNear(this.col, this.row);
      screenShake(8, 5);
    }
    if (this.type === BlockType.CRYSTAL) {
      const shards = randInt(3, 8);
      game.earnShards(shards);
      spawnParticles(this.cx, this.cy, '#cc00ff', 10, { speed: 3, gravity: -0.04, decay: 0.025 });
    }
    if (this.type === BlockType.BOSS) {
      screenShake(14, 9);
      game.earnShards(randInt(15, 25));
    }
  }

  draw(ctx) {
    const colors = BLOCK_COLORS[this.type];
    const x = this.x, y = this.y;
    const flash = this.hitFlash > 0;
    if (flash) this.hitFlash--;

    ctx.save();
    // glow
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = flash ? 20 : 8;

    // fill
    ctx.beginPath();
    roundRect(ctx, x, y, blockW, blockH, 6);
    ctx.fillStyle = flash ? '#ffffff33' : colors.fill;
    ctx.fill();

    // border
    ctx.lineWidth = this.type === BlockType.BOSS ? 2.5 : 1.5;
    ctx.strokeStyle = flash ? '#ffffff' : colors.stroke;
    ctx.stroke();

    // shield aura
    if (this.shieldActive) {
      ctx.shadowBlur = 16;
      ctx.shadowColor = '#00ccff';
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,200,255,0.5)';
      roundRect(ctx, x - 3, y - 3, blockW + 6, blockH + 6, 9);
      ctx.stroke();
    }

    ctx.restore();

    // HP text
    const ratio = this.hp / this.maxHp;
    ctx.save();
    ctx.font = `bold ${blockH > 28 ? 13 : 10}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = flash ? '#fff' : (ratio > 0.5 ? '#fff' : '#ff8888');
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 4;
    ctx.fillText(this.hp, x + blockW / 2, y + blockH / 2);
    ctx.restore();

    // Boss indicator
    if (this.type === BlockType.BOSS) {
      ctx.save();
      ctx.font = `8px 'Courier New'`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0044';
      ctx.shadowColor = '#ff0044';
      ctx.shadowBlur = 6;
      ctx.fillText('CORE', x + blockW / 2, y + blockH - 6);
      ctx.restore();
    }
  }
}

// helper — roundRect path
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ============================================================
// BALL
// ============================================================

class Ball {
  constructor(x, y, vx, vy, opts = {}) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.active = true;
    this.piercingLeft = opts.piercingLeft || 0;
    this.trail = [];
  }

  update(game) {
    if (!this.active) return;

    // Trail
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 7) this.trail.shift();

    this.x += this.vx;
    this.y += this.vy;

    // Wall bounces
    if (this.x - BALL_RADIUS < 0) { this.x = BALL_RADIUS; this.vx = Math.abs(this.vx); }
    if (this.x + BALL_RADIUS > W) { this.x = W - BALL_RADIUS; this.vx = -Math.abs(this.vx); }
    if (this.y - BALL_RADIUS < 0) { this.y = BALL_RADIUS; this.vy = Math.abs(this.vy); }

    // Left bottom — deactivate
    if (this.y > H + BALL_RADIUS * 2) {
      this.active = false;
      return;
    }

    // Block collision
    for (const block of game.blocks) {
      if (!block.alive) continue;
      if (this.collidesBlock(block)) {
        this.resolveBlockCollision(block, game);
      }
    }
  }

  collidesBlock(block) {
    const bx = block.x, by = block.y;
    const cx = clamp(this.x, bx, bx + blockW);
    const cy = clamp(this.y, by, by + blockH);
    const dx = this.x - cx, dy = this.y - cy;
    return dx * dx + dy * dy < BALL_RADIUS * BALL_RADIUS;
  }

  resolveBlockCollision(block, game) {
    const dmg = game.ballDamage + (game.hasUpgrade('crit_chance') && Math.random() < 0.15 ? game.ballDamage * 2 : 0);

    // Chain reaction upgrade: first hit per turn causes extra explosion
    if (game.hasUpgrade('explode_hit') && game.firstHitThisTurn) {
      game.firstHitThisTurn = false;
      game.explodeNear(block.col, block.row, 1);
    }

    block.hit(Math.max(1, Math.round(dmg)), game);

    // Piercing: skip bounce for first N bounces
    if (this.piercingLeft > 0) {
      this.piercingLeft--;
      // push through
      const overlap = BALL_RADIUS * 2;
      if (this.vy < 0) this.y = block.y + blockH + overlap;
      else this.y = block.y - overlap;
      return;
    }

    // Normal bounce resolution
    const bCX = block.cx, bCY = block.cy;
    const dx = this.x - bCX, dy = this.y - bCY;
    const hw = blockW / 2 + BALL_RADIUS, hh = blockH / 2 + BALL_RADIUS;
    const overlapX = hw - Math.abs(dx), overlapY = hh - Math.abs(dy);
    if (overlapX < overlapY) {
      this.vx = dx > 0 ? Math.abs(this.vx) : -Math.abs(this.vx);
      this.x += dx > 0 ? overlapX : -overlapX;
    } else {
      this.vy = dy > 0 ? Math.abs(this.vy) : -Math.abs(this.vy);
      this.y += dy > 0 ? overlapY : -overlapY;
    }
  }

  draw(ctx) {
    if (!this.active) return;

    // Trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.4;
      const r = BALL_RADIUS * (i / this.trail.length);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#00f5ff';
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Ball
    ctx.save();
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 14;
    const grad = ctx.createRadialGradient(this.x - 2, this.y - 2, 1, this.x, this.y, BALL_RADIUS);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#00f5ff');
    grad.addColorStop(1, '#0033cc');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================
// LAUNCHER
// ============================================================

class Launcher {
  constructor() {
    this.x = W / 2;
    this.angle = -Math.PI / 2; // straight up
    this.minAngle = -Math.PI + 0.18;
    this.maxAngle = -0.18;
  }

  setAngleFromPoint(px, py) {
    const dx = px - this.x;
    const dy = py - launcherY;
    let a = Math.atan2(dy, dx);
    // clamp: only allow upward angles
    a = clamp(a, this.minAngle, this.maxAngle);
    this.angle = a;
  }

  draw(ctx) {
    const lx = this.x, ly = launcherY;
    const len = 38;
    const ex = lx + Math.cos(this.angle) * len;
    const ey = ly + Math.sin(this.angle) * len;

    // Base platform
    ctx.save();
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 16;
    const grad = ctx.createLinearGradient(lx - 18, ly, lx + 18, ly);
    grad.addColorStop(0, '#003366');
    grad.addColorStop(0.5, '#0099ff');
    grad.addColorStop(1, '#003366');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(lx, ly + 6, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Barrel
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Tip glow
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Aim dots
    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.strokeStyle = 'rgba(0,245,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    const dotLen = 80;
    ctx.lineTo(ex + Math.cos(this.angle) * dotLen, ey + Math.sin(this.angle) * dotLen);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================
// GAME STATE MACHINE
// ============================================================

const GamePhase = {
  IDLE:       'idle',       // waiting for player to aim/shoot
  SHOOTING:   'shooting',   // balls flying
  TURN_END:   'turn_end',   // processing end of turn
  UPGRADE:    'upgrade',    // showing upgrade cards
  GAMEOVER:   'gameover',
};

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    resizeCanvas();

    // Run stats
    this.stage = 1;
    this.score = 0;
    this.shards = 0;
    this.phase = GamePhase.IDLE;
    this.turn = 0;
    this.laserTurnCounter = 0;

    // Apply permanent upgrades
    this.ballCount = 1;
    this.ballDamage = 1;
    this.shardMultiplier = 1.0;
    this.startShieldLevel = 0;
    this.applyPermUpgrades();

    // Run upgrades
    this.runUpgrades = [];
    this.firstHitThisTurn = true;

    // Powers
    this.powLightning = 1;
    this.powBomb = 1;

    // Game objects
    this.blocks = [];
    this.balls = [];
    this.pendingBalls = 0;
    this.launcher = new Launcher();

    // Input
    this.aiming = false;
    this.inputX = W / 2;
    this.inputY = 0;

    // Spawn first stage
    this.spawnStageBlocks();

    this.updateHUD();
    this.updatePowerBar();
  }

  applyPermUpgrades() {
    const tempState = {
      ballCount: this.ballCount,
      shardMultiplier: this.shardMultiplier,
      startShieldLevel: this.startShieldLevel
    };
    for (const upg of PERM_UPGRADES) {
      const lvl = saveData.permLevels[upg.id] || 0;
      if (lvl > 0) upg.apply(lvl, tempState);
    }
    this.ballCount = tempState.ballCount;
    this.shardMultiplier = tempState.shardMultiplier;
    this.startShieldLevel = tempState.startShieldLevel;
  }

  hasUpgrade(id) {
    return this.runUpgrades.includes(id);
  }

  earnShards(n) {
    const earned = Math.floor(n * this.shardMultiplier);
    this.shards += earned;
    saveData.totalShards += earned;
    document.getElementById('hud-shards').textContent = this.shards;
  }

  // ---- Block spawning ----

  blockHpForStage(stage) {
    return Math.ceil(1 + stage * 0.8 + (stage > 5 ? stage * 0.4 : 0));
  }

  spawnStageBlocks() {
    const stage = this.stage;
    const hp = this.blockHpForStage(stage);
    const isBossStage = stage % BOSS_INTERVAL === 0;

    // Generate one row of blocks at the top
    for (let col = 0; col < COLS; col++) {
      const rnd = Math.random();
      let type = BlockType.NORMAL;

      if (isBossStage && col === Math.floor(COLS / 2)) {
        type = BlockType.BOSS;
      } else if (rnd < 0.08) {
        type = BlockType.EXPLOSIVE;
      } else if (rnd < 0.16) {
        type = BlockType.SHIELD;
      } else if (rnd < 0.24) {
        type = BlockType.CRYSTAL;
      }

      // Skip some columns for variety
      if (type === BlockType.NORMAL && Math.random() < 0.25) continue;

      const blockHp = type === BlockType.BOSS ? hp * 4 : hp;
      this.blocks.push(new Block(col, 0, type, blockHp));
    }

    // Apply shield barrier from permanent upgrade
    if (this.startShieldLevel > 0 && stage === 1) {
      // (handled via blocks; skip for simplicity in prototype)
    }
  }

  // ---- Descent ----

  descendBlocks() {
    let slowBonus = 0;
    if (this.hasUpgrade('slow_descent') && this.stage % 8 === 0) slowBonus = 1;

    for (const block of this.blocks) {
      block.row += (1 - slowBonus);
    }

    // Check game over
    for (const block of this.blocks) {
      if (block.alive && block.row >= DANGER_ROW) {
        this.triggerGameOver();
        return;
      }
    }
  }

  // ---- Shooting ----

  shoot() {
    if (this.phase !== GamePhase.IDLE) return;
    this.phase = GamePhase.SHOOTING;
    this.firstHitThisTurn = true;
    this.turn++;

    const totalBalls = this.ballCount + (this.hasUpgrade('ball_plus') ? 1 : 0);
    const piercing = this.hasUpgrade('piercing') ? 3 : 0;
    const spread = this.hasUpgrade('multishot');
    const lx = this.launcher.x;
    const ly = launcherY;
    const angle = this.launcher.angle;
    const spd = BALL_SPEED;

    let launched = 0;
    this.pendingBalls = totalBalls; // track balls yet to be fired
    const launchNext = () => {
      if (launched >= totalBalls) return;
      let a = angle;
      if (spread) a += (launched % 2 === 0 ? 1 : -1) * 0.08 * Math.ceil(launched / 2);
      const vx = Math.cos(a) * spd;
      const vy = Math.sin(a) * spd;
      this.balls.push(new Ball(lx, ly, vx, vy, { piercingLeft: piercing }));
      launched++;
      this.pendingBalls--;
      if (launched < totalBalls) setTimeout(launchNext, FIRE_DELAY);
    };
    launchNext();

    // Laser barrage upgrade
    if (this.hasUpgrade('laser_strike')) {
      this.laserTurnCounter++;
      if (this.laserTurnCounter % 3 === 0) {
        setTimeout(() => this.triggerLaser(), 500);
      }
    }
  }

  triggerLaser() {
    // Damage all blocks in a random column
    const col = randInt(0, COLS - 1);
    for (const b of this.blocks) {
      if (b.alive && b.col === col) {
        b.hit(this.ballDamage * 3, this);
        spawnParticles(b.cx, b.cy, '#ff0044', 5, { speed: 2, decay: 0.08 });
      }
    }
    screenShake(4, 3);
  }

  // ---- Powers ----

  useLightning() {
    if (this.phase !== GamePhase.IDLE || this.powLightning <= 0) return;
    this.powLightning--;
    this.updatePowerBar();

    // Hit 5 random alive blocks
    const alive = this.blocks.filter(b => b.alive);
    const targets = alive.sort(() => Math.random() - 0.5).slice(0, 5);
    for (const b of targets) {
      b.hit(this.ballDamage * 3, this);
      spawnParticles(b.cx, b.cy, '#ffee00', 8, { speed: 3, decay: 0.05 });
    }
    screenShake(5, 4);
  }

  useBomb() {
    if (this.phase !== GamePhase.IDLE || this.powBomb <= 0) return;
    this.powBomb--;
    this.updatePowerBar();

    // Damage a 3x3 area in the center
    const centerCol = Math.floor(COLS / 2);
    const centerRow = Math.floor(this.blocks.reduce((a, b) => b.alive ? Math.min(a, b.row) : a, 999) + 2);
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (Math.abs(b.col - centerCol) <= 1 && Math.abs(b.row - centerRow) <= 1) {
        b.hit(this.ballDamage * 5, this);
        spawnParticles(b.cx, b.cy, '#ff6600', 10, { speed: 4, decay: 0.04 });
      }
    }
    screenShake(8, 6);
  }

  // ---- Explosions ----

  explodeNear(col, row, dmg) {
    const d = dmg || this.ballDamage * 2;
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (Math.abs(b.col - col) <= 1 && Math.abs(b.row - row) <= 1 && !(b.col === col && b.row === row)) {
        b.hit(d, this);
      }
    }
  }

  // ---- Turn end ----

  processTurnEnd() {
    this.phase = GamePhase.TURN_END;

    // Remove dead blocks
    this.blocks = this.blocks.filter(b => b.alive);

    // Shard regen upgrade
    if (this.hasUpgrade('regen')) this.earnShards(5);

    // Score
    const scoreGain = this.stage * 10;
    this.score += scoreGain;
    document.getElementById('hud-score').textContent = this.score;

    this.descendBlocks();
    if (this.phase === GamePhase.GAMEOVER) return;

    // Spawn new row for next stage
    this.stage++;
    document.getElementById('hud-stage').textContent = this.stage;

    this.spawnStageBlocks();

    // Shard earn per stage
    this.earnShards(randInt(2, 5) + Math.floor(this.stage / 5));

    // Check upgrade interval
    if (this.stage % UPGRADE_INTERVAL === 1 && this.stage > 1) {
      setTimeout(() => this.showUpgradeChoice(), 400);
      return;
    }

    this.phase = GamePhase.IDLE;
    this.updateHUD();
  }

  // ---- Upgrade Choice ----

  showUpgradeChoice() {
    this.phase = GamePhase.UPGRADE;
    const available = RUN_UPGRADES.filter(u => !this.hasUpgrade(u.id) || u.id === 'ball_plus');
    const picks = available.sort(() => Math.random() - 0.5).slice(0, 3);

    const container = document.getElementById('upgrade-cards');
    container.innerHTML = '';
    for (const upg of picks) {
      const card = document.createElement('div');
      card.className = 'upg-card';
      card.innerHTML = `
        <div class="upg-card-icon">${upg.icon}</div>
        <div class="upg-card-text">
          <div class="upg-card-name">${upg.name}</div>
          <div class="upg-card-desc">${upg.desc}</div>
        </div>`;
      card.addEventListener('click', () => this.pickUpgrade(upg));
      container.appendChild(card);
    }

    Screens.show('upgrade-choice');
  }

  pickUpgrade(upg) {
    this.runUpgrades.push(upg.id);
    if (upg.id === 'dmg_plus') this.ballDamage += 1;

    Screens.show('game');
    this.phase = GamePhase.IDLE;
    this.updateHUD();
  }

  // ---- Game Over ----

  triggerGameOver() {
    this.phase = GamePhase.GAMEOVER;

    if (this.stage > saveData.bestStage) saveData.bestStage = this.stage;
    Save.save(saveData);

    document.getElementById('go-stage').textContent = this.stage;
    document.getElementById('go-score').textContent = this.score;
    document.getElementById('go-shards').textContent = this.shards;
    document.getElementById('go-best').textContent = saveData.bestStage;

    setTimeout(() => Screens.show('gameover'), 700);
  }

  // ---- HUD ----

  updateHUD() {
    document.getElementById('hud-stage').textContent = this.stage;
    document.getElementById('hud-score').textContent = this.score;
    document.getElementById('hud-shards').textContent = this.shards;
    const total = this.ballCount + (this.hasUpgrade('ball_plus') ? 1 : 0);
    document.getElementById('balls-count').textContent = total;
  }

  updatePowerBar() {
    document.getElementById('pow-lightning-count').textContent = this.powLightning;
    document.getElementById('pow-bomb-count').textContent = this.powBomb;
    document.getElementById('btn-lightning').disabled = (this.powLightning <= 0 || this.phase !== GamePhase.IDLE);
    document.getElementById('btn-bomb').disabled = (this.powBomb <= 0 || this.phase !== GamePhase.IDLE);
  }

  // ---- Update loop ----

  update() {
    if (this.phase !== GamePhase.SHOOTING) return;

    for (const ball of this.balls) {
      ball.update(this);
    }

    const activeBalls = this.balls.filter(b => b.active);
    if (activeBalls.length === 0 && this.balls.length > 0 && this.pendingBalls === 0) {
      this.balls = [];
      this.processTurnEnd();
    }
  }

  // ---- Draw ----

  draw() {
    // Screen shake offset
    let sx = 0, sy = 0;
    if (shakeFrames > 0) {
      sx = (Math.random() - 0.5) * shakeAmt;
      sy = (Math.random() - 0.5) * shakeAmt;
      shakeFrames--;
      if (shakeFrames === 0) shakeAmt = 0;
    }

    ctx.save();
    ctx.translate(sx, sy);

    // Background
    ctx.fillStyle = '#060818';
    ctx.fillRect(-sx, -sy, W, H);

    // Subtle grid
    ctx.strokeStyle = 'rgba(0,100,200,0.06)';
    ctx.lineWidth = 1;
    const gSep = 40;
    for (let gx = 0; gx < W; gx += gSep) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += gSep) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // Danger line
    const dangerY = blockPad + DANGER_ROW * (blockH + blockPad);
    const dangerPulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.004);
    ctx.strokeStyle = `rgba(255,0,68,${0.4 + dangerPulse * 0.4})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(0, dangerY); ctx.lineTo(W, dangerY); ctx.stroke();
    ctx.setLineDash([]);

    // Blocks
    for (const block of this.blocks) {
      if (block.alive) block.draw(ctx);
    }

    // Launcher
    if (this.phase === GamePhase.IDLE || this.phase === GamePhase.SHOOTING) {
      this.launcher.draw(ctx);
    }

    // Balls
    for (const ball of this.balls) {
      ball.draw(ctx);
    }

    // Aim indicator when idle
    if (this.phase === GamePhase.IDLE && this.aiming) {
      // Already drawn in launcher
    }

    // Particles
    for (const p of particles) { p.draw(ctx); }

    ctx.restore();

    // Update particles
    for (const p of particles) p.update();
    particles = particles.filter(p => !p.dead);
  }
}

// ============================================================
// MAIN MENU
// ============================================================

function updateMenuDisplay() {
  document.getElementById('menu-best-stage').textContent = saveData.bestStage;
  document.getElementById('menu-shards').textContent = saveData.totalShards;
}

function buildPermUpgradeList() {
  document.getElementById('upg-shards').textContent = saveData.totalShards;
  const list = document.getElementById('perm-upgrade-list');
  list.innerHTML = '';

  for (const upg of PERM_UPGRADES) {
    const lvl = saveData.permLevels[upg.id] || 0;
    const maxed = lvl >= upg.maxLevel;
    const cost = Math.floor(upg.baseCost * Math.pow(upg.costMultiplier, lvl));
    const canAfford = saveData.totalShards >= cost;

    const card = document.createElement('div');
    card.className = 'perm-upg-card';
    card.innerHTML = `
      <div class="perm-upg-info">
        <div class="perm-upg-name">${upg.name}</div>
        <div class="perm-upg-desc">${upg.desc}</div>
        <div class="perm-upg-level">Level ${lvl}/${upg.maxLevel}</div>
      </div>
      <button class="perm-upg-btn" ${(maxed || !canAfford) ? 'disabled' : ''}>
        ${maxed ? 'MAXED' : `◈ ${cost}`}
      </button>`;

    if (!maxed) {
      card.querySelector('.perm-upg-btn').addEventListener('click', () => {
        if (saveData.totalShards < cost) return;
        saveData.totalShards -= cost;
        saveData.permLevels[upg.id] = lvl + 1;
        Save.save(saveData);
        buildPermUpgradeList();
      });
    }
    list.appendChild(card);
  }
}

// ============================================================
// INPUT HANDLING
// ============================================================

let game = null;

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let cx, cy;
  if (e.touches) {
    cx = (e.touches[0].clientX - rect.left) * scaleX;
    cy = (e.touches[0].clientY - rect.top) * scaleY;
  } else {
    cx = (e.clientX - rect.left) * scaleX;
    cy = (e.clientY - rect.top) * scaleY;
  }
  return { x: cx, y: cy };
}

function onPointerDown(e) {
  if (!game || game.phase !== GamePhase.IDLE) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  if (pos.y < launcherY - 10) {
    game.aiming = true;
    game.launcher.setAngleFromPoint(pos.x, pos.y);
  }
}

function onPointerMove(e) {
  if (!game || !game.aiming) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  game.launcher.setAngleFromPoint(pos.x, pos.y);
}

function onPointerUp(e) {
  if (!game || !game.aiming) return;
  e.preventDefault();
  game.aiming = false;
  game.shoot();
  game.updatePowerBar();
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove', onPointerMove, { passive: false });
canvas.addEventListener('touchend', onPointerUp, { passive: false });

// ============================================================
// BUTTON WIRING
// ============================================================

document.getElementById('btn-start').addEventListener('click', () => {
  game = new Game();
  Screens.show('game');
});

document.getElementById('btn-upgrades').addEventListener('click', () => {
  buildPermUpgradeList();
  Screens.show('upgrades');
});

document.getElementById('btn-back-menu').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-pause').addEventListener('click', () => {
  if (game && game.phase !== GamePhase.GAMEOVER) Screens.show('pause');
});

document.getElementById('btn-resume').addEventListener('click', () => Screens.show('game'));

document.getElementById('btn-restart-pause').addEventListener('click', () => {
  game = new Game();
  Screens.show('game');
});

document.getElementById('btn-menu-pause').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-restart-go').addEventListener('click', () => {
  game = new Game();
  Screens.show('game');
});

document.getElementById('btn-menu-go').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-lightning').addEventListener('click', () => {
  if (game) { game.useLightning(); game.updatePowerBar(); }
});

document.getElementById('btn-bomb').addEventListener('click', () => {
  if (game) { game.useBomb(); game.updatePowerBar(); }
});

// ============================================================
// GAME LOOP
// ============================================================

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const showingGame = document.getElementById('screen-game').classList.contains('active');
  if (showingGame && game) {
    game.update();
    game.draw();
  }
}

// ============================================================
// INIT
// ============================================================

window.addEventListener('resize', () => {
  resizeCanvas();
  if (game) {
    game.launcher.x = W / 2;
    game.launcher = new Launcher();
  }
});

updateMenuDisplay();
resizeCanvas();
Screens.show('menu');
gameLoop();
