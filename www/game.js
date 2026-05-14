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
const BALL_DRAW_RADIUS = 11;  // visual radius — reduced for cleaner multi-ball display (collision stays 9)
const BLOCK_ROWS_MAX = 12;  // rows visible at once
// V6D: computed dynamically in resizeCanvas() so the lose line sits near the launcher
let DANGER_ROW = 14;        // blocks reaching this row → game over
let WARNING_ROW = 13;       // one row above danger → red flash warning
const UPGRADE_INTERVAL = 5; // every N stages show upgrade choice
const BOSS_INTERVAL = 10;   // every N stages add boss block
const FIRE_DELAY = 90;      // ms between successive ball launches
const MAX_ORBS = 2;         // max ball-pickup orbs on board simultaneously
const ORB_SPAWN_CHANCE = 0.22; // probability of orb spawn per stage
const TOTAL_LEVELS = 100;   // V6D: total generated levels

// ---- Touch aiming constants ----
const TOUCH_SENSITIVITY    = 0.78;  // fraction of raw angle delta applied per touch event
const TOUCH_DEADZONE_PX    = 5;     // pixels — ignore touch moves smaller than this
const TOUCH_MAX_DELTA      = 0.13;  // radians — max angle change per touch event (~7.5°)
const TOUCH_MIN_AIM_DIST   = 110;   // pixels — enforce this min distance from cannon to avoid singularity

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
        if (!d.highestUnlockedLevel)          d.highestUnlockedLevel = 1;
        if (!d.completedLevels)               d.completedLevels = [];
        if (!d.levelBestScore)                d.levelBestScore = {};
        if (!('pendingMilestonePowers' in d)) d.pendingMilestonePowers = 0;
        // V8C: Migrate to persistent power inventory (applies pending bonus if old save)
        if (!('bombCount' in d)) {
          const pending = d.pendingMilestonePowers || 0;
          d.bombCount = 3 + pending;
          d.multiplier10xCount = 3 + pending;
          d.pendingMilestonePowers = 0;
        }
        if (!d.claimedMilestoneRewards) d.claimedMilestoneRewards = [];
        if (!d.audioPrefs) d.audioPrefs = { sfxEnabled: true, musicEnabled: false, volume: 0.7, hapticsEnabled: false };
        if (!('diamonds' in d)) d.diamonds = 0;
        if (!('noForcedAds' in d)) d.noForcedAds = false;
        return d;
      }
    } catch(e) {}
    return { bestStage: 0, totalShards: 0, permLevels: {}, stats: { ...DEFAULT_STATS }, achievements: {},
             highestUnlockedLevel: 1, completedLevels: [], levelBestScore: {}, pendingMilestonePowers: 0,
             bombCount: 3, multiplier10xCount: 3, claimedMilestoneRewards: [], diamonds: 0,
             audioPrefs: { sfxEnabled: true, musicEnabled: false, volume: 0.7, hapticsEnabled: false },
             noForcedAds: false };
  },
  save(data) {
    try { localStorage.setItem('neonSiegeSave', JSON.stringify(data)); } catch(e) {}
  }
};

let saveData = Save.load();

// V8C: Power inventory helpers — use these for future purchase / reward systems
function addPowerInventory(type, amount) {
  if (type === 'bomb') {
    saveData.bombCount = (saveData.bombCount || 0) + amount;
  } else if (type === 'mult') {
    saveData.multiplier10xCount = (saveData.multiplier10xCount || 0) + amount;
  }
  Save.save(saveData);
  if (game) {
    game.powBomb = saveData.bombCount;
    game.powMult = saveData.multiplier10xCount;
    game.updatePowerBar();
  }
}

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
      'position:fixed', 'top:calc(68px + env(safe-area-inset-top, 0px))', 'right:-320px', 'z-index:200',
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
    AudioManager.play('achieve');
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
// AUDIO MANAGER  (Web Audio API — lazy-init after first gesture)
// ============================================================

const AudioManager = (() => {
  let _ctx = null, _masterGain = null, _sfxGain = null, _musicGain = null;
  let _musicNodes = null, _noiseBuffer = null, _initialized = false;
  let _lastHitTime = 0, _lastPortalTime = 0;
  const HIT_THROTTLE_MS = 80, PORTAL_THROTTLE_MS = 200;

  function _prefs() {
    if (!saveData.audioPrefs)
      saveData.audioPrefs = { sfxEnabled: true, musicEnabled: false, volume: 0.7, hapticsEnabled: false };
    return saveData.audioPrefs;
  }

  function _osc(freq, type, gainVal, dur, delay) {
    if (!_ctx) return;
    const t = _ctx.currentTime + (delay || 0);
    const o = _ctx.createOscillator(), g = _ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(_sfxGain);
    o.start(t); o.stop(t + dur + 0.01);
  }

  function _sweep(f0, f1, type, gainVal, dur, delay) {
    if (!_ctx) return;
    const t = _ctx.currentTime + (delay || 0);
    const o = _ctx.createOscillator(), g = _ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(_sfxGain);
    o.start(t); o.stop(t + dur + 0.01);
  }

  function _noise(gainVal, dur, cutoff, delay) {
    if (!_ctx || !_noiseBuffer) return;
    const t = _ctx.currentTime + (delay || 0);
    const src = _ctx.createBufferSource();
    src.buffer = _noiseBuffer;
    const filt = _ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = cutoff;
    const g = _ctx.createGain();
    const d = Math.min(dur, 0.48);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    src.connect(filt); filt.connect(g); g.connect(_sfxGain);
    src.start(t); src.stop(t + d + 0.01);
  }

  const am = {
    init() {
      if (_initialized) { if (_ctx.state === 'suspended') _ctx.resume(); return; }
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _masterGain = _ctx.createGain();
        _masterGain.gain.value = _prefs().volume;
        _masterGain.connect(_ctx.destination);

        _sfxGain = _ctx.createGain();
        _sfxGain.gain.value = _prefs().sfxEnabled ? 1.0 : 0.0;
        _sfxGain.connect(_masterGain);

        _musicGain = _ctx.createGain();
        _musicGain.gain.value = 0;
        _musicGain.connect(_masterGain);

        // Pre-bake ~0.5 s of white noise — reuse across buffer-source nodes
        const len = Math.floor(_ctx.sampleRate * 0.5);
        _noiseBuffer = _ctx.createBuffer(1, len, _ctx.sampleRate);
        const d = _noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        _initialized = true;
        if (_prefs().musicEnabled) this._startMusic();
      } catch (e) { /* Web Audio unavailable — silent fail */ }
    },

    _startMusic() {
      if (!_initialized || _musicNodes) return;

      const BPM = 126;
      const STEP_MS = Math.round(60000 / BPM / 2); // 8th note ≈ 238 ms

      // A-minor pentatonic (two octaves): A3 C4 D4 E4 G4 A4 C5 D5
      const NOTES = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
      const PATTERN = [4, 6, 5, 7, 4, 5, 3, 6, 4, 7, 5, 6, 3, 4, 5, 3];

      let step = 0, alive = true, timerId = null;

      const playNote = (freq, wave, peak, dur) => {
        const t = _ctx.currentTime;
        const o = _ctx.createOscillator(), g = _ctx.createGain();
        o.type = wave; o.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(_musicGain);
        o.start(t); o.stop(t + dur + 0.02);
      };

      const tick = () => {
        if (!alive) return;
        playNote(NOTES[PATTERN[step % PATTERN.length]], 'triangle', 0.07, 0.20);
        if (step % 4 === 0) playNote(110, 'sine', 0.05, 0.28);
        step++;
        timerId = setTimeout(tick, STEP_MS);
      };

      _musicNodes = { stop() { alive = false; clearTimeout(timerId); } };
      _musicGain.gain.setValueAtTime(0, _ctx.currentTime);
      _musicGain.gain.linearRampToValueAtTime(0.7, _ctx.currentTime + 2.0);
      timerId = setTimeout(tick, 80);
    },

    _stopMusic() {
      if (!_musicNodes) return;
      _musicNodes.stop(); _musicNodes = null;
      const now = _ctx.currentTime;
      _musicGain.gain.setValueAtTime(_musicGain.gain.value, now);
      _musicGain.gain.linearRampToValueAtTime(0, now + 1.5);
    },

    setMusicEnabled(en) {
      if (!_initialized) return;
      if (en) this._startMusic();
      else this._stopMusic();
    },

    setSfxEnabled(en) { if (_initialized) _sfxGain.gain.value = en ? 1.0 : 0.0; },

    setVolume(v) { if (_initialized) _masterGain.gain.value = v; },

    play(type) {
      if (!_initialized || !_prefs().sfxEnabled) return;
      if (_ctx.state === 'suspended') _ctx.resume();
      const now = Date.now();
      switch (type) {
        case 'click':    _osc(880, 'sine', 0.16, 0.07); break;
        case 'shoot':    _sweep(280, 1100, 'sine', 0.20, 0.13); break;
        case 'hit':
          if (now - _lastHitTime < HIT_THROTTLE_MS) return;
          _lastHitTime = now;
          _osc(90, 'sawtooth', 0.15, 0.055); _noise(0.08, 0.055, 700);
          break;
        case 'destroy':
          _noise(0.32, 0.20, 2200); _osc(55, 'sawtooth', 0.22, 0.16);
          break;
        case 'crystal':
          _osc(1320, 'sine', 0.18, 0.20); _osc(1980, 'sine', 0.10, 0.18, 0.05);
          break;
        case 'bomb':
          _noise(0.48, 0.32, 350); _osc(38, 'sawtooth', 0.32, 0.28);
          break;
        case 'mult10':
          [880, 1100, 1320].forEach((f, i) => _osc(f, 'square', 0.13, 0.14, i * 0.065));
          break;
        case 'recall':   _sweep(900, 180, 'sine', 0.20, 0.20); break;
        case 'laser':    _sweep(2200, 350, 'sawtooth', 0.18, 0.14); break;
        case 'portal':
          if (now - _lastPortalTime < PORTAL_THROTTLE_MS) return;
          _lastPortalTime = now;
          [440, 660, 880, 1100].forEach((f, i) => _osc(f, 'sine', 0.11, 0.10, i * 0.04));
          break;
        case 'mystery':
          for (let i = 0; i < 4; i++)
            _osc(200 + Math.random() * 700, i % 2 ? 'sine' : 'triangle', 0.10, 0.14, i * 0.07);
          break;
        case 'achieve':
          [523, 659, 784, 1047].forEach((f, i) => _osc(f, 'triangle', 0.18, 0.28, i * 0.10));
          break;
        case 'levelComplete':
          [523, 659, 784, 1047, 1319].forEach((f, i) => _osc(f, 'sine', 0.20, 0.30, i * 0.09));
          break;
        case 'gameOver':
          [440, 370, 330, 220].forEach((f, i) => _osc(f, 'sawtooth', 0.18, 0.35, i * 0.18));
          break;
        case 'milestone':
          [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => _osc(f, 'triangle', 0.20, 0.22, i * 0.07));
          break;
      }
    },
  };
  return am;
})();

