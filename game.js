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
const BALL_RADIUS = 9;        // collision radius — never change
const BALL_DRAW_RADIUS = 12;  // visual radius — bigger for readability
const BLOCK_ROWS_MAX = 12;  // rows visible at once
// V6D: computed dynamically in resizeCanvas() so the lose line sits near the launcher
let DANGER_ROW = 14;        // blocks reaching this row → game over
let WARNING_ROW = 13;       // one row above danger → red flash warning
const UPGRADE_INTERVAL = 5; // every N stages show upgrade choice
const BOSS_INTERVAL = 10;   // every N stages add boss block
const FIRE_DELAY = 55;      // ms between successive ball launches
const MAX_ORBS = 2;         // max ball-pickup orbs on board simultaneously
const ORB_SPAWN_CHANCE = 0.22; // probability of orb spawn per stage
const TOTAL_LEVELS = 100;   // V6D: total generated levels

// V6D: waves (block rows) to spawn per level — grows gradually, caps at 12
function levelWaves(level) {
  return Math.min(3 + Math.floor(level * 0.4), 12);
}

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

// Relic definitions (V4B — boss reward, current-run only)
const RELICS = [
  { id: 'broken_reactor',   icon: '☢', name: 'BROKEN REACTOR',   desc: 'Start of each turn: deal 1 damage to a random block.' },
  { id: 'frozen_heart',     icon: '💙', name: 'FROZEN HEART',     desc: 'Every 4th turn a random row freezes for 1 turn.' },
  { id: 'storm_lens',       icon: '🔭', name: 'STORM LENS',       desc: 'Laser markers deal +1 damage per hit.' },
  { id: 'fire_crown',       icon: '👑', name: 'FIRE CROWN',       desc: 'Fire explosions damage a wider area.' },
  { id: 'void_compass',     icon: '🧭', name: 'VOID COMPASS',     desc: 'After portal teleport, next hit deals +1 damage.' },
  { id: 'siege_engine',     icon: '⚙', name: 'SIEGE ENGINE',     desc: '+2 balls this run. Blocks spawn slightly tougher.' },
  { id: 'greedy_core',      icon: '💰', name: 'GREEDY CORE',      desc: '+50% shard gain. Mystery harmful events slightly more likely.' },
  { id: 'emergency_shield', icon: '🛡', name: 'EMERGENCY SHIELD', desc: 'First warning row moment: push back the most dangerous block.' },
];

// ============================================================
// V5A: STATS & ACHIEVEMENTS
// ============================================================

const DEFAULT_STATS = {
  totalBlocksDestroyed:        0,
  totalBossesDefeated:         0,
  totalShotsFired:             0,
  totalShardsEarned:           0,
  totalMysteryBlocksDestroyed: 0,
  highestCombo:                0,
  highestBallCount:            0,
  laserTriggers:               0,
  portalHits:                  0,
  gravityHits:                 0,
  closeCallRecoveries:         0,
  harmfulMysterySurvived:      0,
  tripledBlockDestroyed:       0,
};

const ACHIEVEMENTS = [
  // First Steps
  { id: 'first_shot',    title: 'First Shot',         desc: 'Fire your first shot.',                    cat: 'first',    reward: 5,   stat: 'totalShotsFired',             target: 1    },
  { id: 'first_break',   title: 'First Break',        desc: 'Destroy your first block.',                cat: 'first',    reward: 5,   stat: 'totalBlocksDestroyed',        target: 1    },
  { id: 'first_upgrade', title: 'First Upgrade',      desc: 'Choose your first upgrade card.',          cat: 'first',    reward: 5,   stat: null,                          target: null },
  { id: 'first_boss',    title: 'First Boss',         desc: 'Defeat your first boss core.',             cat: 'first',    reward: 20,  stat: 'totalBossesDefeated',         target: 1    },
  // Skill
  { id: 'combo_5',       title: 'Combo Starter',      desc: 'Reach x5 combo in one turn.',              cat: 'skill',    reward: 10,  stat: null,                          target: null },
  { id: 'combo_10',      title: 'Neon Frenzy',        desc: 'Reach x10 combo in one turn.',             cat: 'skill',    reward: 20,  stat: null,                          target: null },
  { id: 'combo_20',      title: 'Siege Master',       desc: 'Reach x20 combo in one turn.',             cat: 'skill',    reward: 50,  stat: null,                          target: null },
  { id: 'ball_storm',    title: 'Ball Storm',         desc: 'Reach 10 balls in one run.',               cat: 'skill',    reward: 20,  stat: null,                          target: null },
  { id: 'swarm_cmd',     title: 'Swarm Commander',    desc: 'Reach 25 balls in one run.',               cat: 'skill',    reward: 50,  stat: null,                          target: null },
  { id: 'laser_artist',  title: 'Laser Artist',       desc: 'Trigger 10 laser markers.',                cat: 'skill',    reward: 15,  stat: 'laserTriggers',               target: 10   },
  { id: 'portal_shot',   title: 'Portal Shot',        desc: 'Hit a block after a portal teleport.',     cat: 'skill',    reward: 15,  stat: 'portalHits',                  target: 1    },
  { id: 'gravity_trick', title: 'Gravity Trick',      desc: 'Hit a block under black hole influence.',  cat: 'skill',    reward: 15,  stat: 'gravityHits',                 target: 1    },
  // Survival
  { id: 'close_call',    title: 'Close Call',         desc: 'Recover after blocks enter warning row.',  cat: 'survival', reward: 15,  stat: 'closeCallRecoveries',         target: 1    },
  { id: 'last_line',     title: 'Last Line Hero',     desc: 'Destroy a block in the warning row.',      cat: 'survival', reward: 25,  stat: null,                          target: null },
  { id: 'boss_survivor', title: 'Boss Survivor',      desc: 'Defeat a boss while blocks near danger.',  cat: 'survival', reward: 30,  stat: null,                          target: null },
  // Long-Term
  { id: 'crusher_1',     title: 'Block Crusher I',    desc: 'Destroy 100 blocks total.',                cat: 'longterm', reward: 15,  stat: 'totalBlocksDestroyed',        target: 100  },
  { id: 'crusher_2',     title: 'Block Crusher II',   desc: 'Destroy 1000 blocks total.',               cat: 'longterm', reward: 50,  stat: 'totalBlocksDestroyed',        target: 1000 },
  { id: 'boss_hunter_1', title: 'Boss Hunter I',      desc: 'Defeat 5 bosses total.',                   cat: 'longterm', reward: 20,  stat: 'totalBossesDefeated',         target: 5    },
  { id: 'boss_hunter_2', title: 'Boss Hunter II',     desc: 'Defeat 25 bosses total.',                  cat: 'longterm', reward: 75,  stat: 'totalBossesDefeated',         target: 25   },
  { id: 'shard_1',       title: 'Shard Collector I',  desc: 'Earn 1000 total shards.',                  cat: 'longterm', reward: 0,   stat: 'totalShardsEarned',           target: 1000 },
  { id: 'shard_2',       title: 'Shard Collector II', desc: 'Earn 10000 total shards.',                 cat: 'longterm', reward: 0,   stat: 'totalShardsEarned',           target: 10000},
  // Secret
  { id: 'risk_taker',    title: 'Risk Taker',         desc: 'Destroy 10 mystery blocks.',               cat: 'secret',   reward: 25,  stat: 'totalMysteryBlocksDestroyed', target: 10,  hidden: true },
  { id: 'cursed_luck',   title: 'Cursed Luck',        desc: 'Survive a harmful mystery effect.',        cat: 'secret',   reward: 25,  stat: 'harmfulMysterySurvived',      target: 1,   hidden: true },
  { id: 'overloaded',    title: 'Overloaded',         desc: 'Destroy a block tripled by mystery.',      cat: 'secret',   reward: 30,  stat: 'tripledBlockDestroyed',       target: 1,   hidden: true },
  { id: 'chain_react',   title: 'Chain Reaction',     desc: 'Use power, laser, and electric in one turn.', cat: 'secret', reward: 40, stat: null,                        target: null, hidden: true },
];

