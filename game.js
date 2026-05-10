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
const BLOCK_ROWS_MAX = 12;  // rows visible at once
const DANGER_ROW = 14;      // blocks past this row = game over
const WARNING_ROW = DANGER_ROW - 1; // danger warning one row before game over
const UPGRADE_INTERVAL = 5; // every N stages show upgrade choice
const BOSS_INTERVAL = 10;   // every N stages add boss block
const FIRE_DELAY = 55;      // ms between successive ball launches
const MAX_ORBS = 2;         // max ball-pickup orbs on board simultaneously
const ORB_SPAWN_CHANCE = 0.22; // probability of orb spawn per stage

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
  { id: 'ball_plus',    icon: '🔵', name: '+1 BALL',          desc: 'Permanently add one more ball to your stream.' },
  { id: 'dmg_plus',     icon: '⚔️', name: '+1 DAMAGE',         desc: 'Each ball deals +1 damage per hit.' },
  { id: 'explode_hit',  icon: '💥', name: 'CHAIN REACTION',    desc: 'First hit each turn causes a small explosion.' },
  { id: 'crit_chance',  icon: '🎯', name: 'CRITICAL HIT',      desc: '15% chance for triple damage on any hit.' },
  { id: 'laser_strike', icon: '🔱', name: 'LASER BARRAGE',     desc: 'Every 3 turns, an auto-laser damages a column.' },
  { id: 'slow_descent', icon: '🧲', name: 'GRAVITY DAMPENER',  desc: 'Blocks descend one fewer row every 8 stages.' },
  { id: 'piercing',     icon: '🏹', name: 'PIERCING SHOT',      desc: 'First 3 bounces pass through blocks.' },
  { id: 'magnet',       icon: '⭐', name: 'MAGNET FIELD',       desc: 'Collect crystals automatically without hitting.' },
  { id: 'multishot',    icon: '🌀', name: 'MULTISHOT',          desc: 'Launch balls in a spread fan pattern.' },
  { id: 'regen',        icon: '💜', name: 'SHARD PULSE',        desc: 'Earn 5 bonus shards at end of each turn.' },
  // V4A: Element upgrades
  { id: 'fire_core',     icon: '🔥', name: 'FIRE CORE',         desc: 'Every 5th launched ball is a fire ball — area damage on hit.', minStage: 5 },
  { id: 'ice_echo',      icon: '❄',  name: 'ICE ECHO',          desc: 'First hit each turn freezes the target block for 1 turn.', minStage: 5 },
  { id: 'elec_chain',    icon: '⚡', name: 'ELECTRIC CHAIN',    desc: 'Every 4th hit arcs electricity to up to 2 nearby blocks.', minStage: 5 },
  { id: 'burn_impact',   icon: '💢', name: 'BURNING IMPACT',    desc: 'Fire explosions deal +1 bonus area damage.', minStage: 8 },
  { id: 'frost_barrier', icon: '🧊', name: 'FROST BARRIER',     desc: 'Frozen blocks have 40% chance to freeze an adjacent block.', minStage: 8 },
  { id: 'overcharge',    icon: '🌩', name: 'OVERCHARGE',        desc: 'Electric chain jumps one extra time.', minStage: 8 },
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

  blockPad = 7;
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
  TRIANGLE:  'triangle',
  INV_TRI:   'inv_tri',
  MYSTERY:   'mystery',
};

const BLOCK_COLORS = {
  [BlockType.NORMAL]:    { fill: '#1a1050', stroke: '#6644ff', glow: '#6644ff' },
  [BlockType.EXPLOSIVE]: { fill: '#2a0808', stroke: '#ff3300', glow: '#ff5500' },
  [BlockType.SHIELD]:    { fill: '#051525', stroke: '#00ccff', glow: '#00ccff' },
  [BlockType.CRYSTAL]:   { fill: '#120b28', stroke: '#cc00ff', glow: '#ee88ff' },
  [BlockType.BOSS]:      { fill: '#1a0005', stroke: '#ff0044', glow: '#ff0044' },
  [BlockType.TRIANGLE]:  { fill: '#081a10', stroke: '#00ff88', glow: '#00ff88' },
  [BlockType.INV_TRI]:   { fill: '#1a0c00', stroke: '#ffaa00', glow: '#ffcc44' },
  [BlockType.MYSTERY]:   { fill: '#0d0020', stroke: '#bb44ff', glow: '#cc66ff' },
};