// ============================================================
// AD MANAGER  (Placeholder — no real SDK, no network calls)
// ============================================================

const AdManager = {
  canShowInterstitial() {
    return !(saveData.noForcedAds || false);
  },

  // Simulates a rewarded ad load + viewing delay, then calls onSuccess.
  // In a real release: replace body with actual rewarded ad SDK call.
  showRewardedPlaceholder(onSuccess) {
    const btn = document.getElementById('btn-watch-ad-continue');
    btn.textContent = '⏳ LOADING AD...';
    btn.disabled = true;
    setTimeout(() => { onSuccess(); }, 1500);
  },

  // Shows the interstitial placeholder modal; calls onContinue when player taps Continue.
  // In a real release: replace body with actual interstitial ad SDK call.
  showInterstitialPlaceholder(onContinue) {
    const modal = document.getElementById('interstitial-modal');
    modal.style.display = 'flex';
    document.getElementById('btn-interstitial-continue').onclick = () => {
      modal.style.display = 'none';
      onContinue();
    };
  },
};

// ============================================================
// CANVAS / RESIZE
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, blockW = 0, blockH = 0, blockPad = 0;
let launcherY = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const hud      = document.getElementById('hud');
  const powerBar = document.getElementById('power-bar');
  const aimRail  = document.getElementById('aim-rail-wrap');
  const availW = Math.min(parent.clientWidth, 480);
  // Measure actual heights so safe-area padding and aim rail are included
  const hudH  = hud      ? hud.offsetHeight      : 52;
  const barH  = powerBar ? powerBar.offsetHeight  : 80;
  const railH = aimRail  ? aimRail.offsetHeight   : 52;
  const availH = Math.max(parent.clientHeight - hudH - barH - railH, 200);

  W = availW;
  H = availH;
  // Scale canvas backing store by DPR for crisp rendering on retina / high-DPI screens
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  blockPad = 7;
  blockW = (W - blockPad * (COLS + 1)) / COLS;
  blockH = blockW * 0.76;
  launcherY = H - 44; // V8: 4px lower → danger row shifts down one step
  // V7: danger line sits one block-row lower — blocks can come even closer to the cannon
  const rowH = blockH + blockPad;
  DANGER_ROW  = Math.max(13, Math.floor((launcherY - blockPad) / rowH));
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
  NORMAL:      'normal',
  EXPLOSIVE:   'explosive',
  SHIELD:      'shield',
  CRYSTAL:     'crystal',
  BOSS:        'boss',
  TRIANGLE:    'triangle',
  INV_TRI:     'inv_tri',
  MYSTERY:     'mystery',
  // V6F: laser explosion blocks — fire beam on destruction (distinct from empty-space markers)
  LASER_H:     'laser_h_block',
  LASER_V:     'laser_v_block',
  LASER_CROSS: 'laser_cross_block',
};