// ============================================================
// SAVE DATA
// ============================================================

const Save = {
  load() {
    try {
      const raw = localStorage.getItem('neonSiegeSave');
      if (raw) {
        const d = JSON.parse(raw);
        if (!d.stats) {
          d.stats = { ...DEFAULT_STATS };
        } else {
          for (const k of Object.keys(DEFAULT_STATS)) {
            if (!(k in d.stats)) d.stats[k] = 0;
          }
        }
        if (!d.achievements) d.achievements = {};
        // V6D: level progress migration
        if (!d.highestUnlockedLevel) d.highestUnlockedLevel = 1;
        if (!d.completedLevels)      d.completedLevels = [];
        if (!d.levelBestScore)       d.levelBestScore = {};
        return d;
      }
    } catch(e) {}
    return { bestStage: 0, totalShards: 0, permLevels: {}, stats: { ...DEFAULT_STATS }, achievements: {},
             highestUnlockedLevel: 1, completedLevels: [], levelBestScore: {} };
  },
  save(data) {
    try { localStorage.setItem('neonSiegeSave', JSON.stringify(data)); } catch(e) {}
  }
};

let saveData = Save.load();

// ============================================================
// V5A: ACHIEVEMENT TOAST
// ============================================================

let _achQueue  = [];
let _achEl     = null;
let _achBusy   = false;

function _getAchEl() {
  if (!_achEl) {
    _achEl = document.createElement('div');
    _achEl.style.cssText = [
      'position:fixed', 'top:68px', 'right:-320px', 'z-index:200',
      'background:rgba(6,2,20,0.96)', 'border:1px solid #ffcc44',
      'border-radius:12px', 'padding:10px 14px', 'min-width:200px', 'max-width:270px',
      'box-shadow:0 0 28px rgba(255,200,0,0.25)', 'transition:right 0.38s ease',
      "font-family:'Courier New',monospace", 'pointer-events:none',
    ].join(';');
    document.body.appendChild(_achEl);
  }
  return _achEl;
}

function _showNextAch() {
  if (_achBusy || _achQueue.length === 0) return;
  _achBusy = true;
  const ach = _achQueue.shift();
  const el  = _getAchEl();
  el.innerHTML =
    '<div style="font-size:9px;letter-spacing:2px;color:#ffcc44;margin-bottom:3px">ACHIEVEMENT UNLOCKED</div>' +
    '<div style="font-size:13px;font-weight:bold;color:#fff;letter-spacing:1px">' + ach.title + '</div>' +
    '<div style="font-size:10px;color:#9090bb;margin-top:2px">' + ach.desc + '</div>' +
    (ach.reward > 0
      ? '<div style="font-size:11px;color:#a855f7;margin-top:5px">+' + ach.reward + ' ◈ SHARDS</div>'
      : '');
  setTimeout(() => { el.style.right = '10px'; }, 30);
  setTimeout(() => {
    el.style.right = '-320px';
    setTimeout(() => { _achBusy = false; _showNextAch(); }, 420);
  }, 3600);
}

// ============================================================
// V5A: ACHIEVEMENTS SYSTEM
// ============================================================

const Achievements = {
  isUnlocked(id) {
    return !!(saveData.achievements && saveData.achievements[id]);
  },

  unlock(id) {
    if (this.isUnlocked(id)) return;
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (!ach) return;
    saveData.achievements[id] = true;
    if (ach.reward > 0) {
      saveData.totalShards += ach.reward;
      Save.save(saveData);
    }
    _achQueue.push(ach);
    _showNextAch();
  },

  checkStat(statKey, value) {
    for (const ach of ACHIEVEMENTS) {
      if (ach.stat === statKey && ach.target !== null && !this.isUnlocked(ach.id)) {
        if (value >= ach.target) this.unlock(ach.id);
      }
    }
  },
};

// ============================================================
// SCREEN MANAGER
// ============================================================

const OVERLAY_SCREENS = new Set(['pause', 'upgrade-choice', 'gameover', 'levelcomplete']);

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
  // V6E: subtract HUD (~48px) + redesigned power bar (~80px) so canvas never overflows
  const availH = parent.clientHeight - 128;

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
  // V6D: danger line just 1 block-row above the launcher — blocks can come very close
  const rowH = blockH + blockPad;
  DANGER_ROW  = Math.max(13, Math.floor((launcherY - blockPad) / rowH) - 1);
  WARNING_ROW = DANGER_ROW - 1; // one row above lose line = warning flash
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
    this.bossType = null;
    this.wasTripled = false;
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
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ff0044'; ctx.shadowBlur = 6;
      ctx.font = `8px 'Courier New'`; ctx.fillStyle = '#ff0044';
      ctx.fillText('CORE', x + blockW / 2, y + blockH - 6);
      if (this.bossType) {
        ctx.font = `6px 'Courier New'`; ctx.fillStyle = '#ff9999'; ctx.shadowBlur = 3;
        ctx.fillText(this.bossType.split('_')[0].toUpperCase(), x + blockW / 2, y + 7);
      }
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
// BLACK HOLE  (V4B — gravity anomaly)
// ============================================================