// Mystery effect pools
const MYSTERY_GOOD = [
  { id: 'bomb_burst',    label: '💥 BOOM!' },
  { id: 'plus1_ball',    label: '+1 BALL!' },
  { id: 'plus2_balls',   label: '+2 BALLS!' },
  { id: 'shard_bonus',   label: '◈ SHARDS!' },
  { id: 'weaken_near',   label: '⬇ WEAKENED!' },
  { id: 'destroy_low',   label: '✓ CLEARED!' },
  { id: 'mini_laser',    label: '⚡ LASER!' },
];
const MYSTERY_BAD = [
  { id: 'boost_one_hp',    label: '↑ HP BOOST!' },
  { id: 'boost_near_hp',   label: '↑↑ SURGE!' },
  { id: 'triple_largest',  label: '✕3 TRIPLE!' },
  { id: 'shuffle_blocks',  label: '~ SHUFFLE!' },
  { id: 'spawn_extra',     label: '+ SPAWNED!' },
  { id: 'strengthen_boss', label: '☠ CORE UP!' },
];

// Marker visuals
const MARKER_COLORS = {
  laser_h:     { fill: 'rgba(40,0,40,0.9)',  stroke: '#ff44cc', glow: '#ff44cc', label: '-' },
  laser_v:     { fill: 'rgba(0,20,40,0.9)',  stroke: '#00ccff', glow: '#00ccff', label: '|' },
  laser_cross: { fill: 'rgba(30,30,0,0.9)',  stroke: '#ffee00', glow: '#ffee00', label: '+' },
  ball_boost:  { fill: 'rgba(0,30,10,0.9)',  stroke: '#00ff88', glow: '#00ff88', label: '+B' },
  shuffle:     { fill: 'rgba(30,10,0,0.9)',  stroke: '#ff8800', glow: '#ff8800', label: '~' },
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
    this.frozen = false;
    this.frozenTurns = 0;
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
    game.onBlockDestroyed(this);
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
    if (this.type === BlockType.MYSTERY) {
      spawnParticles(this.cx, this.cy, '#cc66ff', 14, { speed: 5, decay: 0.028, size: 4 });
      game.applyMysteryEffect(this.col, this.row, this.cx, this.cy);
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

    // Shape path — triangles get their own outline; squares keep roundRect
    if (this.type === BlockType.TRIANGLE) {
      ctx.beginPath();
      ctx.moveTo(x + blockW / 2, y + 2);
      ctx.lineTo(x + blockW - 2, y + blockH - 2);
      ctx.lineTo(x + 2,          y + blockH - 2);
      ctx.closePath();
    } else if (this.type === BlockType.INV_TRI) {
      ctx.beginPath();
      ctx.moveTo(x + 2,          y + 2);
      ctx.lineTo(x + blockW - 2, y + 2);
      ctx.lineTo(x + blockW / 2, y + blockH - 2);
      ctx.closePath();
    } else {
      roundRect(ctx, x, y, blockW, blockH, 6);
    }
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

    // Frozen overlay
    if (this.frozen) {
      ctx.save();
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#00ccff';
      if (this.type === BlockType.TRIANGLE) {
        ctx.beginPath(); ctx.moveTo(x+blockW/2,y+2); ctx.lineTo(x+blockW-2,y+blockH-2); ctx.lineTo(x+2,y+blockH-2); ctx.closePath();
      } else if (this.type === BlockType.INV_TRI) {
        ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+blockW-2,y+2); ctx.lineTo(x+blockW/2,y+blockH-2); ctx.closePath();
      } else {
        roundRect(ctx, x, y, blockW, blockH, 6);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,200,255,0.75)';
      ctx.lineWidth = 1.5;
      if (this.type === BlockType.TRIANGLE) {
        ctx.beginPath(); ctx.moveTo(x+blockW/2,y+2); ctx.lineTo(x+blockW-2,y+blockH-2); ctx.lineTo(x+2,y+blockH-2); ctx.closePath();
      } else if (this.type === BlockType.INV_TRI) {
        ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+blockW-2,y+2); ctx.lineTo(x+blockW/2,y+blockH-2); ctx.closePath();
      } else {
        roundRect(ctx, x, y, blockW, blockH, 6);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Label — mystery shows '?' instead of HP
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.type === BlockType.MYSTERY) {
      ctx.font = `bold ${blockH > 28 ? 17 : 14}px 'Courier New'`;
      ctx.fillStyle = flash ? '#fff' : '#cc88ff';
      ctx.shadowColor = '#bb44ff';
      ctx.shadowBlur = 8;
      ctx.fillText('?', x + blockW / 2, y + blockH / 2);
    } else {
      const ratio = this.hp / this.maxHp;
      ctx.font = `bold ${blockH > 28 ? 13 : 10}px 'Courier New'`;
      ctx.fillStyle = flash ? '#fff' : (ratio > 0.5 ? '#fff' : '#ff8888');
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = 4;
      ctx.fillText(this.hp, x + blockW / 2, y + blockH / 2);
    }
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
// FLOATING TEXT
// ============================================================

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.vy = -1.8;
  }
  update() {
    this.y += this.vy;
    this.vy *= 0.94;
    this.life -= 0.022;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.font = 'bold 14px \'Courier New\'';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
  get dead() { return this.life <= 0; }
}

let floatingTexts = [];