const BLOCK_COLORS = {
  [BlockType.NORMAL]:      { fill: '#1a1050', stroke: '#6644ff', glow: '#6644ff' },
  [BlockType.EXPLOSIVE]:   { fill: '#2a0808', stroke: '#ff3300', glow: '#ff5500' },
  [BlockType.SHIELD]:      { fill: '#051525', stroke: '#00ccff', glow: '#00ccff' },
  [BlockType.CRYSTAL]:     { fill: '#120b28', stroke: '#cc00ff', glow: '#ee88ff' },
  [BlockType.BOSS]:        { fill: '#1a0005', stroke: '#ff0044', glow: '#ff0044' },
  [BlockType.TRIANGLE]:    { fill: '#081a10', stroke: '#00ff88', glow: '#00ff88' },
  [BlockType.INV_TRI]:     { fill: '#1a0c00', stroke: '#ffaa00', glow: '#ffcc44' },
  [BlockType.MYSTERY]:     { fill: '#0d0020', stroke: '#bb44ff', glow: '#cc66ff' },
  // V6F: laser blocks — solid blocks that fire a beam when destroyed
  [BlockType.LASER_H]:     { fill: '#200820', stroke: '#ff44cc', glow: '#ff44cc' },
  [BlockType.LASER_V]:     { fill: '#001828', stroke: '#00ccff', glow: '#00f5ff' },
  [BlockType.LASER_CROSS]: { fill: '#1e1e00', stroke: '#ffee00', glow: '#ffee44' },
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
      AudioManager.play('hit');
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
    AudioManager.play('hit');
    return false;
  }

  onDestroy(game) {
    game.onBlockDestroyed(this);
    if (this.type === BlockType.CRYSTAL) AudioManager.play('crystal');
    else AudioManager.play('destroy');
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
    // V6F: laser explosion blocks — clear entire row/col on destruction
    if (this.type === BlockType.LASER_H) {
      game._clearRow(this.row);
      laserBeams.push({ x1: 0, y1: this.cy, x2: W, y2: this.cy, color: '#ff44cc', life: 16 });
      floatingTexts.push(new FloatingText(this.cx, this.cy - 26, '— ROW CLEAR!', '#ff44cc'));
    }
    if (this.type === BlockType.LASER_V) {
      game._clearCol(this.col);
      laserBeams.push({ x1: this.cx, y1: 0, x2: this.cx, y2: H, color: '#00f5ff', life: 16 });
      floatingTexts.push(new FloatingText(this.cx, this.cy - 26, '| COL CLEAR!', '#00f5ff'));
    }
    if (this.type === BlockType.LASER_CROSS) {
      game._clearRow(this.row);
      game._clearCol(this.col);
      laserBeams.push({ x1: 0, y1: this.cy, x2: W, y2: this.cy, color: '#ffee00', life: 16 });
      laserBeams.push({ x1: this.cx, y1: 0, x2: this.cx, y2: H, color: '#ffee00', life: 16 });
      floatingTexts.push(new FloatingText(this.cx, this.cy - 26, '+ CROSS CLEAR!', '#ffee00'));
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

    // Shape path — triangles: square tile with one bevel cut; squares: sharp roundRect
    const _tCut = Math.min(blockW, blockH) * 0.52;
    if (this.type === BlockType.TRIANGLE) {
      // Square tile with top-right corner cut (ramp/wedge look)
      ctx.beginPath();
      ctx.moveTo(x + 2,                   y + 2);
      ctx.lineTo(x + blockW - 2 - _tCut,  y + 2);
      ctx.lineTo(x + blockW - 2,           y + 2 + _tCut);
      ctx.lineTo(x + blockW - 2,           y + blockH - 2);
      ctx.lineTo(x + 2,                   y + blockH - 2);
      ctx.closePath();
    } else if (this.type === BlockType.INV_TRI) {
      // Square tile with bottom-left corner cut (opposite ramp look)
      ctx.beginPath();
      ctx.moveTo(x + 2,                   y + 2);
      ctx.lineTo(x + blockW - 2,           y + 2);
      ctx.lineTo(x + blockW - 2,           y + blockH - 2);
      ctx.lineTo(x + 2 + _tCut,           y + blockH - 2);
      ctx.lineTo(x + 2,                   y + blockH - 2 - _tCut);
      ctx.closePath();
    } else {
      roundRect(ctx, x, y, blockW, blockH, 3);
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
      roundRect(ctx, x - 3, y - 3, blockW + 6, blockH + 6, 6);
      ctx.stroke();
    }

    // Frozen overlay
    if (this.frozen) {
      ctx.save();
      ctx.shadowColor = '#00ccff';
      ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#00ccff';
      const _fCut = Math.min(blockW, blockH) * 0.52;
      const _drawTriPath = () => {
        if (this.type === BlockType.TRIANGLE) {
          ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+blockW-2-_fCut,y+2); ctx.lineTo(x+blockW-2,y+2+_fCut); ctx.lineTo(x+blockW-2,y+blockH-2); ctx.lineTo(x+2,y+blockH-2); ctx.closePath();
        } else if (this.type === BlockType.INV_TRI) {
          ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+blockW-2,y+2); ctx.lineTo(x+blockW-2,y+blockH-2); ctx.lineTo(x+2+_fCut,y+blockH-2); ctx.lineTo(x+2,y+blockH-2-_fCut); ctx.closePath();
        } else {
          roundRect(ctx, x, y, blockW, blockH, 3);
        }
      };
      _drawTriPath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,200,255,0.75)';
      ctx.lineWidth = 1.5;
      _drawTriPath();
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
    } else if (this.type === BlockType.LASER_H || this.type === BlockType.LASER_V || this.type === BlockType.LASER_CROSS) {
      const sym = this.type === BlockType.LASER_H ? '—' : this.type === BlockType.LASER_V ? '|' : '+';
      const symColor = this.type === BlockType.LASER_H ? '#ff44cc' : this.type === BlockType.LASER_V ? '#00f5ff' : '#ffee00';
      ctx.font = `bold ${blockH > 28 ? 16 : 13}px 'Courier New'`;
      ctx.fillStyle = flash ? '#fff' : symColor;
      ctx.shadowColor = symColor;
      ctx.shadowBlur = 10;
      ctx.fillText(sym, x + blockW / 2, y + blockH / 2 - 4);
      ctx.font = `${blockH > 28 ? 9 : 8}px 'Courier New'`;
      ctx.fillStyle = flash ? '#fff' : 'rgba(255,255,255,0.6)';
      ctx.shadowBlur = 2;
      ctx.fillText(this.hp, x + blockW / 2, y + blockH / 2 + 7);
    } else {
      const ratio = this.hp / this.maxHp;
      ctx.font = `bold ${blockH > 28 ? 15 : 10}px 'Courier New'`;
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
    this.usedThisShot = false; // set true when any ball teleports; removed at turn end
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
    this.used  = false; // V7: reward given once; stays visible (dimmed) until turn end
    this.pulse = Math.random() * Math.PI * 2;
  }

  get x() { return blockPad + this.col * (blockW + blockPad) + blockW / 2; }
  get y() { return blockPad + this.row * (blockH + blockPad) + blockH / 2; }
  get radius() { return Math.min(blockW, blockH) * 0.30; }

  collect(game) {
    if (!this.alive || this.used) return;
    // V7: mark used so reward fires once, but orb stays visible until shot ends
    this.used = true;
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
    this.pulse += this.used ? 0.02 : 0.075;
    const r = this.radius;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);
    // V7: dim the orb once used — reward already granted, but keep it visible until turn ends
    const alpha = this.used ? 0.28 : 1.0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = this.used ? 4 : 10 + glow * 14;

    // Outer ring — static when used
    ctx.strokeStyle = this.used
      ? 'rgba(0,245,255,0.25)'
      : `rgba(0,245,255,${0.4 + glow * 0.45})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r + (this.used ? 2 : 3 + glow * 3), 0, Math.PI * 2);
    ctx.stroke();

    // Orb body gradient
    const grad = ctx.createRadialGradient(
      this.x - r * 0.3, this.y - r * 0.35, 1,
      this.x, this.y, r
    );
    grad.addColorStop(0, this.used ? '#446688' : '#ffffff');
    grad.addColorStop(0.35, this.used ? '#004466' : '#00f5ff');
    grad.addColorStop(1, '#220044');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Label: "✓" when used, "+1" when fresh
    ctx.shadowBlur = 0;
    ctx.fillStyle = this.used ? 'rgba(0,200,200,0.7)' : '#ffffff';
    ctx.font = `bold ${Math.max(9, Math.floor(r * 0.85))}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.used ? '✓' : '+1', this.x, this.y);
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
  // V7B: one-shot markers (ball_boost, shuffle) draw dimmed once triggeredOnce — shows used state mid-shot
  draw(ctx) {
    if (!this.alive) return;
    const isSpent = this.triggeredOnce && (this.type === 'ball_boost' || this.type === 'shuffle');
    this.pulse += isSpent ? 0.02 : 0.07; // slow pulse when spent
    const mc = MARKER_COLORS[this.type];
    if (!mc) return;
    const glow = 0.5 + 0.5 * Math.sin(this.pulse);
    const af = isSpent ? 0.28 : 1.0; // alpha factor

    ctx.save();

    // Very faint ghost background
    ctx.globalAlpha = (0.10 + glow * 0.06) * af;
    ctx.fillStyle = mc.fill;
    roundRect(ctx, this.x + 2, this.y + 2, blockW - 4, blockH - 4, 6);
    ctx.fill();

    // Animated dashed neon border ring
    ctx.globalAlpha = af;
    ctx.shadowColor = mc.glow;
    ctx.shadowBlur = isSpent ? 3 : 8 + glow * 14;
    ctx.strokeStyle = hexToRgba(mc.stroke, (0.28 + glow * 0.42) * af);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    roundRect(ctx, this.x + 3, this.y + 3, blockW - 6, blockH - 6, 5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Symbol — show '✓' for spent one-shot markers, original label otherwise
    ctx.shadowBlur = isSpent ? 2 : 6 + glow * 12;
    ctx.fillStyle = isSpent ? 'rgba(180,180,180,0.55)' : mc.stroke;
    ctx.globalAlpha = isSpent ? 0.40 : (0.80 + glow * 0.20);
    ctx.font = `bold ${blockH > 28 ? 19 : 15}px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSpent ? '✓' : mc.label, this.cx, this.cy);

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
    this.returning = false;      // true while sliding along bottom toward cannon
    this.collectTargetX = null;  // X to slide toward during return
    this.returningFrames = 0;    // safety counter — force-collect after timeout
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

    // Bottom boundary — begin return animation toward cannon
    if (!this.returning && this.y + BALL_RADIUS >= H) {
      this.returning = true;
      this.y = H - BALL_RADIUS;
      this.vx = 0;
      this.vy = 0;
    }
    if (this.returning) {
      this.returningFrames++;
      if (this.collectTargetX !== null) {
        const dx = this.collectTargetX - this.x;
        if (Math.abs(dx) < 2) {
          this.x = this.collectTargetX;
          this.active = false; // absorbed into cannon
        } else {
          // No-overshoot easing: step is always <= |dx| so ball never oscillates past target
          const step = Math.min(Math.abs(dx), Math.max(9, Math.abs(dx) * 0.3));
          this.x += Math.sign(dx) * step;
        }
      }
      // Safety: force-collect after 4 seconds (240 frames) so turn never soft-locks
      if (this.returningFrames > 240) this.active = false;
      return;
    }

    // Block collision
    for (const block of game.blocks) {
      if (!block.alive) continue;
      if (this.collidesBlock(block)) {
        this.resolveBlockCollision(block, game);
      }
    }

    // Orb collision — collect on touch (V7: skip already-used orbs)
    for (const orb of game.orbs) {
      if (!orb.alive || orb.used) continue;
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
            pp.usedThisShot = true; // mark for removal at turn end
            spawnParticles(pp.ax, pp.ay, '#00f5ff', 7, { speed: 3, decay: 0.06, size: 2 });
            spawnParticles(pp.bx, pp.by, '#ff44cc', 7, { speed: 3, decay: 0.06, size: 2 });
            AudioManager.play('portal');
            if (game.hasRelic && game.hasRelic('void_compass')) game.voidCompassReady = true;
            break;
          }
          const dxb = this.x - pp.bx, dyb = this.y - pp.by;
          if (dxb * dxb + dyb * dyb < r * r) {
            this.x = pp.ax; this.y = pp.ay;
            this.portalCooldown = 22;
            this.portalJustUsed = true;
            pp.usedThisShot = true; // mark for removal at turn end
            spawnParticles(pp.bx, pp.by, '#ff44cc', 7, { speed: 3, decay: 0.06, size: 2 });
            spawnParticles(pp.ax, pp.ay, '#00f5ff', 7, { speed: 3, decay: 0.06, size: 2 });
            AudioManager.play('portal');
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

    // Returning: small glowing orb sliding along the bottom toward cannon
    if (this.returning) {
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#00f5ff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, BALL_DRAW_RADIUS * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

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
    this.angle       = -Math.PI / 2; // current displayed angle (lerped)
    this.targetAngle = -Math.PI / 2; // V7B: pointer sets this; draw follows smoothly
    this.minAngle = -Math.PI + 0.18;
    this.maxAngle = -0.18;
    this.railControlled = false; // true while the aim rail is being dragged
  }

  setAngleFromPoint(px, py, isTouch = false) {
    const dx = px - this.x;
    const dy = py - launcherY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Enforce minimum effective distance — prevents extreme angle swings when
    // the finger is very close to the cannon vertically (atan2 singularity zone).
    let aDx = dx, aDy = dy;
    // If touch is at or below cannon level, project upward so aim is still meaningful.
    // This makes the cannon area forgiving — touching on/below cannon aims based on
    // horizontal finger position rather than snapping to a clamped extreme.
    if (aDy > -20) {
      aDy = -TOUCH_MIN_AIM_DIST;
    } else if (dist > 0.5 && dist < TOUCH_MIN_AIM_DIST) {
      const s = TOUCH_MIN_AIM_DIST / dist;
      aDx = dx * s; aDy = dy * s;
    }

    let a = Math.atan2(aDy, aDx);
    a = clamp(a, this.minAngle, this.maxAngle);

    if (isTouch) {
      // Apply sensitivity: limit per-event delta so fast swipes don't jump instantly.
      const rawDelta = a - this.targetAngle;
      const clamped  = clamp(rawDelta, -TOUCH_MAX_DELTA, TOUCH_MAX_DELTA);
      this.targetAngle = clamp(
        this.targetAngle + clamped * TOUCH_SENSITIVITY,
        this.minAngle, this.maxAngle
      );
    } else {
      this.targetAngle = a;
    }
  }

  // V7B: smooth follow — called every frame; gives mobile-shooter "springy" feel
  update() {
    const diff = this.targetAngle - this.angle;
    if (Math.abs(diff) < 0.0015) {
      this.angle = this.targetAngle; // snap when negligibly close (prevents jitter)
    } else {
      // Rail: near-instant lerp (0.90) so knob tracks finger with no perceptible lag.
      // Canvas drag: springy feel (0.22).
      const t = this.railControlled ? 0.90 : 0.22;
      this.angle = lerp(this.angle, this.targetAngle, t);
    }
  }

  // V7B: instant snap just before firing — shot always goes exactly where aimed
  snapToTarget() {
    this.angle = this.targetAngle;
  }

  draw(ctx) {
    const lx = this.x, ly = launcherY;
    const len = 28;
    const ex = lx + Math.cos(this.angle) * len;
    const ey = ly + Math.sin(this.angle) * len;

    ctx.save();
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 18;

    // Base platform — stays level, acts as the fixed mount
    const bGrad = ctx.createLinearGradient(lx - 24, ly, lx + 24, ly);
    bGrad.addColorStop(0, '#001e3a');
    bGrad.addColorStop(0.5, '#0077cc');
    bGrad.addColorStop(1, '#001e3a');
    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.ellipse(lx, ly + 7, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 4;
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Turret body — rotates visibly with aim angle (the tilt effect)
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(this.angle);
    const tGrad = ctx.createLinearGradient(0, -6, 0, 6);
    tGrad.addColorStop(0, '#00bbff');
    tGrad.addColorStop(1, '#002255');
    ctx.fillStyle = tGrad;
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 10;
    roundRect(ctx, 2, -5, 26, 10, 4);
    ctx.fill();
    ctx.strokeStyle = '#00ddff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Barrel line — glowing cyan
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Tip glow dot
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
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

    // V8C: Powers loaded from persistent inventory — never reset per level/restart
    this.powBomb = saveData.bombCount;
    this.powMult = saveData.multiplier10xCount;
    this.ballMultActive = false;
    this.lastShotAngle = null; // captured at fire time for mid-shot ×10 burst
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

    // Ad state — reset each attempt so retry always gets a fresh rewarded continue slot
    this.rewardedContinueUsed = false;

    // Initialize level layout (row 0 empty; pre-populated rows for higher levels)
    this._initLevelLayout();

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
      // V8: early levels very sparse (70% skip ≈ 2 blocks/row); later levels fill up (28% skip ≈ 5 blocks)
      skipChance:    isMilestone ? 0.12 : Math.max(0.28, 0.70 - stage * 0.018),
      triChance:     stage >= 5  ? Math.min(0.32, (stage - 4) * 0.04)  : 0,   // triangle blocks
      mysteryChance: stage >= 4  ? Math.min(0.07, (stage - 3) * 0.010) : 0,   // mystery blocks
      markerChance:  stage >= 2  ? Math.min(0.30, (stage - 1) * 0.04)  : 0,   // markers
      laserChance:   stage >= 5  ? Math.min(0.08, (stage - 4) * 0.012) : 0,   // laser explosion blocks
      isMilestone,
    };
  }

  blockHpForStage(stage) {
    const bal       = this.stageBalance(stage);
    const relicMult = this.hasRelic('siege_engine') ? 1.12 : 1.0;
    return Math.max(1, Math.ceil(bal.blockHp * bal.milestoneMult * relicMult));
  }

  _initLevelLayout() {
    this.spawnStageBlocks(); // spawn first wave (always at row 1 — row 0 stays empty)
    // Pre-populate extra rows for higher levels so the board feels full
    const extraRows = Math.min(Math.floor((this.level - 1) / 8), 3);
    for (let r = 0; r < extraRows; r++) {
      this._spawnRowAtPosition(r + 2);
    }
  }

  _spawnRowAtPosition(targetRow) {
    if (this.wavesSpawned >= this.maxWaves) return;
    const stage = this.level;
    const bal   = this.stageBalance(stage);
    const hp    = this.blockHpForStage(stage);
    const numGaps = stage <= 8 ? 2 : 1;
    const gapCols = new Set();
    while (gapCols.size < numGaps) gapCols.add(randInt(0, COLS - 1));
    for (let col = 0; col < COLS; col++) {
      if (gapCols.has(col)) continue;
      const rnd = Math.random();
      let type = BlockType.NORMAL;
      if (bal.laserChance > 0 && Math.random() < bal.laserChance) {
        const pick = Math.random();
        type = pick < 0.4 ? BlockType.LASER_H : pick < 0.8 ? BlockType.LASER_V : BlockType.LASER_CROSS;
      } else if (bal.mysteryChance > 0 && Math.random() < bal.mysteryChance) {
        type = BlockType.MYSTERY;
      } else if (bal.triChance > 0 && Math.random() < bal.triChance) {
        type = Math.random() < 0.5 ? BlockType.TRIANGLE : BlockType.INV_TRI;
      } else if (rnd < 0.05) {
        type = BlockType.EXPLOSIVE;
      } else if (rnd < 0.10) {
        type = BlockType.SHIELD;
      } else if (rnd < 0.15) {
        type = BlockType.CRYSTAL;
      }
      if (type === BlockType.NORMAL && Math.random() < bal.skipChance) continue;
      this.blocks.push(new Block(col, targetRow, type, hp));
    }
    this.wavesSpawned++;
  }

  spawnStageBlocks() {
    if (this.wavesSpawned >= this.maxWaves) return; // V6D: wave limit
    const stage = this.level;                        // V6D: difficulty from level
    const bal   = this.stageBalance(stage);
    const hp    = this.blockHpForStage(stage);
    const isBossThisWave = bal.isMilestone && this.wavesSpawned === 0; // boss only on wave 0
    const triChance     = bal.triChance;
    const mysteryChance = bal.mysteryChance;
    const laserChance   = bal.laserChance;

    // Generate one row of blocks at the top
    const numGaps = stage <= 8 ? 2 : 1;
    const gapCols = new Set();
    while (gapCols.size < numGaps) gapCols.add(randInt(0, COLS - 1));

    for (let col = 0; col < COLS; col++) {
      if (gapCols.has(col) && !isBossThisWave) continue; // corridor gap
      const rnd = Math.random();
      let type = BlockType.NORMAL;

      if (isBossThisWave && col === Math.floor(COLS / 2)) {
        type = BlockType.BOSS;
      } else if (mysteryChance > 0 && Math.random() < mysteryChance) {
        type = BlockType.MYSTERY;
      } else if (triChance > 0 && Math.random() < triChance) {
        type = Math.random() < 0.5 ? BlockType.TRIANGLE : BlockType.INV_TRI;
      } else if (laserChance > 0 && Math.random() < laserChance) {
        const pick = Math.random();
        type = pick < 0.4 ? BlockType.LASER_H : pick < 0.8 ? BlockType.LASER_V : BlockType.LASER_CROSS;
      } else if (rnd < 0.05) {
        type = BlockType.EXPLOSIVE;
      } else if (rnd < 0.10) {
        type = BlockType.SHIELD;
      } else if (rnd < 0.15) {
        type = BlockType.CRYSTAL;
      }

      // V6A: Skip chance from stageBalance (fewer gaps on milestone stages)
      if (type === BlockType.NORMAL && Math.random() < bal.skipChance) continue;

      const blockHp = type === BlockType.BOSS ? hp * 4 : hp;
      const newBlock = new Block(col, 1, type, blockHp); // row 1 — row 0 always stays empty
      if (type === BlockType.BOSS) {
        const behaviors = ['shield_core', 'gravity_core', 'summoner_core', 'corrupt_core', 'laser_core'];
        newBlock.bossType = behaviors[(Math.floor(stage / BOSS_INTERVAL) - 1) % behaviors.length];
      }
      this.blocks.push(newBlock);
    }

    // Collect columns occupied at row 1
    const takenCols = () => [
      ...this.blocks.filter(b => b.row === 1).map(b => b.col),
      ...this.orbs.filter(o => o.row === 1).map(o => o.col),
      ...this.markers.filter(m => m.row === 1).map(m => m.col),
    ];

    // Spawn a ball-orb in a free column if conditions are met
    const activeOrbs = this.orbs.filter(o => o.alive).length;
    const needOrb = this.ballCount < 3 && stage <= 10;
    if (activeOrbs < MAX_ORBS && (needOrb || Math.random() < ORB_SPAWN_CHANCE)) {
      const freeCols = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols().includes(c));
      if (freeCols.length > 0) {
        this.orbs.push(new BallOrb(randItem(freeCols), 1)); // row 1, not row 0
      }
    }

    // Spawn a marker in a free column (stage 2+) — V6A: uses bal.markerChance
    const markerChance = bal.markerChance;
    if (markerChance > 0 && Math.random() < markerChance) {
      const freeCols = Array.from({ length: COLS }, (_, i) => i).filter(c => !takenCols().includes(c));
      if (freeCols.length > 0) {
        this.markers.push(new Marker(randItem(freeCols), 1, this._pickMarkerType(stage))); // row 1, not row 0
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
      const rowA = randInt(1, 3);
      const rowB = randItem([1, 2, 3].filter(r => r !== rowA));
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
    this.launcher.snapToTarget(); // V7B: commit exact aim before balls fly
    AudioManager.play('shoot');
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
    this.lastShotAngle = angle; // stored for mid-shot ×10 burst
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
    AudioManager.play('mystery');
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
          AudioManager.play('laser');
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
          AudioManager.play('laser');
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
          AudioManager.play('laser');
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

  // Row/col clear: instantly destroys all blocks (triggered by laser explosion blocks on death)
  // Safe against chain loops: b.alive = false before onDestroy, so re-entrant calls skip dead blocks
  _clearRow(row) {
    this.turnLaserUsed = true;
    const targets = this.blocks.filter(b => b.alive && b.row === row);
    for (const b of targets) {
      if (!b.alive) continue; // guard against chain-clear double-processing
      b.shieldActive = false;  // bypass shield protection
      b.hp = 0;
      b.alive = false;
      b.onDestroy(this);       // handles scoring, special effects, and possible chain clears
    }
    screenShake(6, 4);
  }

  _clearCol(col) {
    this.turnLaserUsed = true;
    const targets = this.blocks.filter(b => b.alive && b.col === col);
    for (const b of targets) {
      if (!b.alive) continue;
      b.shieldActive = false;
      b.hp = 0;
      b.alive = false;
      b.onDestroy(this);
    }
    screenShake(6, 4);
  }

  // ---- Powers ----

  // V6B: Bomb — damages the bottom 3 block rows (closest to danger line)
  useBomb() {
    if (this.phase !== GamePhase.IDLE && this.phase !== GamePhase.SHOOTING) return;
    if (this.powBomb <= 0) return;
    this.powBomb--;
    saveData.bombCount = this.powBomb; // V8C: persist spend immediately
    Save.save(saveData);
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
      AudioManager.play('bomb');
    }
  }

  // V6B: 10x Ball Multiplier — arms next shot (IDLE) or fires extra burst immediately (SHOOTING)
  useMult() {
    if (this.powMult <= 0) return;
    if (this.phase === GamePhase.IDLE && !this.ballMultActive) {
      this.powMult--;
      saveData.multiplier10xCount = this.powMult; // V8C: persist spend immediately
      Save.save(saveData);
      this.turnPowerUsed = true;
      this.ballMultActive = true;
      this.updatePowerBar();
      floatingTexts.push(new FloatingText(W / 2, H * 0.43, '×10 READY!', '#ffee00'));
      AudioManager.play('mult10');
    } else if (this.phase === GamePhase.SHOOTING && this.lastShotAngle !== null) {
      this.powMult--;
      saveData.multiplier10xCount = this.powMult; // V8C: persist spend immediately
      Save.save(saveData);
      this.turnPowerUsed = true;
      this.updatePowerBar();
      const totalExtra = Math.min(this.ballCount * 10, 300);
      this.pendingBalls += totalExtra;
      const currentShotId = this.shotId;
      const angle = this.lastShotAngle;
      const lx = this.launcher.x, ly = launcherY, spd = BALL_SPEED;
      const piercing = this.hasUpgrade('piercing') ? 3 : 0;
      let launched = 0;
      const launchNext = () => {
        if (launched >= totalExtra || this.shotId !== currentShotId) return;
        this.balls.push(new Ball(lx, ly, Math.cos(angle) * spd, Math.sin(angle) * spd, { piercingLeft: piercing }));
        launched++;
        this.pendingBalls--;
        if (launched < totalExtra) setTimeout(launchNext, Math.max(8, FIRE_DELAY >> 2));
      };
      launchNext();
      floatingTexts.push(new FloatingText(W / 2, H * 0.4, '×10 BURST!', '#ffee00'));
      screenShake(4, 3);
    }
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
    AudioManager.play('recall');
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
    this.orbs    = this.orbs.filter(o => o.alive && !o.used); // V7: remove used orbs at turn end
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

    // V4B: Descend anomalies; cull those too close to launcher or used this shot
    for (const bh of this.blackHoles) bh.descend();
    for (const pp of this.portals) pp.descend();
    this.blackHoles = this.blackHoles.filter(bh => bh.alive && bh.y < launcherY - 20);
    // V8B: used portals are removed at turn end; untouched portals persist and descend
    this.portals = this.portals.filter(pp => pp.alive && !pp.usedThisShot && pp.ay < launcherY - 20 && pp.by < launcherY - 20);

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
      this.powBomb++;
      this.powMult++;
      saveData.bombCount = this.powBomb; // V8C: persist boss-defeat bonus
      saveData.multiplier10xCount = this.powMult;
      Save.save(saveData);
      this.updatePowerBar();
      floatingTexts.push(new FloatingText(W / 2, H * 0.30, '★ MILESTONE CLEARED! ★', '#ffee00'));
      floatingTexts.push(new FloatingText(W / 2, H * 0.38, '+1 BOMB  +1 ×10  +SHARDS', '#00ff88'));
      screenShake(10, 6);
      AudioManager.play('milestone');
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

    // Rewarded continue: 1 use per attempt — hide if already used this attempt
    const adBtn = document.getElementById('btn-watch-ad-continue');
    adBtn.style.display = this.rewardedContinueUsed ? 'none' : 'block';
    adBtn.textContent = '📺 WATCH AD TO CONTINUE';
    adBtn.disabled = false;

    AudioManager.play('gameOver');
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
    if (isMilestone && !saveData.claimedMilestoneRewards.includes(lv)) {
      // V8C: Grant once per milestone level — persisted immediately
      saveData.claimedMilestoneRewards.push(lv);
      saveData.bombCount++;
      saveData.multiplier10xCount++;
      saveData.diamonds = (saveData.diamonds || 0) + 10;
      Save.save(saveData);
      // Sync in-memory counts for correct button display if player stays in session
      this.powBomb = saveData.bombCount;
      this.powMult = saveData.multiplier10xCount;
      this.updatePowerBar();
      document.getElementById('lc-bonus').textContent = '★ MILESTONE REWARD: +1 BOMB  +1 ×10  +10 💎';
    } else {
      document.getElementById('lc-bonus').textContent =
        (isMilestone && saveData.claimedMilestoneRewards.includes(lv)) ? '(Milestone already claimed)' : '';
    }
    AudioManager.play('levelComplete');
    Screens.show('levelcomplete');
  }

  // ---- HUD ----

  updateHUD() {
    document.getElementById('hud-stage').textContent = this.level;
    document.getElementById('hud-score').textContent = this.score;
    document.getElementById('hud-shards').textContent = this.shards;
    document.getElementById('hud-diamonds').textContent = saveData.diamonds;
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
    const activePhase = this.phase === GamePhase.IDLE || this.phase === GamePhase.SHOOTING;
    document.getElementById('pow-lightning-count').textContent = this.powBomb;
    document.getElementById('pow-bomb-count').textContent = this.ballMultActive ? '✓' : this.powMult;
    document.getElementById('btn-lightning').disabled = (this.powBomb <= 0 || !activePhase);
    const multBtn = document.getElementById('btn-bomb');
    multBtn.disabled = (this.powMult <= 0 || !activePhase || (this.phase === GamePhase.IDLE && this.ballMultActive));
    multBtn.classList.toggle('armed', this.ballMultActive);
    const recallBtn = document.getElementById('btn-recall');
    if (recallBtn) recallBtn.disabled = (this.phase !== GamePhase.SHOOTING);
  }

  // ---- Update loop ----

  update() {
    // V7B: smooth launcher angle every frame so aiming feels responsive, not snapped
    if (this.launcher) this.launcher.update();

    if (this.phase !== GamePhase.SHOOTING) return;

    for (const ball of this.balls) {
      const wasReturning = ball.returning;
      ball.update(this);
      // Capture X of the FIRST ball to hit the bottom — used for launcher snap
      if (!wasReturning && ball.returning && this.firstReturnX === null) {
        this.firstReturnX = ball.x;
      }
    }
    // Assign collect target to all returning balls.
    // firstReturnX is set the frame the first ball lands; fall back to cannon X if somehow still null.
    const _retTarget = this.firstReturnX !== null
      ? clamp(this.firstReturnX, BALL_RADIUS + 12, W - BALL_RADIUS - 12)
      : (this.launcher ? clamp(this.launcher.x, BALL_RADIUS + 12, W - BALL_RADIUS - 12) : W / 2);
    for (const ball of this.balls) {
      if (ball.returning && ball.collectTargetX === null) {
        ball.collectTargetX = _retTarget;
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
    // Pin the base transform to DPR scale every frame so retina backing store is used correctly
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
      // V8: "BALLS ×N" label just below cannon tip — readable on mobile
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = 0.90;
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#00f5ff';
      ctx.font = "bold 12px 'Courier New'";
      ctx.fillText('BALLS \xd7' + this.ballCount, this.launcher.x, launcherY + 22);
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

  // ---- Aim guide — dotted trajectory with wall-bounce prediction ----

  drawAimGuide(ctx) {
    const lx = this.launcher.x, ly = launcherY;
    const angle = this.launcher.angle;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const barrelLen = 28;
    const startX = lx + dx * barrelLen;
    const startY = ly + dy * barrelLen;

    const totalLen   = 280;  // total guide reach in px
    const DOT_SPACE  = 13;   // distance between dot centres
    const DOT_R1     = 2.4;  // primary segment dot radius
    const DOT_R2     = DOT_R1; // secondary segment same size as primary for full readability

    // ---- helper: draw dots along a segment ----
    const drawDots = (x1, y1, x2, y2, alpha, radius) => {
      const segDx = x2 - x1, segDy = y2 - y1;
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      if (segLen < 1) return;
      const nx = segDx / segLen, ny = segDy / segLen;
      const count = Math.floor(segLen / DOT_SPACE);
      ctx.save();
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur  = 7;
      ctx.fillStyle   = `rgba(0,245,255,${alpha})`;
      for (let i = 0; i <= count; i++) {
        const t  = i * DOT_SPACE;
        const fx = alpha - (alpha * 0.35 * (t / (segLen || 1))); // gentle fade — keeps both segments readable
        ctx.globalAlpha = Math.max(0.06, fx);
        ctx.beginPath();
        ctx.arc(x1 + nx * t, y1 + ny * t, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // ---- Find first block hit along the ray ----
    const rayHitsBlock = (rx, ry, rvx, rvy, maxDist) => {
      // Step along the ray in coarse steps and test block bounding boxes
      const STEP = 6;
      const steps = Math.floor(maxDist / STEP);
      for (let i = 1; i <= steps; i++) {
        const cx = rx + rvx * i * STEP;
        const cy = ry + rvy * i * STEP;
        for (const b of this.blocks) {
          if (!b.alive) continue;
          if (cx >= b.x - BALL_RADIUS && cx <= b.x + b.w + BALL_RADIUS &&
              cy >= b.y - BALL_RADIUS && cy <= b.y + b.h + BALL_RADIUS) {
            return i * STEP; // distance to hit
          }
        }
      }
      return maxDist + 1; // no hit
    };

    // ---- Compute wall bounce ----
    let tWall = totalLen + 1;
    if (dx < -0.001) tWall = (BALL_RADIUS - startX) / dx;
    else if (dx > 0.001) tWall = (W - BALL_RADIUS - startX) / dx;
    if (tWall < 0) tWall = totalLen + 1;

    const distToWall = tWall < totalLen ? tWall : totalLen + 1;

    ctx.save();
    ctx.globalAlpha = 1;

    if (distToWall < totalLen) {
      // Segment 1: cannon tip → wall
      const blockHit1 = rayHitsBlock(startX, startY, dx, dy, distToWall);
      const seg1Len   = Math.min(distToWall, blockHit1);
      const wx = startX + dx * seg1Len;
      const wy = startY + dy * seg1Len;
      drawDots(startX, startY, wx, wy, 0.52, DOT_R1);

      // Wall bounce indicator (bright dot)
      if (blockHit1 >= distToWall) {
        ctx.save();
        ctx.fillStyle  = 'rgba(0,245,255,0.70)';
        ctx.shadowColor = '#00f5ff';
        ctx.shadowBlur  = 14;
        ctx.beginPath();
        ctx.arc(wx, wy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Segment 2: reflected path (fainter)
        const rem   = totalLen - distToWall;
        const rvx   = -dx; // horizontal reflection
        const ex2   = wx + rvx * rem;
        const ey2   = wy + dy * rem;
        const blockHit2 = rayHitsBlock(wx, wy, rvx, dy, rem);
        const seg2End = Math.min(rem, blockHit2);
        drawDots(wx, wy, wx + rvx * seg2End, wy + dy * seg2End, 0.50, DOT_R2);
      }
    } else {
      // No wall hit — straight dotted guide
      const blockHit = rayHitsBlock(startX, startY, dx, dy, totalLen);
      const endLen   = Math.min(totalLen, blockHit);
      drawDots(startX, startY, startX + dx * endLen, startY + dy * endLen, 0.52, DOT_R1);
    }

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
  // Insert highest level first so level 1 ends up at the bottom (climb upward feel)
  for (let i = TOTAL_LEVELS; i >= 1; i--) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    btn.textContent = i;
    btn.dataset.level = i;
    const completed  = saveData.completedLevels.includes(i);
    const isUnlocked = i <= unlocked;
    if (completed)        btn.classList.add('level-completed');
    else if (isUnlocked)  btn.classList.add('level-unlocked');
    else { btn.classList.add('level-locked'); btn.disabled = true; }
    // Milestone levels get a special gift-box visual; claimed ones show a different state
    if (i % 10 === 0) {
      btn.classList.add('level-milestone');
      if (saveData.claimedMilestoneRewards.includes(i)) btn.classList.add('level-milestone-claimed');
    }
    if (isUnlocked) btn.addEventListener('click', () => { Screens.show('game'); game = new Game(i); });
    grid.appendChild(btn);
  }
  const progressEl = document.getElementById('ls-progress');
  if (progressEl) progressEl.textContent = saveData.completedLevels.length + ' / ' + TOTAL_LEVELS + ' CLEARED';
  const currentBtn = grid.querySelector('[data-level="' + unlocked + '"]');
  if (currentBtn) setTimeout(() => currentBtn.scrollIntoView({ block: 'center' }), 50);
}

function updateMenuDisplay() {
  document.getElementById('menu-best-stage').textContent = Math.max(0, saveData.highestUnlockedLevel - 1);
  document.getElementById('menu-shards').textContent = saveData.totalShards;
  document.getElementById('menu-diamonds').textContent = saveData.diamonds;
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

// Track last touch position for deadzone
let _touchLastPos = null;

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  // Return CSS-pixel coords — these match W/H used throughout game logic.
  // DPR scaling is handled by ctx.setTransform in draw(), not here.
  let cx, cy;
  if (e.touches && e.touches.length > 0) {
    cx = e.touches[0].clientX - rect.left;
    cy = e.touches[0].clientY - rect.top;
  } else if (e.changedTouches && e.changedTouches.length > 0) {
    cx = e.changedTouches[0].clientX - rect.left;
    cy = e.changedTouches[0].clientY - rect.top;
  } else {
    cx = e.clientX - rect.left;
    cy = e.clientY - rect.top;
  }
  return { x: cx, y: cy };
}

function onPointerDown(e) {
  AudioManager.init();
  if (!game || game.phase !== GamePhase.IDLE) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const isTouch = !!e.touches;
  _touchLastPos = isTouch ? pos : null;
  game.aiming = true;
  game.launcher.setAngleFromPoint(pos.x, pos.y, isTouch);
}

function onPointerMove(e) {
  if (!game || !game.aiming) return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const isTouch = !!e.touches;

  if (isTouch) {
    // Apply deadzone — ignore tiny finger tremors
    if (_touchLastPos) {
      const ddx = Math.abs(pos.x - _touchLastPos.x);
      const ddy = Math.abs(pos.y - _touchLastPos.y);
      if (ddx < TOUCH_DEADZONE_PX && ddy < TOUCH_DEADZONE_PX) return;
    }
    _touchLastPos = pos;
    game.launcher.setAngleFromPoint(pos.x, pos.y, true);
  } else {
    game.launcher.setAngleFromPoint(pos.x, pos.y, false);
  }
}

function onPointerUp(e) {
  if (!game || !game.aiming) return;
  e.preventDefault();
  _touchLastPos = null;
  game.aiming = false;
  game.shoot();
  game.updatePowerBar();
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('mousemove', onPointerMove);
canvas.addEventListener('mouseup',   onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

// ============================================================
// AIM RAIL — horizontal thumb slider
// ============================================================

const aimRailWrap  = document.getElementById('aim-rail-wrap');
const aimRailKnob  = document.getElementById('aim-rail-fill-left');
const aimRailTrack = document.getElementById('aim-rail-track');

let _railDragging = false;

// Map launcher angle to knob position (0–100%) and fill width.
// Uses inverse of center-based mapping: 0% = full left, 50% = straight up, 100% = full right.
function syncRailKnob() {
  if (!game || !game.launcher) return;
  const visible = (game.phase === GamePhase.IDLE || game.phase === GamePhase.SHOOTING);
  aimRailWrap.style.display = visible ? 'flex' : 'none';
  if (!visible) return;

  // Inverse: aimValue = (angle - straightUp) / maxOffset → pct = (aimValue+1)/2
  const aimValue = clamp((game.launcher.angle - RAIL_STRAIGHT_UP) / RAIL_MAX_OFFSET, -1, 1);
  const pct = ((aimValue + 1) / 2) * 100;
  document.getElementById('aim-rail-knob').style.left = pct + '%';
  aimRailKnob.style.width = pct + '%';
}

// Rail angle constants — center of rail = straight up, edges = max left/right aim.
const RAIL_STRAIGHT_UP = -Math.PI / 2;  // -1.5708 rad
const RAIL_MAX_OFFSET  = 1.30;          // ~74.5° from vertical on each side
const RAIL_BOOST       = 1.35;          // full range reachable before screen edge (no need to reach extreme pixel)

// Center-based absolute mapping: finger position → aimValue → angle.
//   normalized -1 = far left  → aims left
//   normalized  0 = center    → aims straight up
//   normalized +1 = far right → aims right
function setAngleFromRailX(clientX) {
  const rect      = aimRailTrack.getBoundingClientRect();
  const centerX   = rect.left + rect.width * 0.5;
  const halfW     = (rect.width * 0.5) || 1;
  const normalized = clamp(((clientX - centerX) / halfW) * RAIL_BOOST, -1, 1);
  game.launcher.targetAngle = clamp(
    RAIL_STRAIGHT_UP + normalized * RAIL_MAX_OFFSET,
    game.launcher.minAngle,
    game.launcher.maxAngle
  );
}

function onRailDown(e) {
  if (!game || game.phase !== GamePhase.IDLE) return;
  e.preventDefault();
  AudioManager.init();
  _railDragging = true;
  game.launcher.railControlled = true;
  game.aiming = false;
  aimRailWrap.classList.add('rail-active');
  // Immediately snap aim to the touched position — no delta accumulation
  setAngleFromRailX(e.touches ? e.touches[0].clientX : e.clientX);
}

function onRailMove(e) {
  if (!_railDragging || !game || game.phase !== GamePhase.IDLE) return;
  e.preventDefault();
  setAngleFromRailX(e.touches ? e.touches[0].clientX : e.clientX);
}

function onRailUp(e) {
  if (!_railDragging) return;
  e.preventDefault();
  _railDragging = false;
  aimRailWrap.classList.remove('rail-active');
  if (game && game.launcher) game.launcher.railControlled = false;
  if (game && game.phase === GamePhase.IDLE) {
    game.shoot();
    game.updatePowerBar();
  }
}

aimRailWrap.addEventListener('mousedown',  onRailDown);
aimRailWrap.addEventListener('mousemove',  onRailMove);
aimRailWrap.addEventListener('mouseup',    onRailUp);
aimRailWrap.addEventListener('touchstart', onRailDown, { passive: false });
aimRailWrap.addEventListener('touchmove',  onRailMove, { passive: false });
aimRailWrap.addEventListener('touchend',   onRailUp,   { passive: false });

// Release rail if pointer leaves window
document.addEventListener('mouseup',  () => { if (_railDragging) { _railDragging = false; aimRailWrap.classList.remove('rail-active'); } });
document.addEventListener('touchend', () => { if (_railDragging) { _railDragging = false; aimRailWrap.classList.remove('rail-active'); } });

// ============================================================
// BUTTON WIRING
// ============================================================

document.getElementById('btn-start').addEventListener('click', () => {
  buildLevelSelectGrid();
  Screens.show('levelselect');
});

document.getElementById('btn-continue').addEventListener('click', () => {
  Screens.show('game');
  game = new Game(saveData.highestUnlockedLevel);
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
  Screens.show('game');
  game = new Game(lv);
});

document.getElementById('btn-menu-pause').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-restart-go').addEventListener('click', () => {
  const lv = game ? game.level : 1;
  Screens.show('game');
  game = new Game(lv);
});

document.getElementById('btn-menu-go').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-watch-ad-continue').addEventListener('click', () => {
  if (!game || game.rewardedContinueUsed) return;
  AdManager.showRewardedPlaceholder(() => {
    // Reward granted — clear the 3 lowest alive block rows then resume
    game.rewardedContinueUsed = true;
    const aliveRows = [...new Set(game.blocks.filter(b => b.alive).map(b => b.row))].sort((a, b) => b - a);
    const targetRows = new Set(aliveRows.slice(0, 3));
    for (const b of game.blocks) {
      if (!b.alive || !targetRows.has(b.row)) continue;
      b.alive = false;
      spawnParticles(b.cx, b.cy, '#00ff88', 8, { speed: 3.5, decay: 0.05 });
    }
    game.blocks = game.blocks.filter(b => b.alive);
    screenShake(6, 4);
    floatingTexts.push(new FloatingText(W / 2, H * 0.43, '▶ CONTINUE!', '#00ff88'));
    game.warningActive = false;
    game.phase = GamePhase.IDLE;
    game.updatePowerBar();
    Screens.show('game');
  });
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
  const nextLv = lv + 1;
  if (lv % 5 === 0 && AdManager.canShowInterstitial()) {
    AdManager.showInterstitialPlaceholder(() => {
      Screens.show('game');
      game = new Game(nextLv);
    });
  } else {
    Screens.show('game');
    game = new Game(nextLv);
  }
});

document.getElementById('btn-goto-levelselect').addEventListener('click', () => {
  buildLevelSelectGrid();
  Screens.show('levelselect');
});

// ============================================================
// STORE / DIAMOND MARKET
// ============================================================

const DIAMOND_PACKS = [
  { gems: 100,   price: '$1.99'  },
  { gems: 600,   price: '$4.99'  },
  { gems: 1400,  price: '$9.99'  },
  { gems: 3500,  price: '$19.99' },
  { gems: 10000, price: '$49.99' },
];

const Store = {
  open() {
    document.getElementById('store-diamonds').textContent = saveData.diamonds || 0;
    document.getElementById('store-bombs').textContent    = saveData.bombCount || 0;
    document.getElementById('store-mults').textContent    = saveData.multiplier10xCount || 0;
    Screens.show('store');
  },

  buyPack(index) {
    const pack = DIAMOND_PACKS[index];
    if (!pack) return;
    showInfoModal('DIAMOND PACKS',
      `Diamond packs will be available in the mobile release of Neon Siege.\n\n` +
      `Pack: ${pack.gems} 💎 for ${pack.price}`);
  },

  buyItem(type) {
    const COST = 100;
    if ((saveData.diamonds || 0) < COST) {
      showInfoModal('NOT ENOUGH DIAMONDS',
        `You need 100 💎 to buy this item.\n\nEarn diamonds by reaching milestone levels (every 10 levels) or buy a Diamond Pack!`);
      return;
    }
    saveData.diamonds -= COST;
    if (type === 'bomb') {
      addPowerInventory('bomb', 3);
      showInfoModal('PURCHASE COMPLETE', '💣 +3 BOMBS added to your inventory!');
    } else if (type === 'mult') {
      addPowerInventory('mult', 3);
      showInfoModal('PURCHASE COMPLETE', '✕10 +3 MULTIPLIERS added to your inventory!');
    }
    Save.save(saveData);
    document.getElementById('store-diamonds').textContent = saveData.diamonds || 0;
    document.getElementById('store-bombs').textContent    = saveData.bombCount || 0;
    document.getElementById('store-mults').textContent    = saveData.multiplier10xCount || 0;
  },

  buyNoAds(all) {
    showInfoModal('REMOVE ADS',
      all
        ? 'Remove All Ads ($2.99) will be available in the mobile release of Neon Siege.'
        : 'Remove Forced Ads ($1.99) will be available in the mobile release of Neon Siege.');
  },
};

document.getElementById('btn-store').addEventListener('click', () => Store.open());

document.getElementById('btn-back-store').addEventListener('click', () => {
  updateMenuDisplay();
  Screens.show('menu');
});

document.getElementById('btn-buy-bombs').addEventListener('click', () => Store.buyItem('bomb'));
document.getElementById('btn-buy-mults').addEventListener('click', () => Store.buyItem('mult'));

// ============================================================
// SETTINGS SCREEN
// ============================================================

let _settingsBack = 'menu'; // 'menu' | 'pause'

function openSettings(backTarget) {
  _settingsBack = backTarget;
  _buildSettingsUI();
  Screens.show('settings');
}

function _buildSettingsUI() {
  const p = saveData.audioPrefs;
  const sfxBtn   = document.getElementById('toggle-sfx');
  const musicBtn = document.getElementById('toggle-music');
  const hapBtn   = document.getElementById('toggle-haptics');
  const vol      = document.getElementById('settings-volume');

  sfxBtn.textContent   = p.sfxEnabled   ? 'ON' : 'OFF';
  sfxBtn.classList.toggle('active', p.sfxEnabled);

  musicBtn.textContent = p.musicEnabled ? 'ON' : 'OFF';
  musicBtn.classList.toggle('active', p.musicEnabled);

  hapBtn.textContent   = p.hapticsEnabled ? 'ON' : 'OFF';
  hapBtn.classList.toggle('active', p.hapticsEnabled);

  vol.value = Math.round(p.volume * 100);
}

function showInfoModal(title, body) {
  document.getElementById('info-modal-title').textContent = title;
  document.getElementById('info-modal-body').textContent  = body;
  document.getElementById('info-modal').style.display    = 'flex';
}

// Settings navigation
document.getElementById('btn-settings').addEventListener('click', () => openSettings('menu'));

document.getElementById('btn-settings-hud').addEventListener('click', () => {
  if (game && game.phase !== GamePhase.GAMEOVER) Screens.show('pause');
  openSettings('pause');
});

document.getElementById('btn-settings-pause').addEventListener('click', () => openSettings('pause'));

document.getElementById('btn-back-settings').addEventListener('click', () => {
  if (_settingsBack === 'menu') updateMenuDisplay();
  Screens.show(_settingsBack);
});

// Audio toggles
document.getElementById('toggle-sfx').addEventListener('click', () => {
  const p = saveData.audioPrefs;
  p.sfxEnabled = !p.sfxEnabled;
  AudioManager.setSfxEnabled(p.sfxEnabled);
  Save.save(saveData);
  _buildSettingsUI();
});

document.getElementById('toggle-music').addEventListener('click', () => {
  const p = saveData.audioPrefs;
  p.musicEnabled = !p.musicEnabled;
  AudioManager.setMusicEnabled(p.musicEnabled);
  Save.save(saveData);
  _buildSettingsUI();
});

document.getElementById('settings-volume').addEventListener('input', () => {
  const v = parseInt(document.getElementById('settings-volume').value, 10) / 100;
  saveData.audioPrefs.volume = v;
  AudioManager.setVolume(v);
  Save.save(saveData);
});

document.getElementById('toggle-haptics').addEventListener('click', () => {
  const p = saveData.audioPrefs;
  p.hapticsEnabled = !p.hapticsEnabled;
  Save.save(saveData);
  _buildSettingsUI();
});

// Info placeholders
document.getElementById('btn-privacy').addEventListener('click', () =>
  showInfoModal('PRIVACY POLICY',
    'Privacy Policy will be available in the mobile version of Neon Siege.'));

document.getElementById('btn-terms').addEventListener('click', () =>
  showInfoModal('TERMS OF USE',
    'Terms of Use will be available in the mobile version of Neon Siege.'));

document.getElementById('btn-contact').addEventListener('click', () =>
  showInfoModal('CONTACT / SUPPORT',
    'Support contact will be added before release.\nThank you for playing Neon Siege!'));

document.getElementById('btn-restore').addEventListener('click', () =>
  showInfoModal('RESTORE PURCHASES',
    'Restore Purchases is available in the mobile version of Neon Siege.'));

document.getElementById('btn-about').addEventListener('click', () =>
  showInfoModal('ABOUT / CREDITS',
    'NEON SIEGE\nArcade Roguelike Prototype\n\nBuilt with HTML5 Canvas.\nNo external libraries.\n\nThank you for playing!'));

document.getElementById('btn-info-close').addEventListener('click', () => {
  document.getElementById('info-modal').style.display = 'none';
});

// Reset Progress
document.getElementById('btn-reset-progress').addEventListener('click', () => {
  document.getElementById('reset-modal').style.display = 'flex';
});

document.getElementById('btn-reset-cancel').addEventListener('click', () => {
  document.getElementById('reset-modal').style.display = 'none';
});

document.getElementById('btn-reset-confirm').addEventListener('click', () => {
  const preservedAudio = saveData && saveData.audioPrefs
    ? { ...saveData.audioPrefs }
    : { sfxEnabled: true, musicEnabled: false, volume: 0.7, hapticsEnabled: false };
  localStorage.removeItem('neonSiegeSave');
  saveData = Save.load();
  saveData.audioPrefs = preservedAudio;
  Save.save(saveData);
  location.reload();
});

// Document-level: init audio + play click on any button press
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) {
    AudioManager.init();
    AudioManager.play('click');
  }
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
    syncRailKnob();
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