class BlackHole {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.alive = true;
    this.strength = 0.28;
    this.pulse = Math.random() * Math.PI * 2;
  }
  get coreRadius() { return Math.min(blockW, blockH) * 0.36; }
  get radius()     { return Math.min(blockW * 3.2, 96); }

  update() { this.pulse += 0.04; }
  descend() { this.y += blockH + blockPad; }

  draw(ctx) {
    const r = this.radius, cr = this.coreRadius;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);
    ctx.save();

    // Influence dashed ring
    ctx.strokeStyle = `rgba(140,0,220,${0.13 + glow * 0.09})`;
    ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Radial fog
    const fog = ctx.createRadialGradient(this.x, this.y, cr * 0.2, this.x, this.y, r);
    fog.addColorStop(0,   'rgba(70,0,150,0.52)');
    fog.addColorStop(0.4, 'rgba(40,0,100,0.22)');
    fog.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = fog;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();

    // Core
    ctx.shadowColor = '#8800ff'; ctx.shadowBlur = 14 + glow * 10;
    const cg = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, cr);
    cg.addColorStop(0, '#000000'); cg.addColorStop(0.55, '#2a0066'); cg.addColorStop(1, '#8800ff');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(this.x, this.y, cr, 0, Math.PI * 2); ctx.fill();

    // Rotating accretion ring
    ctx.shadowBlur = 6;
    ctx.strokeStyle = `rgba(180,0,255,${0.5 + glow * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.pulse * 0.65);
    ctx.beginPath(); ctx.ellipse(0, 0, cr * 1.7, cr * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    ctx.restore();
  }
}

// ============================================================
// PORTAL PAIR  (V4B — ball teleporter)
// ============================================================

class PortalPair {
  constructor(ax, ay, bx, by) {
    this.ax = ax; this.ay = ay;
    this.bx = bx; this.by = by;
    this.alive = true;
    this.pulse = Math.random() * Math.PI * 2;
  }
  get radius() { return Math.min(blockW, blockH) * 0.44; }

  update() { this.pulse += 0.07; }
  descend() { this.ay += blockH + blockPad; this.by += blockH + blockPad; }

  _drawSingle(ctx, x, y, rgb, glow) {
    const r = this.radius;
    ctx.save();
    ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 10 + glow * 12;
    ctx.strokeStyle = `rgba(${rgb},${0.5 + glow * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},0.48)`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(x, y); ctx.rotate(this.pulse);
    ctx.strokeStyle = `rgba(${rgb},${0.65 + glow * 0.3})`; ctx.lineWidth = 1.5; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 1.4); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  draw(ctx) {
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);
    this._drawSingle(ctx, this.ax, this.ay, '0,245,255', glow);
    this._drawSingle(ctx, this.bx, this.by, '255,68,204', glow);
    ctx.save();
    ctx.globalAlpha = 0.06 + 0.03 * Math.sin(this.pulse * 2);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([3, 8]);
    ctx.beginPath(); ctx.moveTo(this.ax, this.ay); ctx.lineTo(this.bx, this.by); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
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
    // V6D: lifecycle tracking — no cooldown; per-ball Set prevents same-ball double-fire
    this.triggeredBalls = new Set(); // balls that already fired this marker this turn
    this.usedThisTurn   = false;     // any ball touched → remove at turn end
    this.triggeredOnce  = false;     // one-shot effects (ball_boost, shuffle) guard
  }

  get x()  { return blockPad + this.col * (blockW + blockPad); }
  get y()  { return blockPad + this.row * (blockH + blockPad); }
  get cx() { return this.x + blockW / 2; }
  get cy() { return this.y + blockH / 2; }

  // V6C: Ghost-style draw — clearly NOT a block (no solid fill, no HP number, just a glowing symbol)
  draw(ctx) {
    if (!this.alive) return;
    this.pulse += 0.07;
    const mc = MARKER_COLORS[this.type];
    if (!mc) return;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);

    ctx.save();

    // Very faint ghost background (≈10% opacity) — signals "open cell, not a wall"
    ctx.globalAlpha = 0.10 + glow * 0.06;
    ctx.fillStyle = mc.fill;
    roundRect(ctx, this.x + 2, this.y + 2, blockW - 4, blockH - 4, 6);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Animated dashed neon border ring
    ctx.shadowColor = mc.glow;
    ctx.shadowBlur = 8 + glow * 14;
    ctx.strokeStyle = hexToRgba(mc.stroke, 0.28 + glow * 0.42);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    roundRect(ctx, this.x + 3, this.y + 3, blockW - 6, blockH - 6, 5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Large bright symbol — the only label; no HP number ever shown here
    ctx.shadowBlur = 6 + glow * 12;
    ctx.fillStyle = mc.stroke;
    ctx.globalAlpha = 0.80 + glow * 0.20;
    ctx.font = `bold ${blockH > 28 ? 19 : 15}px 'Courier New'`;
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
    this.portalCooldown = 0;
    this.portalJustUsed = false;
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

    // Marker collision — balls pass through but trigger effects
    // V6D: each ball can trigger a marker at most once per shot (per-ball Set)
    for (const marker of game.markers) {
      if (!marker.alive) continue;
      if (marker.triggeredBalls.has(this)) continue; // same ball already fired this marker
      if (this.collidesBlock(marker)) {
        marker.triggeredBalls.add(this);
        game.triggerMarker(marker, this);
      }
    }

    // V4B: Portal teleport
    if (game.portals) {
      if (this.portalCooldown > 0) {
        this.portalCooldown--;
      } else {
        for (const pp of game.portals) {
          if (!pp.alive) continue;
          const r = pp.radius;
          const dxa = this.x - pp.ax, dya = this.y - pp.ay;
          if (dxa * dxa + dya * dya < r * r) {
            this.x = pp.bx; this.y = pp.by;
            this.portalCooldown = 22;
            this.portalJustUsed = true;
            spawnParticles(pp.ax, pp.ay, '#00f5ff', 7, { speed: 3, decay: 0.06, size: 2 });
            spawnParticles(pp.bx, pp.by, '#ff44cc', 7, { speed: 3, decay: 0.06, size: 2 });
            if (game.hasRelic && game.hasRelic('void_compass')) game.voidCompassReady = true;
            break;
          }
          const dxb = this.x - pp.bx, dyb = this.y - pp.by;
          if (dxb * dxb + dyb * dyb < r * r) {
            this.x = pp.ax; this.y = pp.ay;
            this.portalCooldown = 22;
            this.portalJustUsed = true;
            spawnParticles(pp.bx, pp.by, '#ff44cc', 7, { speed: 3, decay: 0.06, size: 2 });
            spawnParticles(pp.ax, pp.ay, '#00f5ff', 7, { speed: 3, decay: 0.06, size: 2 });
            if (game.hasRelic && game.hasRelic('void_compass')) game.voidCompassReady = true;
            break;
          }
        }
      }
    }

    // V4B: Black hole gravity
    if (game.blackHoles) {
      for (const bh of game.blackHoles) {
        if (!bh.alive) continue;
        const dx = bh.x - this.x, dy = bh.y - this.y;
        const distSq = dx * dx + dy * dy;
        const r = bh.radius;
        if (distSq < r * r && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          const force = bh.strength / (dist + 1);
          this.vx += (dx / dist) * force;
          this.vy += (dy / dist) * force;
          const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
          if (spd > BALL_SPEED * 1.55) {
            const sc = (BALL_SPEED * 1.55) / spd;
            this.vx *= sc; this.vy *= sc;
          }
        }
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
    const voidBonus = (game.hasRelic && game.hasRelic('void_compass') && game.voidCompassReady) ? 1 : 0;
    if (voidBonus) game.voidCompassReady = false;
    const dmg = game.ballDamage + voidBonus + (game.hasUpgrade('crit_chance') && Math.random() < 0.15 ? game.ballDamage * 2 : 0);

    // V5A: Portal hit stat
    if (this.portalJustUsed) {
      this.portalJustUsed = false;
      saveData.stats.portalHits++;
      Achievements.checkStat('portalHits', saveData.stats.portalHits);
    }
    // V5A: Gravity hit stat (ball inside a black hole's influence zone)
    if (game.blackHoles && game.blackHoles.some(bh => {
      if (!bh.alive) return false;
      const dx = this.x - bh.x, dy = this.y - bh.y;
      return dx * dx + dy * dy < bh.radius * bh.radius;
    })) {
      saveData.stats.gravityHits++;
      Achievements.checkStat('gravityHits', saveData.stats.gravityHits);
    }

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

    // Trail — scaled to BALL_DRAW_RADIUS for visibility
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.4;
      const r = BALL_DRAW_RADIUS * (i / this.trail.length);
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

    // Ball — drawn at BALL_DRAW_RADIUS (bigger visual, same collision)
    ctx.save();
    ctx.shadowColor = tc;
    ctx.shadowBlur = 16;
    const grad = ctx.createRadialGradient(
      this.x - BALL_DRAW_RADIUS * 0.25, this.y - BALL_DRAW_RADIUS * 0.25, 1,
      this.x, this.y, BALL_DRAW_RADIUS
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, bc2);
    grad.addColorStop(1, bc3);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, BALL_DRAW_RADIUS, 0, Math.PI * 2);
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
  // V6D: level param selects which level to play (1 = first level)
  constructor(level = 1) {
    this.level = Math.max(1, level);
    this.reset();
  }

  reset() {
    resizeCanvas();

    // Run stats
    this.stage = 1;  // internal turn counter within the level
    this.score = 0;
    this.shards = 0;
    this.phase = GamePhase.IDLE;
    this.turn = 0;
    this.laserTurnCounter = 0;

    // V6D: level wave tracking
    this.wavesSpawned = 0;
    this.maxWaves     = levelWaves(this.level);
    this.levelCleared = false;

    // Apply permanent upgrades (start ball count from level number)
    this.ballCount = Math.min(this.level, 30); // V6D: level N starts with N balls (cap 30)
    this.ballDamage = 1;
    this.shardMultiplier = 1.0;
    this.startShieldLevel = 0;
    this.applyPermUpgrades();
    // V6D: ball floor = min(level, 30)
    this.ballCount = Math.max(this.ballCount, Math.min(this.level, 30));

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

    // Powers (V6B)
    this.powBomb     = 3;   // left button — bomb (bottom 3 rows)
    this.powMult     = 3;   // right button — 10x ball multiplier
    this.ballMultActive = false;
    this.shotId      = 0;   // incremented each shoot(); recall uses this to cancel queued launches

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

    // V4B: Anomalies, portals, relics
    this.blackHoles = [];
    this.portals = [];
    this.relics = [];
    this.bossDefeatedThisTurn = false;
    this.emergencyShieldUsed = false;
    this.voidCompassReady = false;

    // V5A: Per-turn effect flags (chain_react achievement)
    this.turnPowerUsed    = false;
    this.turnLaserUsed    = false;
    this.turnElectricUsed = false;

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

  hasRelic(id) {
    return this.relics ? this.relics.includes(id) : false;
  }

  earnShards(n) {
    let mult = this.shardMultiplier;
    if (this.hasRelic('greedy_core')) mult *= 1.5;
    const earned = Math.floor(n * mult);
    this.shards += earned;
    saveData.totalShards += earned;
    // V5A: Cumulative shards earned (wallet-independent)
    saveData.stats.totalShardsEarned += earned;
    Achievements.checkStat('totalShardsEarned', saveData.stats.totalShardsEarned);
    document.getElementById('hud-shards').textContent = this.shards;
  }

  // ---- Block spawning ----

  // V6A: Single balance table — all difficulty values derived here for easy tuning
  stageBalance(stage) {
    const isMilestone = (stage % BOSS_INTERVAL === 0);
    const approxBalls = Math.min(stage, 30);            // V6C: ball count is capped at 30 by V6A
    return {
      blockHp:       Math.min(stage * 0.9 + 1, approxBalls * 1.5 + 2),        // V6C: caps at ~47 HP (30 balls × 1.5)
      milestoneMult: isMilestone ? 1.25 : 1.0,                                 // milestone blocks 25% tougher
      // V6D: early levels start sparse (60% skip = ~3 blocks/row); later levels fill up (25% skip = ~5 blocks)
      skipChance:    isMilestone ? 0.10 : Math.max(0.25, 0.60 - stage * 0.016),
      triChance:     stage >= 5  ? Math.min(0.32, (stage - 4) * 0.04)  : 0,   // triangle blocks
      mysteryChance: stage >= 3  ? Math.min(0.12, (stage - 2) * 0.018) : 0,   // mystery blocks
      markerChance:  stage >= 2  ? Math.min(0.30, (stage - 1) * 0.04)  : 0,   // markers
      isMilestone,
    };
  }

  blockHpForStage(stage) {
    const bal       = this.stageBalance(stage);
    const relicMult = this.hasRelic('siege_engine') ? 1.12 : 1.0;
    return Math.max(1, Math.ceil(bal.blockHp * bal.milestoneMult * relicMult));
  }

  spawnStageBlocks() {
    if (this.wavesSpawned >= this.maxWaves) return; // V6D: wave limit
    const stage = this.level;                        // V6D: difficulty from level
    const bal   = this.stageBalance(stage);
    const hp    = this.blockHpForStage(stage);
    const isBossThisWave = bal.isMilestone && this.wavesSpawned === 0; // boss only on wave 0
    const triChance     = bal.triChance;
    const mysteryChance = bal.mysteryChance;

    // Generate one row of blocks at the top
    for (let col = 0; col < COLS; col++) {
      const rnd = Math.random();
      let type = BlockType.NORMAL;

      if (isBossThisWave && col === Math.floor(COLS / 2)) {
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

      // V6A: Skip chance from stageBalance (fewer gaps on milestone stages)
      if (type === BlockType.NORMAL && Math.random() < bal.skipChance) continue;

      const blockHp = type === BlockType.BOSS ? hp * 4 : hp;
      const newBlock = new Block(col, 0, type, blockHp);
      if (type === BlockType.BOSS) {
        const behaviors = ['shield_core', 'gravity_core', 'summoner_core', 'corrupt_core', 'laser_core'];
        newBlock.bossType = behaviors[(Math.floor(stage / BOSS_INTERVAL) - 1) % behaviors.length];
      }
      this.blocks.push(newBlock);
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

    // Spawn a marker in a free column (stage 2+) — V6A: uses bal.markerChance
    const markerChance = bal.markerChance;
    if (markerChance > 0 && Math.random() < markerChance) {
      const freeCols = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols().includes(c));
      if (freeCols.length > 0) {
        this.markers.push(new Marker(randItem(freeCols), 0, this._pickMarkerType(stage)));
      }
    }

    // V4B: Spawn black hole (stage 4+, max 1 alive at a time)
    if (stage >= 4 && this.blackHoles.filter(bh => bh.alive).length < 1 && Math.random() < 0.13) {
      const col = randInt(1, COLS - 2);
      const row = randInt(1, 4);
      const bhX = blockPad + col * (blockW + blockPad) + blockW / 2;
      const bhY = blockPad + row * (blockH + blockPad) + blockH / 2;
      this.blackHoles.push(new BlackHole(bhX, bhY));
    }

    // V4B: Spawn portal pair (stage 6+, max 1 pair alive at a time)
    if (stage >= 6 && this.portals.filter(p => p.alive).length < 1 && Math.random() < 0.15) {
      const colA = randInt(0, 2), colB = randInt(4, COLS - 1);
      const rowA = randInt(1, 3), rowB = randInt(1, 3);
      const ax = blockPad + colA * (blockW + blockPad) + blockW / 2;
      const ay = blockPad + rowA * (blockH + blockPad) + blockH / 2;
      const bx = blockPad + colB * (blockW + blockPad) + blockW / 2;
      const by = blockPad + rowB * (blockH + blockPad) + blockH / 2;
      this.portals.push(new PortalPair(ax, ay, bx, by));
    }

    this.wavesSpawned++; // V6D
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
    // V4B: Emergency Shield relic — push back most dangerous block on first warning
    if (hitWarning && !this.warningActive && !this.emergencyShieldUsed && this.hasRelic('emergency_shield')) {
      this.emergencyShieldUsed = true;
      const dangerBlock = this.blocks
        .filter(b => b.alive && b.row >= WARNING_ROW)
        .sort((a, b) => b.row - a.row)[0];
      if (dangerBlock) {
        const fx = dangerBlock.cx, fy = dangerBlock.cy;
        dangerBlock.row = Math.max(0, dangerBlock.row - 2);
        floatingTexts.push(new FloatingText(W / 2, H * 0.5, 'EMERGENCY SHIELD!', '#00ccff'));
        spawnParticles(fx, fy, '#00ccff', 12, { speed: 3, decay: 0.04 });
        screenShake(4, 3);
      }
    }

    // V5A: Close call recovery — blocks were in warning row but player cleared them
    if (this.warningActive && !hitWarning) {
      saveData.stats.closeCallRecoveries++;
      Achievements.checkStat('closeCallRecoveries', saveData.stats.closeCallRecoveries);
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
    this.shotId++;
    this.updatePowerBar(); // enable recall button immediately

    // V5A: Track shot + reset per-turn laser/electric flags (power flag persists from IDLE)
    saveData.stats.totalShotsFired++;
    Achievements.checkStat('totalShotsFired', saveData.stats.totalShotsFired);
    this.turnLaserUsed    = false;
    this.turnElectricUsed = false;

    // V4B: Broken Reactor relic — 1 damage to a random block at start of turn
    if (this.hasRelic('broken_reactor')) {
      const aliveBlocks = this.blocks.filter(b => b.alive);
      if (aliveBlocks.length > 0) {
        const target = randItem(aliveBlocks);
        target.hit(1, this);
        spawnParticles(target.cx, target.cy, '#ff4400', 5, { speed: 2, decay: 0.07, size: 2 });
      }
    }

    // V6B: 10x multiplier applies to this shot only
    const isMultShot = this.ballMultActive;
    let totalBalls = this.ballCount;
    if (isMultShot) {
      totalBalls = Math.min(this.ballCount * 10, 300);
      this.ballMultActive = false;
      floatingTexts.push(new FloatingText(W / 2, H * 0.4, '×10 SHOT!', '#ffee00'));
      screenShake(4, 3);
    }
    const piercing = this.hasUpgrade('piercing') ? 3 : 0;
    const spread = this.hasUpgrade('multishot');
    const lx = this.launcher.x;
    const ly = launcherY;
    const angle = this.launcher.angle;
    const spd = BALL_SPEED;

    let launched = 0;
    this.pendingBalls = totalBalls;
    const currentShotId = this.shotId;                        // V6B: recall guard
    const launchDelay   = isMultShot ? Math.max(8, FIRE_DELAY >> 2) : FIRE_DELAY;
    const launchNext = () => {
      if (launched >= totalBalls || this.shotId !== currentShotId) return; // cancelled by recall
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
      if (launched < totalBalls) setTimeout(launchNext, launchDelay);
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

    const isGood = Math.random() < (this.hasRelic('greedy_core') ? 0.45 : 0.60);
    const pool = isGood ? MYSTERY_GOOD : MYSTERY_BAD;
    // V5A: Harmful mystery stat
    if (!isGood) {
      saveData.stats.harmfulMysterySurvived++;
      Achievements.checkStat('harmfulMysterySurvived', saveData.stats.harmfulMysterySurvived);
    }
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
          big.wasTripled = true; // V5A: tracked for overloaded achievement
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
    // V6D: marker stays alive during the whole shot — it is NOT removed here.
    // marker.usedThisTurn = true marks it for removal at processTurnEnd().
    // Laser markers fire on every ball touch (per-ball dedup handled by triggeredBalls Set).
    // ball_boost / shuffle fire only once (triggeredOnce guard).
    marker.usedThisTurn = true;
    const cx = marker.cx, cy = marker.cy;

    switch (marker.type) {
      case 'ball_boost': {
        if (!marker.triggeredOnce) {
          marker.triggeredOnce = true;
          const bonus = Math.random() < 0.35 ? 2 : 1;
          this.ballCount += bonus;
          this.updateHUD();
          spawnParticles(cx, cy, '#00ff88', 14, { speed: 4, decay: 0.025 });
          floatingTexts.push(new FloatingText(cx, cy - 24, `+${bonus} BALL${bonus > 1 ? 'S' : ''}!`, '#00ff88'));
        }
        break;
      }
      case 'shuffle': {
        if (!marker.triggeredOnce) {
          marker.triggeredOnce = true;
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
        }
        break;
      }
      case 'laser_h':
        // Every ball touch damages the row — lightweight beam drawn once per trigger
        this._fireLaserRow(marker.row);
        laserBeams.push({ x1: 0, y1: cy, x2: W, y2: cy, color: '#ff44cc', life: 8 });
        saveData.stats.laserTriggers++;
        Achievements.checkStat('laserTriggers', saveData.stats.laserTriggers);
        if (!marker.triggeredOnce) {
          marker.triggeredOnce = true;
          floatingTexts.push(new FloatingText(cx, cy - 24, '— ROW LASER!', '#ff44cc'));
        }
        break;
      case 'laser_v':
        this._fireLaserCol(marker.col);
        laserBeams.push({ x1: cx, y1: 0, x2: cx, y2: H, color: '#00ccff', life: 8 });
        saveData.stats.laserTriggers++;
        Achievements.checkStat('laserTriggers', saveData.stats.laserTriggers);
        if (!marker.triggeredOnce) {
          marker.triggeredOnce = true;
          floatingTexts.push(new FloatingText(cx, cy - 24, '| COL LASER!', '#00ccff'));
        }
        break;
      case 'laser_cross':
        this._fireLaserRow(marker.row);
        this._fireLaserCol(marker.col);
        laserBeams.push({ x1: 0, y1: cy, x2: W, y2: cy, color: '#ffee00', life: 8 });
        laserBeams.push({ x1: cx, y1: 0, x2: cx, y2: H, color: '#ffee00', life: 8 });
        saveData.stats.laserTriggers++;
        Achievements.checkStat('laserTriggers', saveData.stats.laserTriggers);
        if (!marker.triggeredOnce) {
          marker.triggeredOnce = true;
          floatingTexts.push(new FloatingText(cx, cy - 24, '+ CROSS LASER!', '#ffee00'));
        }
        break;
    }
  }

  _fireLaserRow(row) {
    this.turnLaserUsed = true; // V5A
    const laserDmg = 1 + (this.hasRelic('storm_lens') ? 1 : 0);
    for (const b of this.blocks) {
      if (b.alive && b.row === row) {
        b.hit(laserDmg, this);
        spawnParticles(b.cx, b.cy, '#ff44cc', 4, { speed: 2, decay: 0.07 });
      }
    }
    screenShake(3, 2);
  }

  _fireLaserCol(col) {
    this.turnLaserUsed = true; // V5A
    const laserDmg = 1 + (this.hasRelic('storm_lens') ? 1 : 0);
    for (const b of this.blocks) {
      if (b.alive && b.col === col) {
        b.hit(laserDmg, this);
        spawnParticles(b.cx, b.cy, '#00ccff', 4, { speed: 2, decay: 0.07 });
      }
    }
    screenShake(3, 2);
  }

  // ---- Powers ----

  // V6B: Bomb — damages the bottom 3 block rows (closest to danger line)
  useBomb() {
    if (this.phase !== GamePhase.IDLE || this.powBomb <= 0) return;
    this.powBomb--;
    this.turnPowerUsed = true;
    this.updatePowerBar();

    const aliveRows = [...new Set(this.blocks.filter(b => b.alive).map(b => b.row))].sort((a, b) => b - a);
    const targetRows = new Set(aliveRows.slice(0, 3));
    let hit = 0;
    for (const b of this.blocks) {
      if (!b.alive || !targetRows.has(b.row)) continue;
      b.hit(this.ballDamage * 8, this);
      spawnParticles(b.cx, b.cy, '#ff6600', 10, { speed: 4.5, decay: 0.04 });
      spawnParticles(b.cx, b.cy, '#ffee00', 5,  { speed: 6,   decay: 0.035, size: 3 });
      hit++;
    }
    if (hit > 0) {
      floatingTexts.push(new FloatingText(W / 2, H * 0.43, '💣 BOMB!', '#ff6600'));
      screenShake(12, 7);
    }
  }

  // V6B: 10x Ball Multiplier — next shot fires 10× current ball count (one shot only)
  useMult() {
    if (this.phase !== GamePhase.IDLE || this.powMult <= 0 || this.ballMultActive) return;
    this.powMult--;
    this.turnPowerUsed = true;
    this.ballMultActive = true;
    this.updatePowerBar();
    floatingTexts.push(new FloatingText(W / 2, H * 0.43, '×10 READY!', '#ffee00'));
  }

  // V6B: Recall — instantly deactivates all flying balls and ends the turn
  recallBalls() {
    if (this.phase !== GamePhase.SHOOTING) return;
    this.shotId++;              // cancels any queued launchNext timeouts
    this.pendingBalls = 0;     // forces turn-end detection in update()
    if (this.firstReturnX === null) this.firstReturnX = this.launcher.x;
    for (const b of this.balls) {
      if (b.active) {
        spawnParticles(b.x, b.y, '#00f5ff', 4, { speed: 2.5, decay: 0.08 });
        b.active = false;
      }
    }
    floatingTexts.push(new FloatingText(W / 2, H * 0.5, '↓ RECALLED', '#00ccff'));
    this.updatePowerBar();
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
    if (block.type === BlockType.BOSS) this.bossDefeatedThisTurn = true;
    this.comboCount++;
    const count = this.comboCount;

    // V5A: Block destroyed stats
    saveData.stats.totalBlocksDestroyed++;
    Achievements.checkStat('totalBlocksDestroyed', saveData.stats.totalBlocksDestroyed);

    if (block.type === BlockType.BOSS) {
      saveData.stats.totalBossesDefeated++;
      Achievements.checkStat('totalBossesDefeated', saveData.stats.totalBossesDefeated);
      if (this.warningActive) Achievements.unlock('boss_survivor');
    }
    if (block.type === BlockType.MYSTERY) {
      saveData.stats.totalMysteryBlocksDestroyed++;
      Achievements.checkStat('totalMysteryBlocksDestroyed', saveData.stats.totalMysteryBlocksDestroyed);
    }
    if (block.wasTripled) {
      saveData.stats.tripledBlockDestroyed++;
      Achievements.checkStat('tripledBlockDestroyed', saveData.stats.tripledBlockDestroyed);
    }
    if (block.row >= WARNING_ROW) Achievements.unlock('last_line');

    // V5A: Combo stat + achievements
    if (count > saveData.stats.highestCombo) saveData.stats.highestCombo = count;
    if (count === 5)  Achievements.unlock('combo_5');
    if (count === 10) Achievements.unlock('combo_10');
    if (count === 20) Achievements.unlock('combo_20');

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
    const useCrown = this.hasRelic('fire_crown');
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (b.col === col && b.row === row) continue;
      const dist = Math.max(Math.abs(b.col - col), Math.abs(b.row - row));
      if (dist <= 1) {
        b.hit(areaDmg, this);
      } else if (dist === 2 && useCrown) {
        b.hit(1, this);
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
    this.turnElectricUsed = true; // V5A
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

  // ---- V4B: Boss behavior ----

  performBossAction(boss) {
    switch (boss.bossType) {
      case 'shield_core': {
        const candidates = this.blocks.filter(b => b.alive && b.type !== BlockType.BOSS && !b.shieldActive)
          .sort((a, b) => (Math.abs(a.col - boss.col) + Math.abs(a.row - boss.row)) -
                          (Math.abs(b.col - boss.col) + Math.abs(b.row - boss.row)))
          .slice(0, 2);
        for (const nb of candidates) {
          nb.shieldActive = true;
          spawnParticles(nb.cx, nb.cy, '#00ccff', 6, { speed: 2, decay: 0.06 });
        }
        if (candidates.length > 0) floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'SHIELD GRANTED!', '#00ccff'));
        break;
      }
      case 'gravity_core': {
        const existBH = this.blackHoles.find(bh => bh.alive);
        if (existBH) {
          existBH.strength = Math.min(existBH.strength + 0.1, 0.6);
          floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'GRAVITY+!', '#8800ff'));
        } else {
          this.blackHoles.push(new BlackHole(boss.cx, boss.cy + (blockH + blockPad) * 1.5));
          floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'VOID OPENED!', '#8800ff'));
        }
        spawnParticles(boss.cx, boss.cy, '#8800ff', 10, { speed: 3, decay: 0.05 });
        break;
      }
      case 'summoner_core': {
        const taken = this.blocks.filter(b => b.alive && b.row === 0).map(b => b.col);
        const free = Array.from({ length: COLS }, (_, i) => i).filter(c => !taken.includes(c));
        if (free.length > 0) {
          const summonHp = Math.ceil(this.blockHpForStage(this.stage) * 0.6);
          this.blocks.push(new Block(randItem(free), 0, BlockType.NORMAL, summonHp));
          floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'SUMMONED!', '#ff8800'));
          spawnParticles(boss.cx, boss.cy, '#ff8800', 8, { speed: 2.5, decay: 0.05 });
        }
        break;
      }
      case 'corrupt_core': {
        const targets = this.blocks.filter(b => b.alive && b.type !== BlockType.BOSS)
          .sort(() => Math.random() - 0.5).slice(0, 3);
        for (const t of targets) { t.hp += 3; t.maxHp = Math.max(t.maxHp, t.hp); t.hitFlash = 4; }
        if (targets.length > 0) floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'CORRUPTED!', '#ff0066'));
        spawnParticles(boss.cx, boss.cy, '#ff0066', 8, { speed: 2.5, decay: 0.05 });
        break;
      }
      case 'laser_core':
        this._fireLaserRow(boss.row);
        laserBeams.push({ x1: 0, y1: boss.cy, x2: W, y2: boss.cy, color: '#ff0044', life: 10 });
        floatingTexts.push(new FloatingText(boss.cx, boss.cy - 30, 'PULSE!', '#ff0044'));
        break;
    }
    boss.hitFlash = 6;
  }

  // ---- V4B: Relic choice ----

  showRelicChoice() {
    this.phase = GamePhase.UPGRADE;
    const titleEl = document.querySelector('#screen-upgrade-choice .screen-title');
    if (titleEl) titleEl.textContent = 'CHOOSE RELIC';

    const available = RELICS.filter(r => !this.hasRelic(r.id));
    const picks = available.sort(() => Math.random() - 0.5).slice(0, 3);

    const container = document.getElementById('upgrade-cards');
    container.innerHTML = '';
    for (const relic of picks) {
      const card = document.createElement('div');
      card.className = 'upg-card';
      card.innerHTML = `
        <div class="upg-card-icon">${relic.icon}</div>
        <div class="upg-card-text">
          <div class="upg-card-name" style="color:#ffcc44">${relic.name}</div>
          <div class="upg-card-desc">${relic.desc}</div>
        </div>`;
      card.addEventListener('click', () => this.pickRelic(relic));
      container.appendChild(card);
    }
    Screens.show('upgrade-choice');
  }

  pickRelic(relic) {
    this.relics.push(relic.id);
    if (relic.id === 'siege_engine') { this.ballCount += 2; this.updateHUD(); }
    const titleEl = document.querySelector('#screen-upgrade-choice .screen-title');
    if (titleEl) titleEl.textContent = 'CHOOSE UPGRADE';
    floatingTexts.push(new FloatingText(W / 2, H * 0.5, relic.name + '!', '#ffcc44'));
    Screens.show('game');
    this.phase = GamePhase.IDLE;
    this.updateHUD();
    this.checkLevelComplete(); // V6D
  }

  // ---- Turn end ----

  processTurnEnd() {
    this.phase = GamePhase.TURN_END;

    // Snap launcher to where first ball exited the bottom
    if (this.firstReturnX !== null) {
      this.launcher.x = clamp(this.firstReturnX, BALL_RADIUS + 12, W - BALL_RADIUS - 12);
    }
    this.firstReturnX = null;

    // Remove dead blocks, orbs, and used markers
    // V6D: markers that were triggered this turn (usedThisTurn) are removed here.
    // Non-triggered markers survive and will descend with the next wave.
    this.blocks  = this.blocks.filter(b => b.alive);
    this.orbs    = this.orbs.filter(o => o.alive);
    this.markers = this.markers.filter(m => m.alive && !m.usedThisTurn);
    // Reset per-turn state for any surviving markers
    for (const m of this.markers) {
      m.triggeredBalls = new Set();
      m.usedThisTurn   = false;
      m.triggeredOnce  = false;
    }

    // V4B: Boss action (every 3rd turn while alive)
    const activeBoss = this.blocks.find(b => b.alive && b.type === BlockType.BOSS);
    if (activeBoss && this.turn % 3 === 0) this.performBossAction(activeBoss);

    // V4B: Frozen Heart relic (every 4th turn)
    if (this.hasRelic('frozen_heart') && this.turn % 4 === 0) {
      const aliveRows = [...new Set(this.blocks.filter(b => b.alive).map(b => b.row))];
      if (aliveRows.length > 0) {
        const frozenRow = randItem(aliveRows);
        this.blocks.filter(b => b.alive && b.row === frozenRow).forEach(b => { b.frozen = true; b.frozenTurns = 1; });
        floatingTexts.push(new FloatingText(W / 2, H * 0.35, 'ROW FROZEN!', '#00ccff'));
        spawnParticles(W / 2, H * 0.4, '#00ccff', 10, { speed: 3.5, decay: 0.04, size: 2.5 });
      }
    }

    // V5A: Chain Reaction achievement — power + laser + electric all in same turn
    if (this.turnPowerUsed && this.turnLaserUsed && this.turnElectricUsed) {
      Achievements.unlock('chain_react');
    }
    this.turnPowerUsed    = false;
    this.turnLaserUsed    = false;
    this.turnElectricUsed = false;
    Save.save(saveData); // persist stats each turn

    // Shard regen upgrade
    if (this.hasUpgrade('regen')) this.earnShards(5);

    // Score
    const scoreGain = this.level * 10;
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
    document.getElementById('hud-stage').textContent = this.level; // V6D: display level

    this.spawnStageBlocks();

    // Shard earn per stage
    this.earnShards(randInt(2, 5) + Math.floor(this.level / 5));

    // V4B: Descend anomalies; cull those too close to launcher
    for (const bh of this.blackHoles) bh.descend();
    for (const pp of this.portals) pp.descend();
    this.blackHoles = this.blackHoles.filter(bh => bh.alive && bh.y < launcherY - 20);
    this.portals    = this.portals.filter(pp => pp.alive && pp.ay < launcherY - 20 && pp.by < launcherY - 20);

    // V6D: Per-shot ball growth — +1 after each turn, floor at level (capped 30)
    this.ballCount = Math.min(30, this.ballCount + 1);
    this.ballCount = Math.max(this.ballCount, Math.min(this.level, 30));
    this.updateHUD();

    // V6A: Milestone rewards on boss defeat (takes priority over upgrade interval)
    if (this.bossDefeatedThisTurn) {
      this.bossDefeatedThisTurn = false;
      const milestoneNum = Math.max(1, Math.floor((this.level - 1) / BOSS_INTERVAL));
      const bonusShards  = 15 + milestoneNum * 10;
      this.earnShards(bonusShards);
      this.powBomb = Math.min(this.powBomb + 1, 6);
      this.powMult = Math.min(this.powMult + 1, 6);
      this.updatePowerBar();
      floatingTexts.push(new FloatingText(W / 2, H * 0.30, '★ MILESTONE CLEARED! ★', '#ffee00'));
      floatingTexts.push(new FloatingText(W / 2, H * 0.38, '+SHARDS & POWER RESTORED', '#00ff88'));
      screenShake(10, 6);
      setTimeout(() => this.showRelicChoice(), 700);
      return;
    }

    // Check upgrade interval
    if (this.turn % UPGRADE_INTERVAL === 0) {
      setTimeout(() => this.showUpgradeChoice(), 400);
      return;
    }

    this.checkLevelComplete();
    if (!this.levelCleared) {
      this.phase = GamePhase.IDLE;
      this.updateHUD();
    }
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
    Achievements.unlock('first_upgrade'); // V5A
    Screens.show('game');
    this.phase = GamePhase.IDLE;
    this.updateHUD();
    this.checkLevelComplete(); // V6D
  }

  // ---- Game Over ----

  triggerGameOver() {
    this.warningActive = false;
    this.phase = GamePhase.GAMEOVER;

    if (this.level > saveData.bestStage) saveData.bestStage = this.level;
    Save.save(saveData);

    document.getElementById('go-stage').textContent = this.level;
    document.getElementById('go-score').textContent = this.score;
    document.getElementById('go-shards').textContent = this.shards;
    document.getElementById('go-best').textContent = saveData.bestStage;

    setTimeout(() => Screens.show('gameover'), 700);
  }

  checkLevelComplete() {
    if (this.levelCleared || this.phase === GamePhase.GAMEOVER) return;
    if (this.wavesSpawned < this.maxWaves) return;
    if (this.blocks.filter(b => b.alive).length > 0) return;
    this.levelCleared = true;
    this.phase = GamePhase.GAMEOVER;
    setTimeout(() => this.onLevelComplete(), 600);
  }

  onLevelComplete() {
    const lv = this.level;
    if (!saveData.completedLevels.includes(lv)) saveData.completedLevels.push(lv);
    if (saveData.highestUnlockedLevel <= lv) saveData.highestUnlockedLevel = lv + 1;
    if (!saveData.levelBestScore[lv] || this.score > saveData.levelBestScore[lv])
      saveData.levelBestScore[lv] = this.score;
    if (lv > saveData.bestStage) saveData.bestStage = lv;
    const shardsEarned = this.shards;
    saveData.totalShards += shardsEarned;
    Save.save(saveData);
    document.getElementById('lc-level').textContent  = lv;
    document.getElementById('lc-score').textContent  = this.score;
    document.getElementById('lc-shards').textContent = shardsEarned;
    const isMilestone = lv % BOSS_INTERVAL === 0;
    document.getElementById('lc-bonus').textContent  = isMilestone ? '★ MILESTONE BONUS!' : '';
    Screens.show('levelcomplete');
  }

  // ---- HUD ----

  updateHUD() {
    document.getElementById('hud-stage').textContent = this.level;
    document.getElementById('hud-score').textContent = this.score;
    document.getElementById('hud-shards').textContent = this.shards;
    document.getElementById('balls-count').textContent = this.ballCount;
    // V5A: Track highest ball count across all time
    if (this.ballCount > saveData.stats.highestBallCount) {
      saveData.stats.highestBallCount = this.ballCount;
      if (this.ballCount >= 10) Achievements.unlock('ball_storm');
      if (this.ballCount >= 25) Achievements.unlock('swarm_cmd');
    }
  }

  updatePowerBar() {
    // V6B: left = bomb, right = 10x multiplier
    document.getElementById('pow-lightning-count').textContent = this.powBomb;
    document.getElementById('pow-bomb-count').textContent      = this.ballMultActive ? '✓' : this.powMult;
    document.getElementById('btn-lightning').disabled = (this.powBomb <= 0 || this.phase !== GamePhase.IDLE);
    document.getElementById('btn-bomb').disabled      = (this.powMult <= 0 || this.phase !== GamePhase.IDLE || this.ballMultActive);
    const recallBtn = document.getElementById('btn-recall');
    if (recallBtn) recallBtn.disabled = (this.phase !== GamePhase.SHOOTING);
  }

  // ---- Update loop ----

  update() {
    if (this.phase !== GamePhase.SHOOTING) return;

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

    // V4B: Black holes (rendered behind blocks)
    for (const bh of this.blackHoles) { bh.update(); if (bh.alive) bh.draw(ctx); }

    // Blocks
    for (const block of this.blocks) {
      if (block.alive) block.draw(ctx);
    }

    // Launcher + ball count label beneath it
    if (this.phase === GamePhase.IDLE || this.phase === GamePhase.SHOOTING) {
      this.launcher.draw(ctx);
      // V6E: compact ball count label just below cannon tip — acts as a quick-glance indicator
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = 0.82;
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#00f5ff';
      ctx.font = "bold 10px 'Courier New'";
      ctx.fillText('\xd7' + this.ballCount, this.launcher.x, launcherY + 18);
      ctx.restore();
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

    // V4B: Portals
    for (const pp of this.portals) { pp.update(); if (pp.alive) pp.draw(ctx); }

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

    // V4B: Active relics — small canvas HUD (top-left, semi-transparent)
    if (this.relics && this.relics.length > 0) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.font = '8px \'Courier New\'';
      ctx.fillStyle = '#ffcc44';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      this.relics.slice(0, 5).forEach((id, i) => {
        const rel = RELICS.find(x => x.id === id);
        if (rel) ctx.fillText(rel.name, 4, 4 + i * 10);
      });
      ctx.restore();
    }

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

function buildLevelSelectGrid() {
  const grid = document.getElementById('level-grid');
  grid.innerHTML = '';
  const unlocked = saveData.highestUnlockedLevel;
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    btn.textContent = i;
    const completed  = saveData.completedLevels.includes(i);
    const isUnlocked = i <= unlocked;
    if (completed)        btn.classList.add('level-completed');
    else if (isUnlocked)  btn.classList.add('level-unlocked');
    else { btn.classList.add('level-locked'); btn.disabled = true; }
    if (isUnlocked) btn.addEventListener('click', () => { game = new Game(i); Screens.show('game'); });
    grid.appendChild(btn);
  }
  const progressEl = document.getElementById('ls-progress');
  if (progressEl) progressEl.textContent = saveData.completedLevels.length + ' / ' + TOTAL_LEVELS + ' CLEARED';
  const currentBtn = grid.children[unlocked - 1];
  if (currentBtn) setTimeout(() => currentBtn.scrollIntoView({ block: 'center' }), 50);
}

function updateMenuDisplay() {
  document.getElementById('menu-best-stage').textContent = Math.max(0, saveData.highestUnlockedLevel - 1);
  document.getElementById('menu-shards').textContent = saveData.totalShards;
  // V5B: Achievement count badge
  const unlockedN = ACHIEVEMENTS.filter(a => Achievements.isUnlocked(a.id)).length;
  const badge = document.getElementById('menu-ach-count');
  if (badge) badge.textContent = unlockedN + ' / ' + ACHIEVEMENTS.length;
}

// ============================================================
// V5B: BUILD ACHIEVEMENT LIST
// ============================================================

const ACH_CAT_LABELS = {
  first:    'FIRST STEPS',
  skill:    'SKILL',
  survival: 'SURVIVAL',
  longterm: 'LONG-TERM',
  secret:   'SECRET',
};

function buildAchievementList() {
  const total    = ACHIEVEMENTS.length;
  const unlocked = ACHIEVEMENTS.filter(a => Achievements.isUnlocked(a.id)).length;

  const summaryEl = document.getElementById('ach-summary');
  if (summaryEl) summaryEl.textContent = unlocked + ' / ' + total + ' UNLOCKED';

  const badge = document.getElementById('menu-ach-count');
  if (badge) badge.textContent = unlocked + ' / ' + total;

  const list = document.getElementById('ach-list');
  if (!list) return;
  list.innerHTML = '';

  const cats = ['first', 'skill', 'survival', 'longterm', 'secret'];
  for (const cat of cats) {
    const items = ACHIEVEMENTS.filter(a => a.cat === cat);
    if (!items.length) continue;

    const header = document.createElement('div');
    header.className = 'ach-cat-header';
    header.textContent = ACH_CAT_LABELS[cat] || cat.toUpperCase();
    list.appendChild(header);

    for (const ach of items) {
      const isUnlocked = Achievements.isUnlocked(ach.id);
      const isSecret   = !!ach.hidden && !isUnlocked;
      const stateClass = isUnlocked ? 'ach-unlocked' : (isSecret ? 'ach-secret' : 'ach-locked');

      const progress = (ach.stat && saveData.stats) ? (saveData.stats[ach.stat] || 0) : 0;
      const pct      = (ach.target && !isUnlocked) ? Math.min(1, progress / ach.target) : (isUnlocked ? 1 : 0);
      const hasProg  = !isSecret && ach.stat && ach.target;

      const card = document.createElement('div');
      card.className = 'ach-card ' + stateClass;

      let html;
      if (isSecret) {
        html =
          '<div class="ach-icon">🔒</div>' +
          '<div class="ach-body">' +
            '<div class="ach-title">SECRET ACHIEVEMENT</div>' +
            '<div class="ach-desc">Keep playing to reveal this secret.</div>' +
            (ach.reward > 0 ? '<div class="ach-reward">◈ ??? SHARDS</div>' : '') +
          '</div>';
      } else {
        const iconChar = isUnlocked ? '✦' : '○';
        const progHtml = hasProg
          ? '<div class="ach-prog-wrap">' +
              '<div class="ach-prog-label">' +
                (isUnlocked ? 'COMPLETED' : (progress + ' / ' + ach.target)) +
              '</div>' +
              '<div class="ach-prog-bar">' +
                '<div class="ach-prog-fill" style="width:' + Math.round(pct * 100) + '%"></div>' +
              '</div>' +
            '</div>'
          : '';
        const rewardHtml = ach.reward > 0
          ? '<div class="ach-reward">+' + ach.reward + ' ◈ SHARDS</div>'
          : '';
        const checkHtml = isUnlocked ? '<div class="ach-check">✓</div>' : '';

        html =
          '<div class="ach-icon">' + iconChar + '</div>' +
          '<div class="ach-body">' +
            '<div class="ach-title">' + ach.title + '</div>' +
            '<div class="ach-desc">' + ach.desc + '</div>' +
            rewardHtml +
            progHtml +
          '</div>' +
          checkHtml;
      }

      card.innerHTML = html;
      list.appendChild(card);
    }
  }
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
  buildLevelSelectGrid();
  Screens.show('levelselect');
});

document.getElementById('btn-continue').addEventListener('click', () => {
  game = new Game(saveData.highestUnlockedLevel);
  Screens.show('game');
});

document.getElementById('btn-upgrades').addEventListener('click', () => {
  buildPermUpgradeList();
  Screens.show('upgrades');
});

document.getElementById('btn-achievements').addEventListener('click', () => {
  buildAchievementList();
  Screens.show('achievements');
});

document.getElementById('btn-back-ach').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
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
  const lv = game ? game.level : 1;
  game = new Game(lv);
  Screens.show('game');
});

document.getElementById('btn-menu-pause').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-restart-go').addEventListener('click', () => {
  const lv = game ? game.level : 1;
  game = new Game(lv);
  Screens.show('game');
});

document.getElementById('btn-menu-go').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

// V6B: left = Bomb, right = 10x Multiplier, center = Recall
document.getElementById('btn-lightning').addEventListener('click', () => {
  if (game) game.useBomb();
});

document.getElementById('btn-bomb').addEventListener('click', () => {
  if (game) game.useMult();
});

document.getElementById('btn-recall').addEventListener('click', () => {
  if (game) game.recallBalls();
});

document.getElementById('btn-back-levelselect').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-next-level').addEventListener('click', () => {
  const lv = game ? game.level : 1;
  game = new Game(lv + 1);
  Screens.show('game');
});

document.getElementById('btn-goto-levelselect').addEventListener('click', () => {
  buildLevelSelectGrid();
  Screens.show('levelselect');
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