// ============================================================
// COMBO TEXT  (large center-screen combo announcements)
// ============================================================

class ComboText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.vy = -1.0;
  }
  update() {
    this.y += this.vy;
    this.vy *= 0.96;
    this.life -= 0.016;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18;
    ctx.font = 'bold 20px \'Courier New\'';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
  get dead() { return this.life <= 0; }
}

// ============================================================
// BALL ORB  (collectible +1 ball pickup)
// ============================================================

class BallOrb {
  constructor(col, row) {
    this.col = col;
    this.row = row;
    this.alive = true;
    this.pulse = Math.random() * Math.PI * 2;
  }

  get x() { return blockPad + this.col * (blockW + blockPad) + blockW / 2; }
  get y() { return blockPad + this.row * (blockH + blockPad) + blockH / 2; }
  get radius() { return Math.min(blockW, blockH) * 0.30; }

  collect(game) {
    if (!this.alive) return;
    this.alive = false;
    game.ballCount++;
    game.updateHUD();
    spawnParticles(this.x, this.y, '#00f5ff', 14, { speed: 4, decay: 0.028, size: 3 });
    spawnParticles(this.x, this.y, '#bf00ff', 8,  { speed: 3, decay: 0.032, size: 2.5 });
    floatingTexts.push(new FloatingText(this.x, this.y - 22, '+1 BALL', '#00f5ff'));
    // Flash the HUD ball count
    const el = document.getElementById('balls-count');
    if (el) {
      el.classList.remove('balls-flash');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('balls-flash');
      setTimeout(() => el.classList.remove('balls-flash'), 700);
    }
  }

  draw(ctx) {
    if (!this.alive) return;
    this.pulse += 0.075;
    const r = this.radius;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);

    ctx.save();
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 10 + glow * 14;

    // Pulsing outer ring
    ctx.strokeStyle = `rgba(0,245,255,${0.4 + glow * 0.45})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r + 3 + glow * 3, 0, Math.PI * 2);
    ctx.stroke();

    // Orb body gradient
    const grad = ctx.createRadialGradient(
      this.x - r * 0.3, this.y - r * 0.35, 1,
      this.x, this.y, r
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#00f5ff');
    grad.addColorStop(1, '#6600cc');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // "+1" label
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(9, Math.floor(r * 0.85))}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+1', this.x, this.y);
    ctx.restore();
  }
}

// ============================================================
// LASER BEAMS  (brief screen-flash effects)
// ============================================================

let laserBeams = []; // { x1,y1,x2,y2,color,life }

// ============================================================
// MARKER  (non-block tile triggered by ball contact)
// ============================================================

class Marker {
  constructor(col, row, type) {
    this.col = col;
    this.row = row;
    this.type = type;
    this.alive = true;
    this.pulse = Math.random() * Math.PI * 2;
    this.cooldown = 0; // frames before next trigger allowed
  }

  get x()  { return blockPad + this.col * (blockW + blockPad); }
  get y()  { return blockPad + this.row * (blockH + blockPad); }
  get cx() { return this.x + blockW / 2; }
  get cy() { return this.y + blockH / 2; }

  draw(ctx) {
    if (!this.alive) return;
    this.pulse += 0.06;
    const mc = MARKER_COLORS[this.type];
    if (!mc) return;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);
    const x = this.x, y = this.y;
    const pad = Math.max(2, blockW * 0.08);

    ctx.save();
    ctx.shadowColor = mc.glow;
    ctx.shadowBlur = 8 + glow * 10;

    // Body (slightly inset to read differently from solid blocks)
    roundRect(ctx, x + pad, y + pad, blockW - pad * 2, blockH - pad * 2, 4);
    ctx.fillStyle = mc.fill;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(mc.stroke, 0.7 + glow * 0.3);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Outer dashed border — distinguishes markers from blocks
    ctx.setLineDash([4, 5]);
    roundRect(ctx, x + 2, y + 2, blockW - 4, blockH - 4, 6);
    ctx.strokeStyle = hexToRgba(mc.stroke, 0.3 + glow * 0.2);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Type label
    ctx.shadowBlur = 4;
    ctx.fillStyle = mc.stroke;
    ctx.font = `bold ${blockH > 28 ? 14 : 11}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mc.label, this.cx, this.cy);
    ctx.restore();
  }
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
    this.element = opts.element || null;
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

    // Orb collision — collect on touch
    for (const orb of game.orbs) {
      if (!orb.alive) continue;
      const odx = this.x - orb.x, ody = this.y - orb.y;
      const minDist = BALL_RADIUS + orb.radius;
      if (odx * odx + ody * ody < minDist * minDist) {
        orb.collect(game);
      }
    }

    // Marker collision — balls pass through but trigger effects (with cooldown)
    for (const marker of game.markers) {
      if (!marker.alive || marker.cooldown > 0) continue;
      if (this.collidesBlock(marker)) {
        game.triggerMarker(marker, this);
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

    const destroyed = block.hit(Math.max(1, Math.round(dmg)), game);
    game.applyElementHit(this, block, destroyed);

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

    const tc  = this.element === 'fire' ? '#ff6600' : this.element === 'ice' ? '#00ccff' : this.element === 'electric' ? '#aa44ff' : '#00f5ff';
    const bc2 = this.element === 'fire' ? '#ff4400' : this.element === 'ice' ? '#aaeeff' : this.element === 'electric' ? '#8822ff' : '#00f5ff';
    const bc3 = this.element === 'fire' ? '#cc0000' : this.element === 'ice' ? '#0066aa' : this.element === 'electric' ? '#330088' : '#0033cc';

    // Trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.4;
      const r = BALL_RADIUS * (i / this.trail.length);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = tc;
      ctx.shadowColor = tc;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Ball
    ctx.save();
    ctx.shadowColor = tc;
    ctx.shadowBlur = 14;
    const grad = ctx.createRadialGradient(this.x - 2, this.y - 2, 1, this.x, this.y, BALL_RADIUS);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, bc2);
    grad.addColorStop(1, bc3);
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

    // V4A: Element & combo state
    this.comboCount = 0;
    this.fireBallLaunchCount = 0;
    this.iceEchoUsed = false;
    this.electricHitCount = 0;

    // Danger state
    this.warningActive = false;

    // Mystery guard (prevent recursive mystery effects)
    this.mysteryProcessing = false;

    // Powers
    this.powLightning = 1;
    this.powBomb = 1;

    // Game objects
    this.blocks = [];
    this.balls = [];
    this.orbs = [];
    this.markers = [];
    this.pendingBalls = 0;
    this.firstReturnX = null; // X of first ball that exits bottom — for launcher snap
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
    return Math.ceil(1 + stage * 0.9 + (stage > 5 ? stage * 0.55 : 0));
  }

  spawnStageBlocks() {
    const stage = this.stage;
    const hp = this.blockHpForStage(stage);
    const isBossStage = stage % BOSS_INTERVAL === 0;
    const triChance     = stage >= 5 ? Math.min(0.35, (stage - 4) * 0.05) : 0;
    const mysteryChance = stage >= 3 ? Math.min(0.10, (stage - 2) * 0.02) : 0;

    // Generate one row of blocks at the top
    for (let col = 0; col < COLS; col++) {
      const rnd = Math.random();
      let type = BlockType.NORMAL;

      if (isBossStage && col === Math.floor(COLS / 2)) {
        type = BlockType.BOSS;
      } else if (mysteryChance > 0 && Math.random() < mysteryChance) {
        type = BlockType.MYSTERY;
      } else if (triChance > 0 && Math.random() < triChance) {
        type = Math.random() < 0.5 ? BlockType.TRIANGLE : BlockType.INV_TRI;
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

    // Collect columns occupied at row 0
    const takenCols = () => [
      ...this.blocks.filter(b => b.row === 0).map(b => b.col),
      ...this.orbs.filter(o => o.row === 0).map(o => o.col),
      ...this.markers.filter(m => m.row === 0).map(m => m.col),
    ];

    // Spawn a ball-orb in a free column if conditions are met
    const activeOrbs = this.orbs.filter(o => o.alive).length;
    const needOrb = this.ballCount < 3 && stage <= 10;
    if (activeOrbs < MAX_ORBS && (needOrb || Math.random() < ORB_SPAWN_CHANCE)) {
      const freeCols = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols().includes(c));
      if (freeCols.length > 0) {
        this.orbs.push(new BallOrb(randItem(freeCols), 0));
      }
    }

    // Spawn a marker in a free column (stage 2+)
    const markerChance = stage >= 2 ? Math.min(0.28, (stage - 1) * 0.04) : 0;
    if (markerChance > 0 && Math.random() < markerChance) {
      const freeCols = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols().includes(c));
      if (freeCols.length > 0) {
        this.markers.push(new Marker(randItem(freeCols), 0, this._pickMarkerType(stage)));
      }
    }
  }

  _pickMarkerType(stage) {
    const types = ['laser_h', 'laser_v', 'laser_cross'];
    if (stage >= 5) types.push('ball_boost', 'shuffle');
    return randItem(types);
  }

  // ---- Descent ----

  descendBlocks() {
    let slowBonus = 0;
    if (this.hasUpgrade('slow_descent') && this.stage % 8 === 0) slowBonus = 1;

    for (const block of this.blocks) {
      if (block.frozen) {
        block.frozenTurns--;
        if (block.frozenTurns <= 0) block.frozen = false;
        continue;
      }
      block.row += (1 - slowBonus);
    }

    // Check game over and warning row
    let hitWarning = false;
    for (const block of this.blocks) {
      if (!block.alive) continue;
      if (block.row >= DANGER_ROW) {
        this.triggerGameOver();
        return;
      }
      if (block.row >= WARNING_ROW) hitWarning = true;
    }
    this.warningActive = hitWarning;
  }

  descendOrbs() {
    for (const orb of this.orbs) {
      orb.row += 1;
    }
    // Orbs past the danger line simply vanish (no game over)
    this.orbs = this.orbs.filter(o => o.row < DANGER_ROW);
  }

  // ---- Shooting ----

  shoot() {
    if (this.phase !== GamePhase.IDLE) return;
    this.phase = GamePhase.SHOOTING;
    this.firstHitThisTurn = true;
    this.iceEchoUsed = false;
    this.electricHitCount = 0;
    this.comboCount = 0;
    this.turn++;

    const totalBalls = this.ballCount;
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
      let ballElement = null;
      if (this.hasUpgrade('fire_core')) {
        this.fireBallLaunchCount++;
        if (this.fireBallLaunchCount % 5 === 0) ballElement = 'fire';
      }
      this.balls.push(new Ball(lx, ly, vx, vy, { piercingLeft: piercing, element: ballElement }));
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

  // ---- Mystery block effect ----

  applyMysteryEffect(col, row, cx, cy) {
    if (this.mysteryProcessing) return; // prevent recursive mystery chains
    this.mysteryProcessing = true;

    const isGood = Math.random() < 0.60;
    const pool = isGood ? MYSTERY_GOOD : MYSTERY_BAD;
    const effect = randItem(pool);
    let label = effect.label;
    const color = isGood ? '#00ff88' : '#ff6600';
    const alive = () => this.blocks.filter(b => b.alive && b.type !== BlockType.MYSTERY);

    switch (effect.id) {
      case 'bomb_burst':
        this.explodeNear(col, row);
        spawnExplosionParticles(cx, cy, '#ff6600');
        screenShake(6, 4);
        break;
      case 'plus1_ball':
        this.ballCount++;
        this.updateHUD();
        spawnParticles(cx, cy, '#00f5ff', 12, { speed: 3, decay: 0.025 });
        break;
      case 'plus2_balls':
        this.ballCount += 2;
        this.updateHUD();
        spawnParticles(cx, cy, '#00f5ff', 18, { speed: 4, decay: 0.025 });
        break;
      case 'shard_bonus': {
        const n = randInt(10, 20);
        this.earnShards(n);
        label = `+${n} SHARDS!`;
        spawnParticles(cx, cy, '#cc00ff', 14, { speed: 3, gravity: -0.05, decay: 0.025 });
        break;
      }
      case 'weaken_near':
        for (const b of alive()) {
          if (Math.abs(b.col - col) <= 1 && Math.abs(b.row - row) <= 1) {
            b.hp = Math.max(1, Math.floor(b.hp / 2));
            b.hitFlash = 4;
            spawnParticles(b.cx, b.cy, '#00ff88', 4, { speed: 2, decay: 0.07 });
          }
        }
        break;
      case 'destroy_low': {
        const low = alive().sort((a, b) => a.hp - b.hp)[0];
        if (low) { low.hp = 0; low.alive = false; low.onDestroy(this); }
        break;
      }
      case 'mini_laser':
        this._fireLaserRow(row);
        laserBeams.push({ x1: 0, y1: cy, x2: W, y2: cy, color: '#ffee00', life: 10 });
        break;
      case 'boost_one_hp': {
        const bl = randItem(alive());
        if (bl) { bl.hp += 5; bl.maxHp = Math.max(bl.maxHp, bl.hp); bl.hitFlash = 5; }
        break;
      }
      case 'boost_near_hp':
        for (const b of alive()) {
          if (Math.abs(b.col - col) <= 1 && Math.abs(b.row - row) <= 1) {
            b.hp += 2; b.maxHp = Math.max(b.maxHp, b.hp); b.hitFlash = 3;
          }
        }
        break;
      case 'triple_largest': {
        const big = alive().sort((a, b) => b.hp - a.hp)[0];
        if (big) {
          big.hp *= 3; big.maxHp = Math.max(big.maxHp, big.hp); big.hitFlash = 8;
          spawnParticles(big.cx, big.cy, '#ff0044', 12, { speed: 3, decay: 0.04 });
        }
        break;
      }
      case 'shuffle_blocks': {
        const pool2 = alive();
        const n = Math.min(4, pool2.length);
        if (n >= 2) {
          const picks = pool2.sort(() => Math.random() - 0.5).slice(0, n);
          const positions = picks.map(b => ({ col: b.col, row: b.row }));
          positions.sort(() => Math.random() - 0.5);
          picks.forEach((b, i) => { b.col = positions[i].col; b.row = positions[i].row; });
          spawnParticles(cx, cy, '#ff8800', 16, { speed: 5, decay: 0.035 });
        }
        break;
      }
      case 'spawn_extra': {
        const takenCols = this.blocks.filter(b => b.alive && b.row === 0).map(b => b.col);
        const free = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols.includes(c));
        if (free.length > 0) {
          this.blocks.push(new Block(randItem(free), 0, BlockType.NORMAL, this.blockHpForStage(this.stage)));
        }
        break;
      }
      case 'strengthen_boss': {
        const boss = this.blocks.find(b => b.alive && b.type === BlockType.BOSS);
        const target = boss || randItem(alive());
        if (target) { target.hp += 5; target.maxHp = Math.max(target.maxHp, target.hp); target.hitFlash = 8; }
        break;
      }
    }

    floatingTexts.push(new FloatingText(cx, cy - 28, label, color));
    this.mysteryProcessing = false;
  }

  // ---- Marker trigger ----

  triggerMarker(marker, ball) {
    marker.cooldown = 8;
    const cx = marker.cx, cy = marker.cy;

    switch (marker.type) {
      case 'ball_boost':
        marker.alive = false;
        const bonus = Math.random() < 0.35 ? 2 : 1;
        this.ballCount += bonus;
        this.updateHUD();
        spawnParticles(cx, cy, '#00ff88', 14, { speed: 4, decay: 0.025 });
        floatingTexts.push(new FloatingText(cx, cy - 24, `+${bonus} BALL${bonus > 1 ? 'S' : ''}!`, '#00ff88'));
        break;
      case 'shuffle': {
        const alive = this.blocks.filter(b => b.alive && b.type !== BlockType.BOSS);
        const n = Math.min(4, alive.length);
        if (n >= 2) {
          const picks = alive.sort(() => Math.random() - 0.5).slice(0, n);
          const positions = picks.map(b => ({ col: b.col, row: b.row }));
          positions.sort(() => Math.random() - 0.5);
          picks.forEach((b, i) => { b.col = positions[i].col; b.row = positions[i].row; });
          spawnParticles(cx, cy, '#ff8800', 10, { speed: 4, decay: 0.04 });
          floatingTexts.push(new FloatingText(cx, cy - 24, 'SHUFFLE!', '#ff8800'));
        }
        break;
      }
      case 'laser_h':
        this._fireLaserRow(marker.row);
        laserBeams.push({ x1: 0, y1: cy, x2: W, y2: cy, color: '#ff44cc', life: 10 });
        floatingTexts.push(new FloatingText(cx, cy - 24, '— ROW LASER!', '#ff44cc'));
        break;
      case 'laser_v':
        this._fireLaserCol(marker.col);
        laserBeams.push({ x1: cx, y1: 0, x2: cx, y2: H, color: '#00ccff', life: 10 });
        floatingTexts.push(new FloatingText(cx, cy - 24, '| COL LASER!', '#00ccff'));
        break;
      case 'laser_cross':
        this._fireLaserRow(marker.row);
        this._fireLaserCol(marker.col);
        laserBeams.push({ x1: 0, y1: cy, x2: W, y2: cy, color: '#ffee00', life: 10 });
        laserBeams.push({ x1: cx, y1: 0, x2: cx, y2: H, color: '#ffee00', life: 10 });
        floatingTexts.push(new FloatingText(cx, cy - 24, '+ CROSS LASER!', '#ffee00'));
        break;
    }
  }

  _fireLaserRow(row) {
    for (const b of this.blocks) {
      if (b.alive && b.row === row) {
        b.hit(1, this);
        spawnParticles(b.cx, b.cy, '#ff44cc', 4, { speed: 2, decay: 0.07 });
      }
    }
    screenShake(3, 2);
  }

  _fireLaserCol(col) {
    for (const b of this.blocks) {
      if (b.alive && b.col === col) {
        b.hit(1, this);
        spawnParticles(b.cx, b.cy, '#00ccff', 4, { speed: 2, decay: 0.07 });
      }
    }
    screenShake(3, 2);
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

  // ---- V4A: Combo system ----

  onBlockDestroyed(block) {
    this.comboCount++;
    const count = this.comboCount;
    let label = null, color = '#ffee00', shardBonus = 0;
    if (count === 2)  { label = 'x2 Combo';        color = '#ffee00'; shardBonus = 1; }
    if (count === 5)  { label = 'x5 Neon Combo';    color = '#ff88ff'; shardBonus = 2; }
    if (count === 10) { label = 'x10 Siege Frenzy'; color = '#ff6600'; shardBonus = 3; }
    if (count === 20) { label = 'x20 Neon Frenzy';  color = '#ff2200'; shardBonus = 5; }
    if (label) {
      floatingTexts.push(new ComboText(W / 2, H * 0.42, label, color));
      if (shardBonus > 0) this.earnShards(shardBonus);
    }
  }

  // ---- V4A: Element system ----

  applyElementHit(ball, block, destroyed) {
    if (ball.element === 'fire') {
      this.applyFireEffect(block.col, block.row, block.cx, block.cy);
    } else if (ball.element === 'ice' && !destroyed && !block.frozen) {
      this.applyIceEffect(block);
    } else if (ball.element === 'electric') {
      this.applyElectricEffect(block.col, block.row, block.cx, block.cy);
    }
    // Ice Echo upgrade: freeze on first hit per turn (independent of ball element)
    if (this.hasUpgrade('ice_echo') && !this.iceEchoUsed && !destroyed && !block.frozen && ball.element !== 'ice') {
      this.iceEchoUsed = true;
      this.applyIceEffect(block);
    }
    // Electric Chain upgrade: every 4th hit arcs (independent of ball element)
    if (this.hasUpgrade('elec_chain') && ball.element !== 'electric') {
      this.electricHitCount++;
      if (this.electricHitCount % 4 === 0) {
        this.applyElectricEffect(block.col, block.row, block.cx, block.cy);
      }
    }
  }

  applyFireEffect(col, row, cx, cy) {
    const areaDmg = 1 + (this.hasUpgrade('burn_impact') ? 1 : 0);
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (b.col === col && b.row === row) continue;
      if (Math.abs(b.col - col) <= 1 && Math.abs(b.row - row) <= 1) {
        b.hit(areaDmg, this);
      }
    }
    spawnParticles(cx, cy, '#ff6600', 8, { speed: 3.5, decay: 0.045, size: 3, gravity: -0.06 });
    spawnParticles(cx, cy, '#ffaa00', 5, { speed: 2.5, decay: 0.05,  size: 2, gravity: -0.09 });
  }

  applyIceEffect(block) {
    block.frozen = true;
    block.frozenTurns = 1;
    block.hitFlash = 3;
    spawnParticles(block.cx, block.cy, '#00ccff', 8, { speed: 2.5, decay: 0.05, size: 2.5 });
    spawnParticles(block.cx, block.cy, '#aaeeff', 5, { speed: 1.5, decay: 0.07, size: 2 });
    if (this.hasUpgrade('frost_barrier')) {
      const neighbors = this.blocks.filter(b =>
        b.alive && !b.frozen &&
        !(b.col === block.col && b.row === block.row) &&
        Math.abs(b.col - block.col) <= 1 && Math.abs(b.row - block.row) <= 1
      );
      if (neighbors.length > 0 && Math.random() < 0.4) {
        const nb = randItem(neighbors);
        nb.frozen = true;
        nb.frozenTurns = 1;
        spawnParticles(nb.cx, nb.cy, '#aaeeff', 6, { speed: 2, decay: 0.06, size: 2 });
      }
    }
  }

  applyElectricEffect(col, row, cx, cy) {
    const maxJumps = this.hasUpgrade('overcharge') ? 3 : 2;
    const candidates = this.blocks.filter(b =>
      b.alive && !(b.col === col && b.row === row) &&
      ((Math.abs(b.col - col) <= 1 && Math.abs(b.row - row) <= 1) ||
       (b.row === row && Math.abs(b.col - col) <= 2))
    );
    const targets = candidates.sort(() => Math.random() - 0.5).slice(0, maxJumps);
    for (const target of targets) {
      target.hit(1, this);
      spawnParticles(target.cx, target.cy, '#aa44ff', 5, { speed: 3, decay: 0.07, size: 2 });
      laserBeams.push({ x1: cx, y1: cy, x2: target.cx, y2: target.cy, color: '#aa44ff', life: 5 });
    }
    spawnParticles(cx, cy, '#6644ff', 6, { speed: 2.5, decay: 0.08, size: 2.5 });
  }

  // ---- Turn end ----

  processTurnEnd() {
    this.phase = GamePhase.TURN_END;

    // Snap launcher to where first ball exited the bottom
    if (this.firstReturnX !== null) {
      this.launcher.x = clamp(this.firstReturnX, BALL_RADIUS + 12, W - BALL_RADIUS - 12);
    }
    this.firstReturnX = null;

    // Remove dead blocks, orbs, and markers
    this.blocks = this.blocks.filter(b => b.alive);
    this.orbs   = this.orbs.filter(o => o.alive);
    this.markers = this.markers.filter(m => m.alive);

    // Shard regen upgrade
    if (this.hasUpgrade('regen')) this.earnShards(5);

    // Score
    const scoreGain = this.stage * 10;
    this.score += scoreGain;
    document.getElementById('hud-score').textContent = this.score;

    this.descendBlocks();
    if (this.phase === GamePhase.GAMEOVER) return;
    this.descendOrbs();

    // Descend markers; remove any past the danger boundary
    for (const m of this.markers) m.row += 1;
    this.markers = this.markers.filter(m => m.alive && m.row < DANGER_ROW);

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
    const available = RUN_UPGRADES.filter(u =>
      (!this.hasUpgrade(u.id) || u.id === 'ball_plus') &&
      (!u.minStage || this.stage >= u.minStage)
    );
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
    if (upg.id === 'ball_plus') {
      // Directly grows the stream — can be picked multiple times
      this.ballCount++;
    } else {
      this.runUpgrades.push(upg.id);
      if (upg.id === 'dmg_plus') this.ballDamage += 1;
    }
    Screens.show('game');
    this.phase = GamePhase.IDLE;
    this.updateHUD();
  }

  // ---- Game Over ----

  triggerGameOver() {
    this.warningActive = false;
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
    document.getElementById('balls-count').textContent = this.ballCount;
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

    // Tick marker cooldowns
    for (const marker of this.markers) {
      if (marker.cooldown > 0) marker.cooldown--;
    }

    for (const ball of this.balls) {
      const wasActive = ball.active;
      ball.update(this);
      // Capture the X of the FIRST ball to exit the bottom for launcher snap
      if (wasActive && !ball.active && this.firstReturnX === null) {
        this.firstReturnX = ball.x;
      }
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

    // Warning row line (amber — one row before game over)
    const warningY = blockPad + WARNING_ROW * (blockH + blockPad);
    const wPulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
    ctx.strokeStyle = `rgba(255,140,0,${0.25 + wPulse * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(0, warningY); ctx.lineTo(W, warningY); ctx.stroke();
    ctx.setLineDash([]);

    // Danger line (red — game over boundary)
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

    // Aim guide (always visible in IDLE)
    if (this.phase === GamePhase.IDLE) {
      this.drawAimGuide(ctx);
    }

    // Ball orbs
    for (const orb of this.orbs) { orb.draw(ctx); }

    // Markers
    for (const marker of this.markers) { marker.draw(ctx); }

    // Laser beam flashes
    for (const lb of laserBeams) {
      ctx.save();
      ctx.globalAlpha = lb.life / 10;
      ctx.strokeStyle = lb.color;
      ctx.shadowColor = lb.color;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lb.x1, lb.y1); ctx.lineTo(lb.x2, lb.y2); ctx.stroke();
      // Bright white core
      ctx.globalAlpha = (lb.life / 10) * 0.45;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(lb.x1, lb.y1); ctx.lineTo(lb.x2, lb.y2); ctx.stroke();
      ctx.restore();
      lb.life--;
    }
    laserBeams = laserBeams.filter(lb => lb.life > 0);

    // Particles
    for (const p of particles) { p.draw(ctx); }

    // Floating texts (drawn above particles)
    for (const ft of floatingTexts) { ft.draw(ctx); }

    ctx.restore();

    // Danger warning border — drawn outside shake context so it stays stable
    if (this.warningActive) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008);
      ctx.save();
      // Subtle red screen tint
      ctx.fillStyle = `rgba(255,0,68,${0.02 + pulse * 0.04})`;
      ctx.fillRect(0, 0, W, H);
      // Glowing red border
      ctx.shadowColor = '#ff0044';
      ctx.shadowBlur = 14 + pulse * 10;
      ctx.strokeStyle = `rgba(255,0,68,${0.55 + pulse * 0.45})`;
      ctx.lineWidth = 5;
      ctx.strokeRect(2, 2, W - 4, H - 4);
      ctx.restore();
    }

    // Update particles
    for (const p of particles) p.update();
    particles = particles.filter(p => !p.dead);

    // Update floating texts
    for (const ft of floatingTexts) ft.update();
    floatingTexts = floatingTexts.filter(ft => !ft.dead);
  }

  // ---- Aim guide with single wall-bounce prediction ----

  drawAimGuide(ctx) {
    const lx = this.launcher.x, ly = launcherY;
    const angle = this.launcher.angle;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const barrelLen = 42;
    let x = lx + dx * barrelLen;
    let y = ly + dy * barrelLen;
    let vx = dx, vy = dy;

    const totalLen = 260; // total guide length in px

    ctx.save();
    ctx.setLineDash([6, 9]);
    ctx.lineWidth = 1.5;

    // Find distance to nearest vertical wall
    let tWall = Infinity;
    if (vx < -0.001) tWall = (BALL_RADIUS - x) / vx;
    else if (vx > 0.001) tWall = (W - BALL_RADIUS - x) / vx;

    const distToWall = tWall < Infinity ? tWall : totalLen + 1;

    if (distToWall < totalLen) {
      // Segment 1: launcher tip → wall
      const wx = x + vx * distToWall;
      const wy = y + vy * distToWall;
      ctx.strokeStyle = 'rgba(0,245,255,0.38)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(wx, wy);
      ctx.stroke();

      // Wall bounce dot
      ctx.save();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,245,255,0.55)';
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(wx, wy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Segment 2: reflected path (fainter)
      const rem = totalLen - distToWall;
      ctx.strokeStyle = 'rgba(0,245,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx - vx * rem, wy + vy * rem);
      ctx.stroke();
    } else {
      // No wall hit in range — simple straight guide
      ctx.strokeStyle = 'rgba(0,245,255,0.38)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + vx * totalLen, y + vy * totalLen);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
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
