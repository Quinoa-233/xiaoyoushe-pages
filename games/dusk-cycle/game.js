'use strict';
/* ============================================================
   黄昏轮回 · 英灵试炼   —— 轻量化元气骑士式地牢射击
   纯 Canvas 2D，无依赖，双击 index.html 即可运行
   ============================================================ */
(function () {
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const W = 960, H = 540, WALL = 36;
  const X0 = WALL, Y0 = WALL, X1 = W - WALL, Y1 = H - WALL;

  /* ---------- 工具 ---------- */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[randi(0, arr.length - 1)];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const TAU = Math.PI * 2;
  // BOSS 塔罗卡面（无头测试环境下没有 Image，自动跳过）
  const CARD_IMG = {};
  if (typeof Image !== 'undefined') {
    ['fenrir', 'jorm', 'hel'].forEach(k => {
      const im = new Image();
      im.onerror = () => { CARD_IMG[k] = null; };
      im.src = 'assets/' + k + '.png';
      CARD_IMG[k] = im;
    });
  }

  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const now = () => performance.now() / 1000;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function poly(pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function ell(x, y, rx, ry, fill, stroke, lw) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
  function text(str, x, y, size, color, align, weight) {
    ctx.font = (weight || '') + ' ' + size + 'px "Microsoft YaHei",sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /* ---------- 音效（WebAudio 合成，无资源文件） ---------- */
  let actx = null, muted = false;
  function sfx(kind) {
    if (muted) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.connect(g); g.connect(actx.destination);
      let f0 = 440, f1 = 220, dur = 0.08, vol = 0.05, type = 'square';
      if (kind === 'shoot') { f0 = 720; f1 = 300; dur = 0.06; vol = 0.035; }
      else if (kind === 'hit') { f0 = 220; f1 = 90; dur = 0.07; vol = 0.05; }
      else if (kind === 'hurt') { f0 = 160; f1 = 60; dur = 0.22; vol = 0.08; type = 'sawtooth'; }
      else if (kind === 'dash') { f0 = 500; f1 = 900; dur = 0.12; vol = 0.04; }
      else if (kind === 'boom') { f0 = 140; f1 = 40; dur = 0.35; vol = 0.09; type = 'sawtooth'; }
      else if (kind === 'pick') { f0 = 600; f1 = 1200; dur = 0.12; vol = 0.05; type = 'triangle'; }
      else if (kind === 'clear') { f0 = 520; f1 = 1040; dur = 0.25; vol = 0.05; type = 'triangle'; }
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* 静默失败 */ }
  }

  /* ---------- 输入 ---------- */
  const keys = Object.create(null);
  const mouse = { x: W / 2, y: H - 120, down: false };
  let mouseScale = 1;

  function updateMouseScale() {
    const r = cvs.getBoundingClientRect();
    mouseScale = W / r.width;
  }
  addEventListener('resize', updateMouseScale);
  addEventListener('mousemove', e => {
    const r = cvs.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
  });
  cvs.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Escape' && (G.mode === 'play' || G.mode === 'pause')) togglePause();
    if ((e.code === 'Space' || e.code === 'Enter') && G.mode === 'title' && introOpen) {
      e.preventDefault(); introNext();
    }
    if (e.code === 'KeyM') muted = !muted;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { mouse.down = false; for (const k in keys) keys[k] = false; });

  /* ---------- 数据 ---------- */
  const WEAPONS = {
    bow: {
      name: '短弓', color: '#c9c2a8', cd: 0.30, dmg: 2, desc: '快，准，不客气',
      fire(p, ang) {
        spawnProj({ x: p.x, y: p.y, ang, spd: 760, r: 4, dmg: p.dmg * 1.6, life: 0.9, kind: 'arrow', owner: 'p' });
      }
    },
    gungnir: {
      name: '冈格尼尔', color: '#9cd8f2', cd: 0.55, dmg: 3, desc: '追踪，穿透',
      fire(p, ang) {
        spawnProj({
          x: p.x, y: p.y, ang, spd: 580, r: 7, dmg: p.dmg * 2.2, life: 1.1, kind: 'spear',
          owner: 'p', pierce: 2, homing: 1.6
        });
      }
    },
    mjolnir: {
      name: '姆乔尔尼尔', color: '#e8c866', cd: 0.55, dmg: 1.0, desc: '投出，回旋，快',
      fire(p, ang) {
        spawnProj({
          x: p.x, y: p.y, ang, spd: 430, r: 13, dmg: p.dmg * 1.0, life: 1.4, kind: 'hammer',
          owner: 'p', pierce: 99, boomerang: true
        });
        sfx('boom');
      }
    },
    laevateinn: {
      name: '莱瓦汀', color: '#f28e34', cd: 0.48, dmg: 2, desc: '扇形火焰，灼烧',
      fire(p, ang) {
        for (let i = -1; i <= 1; i++) {
          spawnProj({
            x: p.x, y: p.y, ang: ang + i * 0.22, spd: 420, r: 9, dmg: p.dmg * 1.6,
            life: 0.42, kind: 'flame', owner: 'p', burn: 1
          });
        }
      }
    },
    runestaff: {
      name: '卢恩法杖', color: '#7ee0a0', cd: 0.75, dmg: 3, desc: '追踪符文',
      fire(p, ang) {
        spawnProj({
          x: p.x, y: p.y, ang, spd: 300, r: 8, dmg: p.dmg * 2.2, life: 2.2,
          kind: 'rune', owner: 'p', homing: 3.4
        });
      }
    },
    tyrsword: {
      name: '提尔之剑', color: '#a8c4e0', cd: 0.95, dmg: 2, desc: '断剑，重而慢',
      fire(p, ang) {
        spawnProj({
          x: p.x, y: p.y, ang, spd: 330, r: 17, dmg: p.dmg * 4, life: 1.2,
          kind: 'swordwave', owner: 'p', pierce: 3
        });
      }
    },
    dainsleif: {
      name: '达因斯莱夫', color: '#c25b4e', cd: 0.75, dmg: 2, desc: '不杀人就掉血',
      fire(p, ang) {
        melee(p, ang, 96, 1.9, p.dmg * 6, 280, '#e04a3a');
        p.curseT = 5;
      }
    },
    axe: {
      name: '战斧', color: '#c8b48a', cd: 0.45, dmg: 1, desc: '近身横扫',
      fire(p, ang) {
        melee(p, ang, 76, 2.4, p.dmg * 3, 190, '#e8dcc0');
      }
    },
    shield: {
      name: '圆盾', color: '#b04a4a', cd: 1.10, dmg: 1, desc: '格挡并清弹',
      fire(p, ang) {
        melee(p, ang, 82, 2.6, p.dmg * 2, 340, '#d05a4a');
        p.iframe = Math.max(p.iframe, 0.28);
        clearEnemyBullets(p.x, p.y, 130);
      }
    },
    draupnir: {
      name: '德劳普尼尔', color: '#e8c866', cd: 0.85, dmg: 2, desc: '命中分裂成三',
      fire(p, ang) {
        spawnProj({
          x: p.x, y: p.y, ang, spd: 430, r: 9, dmg: p.dmg * 2.2, life: 0.85,
          kind: 'ring', owner: 'p', split: true
        });
      }
    },
    brisingamen: {
      name: '布里辛加门', color: '#d07aa8', cd: 0.85, dmg: 1, desc: '光环减速 + 脉冲',
      fire(p, ang) {
        melee(p, ang, 118, Math.PI * 2, p.dmg * 1.5, 0, '#d07aa8');
      }
    },
  };
  const WEAPON_KEYS = Object.keys(WEAPONS);

  const BLESSINGS = [
    { id: 'odin', img: 'bless_odin.jpg', name: '奥丁 · 求知', desc: '伤害 +18%',
      apply(p) { p.dmg *= 1.18; } },
    { id: 'thor', img: 'bless_thor.jpg', name: '托尔 · 力量', desc: '攻击速度 +15%',
      apply(p) { p.cdMul *= 0.85; } },
    { id: 'freyja', img: 'bless_freyja.jpg', name: '芙蕾雅 · 丰饶', desc: '生命上限 +1 并回满',
      apply(p) { p.maxHp += 1; p.hp = p.maxHp; } },
    { id: 'frigg', img: 'bless_frigg.jpg', name: '弗丽嘉 · 静默', desc: '受击无敌 +0.2 秒',
      apply(p) { p.iframeBonus += 0.2; } },
    { id: 'heimdall', img: 'bless_heimdall.jpg', name: '海姆达尔 · 守望', desc: '每次进入新房间回 1 血',
      apply(p) { p.roomHeal = 1; } },
    { id: 'loki', img: 'bless_loki.jpg', name: '洛基 · 玩笑', desc: '金币获取 +50%',
      apply(p) { p.coinMul *= 1.5; } },
    { id: 'norns', img: 'bless_norns.jpg', name: '诺伦 · 命运', desc: '冲刺冷却 −25%',
      apply(p) { p.dashCdBase *= 0.75; } },
    { id: 'hel', img: 'bless_hel.jpg', name: '海拉 · 终结', desc: '每击杀 8 个敌人回 1 血',
      apply(p) { if (!p.killHealEvery) p.killHealEvery = 8; else p.killHealEvery = Math.max(4, p.killHealEvery - 3); } },
    { id: 'surt', img: 'bless_surt.jpg', name: '苏尔特 · 焚尽', desc: '伤害 +30%，生命上限 −1',
      apply(p) { p.dmg *= 1.30; p.maxHp = Math.max(3, p.maxHp - 1); p.hp = Math.min(p.hp, p.maxHp); } },
    { id: 'skathi', img: 'bless_skathi.jpg', name: '斯卡蒂 · 冷', desc: '移动速度 +12%',
      apply(p) { p.speed *= 1.12; } },
    { id: 'baldr', img: 'bless_baldr.jpg', name: '巴德尔 · 光', desc: '每次清场回 1 血',
      apply(p) { p.clearHeal = (p.clearHeal || 0) + 1; } },
    { id: 'yggdrasil', img: 'bless_yggdrasil.jpg', name: '尤克特拉希尔 · 世界', desc: '生命上限 +2',
      apply(p) { p.maxHp += 2; p.hp = Math.min(p.maxHp, p.hp + 2); } }
  ];

  const PROPHECIES = [
    {
      id: 'blood', name: '血誓', desc: '最大生命 −1，伤害 +45%',
      apply(p) { p.maxHp -= 1; p.hp = p.maxHp; p.dmg *= 1.45; }
    },
    {
      id: 'hunt', name: '猎人的时辰', desc: '移动速度 +14%',
      apply(p) { p.speed *= 1.14; }
    },
    {
      id: 'eye', name: '献眼者的恩赐', desc: '冲刺冷却 −35%',
      apply(p) { p.dashCd *= 0.65; }
    },
    {
      id: 'fire', name: '火之禁忌', desc: '持火焰武器时受伤 +1',
      apply(p) { p.fireCurse = true; }
    },
    {
      id: 'thread', name: '最后一根线', desc: '每局一次，濒死时回满',
      apply(p) { p.lastThread = true; }
    }
  ];

  const LEVELS = [
    { name: '米德加德 · 冻土', lore: '世界之树有三条根，一条扎在人间。冬天来了，根就结冰。',
      theme: 'ice', enemies: [['draugr', 3], ['wolf', 2]], props: 4 },
    { name: '米德加德 · 冰湖', lore: '冰层下面是上一个冬天的死者，他们还没被叫醒。',
      theme: 'ice', enemies: [['draugr', 2], ['wolf', 3]], props: 5 },
    { name: '米德加德 · 断崖', lore: '第一层。魔狼被绑在这里，绑它的东西已经断了。',
      theme: 'boss', boss: true, bossType: 'fenrir', layer: 1, enemies: [], props: 0 },
    { name: '吟游诗人的回响', lore: '琴弦一响，价目表就浮了出来。诗人不做慈善，但也不坑死人。',
      theme: 'shop', shop: true, enemies: [], props: 0 },

    { name: '约顿海姆 · 巨人国', lore: '巨人记得诸神欠他们的每一笔账，包括那堵没付钱的城墙。',
      theme: 'stone', enemies: [['draugr', 2], ['wolf', 2], ['salamander', 1]], props: 5 },
    { name: '约顿海姆 · 石庭', lore: '石头也会老，只是比神慢一些。',
      theme: 'stone', enemies: [['salamander', 2], ['wolf', 3]], props: 4 },
    { name: '世界之海 · 无底海', lore: '第二层。它咬着自己的尾巴，把整片海围成一圈。',
      theme: 'sea', boss: true, bossType: 'jorm', layer: 2, enemies: [], props: 0 },
    { name: '吟游诗人的回响', lore: '琴弦一响，价目表就浮了出来。诗人不做慈善，但也不坑死人。',
      theme: 'shop', shop: true, enemies: [], props: 0 },

    { name: '赫尔海姆 · 冥界', lore: '死过一次的人在这里排队，等第二次。',
      theme: 'hel', enemies: [['draugr', 3], ['salamander', 2], ['wolf', 2]], props: 5 },
    { name: '赫尔海姆 · 死者长厅', lore: '厅堂很长，长到你能听见自己的名字被念完。',
      theme: 'hel', enemies: [['draugr', 3], ['wolf', 3], ['elite', 1]], props: 4 },
    { name: '赫尔海姆 · 半死王座', lore: '第三层。她一半是活的，一半已经死了很久。',
      theme: 'boss', boss: true, bossType: 'hel', layer: 3, enemies: [], props: 0 },
    { name: '吟游诗人的回响', lore: '琴弦一响，价目表就浮了出来。诗人不做慈善，但也不坑死人。',
      theme: 'shop', shop: true, enemies: [], props: 0 }
  ];



  /* ---------- 全局状态 ---------- */
  const G = {
    mode: 'title', level: 0, time: 0, shake: 0, flash: 0,
    banner: 0, bannerText: '',
    kills: 0, hits: 0, pressure: 1, fade: 0, roomIntro: 0, roomIntroMax: 3.4, cutscene: 0, bossOut: 0
  };

  let player = null;
  let enemies = [];
  let projs = [];
  let parts = [];
  let texts = [];
  let obstacles = [];
  let pickups = [];
  let portal = null;
  let slashes = [];
  let waves = [];
  let zones = [];
  let hazards = [];

  const BOSS_DEFS = {
    fenrir: {
      cn: '芬里尔', name: '魔狼 · 芬里尔', r: 44, hpScale: 1.70,
      summon: 'wolf', bolts: 4, card: 'fenrir', tone: '#c25b4e'
    },
    jorm: {
      cn: '耶梦加得', name: '尘世巨蟒 · 耶梦加得', r: 54, hpScale: 1.0,
      summon: 'salamander', bolts: 6, card: 'jorm', tone: '#5ec08a'
    },
    hel: {
      cn: '海拉', name: '冥后 · 海拉', r: 46, hpScale: 1.15,
      summon: 'draugr', bolts: 5, card: 'hel', tone: '#c0a8d8'
    }
  };
  let shopItems = [];
  const SHOP_STOCK = [
    { kind: 'heal', name: '蜜酒', desc: '回复 2 点生命', price: 3, color: '#c25b4e' },
    { kind: 'maxhp', name: '英灵之躯', desc: '生命上限 +1', price: 6, color: '#7ee0a0' },
    { kind: 'dmg', name: '弑神之刃', desc: '伤害 +30%', price: 7, color: '#e8c866' },
    { kind: 'weapon', name: '神秘武器', desc: '随机一件武器', price: 5, color: '#9cd8f2' }
  ];
  let shields = [];
  let boss = null;
  let cleared = false;
  let props = [];

  /* ---------- 粒子 / 飘字 ---------- */
  function burst(x, y, n, color, spd, life, size) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(spd * 0.3, spd);
      parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(life * 0.5, life), max: life, color, size: size || rand(1.5, 3.5)
      });
    }
  }
  function popText(x, y, str, color, size) {
    texts.push({ x, y, str, color: color || '#fff', size: size || 14, life: 0.9, vy: -46 });
  }

  /* ---------- 玩家 ---------- */
  function makePlayer() {
    return {
      x: W / 2, y: H / 2, r: 13,
      hp: 8, maxHp: 8,
      speed: 215, dmg: 1,
      weapon: 'bow', owned: ['bow'],
      cd: 0, aim: -Math.PI / 2,
      dashT: 0, dashCd: 0, dashCdBase: 1.1, iframe: 0,
      hurtFlash: 0, fireCurse: false, lastThread: false, curseT: 0, coins: 0,
      cdMul: 1, iframeBonus: 0, roomHeal: 0, coinMul: 1, killHealEvery: 0, killCount: 0, slowT: 0,
      shield: 4, shieldMax: 4, shieldT: 0,
      vx: 0, vy: 0, walk: 0
    };
  }

  /* ---------- 诸神祝福 ---------- */
  let blessChoices = [];

  function offerBlessings() {
    const taken = player.blessings || (player.blessings = []);
    let pool = BLESSINGS.filter(b => taken.indexOf(b.id) < 0);
    if (pool.length < 3) pool = BLESSINGS.slice();
    blessChoices = [];
    const copy = pool.slice();
    for (let i = 0; i < 3 && copy.length; i++) {
      blessChoices.push(copy.splice(randi(0, copy.length - 1), 1)[0]);
    }
    if (window.__AUTO_BLESS) { chooseBlessing(0); return; }
    const row = document.getElementById('blessRow');
    row.innerHTML = '';
    blessChoices.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'bless-card';
      el.innerHTML = '<img src="assets/' + b.img + '" alt=""><div class="bn">' + b.name +
        '</div><div class="bd">' + b.desc + '</div>';
      el.addEventListener('click', () => chooseBlessing(i));
      row.appendChild(el);
    });
    G.mode = 'bless';
    show('ovBless');
    sfx('clear');
  }

  function chooseBlessing(i) {
    const b = blessChoices[i];
    if (!b) return;
    b.apply(player);
    (player.blessings || (player.blessings = [])).push(b.id);
    popText(player.x, player.y - 40, b.name.split(' · ')[0] + '的祝福', '#e8c866', 16);
    hide('ovBless');
    if (G.mode === 'bless') G.mode = 'play';
  }

  function startRun() {
    G.mode = 'play';
    G.level = 0; G.time = 0; G.kills = 0; G.hits = 0;
    G.flash = 0; G.shake = 0;

    const deaths = +(LS.get('hh_deaths') || 0);
    G.pressure = clamp(1.12 - deaths * 0.05, 0.72, 1.15);

    player = makePlayer();
    player.iframe = 1.2;
    // 抽三条预言
    const pool = PROPHECIES.slice();
    const chosen = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      chosen.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
    }
    chosen.forEach(p => p.apply(player));
    player.prophecies = chosen.map(p => p.name + '：' + p.desc);

    G.banner = 0;
    G.bannerText = '';
    G.cutscene = 0;
    G.bossOut = 0;
    G.justBoss = false;
    initLevel(0);
    hideAll();
    offerBlessings();   // 开局第一份祝福
  }

  function togglePause() {
    if (G.mode === 'play') { G.mode = 'pause'; show('ovPause'); }
    else if (G.mode === 'pause') { G.mode = 'play'; hide('ovPause'); }
  }

  /* ---------- 关卡 ---------- */
  function initLevel(i) {
    G.level = i;
    G.fade = 1;
    G.roomIntro = LEVELS[i].boss ? 0 : G.roomIntroMax;
    const L = LEVELS[i];
    enemies = []; projs = []; parts = []; texts = []; pickups = []; slashes = []; shields = []; waves = []; zones = []; hazards = [];
    portal = null; boss = null; cleared = false;
    obstacles = [];
    props = [];

    if (player && player.roomHeal) player.hp = Math.min(player.maxHp, player.hp + player.roomHeal);

    // 地面装饰
    props = [];
    for (let i = 0; i < 16; i++) {
      props.push({ x: rand(X0 + 24, X1 - 24), y: rand(Y0 + 24, Y1 - 24), k: randi(0, 2), s: rand(0.7, 1.5), a: rand(0, TAU) });
    }

    // 障碍
    for (let k = 0; k < L.props; k++) {
      const w = randi(46, 86), h = randi(46, 86);
      const x = rand(X0 + 90, X1 - 90 - w);
      const y = rand(Y0 + 90, Y1 - 90 - h);
      // 不挡在出生点，也不挡传送门走廊
      if (Math.abs(x + w / 2 - W / 2) < 120 && Math.abs(y + h / 2 - H / 2) < 100) continue;
      if (x + w > X1 - 170 && Math.abs(y + h / 2 - H / 2) < 95) continue;
      obstacles.push({ x, y, w, h });
    }

    // 环境陷阱（BOSS 房与商店不生成）
    if (!L.boss && !L.shop) {
      const kinds = L.theme === 'fire' ? ['fire', 'fire', 'barrel']
        : (L.theme === 'hel' || L.theme === 'sea') ? ['poison', 'poison', 'barrel']
        : ['barrel', 'barrel'];
      for (const k of kinds) {
        for (let t = 0; t < 24; t++) {
          const hx = rand(X0 + 120, X1 - 120), hy = rand(Y0 + 120, Y1 - 120);
          if (Math.hypot(hx - W / 2, hy - H / 2) < 150) continue;
          if (obstacles.some(o => hx > o.x - 40 && hx < o.x + o.w + 40 && hy > o.y - 40 && hy < o.y + o.h + 40)) continue;
          if (hazards.some(z => Math.hypot(z.x - hx, z.y - hy) < 90)) continue;
          if (k === 'barrel') hazards.push({ k: 'barrel', x: hx, y: hy, r: 15, hp: 3, dead: false });
          else hazards.push({ k: k, x: hx, y: hy, r: k === 'fire' ? 34 : 42, cd: 0 });
          break;
        }
      }
    }

    // 进新房间：玩家回到左侧入口，短暂无敌
    if (player) {
      player.x = i === 0 ? W / 2 : X0 + 72;
      player.y = H / 2;
      player.iframe = Math.max(player.iframe, 1.0);
      player.vx = 0; player.vy = 0;
      player.dashT = 0;
    }

    if (L.shop) {
      // 商店房：没有敌人，直接开放传送门
      shopItems = SHOP_STOCK.map((it, i) => Object.assign({}, it, {
        x: 220 + i * 150, y: H / 2 - 20, sold: false
      }));
      cleared = true;
      portal = { x: X1 - 30, y: H / 2, r: 30, t: 0 };
      return;
    }

    if (L.boss) {
      if (player) player.hp = player.maxHp;  // 进 BOSS 房，女武神灌你一口蜜酒
      // BOSS 房入口放一件武器，保证不会空手进门
      const ranged = ['bow', 'gungnir', 'mjolnir', 'laevateinn', 'runestaff', 'tyrsword', 'draupnir'];
      pickups.push({ kind: 'weapon', weapon: pick(ranged), x: X0 + 150, y: H / 2 + 30, r: 16, t: 0 });
      G.bossLayer = L.layer || 1;
      spawnBoss(L.bossType || 'fenrir');
    } else {
      let count = 0;
      L.enemies.forEach(([type, n]) => {
        const m = Math.max(1, Math.round(n * G.pressure));
        for (let k = 0; k < m; k++) {
          const pos = safeSpawn();
          spawnEnemy(type, pos.x, pos.y);
          count++;
        }
      });
      if (count === 0) spawnEnemy('draugr', W / 2 + 200, H / 2);
    }
  }

  function safeSpawn() {
    const px = player ? player.x : W / 2, py = player ? player.y : H / 2;
    for (let tries = 0; tries < 90; tries++) {
      const x = rand(X0 + 90, X1 - 90), y = rand(Y0 + 90, Y1 - 90);
      // 不贴玩家、不挤房间中心、不压在别的怪身上、不卡进障碍
      if (Math.hypot(x - px, y - py) < 300) continue;
      if (Math.hypot(x - (px + 60), y - py) < 320) continue;
      if (obstacles.some(o => x > o.x - 34 && x < o.x + o.w + 34 && y > o.y - 34 && y < o.y + o.h + 34)) continue;
      if (enemies.some(e => Math.hypot(e.x - x, e.y - y) < 96)) continue;
      return { x, y };
    }
    // 兜底：网格采样，取离玩家最远、且不撞障碍/不挤同伴的点
    let best = null, bestD = -1;
    for (let gx = X0 + 80; gx <= X1 - 80; gx += 56) {
      for (let gy = Y0 + 80; gy <= Y1 - 80; gy += 56) {
        if (Math.hypot(gx - px, gy - py) < 280) continue;
        if (obstacles.some(o => gx > o.x - 34 && gx < o.x + o.w + 34 && gy > o.y - 34 && gy < o.y + o.h + 34)) continue;
        if (enemies.some(e => Math.hypot(e.x - gx, e.y - gy) < 90)) continue;
        const dd = Math.hypot(gx - px, gy - py);
        if (dd > bestD) { bestD = dd; best = { x: gx, y: gy }; }
      }
    }
    if (best) return best;
    return { x: px > W / 2 ? X0 + 80 : X1 - 80, y: H / 2 };
  }

  /* ---------- 敌人 ---------- */
  const ENEMY_DEFS = {
    draugr: { hp: 9, r: 14, speed: 66, touch: 1, score: 1 },
    wolf: { hp: 7, r: 13, speed: 118, touch: 1, score: 1 },
    salamander: { hp: 11, r: 15, speed: 42, touch: 1, score: 1 },
    elite: { hp: 26, r: 20, speed: 58, touch: 2, score: 3 },
    clone: { hp: 6, r: 15, speed: 130, touch: 1, score: 1 }
  };

  function spawnEnemy(type, x, y) {
    const d = ENEMY_DEFS[type];
    const e = {
      type, x, y, r: d.r, hp: d.hp, maxHp: d.hp, speed: d.speed,
      touch: d.touch, vx: 0, vy: 0, hitT: 0, atkCd: rand(0.4, 1.4),
      state: 'idle', stateT: 0, dir: 0, burn: 0, wob: rand(0, TAU), slowT: 0, spawnT: 0.55
    };
    if (type === 'elite') { e.hp = e.maxHp = Math.round(d.hp * (0.85 + G.pressure * 0.35)); }
    enemies.push(e);
    burst(x, y, 8, '#6f7f6a', 120, 0.4, 2);
  }

  function updateEnemy(e, dt) {
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      if (Math.random() < dt * 10) {
        parts.push({ x: e.x + rand(-16, 16), y: e.y + rand(-16, 16), vx: 0, vy: -40, life: 0.4, max: 0.4, color: '#9cd8f2', size: 2 });
      }
      return;
    }
    if (e.burn > 0) {
      e.burn -= dt;
      e.hp -= dt * 3.2;
      if (Math.random() < dt * 8) parts.push({ x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), vx: 0, vy: -30, life: 0.4, max: 0.4, color: '#f28e34', size: 2 });
      if (e.hp <= 0) return killEnemy(e);
    }

    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    e.wob += dt * 6;

    if (e.type === 'clone') {
      e.stateT -= dt;
      if (e.state === 'idle') {
        e.vx = ux * e.speed; e.vy = uy * e.speed;
        if (d < 260 && e.atkCd <= 0) { e.state = 'wind'; e.stateT = 0.3; e.dir = Math.atan2(dy, dx); }
      } else if (e.state === 'wind') {
        e.vx *= 0.85; e.vy *= 0.85;
        if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.26; }
      } else if (e.state === 'dash') {
        e.vx = Math.cos(e.dir) * 620; e.vy = Math.sin(e.dir) * 620;
        if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = rand(0.9, 1.4); e.hp -= 2; }
      }
    } else if (e.type === 'wolf') {
      e.stateT -= dt;
      if (e.state === 'idle') {
        e.vx = ux * e.speed * 0.45; e.vy = uy * e.speed * 0.45;
        if (d < 250 && e.atkCd <= 0) { e.state = 'wind'; e.stateT = 0.38; e.dir = Math.atan2(dy, dx); }
      } else if (e.state === 'wind') {
        e.vx *= 0.86; e.vy *= 0.86;
        if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.30; burst(e.x, e.y, 6, '#cfe6f2', 90, 0.3, 2); }
      } else if (e.state === 'dash') {
        e.vx = Math.cos(e.dir) * 500; e.vy = Math.sin(e.dir) * 500;
        if (e.stateT <= 0) { e.state = 'idle'; e.atkCd = rand(1.1, 1.8); }
      }
    } else if (e.type === 'salamander') {
      if (d > 230) { e.vx = ux * e.speed; e.vy = uy * e.speed; }
      else if (d < 150) { e.vx = -ux * e.speed; e.vy = -uy * e.speed; }
      else { e.vx *= 0.9; e.vy *= 0.9; }
      e.atkCd -= dt;
      if (e.atkCd <= 0 && d < 460) {
        e.atkCd = rand(1.6, 2.3);
        spawnProj({
          x: e.x, y: e.y, ang: Math.atan2(dy, dx), spd: 250, r: 8,
          dmg: 1, life: 2.4, kind: 'fireball', owner: 'e'
        });
      }
    } else if (e.type === 'elite') {
      e.vx = ux * e.speed; e.vy = uy * e.speed;
      e.atkCd -= dt;
      if (e.atkCd <= 0 && d < 300) {
        e.atkCd = rand(2.2, 3.0);
        for (let i = 0; i < 4; i++) {
          spawnProj({
            x: e.x, y: e.y, ang: i / 4 * TAU + e.wob, spd: 190, r: 9,
            dmg: 1, life: 2.0, kind: 'bolt', owner: 'e'
          });
        }
      }
    } else {
      e.vx = ux * e.speed; e.vy = uy * e.speed;
      if (d < 40) { e.vx *= 0.4; e.vy *= 0.4; }
    }

    // 脱困：长时间原地打转就侧向绕行
    e.tAcc = (e.tAcc || 0) + dt;
    e.moveAcc = (e.moveAcc || 0) + Math.hypot(e.x - (e.lastX ?? e.x), e.y - (e.lastY ?? e.y));
    if (e.tAcc > 0.7) {
      if (e.moveAcc < 18) e.avoidT = 0.7;
      e.tAcc = 0; e.moveAcc = 0; e.lastX = e.x; e.lastY = e.y;
    }
    if (e.avoidT > 0) {
      e.avoidT -= dt;
      e.vx += -uy * e.speed * 1.3;
      e.vy += ux * e.speed * 1.3;
    }
    if (e.slowT > 0) { e.slowT -= dt; e.vx *= 0.45; e.vy *= 0.45; }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = clamp(e.x, X0 + e.r, X1 - e.r);
    e.y = clamp(e.y, Y0 + e.r, Y1 - e.r);
    resolveObstacles(e);

    // 接触伤害
    if (Math.hypot(player.x - e.x, player.y - e.y) < e.r + player.r - 2) {
      hurtPlayer(e.touch);
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      player.x += Math.cos(a) * 8; player.y += Math.sin(a) * 8;
    }
    if (e.hitT > 0) e.hitT -= dt;
    if (e.atkCd > 0) e.atkCd -= dt;
  }

  function killEnemy(e) {
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    G.kills++;
    if (player) {
      if (player.weapon === 'dainsleif') player.curseT = 5;
      if (player.killHealEvery) {
        player.killCount++;
        if (player.killCount % player.killHealEvery === 0) {
          player.hp = Math.min(player.maxHp, player.hp + 1);
          popText(player.x, player.y - 34, '+1', '#7ee0a0', 15);
        }
      }
    }
    burst(e.x, e.y, 16, e.type === 'elite' ? '#e8c866' : '#8a6a5a', 200, 0.5, 3);
    sfx('hit');
    if (e.type === 'elite') {
      popText(e.x, e.y - 20, '精英击破', '#e8c866', 16);
      pickups.push({ kind: 'heart', x: e.x, y: e.y, r: 14, t: 0 });
      pickups.push({ kind: 'coin', value: randi(3, 5), x: e.x + 16, y: e.y + 8, r: 11, t: 0 });
    } else {
      // 小怪 50% 掉金币（额外 10% 掉血瓶）
      if (Math.random() < 0.5) {
        pickups.push({ kind: 'coin', value: randi(1, 2), x: e.x, y: e.y, r: 11, t: 0 });
      }
      if (Math.random() < 0.075) {
        pickups.push({ kind: 'heart', x: e.x + 12, y: e.y, r: 12, t: 0 });
      }
    }
  }

  /* ---------- BOSS 芬里尔 ---------- */
  function spawnBoss(kind) {
    const def = BOSS_DEFS[kind] || BOSS_DEFS.fenrir;
    G.bossKind = kind;
    G.cutscene = 3.2;
    G.fade = Math.max(G.fade, 0.55);
    boss = {
      kind, x: W / 2, y: 182, r: def.r, hp: 200, maxHp: 200,
      state: 'walk', t: 1.2, dir: Math.PI / 2, vx: 0, vy: 0,
      hitT: 0, phase: 1, howlCd: 7, clones: [], enraged: false,
      summonType: def.summon, boltN: def.bolts
    };
    // 血量按玩家当前火力折算，越往后的层越厚
    const DPS = {
      bow: 6, gungnir: 7, mjolnir: 7, laevateinn: 9, runestaff: 4,
      tyrsword: 5, draupnir: 5, axe: 7, shield: 3, dainsleif: 9,
      brisingamen: 3
    };
    // 按当前手持武器折算，换更强的枪打得更快
    const dps = DPS[player.weapon] || 10;
    boss.hp = boss.maxHp = Math.round(clamp(dps * 16 * def.hpScale, 130, 700));
    sfx('boom');
  }

  function updateBoss(dt) {
    const b = boss;
    if (b.kind === 'jorm') {
      b.slither = (b.slither || 0) + dt * (2.0 + Math.hypot(b.vx, b.vy) * 0.016);
    }
    const dx = player.x - b.x, dy = player.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    b.hitT = Math.max(0, b.hitT - dt);

    const hpFrac = b.hp / b.maxHp;
    b.phase = hpFrac > 0.66 ? 1 : hpFrac > 0.33 ? 2 : 3;

    b.t -= dt;
    if (b.state === 'walk') {
      const speed = b.phase === 3 ? 112 : 78;
      b.vx = ux * speed; b.vy = uy * speed;
      if (b.phase === 3) b.t = Math.min(b.t, 0.6);
      if (b.t <= 0) {
        let moves;
        if (b.kind === 'jorm') {
          // 巨蟒不冲锋：射线 + 毒弹 + 砸地 + 锁链环 + 召唤
          moves = [
            ['ray', 30],
            ['howl', 24],
            ['slam', b.phase >= 2 ? 20 : 12],
            ['ring', b.phase >= 3 ? 16 : 0],
            ['clone', b.phase >= 2 ? 10 : 0]
          ];
        } else {
          moves = [
            ['tele', 26],
            ['leap', 16],
            ['howl', b.phase >= 2 ? 16 : 0],
            ['slam', b.phase >= 2 ? 14 : 0],
            ['shadow', b.phase >= 3 ? 14 : 0],
            ['clone', b.phase >= 3 ? 10 : 0],
            ['ring', b.phase >= 3 ? 12 : 0]
          ];
        }
        let total = 0;
        for (const m of moves) total += m[1];
        let r = Math.random() * total, chosen = 'tele';
        for (const m of moves) { r -= m[1]; if (r <= 0) { chosen = m[0]; break; } }

        if (chosen === 'ray') {
          b.state = 'ray'; b.t = 0.72; b.rayAng = Math.atan2(dy, dx);
        } else if (chosen === 'shadow') { b.state = 'shadow'; b.t = 0.42; b.dir = Math.atan2(dy, dx); }
        else if (chosen === 'clone') { b.state = 'clone'; b.t = 0.55; }
        else if (chosen === 'ring') { b.state = 'ring'; b.t = 0.72; }
        else if (chosen === 'slam') { b.state = 'slam'; b.t = 0.68; }
        else if (chosen === 'howl') { b.state = 'howl'; b.t = 0.62; }
        else if (chosen === 'leap') {
          b.state = 'leap'; b.t = 0.48;
          b.leapFrom = { x: b.x, y: b.y };
          b.leapTo = { x: player.x, y: player.y };
        } else { b.state = 'tele'; b.t = 0.5; b.dir = Math.atan2(dy, dx); }
      }
    } else if (b.state === 'tele') {
      b.vx *= 0.82; b.vy *= 0.82;
      b.dir = Math.atan2(dy, dx);
      if (b.t <= 0) {
        b.state = 'charge'; b.t = 0.44;
        sfx('dash');
      }
    } else if (b.state === 'charge') {
      // 冲锋途中缓慢修正方向，侧步躲不掉
      const want = Math.atan2(dy, dx);
      let cur = b.dir;
      let diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
      b.dir = cur + clamp(diff, -0.55 * dt, 0.55 * dt);
      const sp = b.phase === 3 ? 720 : 620;
      b.vx = Math.cos(b.dir) * sp; b.vy = Math.sin(b.dir) * sp;
      if (b.t <= 0) { b.state = 'walk'; b.t = b.phase === 3 ? 0.7 : rand(0.9, 1.35); }
    } else if (b.state === 'shadow') {
      b.vx *= 0.85; b.vy *= 0.85;
      b.dir = Math.atan2(dy, dx);
      if (b.t <= 0) {
        b.state = 'shadowDash'; b.t = 0.34;
        sfx('dash');
      }
    } else if (b.state === 'shadowDash') {
      b.vx = Math.cos(b.dir) * 900; b.vy = Math.sin(b.dir) * 900;
      if (Math.random() < 0.8) {
        parts.push({
          x: b.x + rand(-16, 16), y: b.y + rand(-16, 16),
          vx: 0, vy: 0, life: 0.35, max: 0.35, color: '#8a2f3a', size: rand(3, 6)
        });
      }
      if (b.t <= 0) { b.state = 'walk'; b.t = rand(0.6, 1.0); }
    } else if (b.state === 'howl') {
      b.vx *= 0.7; b.vy *= 0.7;
      if (b.t <= 0) {
        // 咆哮：冲击波 + 一圈暗影弹
        waves.push({ x: b.x, y: b.y, r: 40, maxR: 420, speed: 300, dmg: 1, hit: false });
        for (let i = 0; i < (b.boltN || 4); i++) {
          spawnProj({
            x: b.x, y: b.y, ang: i / (b.boltN || 4) * TAU + 0.4, spd: 220, r: 9,
            dmg: 1, life: 2.2, kind: 'fireball', owner: 'e'
          });
        }
        G.shake = 16; sfx('boom');
        b.state = 'walk'; b.t = rand(0.8, 1.2);
      }
    } else if (b.state === 'ray') {
      b.vx *= 0.5; b.vy *= 0.5;
      b.rayAng = Math.atan2(dy, dx);
      if (b.t <= 0) {
        b.state = 'beam'; b.t = 0.38; b.beamAng = b.rayAng;
        G.shake = 16; sfx('boom');
      }
    } else if (b.state === 'beam') {
      b.vx *= 0.35; b.vy *= 0.35;
      // 射线判定：角度差 + 距离
      const pa = Math.atan2(player.y - b.y, player.x - b.x);
      let da = Math.abs(((pa - b.beamAng + Math.PI * 3) % TAU) - Math.PI);
      if (da < 0.14 && Math.hypot(player.x - b.x, player.y - b.y) < 560) hurtPlayer(1);
      if (b.t <= 0) { b.state = 'walk'; b.t = rand(0.9, 1.3); }
    } else if (b.state === 'slam') {
      b.vx *= 0.6; b.vy *= 0.6;
      if (b.t <= 0) {
        // 裂地：在玩家周围砸出三处暗影裂隙
        for (let i = 0; i < 3; i++) {
          const a = rand(0, TAU), rr = i === 0 ? 0 : rand(70, 130);
          zones.push({
            x: clamp(player.x + Math.cos(a) * rr, X0 + 30, X1 - 30),
            y: clamp(player.y + Math.sin(a) * rr, Y0 + 30, Y1 - 30),
            r: 58, t: 0.62, max: 0.62, dmg: 1
          });
        }
        G.shake = 12; sfx('boom');
        b.state = 'walk'; b.t = rand(0.8, 1.2);
      }
    } else if (b.state === 'clone') {
      b.vx *= 0.6; b.vy *= 0.6;
      if (b.t <= 0) {
        // 影分身：两只血色分身，各扑一次
        G.banner = 1.4; G.bannerText = '芬里尔 · 影分身';
        for (let i = 0; i < 2; i++) {
          const a = rand(0, TAU);
          spawnEnemy('clone', clamp(b.x + Math.cos(a) * 70, X0 + 40, X1 - 40),
            clamp(b.y + Math.sin(a) * 70, Y0 + 40, Y1 - 40));
        }
        sfx('dash');
        b.state = 'walk'; b.t = rand(0.7, 1.0);
      }
    } else if (b.state === 'ring') {
      b.vx *= 0.5; b.vy *= 0.5;
      if (b.t <= 0) {
        // 锁链环：绕 BOSS 一圈的锁链爆点
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU;
          zones.push({
            x: b.x + Math.cos(a) * 150, y: b.y + Math.sin(a) * 150,
            r: 52, t: 0.62, max: 0.62, dmg: 1
          });
        }
        G.shake = 14; sfx('boom');
        b.state = 'walk'; b.t = rand(0.8, 1.2);
      }
    } else if (b.state === 'leap') {
      const t = 1 - Math.max(0, b.t) / 0.48;
      b.x = b.leapFrom.x + (b.leapTo.x - b.leapFrom.x) * t;
      b.y = b.leapFrom.y + (b.leapTo.y - b.leapFrom.y) * t;
      b.vx = b.vy = 0;
      if (b.t <= 0) {
        burst(b.x, b.y, 30, '#c25b4e', 320, 0.6, 4);
        G.shake = 14; sfx('boom');
        if (Math.hypot(player.x - b.x, player.y - b.y) < 96) hurtPlayer(1);
        waves.push({ x: b.x, y: b.y, r: 20, maxR: 170, speed: 260, dmg: 1, hit: false });
        b.state = 'walk'; b.t = rand(0.7, 1.1);
      }
    }

    if (b.state !== 'leap') {
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    b.x = clamp(b.x, X0 + b.r, X1 - b.r);
    b.y = clamp(b.y, Y0 + b.r, Y1 - b.r);
    resolveObstacles(b);

    // 耶梦加得的沼泽：靠近就减速 + 周期性腐蚀
    if (b.kind === 'jorm') {
      const dd = Math.hypot(player.x - b.x, player.y - b.y);
      if (dd < 128) {
        player.slowT = 0.12;
        b.swampCd = (b.swampCd || 0) - dt;
        if (b.swampCd <= 0) {
          b.swampCd = 1.2;
          hurtPlayer(1);
          popText(player.x, player.y - 30, '沼泽腐蚀', '#7ee0a0', 13);
        }
      }
    }

    // 接触伤害：只有冲锋 / 突袭撞到才疼，站着贴着不扣血（避免被堵在墙角耗死）
    if ((b.state === 'charge' || b.state === 'shadowDash') &&
        Math.hypot(player.x - b.x, player.y - b.y) < b.r + player.r - 4) {
      hurtPlayer(1);
    }

    // 残血狂暴
    if (b.hp < b.maxHp * 0.2 && !b.enraged) {
      b.enraged = true;
      G.banner = 1.8; G.bannerText = '芬里尔 · 狂暴';
      G.shake = 18; sfx('boom');
      burst(b.x, b.y, 40, '#ff5a4a', 380, 0.9, 5);
    }
    if (b.enraged) {
      b.t = Math.min(b.t, 0.45);
    }

    // 阶段 2 起：周期性喷暗影弹骚扰
    if (b.phase >= 2) {
      b.shotCd = (b.shotCd || 0) - dt;
      if (b.shotCd <= 0) {
        b.shotCd = b.phase === 3 ? 2.0 : 2.8;
        const a = Math.atan2(player.y - b.y, player.x - b.x) + rand(-0.12, 0.12);
        spawnProj({ x: b.x, y: b.y, ang: a, spd: 320, r: 10, dmg: 1, life: 2.0, kind: 'fireball', owner: 'e' });
        sfx('shoot');
      }
    }

    // 阶段 2：掉一瓶蜜酒（回 1 血）
    if (b.phase >= 2 && !b.gaveHeart) {
      b.gaveHeart = true;
      pickups.push({ kind: 'heart', x: W / 2 - 120, y: H / 2 + 120, r: 12, t: 0 });
      popText(W / 2 - 120, H / 2 + 100, '英灵殿的蜜酒', '#7ee0a0', 15);
    }

    // 阶段 2 起持续召唤影狼
    if (b.phase >= 2) {
      b.howlCd -= dt;
      if (b.howlCd <= 0 && enemies.length < 6) {
        b.howlCd = b.phase === 3 ? 8 : 11;
        G.banner = 1.4; G.bannerText = '芬里尔咆哮 · 影狼来了';
        for (let i = 0; i < (b.phase === 3 ? 2 : 1); i++) {
          const a = rand(0, TAU);
          spawnEnemy(b.summonType || 'wolf', clamp(b.x + Math.cos(a) * 80, X0 + 40, X1 - 40),
            clamp(b.y + Math.sin(a) * 80, Y0 + 40, Y1 - 40));
        }
      }
    }
  }

  function updateZones(dt) {
    for (const z of zones) {
      z.t -= dt;
      if (z.t <= 0 && !z.done) {
        z.done = true;
        burst(z.x, z.y, 18, '#e04a3a', 240, 0.5, 3);
        if (Math.hypot(player.x - z.x, player.y - z.y) < z.r) hurtPlayer(z.dmg);
        G.shake = Math.max(G.shake, 7);
      }
    }
    zones = zones.filter(z => !z.done || z.t > -0.25);
  }

  function explodeBarrel(h) {
    h.dead = true;
    burst(h.x, h.y, 26, '#f28e34', 320, 0.7, 4);
    G.shake = 14; sfx('boom');
    for (const e of enemies.slice()) {
      if (Math.hypot(e.x - h.x, e.y - h.y) < 104) {
        e.hp -= 7; e.hitT = 0.12;
        popText(e.x, e.y - 16, 7, '#ffd98a', 13);
        if (e.hp <= 0) killEnemy(e);
      }
    }
    if (boss && Math.hypot(boss.x - h.x, boss.y - h.y) < 104) hurtBoss(9);
    if (Math.hypot(player.x - h.x, player.y - h.y) < 104) hurtPlayer(2);
  }

  function updateHazards(dt) {
    for (const h of hazards) {
      if (h.k === 'barrel') continue;
      h.cd = Math.max(0, (h.cd || 0) - dt);
      const d = Math.hypot(player.x - h.x, player.y - h.y);
      if (d < h.r + player.r) {
        if (h.k === 'poison') player.slowT = 0.12;
        if (h.cd <= 0) {
          h.cd = 1.2;
          hurtPlayer(1);
          popText(player.x, player.y - 30, h.k === 'poison' ? '中毒' : '灼烧',
            h.k === 'poison' ? '#7ee0a0' : '#f28e34', 13);
        }
      }
    }
    hazards = hazards.filter(h => !h.dead);
  }

  function updateWaves(dt) {
    for (const z of zones) {
      const k = 1 - z.t / z.max;
      ctx.globalAlpha = 0.18 + 0.25 * k;
      ctx.fillStyle = '#c22b2b';
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#ff8a6a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (1 - k * 0.55), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const w of waves) {
      w.r += w.speed * dt;
      if (!w.hit) {
        const dd = Math.hypot(player.x - w.x, player.y - w.y);
        if (Math.abs(dd - w.r) < 26) { hurtPlayer(w.dmg); w.hit = true; }
      }
    }
    waves = waves.filter(w => w.r < w.maxR);
  }

  function hurtBoss(dmg) {
    boss.hp -= dmg;
    boss.hitT = 0.12;
    popText(boss.x + rand(-10, 10), boss.y - 30, Math.round(dmg), '#ffd98a', 15);
    if (boss.hp <= 0) {
      burst(boss.x, boss.y, 60, '#e8c866', 420, 0.9, 5);
      G.shake = 22; sfx('boom');
      boss = null;
      G.justBoss = true;
      G.bossOut = 1.4;
      G.banner = 2.6; G.bannerText = '黄昏落定';
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), sp = rand(60, 260);
        parts.push({
          x: W / 2 + rand(-40, 40), y: H / 2 + rand(-60, 60),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.6, 1.4), max: 1.4, color: '#e8c866', size: rand(2, 4)
        });
      }
      setCleared();
    }
  }

  /* ---------- 投射物 ---------- */
  function melee(p, ang, range, arc, dmg, knock, color) {
    slashes.push({ x: p.x, y: p.y, ang, range, arc, t: 0.20, max: 0.20, color: color || '#fff' });
    const hitOne = (e) => {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > range + e.r) return;
      let da = Math.atan2(e.y - p.y, e.x - p.x) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > arc / 2) return;
      e.hp -= dmg; e.hitT = 0.1;
      if (knock) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.x += Math.cos(a) * knock * 0.05;
        e.y += Math.sin(a) * knock * 0.05;
      }
      popText(e.x, e.y - 16, Math.round(dmg), '#ffe6a8', 13);
      burst(e.x, e.y, 4, color || '#ffd98a', 120, 0.3, 2);
      if (e.hp <= 0) killEnemy(e);
    };
    enemies.slice().forEach(hitOne);
    if (boss) {
      const d = Math.hypot(boss.x - p.x, boss.y - p.y);
      let da = Math.atan2(boss.y - p.y, boss.x - p.x) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d < range + boss.r && Math.abs(da) < arc / 2) hurtBoss(dmg);
    }
    sfx('hit');
  }

  function clearEnemyBullets(x, y, r) {
    for (const q of projs) {
      if (q.owner === 'e' && Math.hypot(q.x - x, q.y - y) < r) {
        q.life = 0;
        burst(q.x, q.y, 3, '#9cd8f2', 90, 0.25, 2);
      }
    }
  }

  function spawnProj(o) {
    projs.push(Object.assign({
      x: 0, y: 0, ang: 0, spd: 400, r: 6, dmg: 1, life: 1, kind: 'arrow',
      owner: 'p', pierce: 0, hit: [], homing: 0, burn: 0, back: false, boomerang: false
    }, o, { vx: Math.cos(o.ang) * o.spd, vy: Math.sin(o.ang) * o.spd }));
  }

  function updateProj(p, dt) {
    p.life -= dt;
    if (p.homing) {
      const target = p.owner === 'p' ? nearestEnemy(p) : (player ? player : null);
      if (target && !p.back) {
        const want = Math.atan2(target.y - p.y, target.x - p.x);
        let cur = Math.atan2(p.vy, p.vx);
        let diff = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
        cur += clamp(diff, -p.homing * dt, p.homing * dt);
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(cur) * sp; p.vy = Math.sin(cur) * sp;
      }
    }
    if (p.boomerang && p.life < 0.55) {
      const dx = player.x - p.x, dy = player.y - p.y;
      const dd = Math.hypot(dx, dy) || 1;
      p.vx += dx / dd * 1400 * dt; p.vy += dy / dd * 1400 * dt;
      const sp = Math.hypot(p.vx, p.vy);
      p.vx *= sp > 640 ? 640 / sp : 1; p.vy *= sp > 640 ? 640 / sp : 1;
      if (dd < 24) { p.life = 0; }
    }

    p.x += p.vx * dt; p.y += p.vy * dt;

    if (p.x < X0 - 20 || p.x > X1 + 20 || p.y < Y0 - 20 || p.y > Y1 + 20) {
      if (!p.boomerang) p.life = 0;
    }

    if (p.life <= 0) {
      if (p.split && !p.didSplit) {
        p.didSplit = true;
        for (let i = -1; i <= 1; i++) {
          spawnProj({
            x: p.x, y: p.y, ang: p.ang + i * 0.5, spd: 420, r: 7,
            dmg: p.dmg * 0.6, life: 0.5, kind: 'ring', owner: 'p'
          });
        }
      }
      return;
    }

    // 战船挡子弹
    if (p.owner === 'e') {
      for (const s of shields) {
        if (Math.hypot(p.x - s.x, p.y - s.y) < s.r) {
          burst(p.x, p.y, 4, '#9ad0c8', 100, 0.25, 2);
          p.life = 0;
          return;
        }
      }
    }

    if (p.owner === 'p') {
      for (const e of enemies.slice()) {
        if (p.hit.includes(e)) continue;
        if (Math.hypot(p.x - e.x, p.y - e.y) < p.r + e.r) {
          p.hit.push(e);
          e.hp -= p.dmg;
          e.hitT = 0.1;
          if (p.burn) e.burn = 2.2;
          popText(e.x + rand(-8, 8), e.y - 16, Math.round(p.dmg), '#ffe6a8', 13);
          burst(p.x, p.y, 5, '#ffd98a', 120, 0.3, 2);
          sfx('hit');
          if (e.hp <= 0) killEnemy(e);
          if (!p.boomerang && p.pierce-- <= 0) { p.life = 0; return; }
        }
      }
      for (const h of hazards) {
        if (h.k !== 'barrel' || h.dead) continue;
        if (Math.hypot(p.x - h.x, p.y - h.y) < p.r + h.r) {
          h.hp -= p.dmg;
          burst(p.x, p.y, 4, '#f28e34', 100, 0.25, 2);
          p.life = 0;
          if (h.hp <= 0) explodeBarrel(h);
          break;
        }
      }
      if (boss && Math.hypot(p.x - boss.x, p.y - boss.y) < p.r + boss.r) {
        hurtBoss(p.dmg);
        burst(p.x, p.y, 6, '#ffd98a', 140, 0.3, 2);
        if (!p.boomerang && p.pierce-- <= 0) p.life = 0;
      }
    } else {
      if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + player.r) {
        hurtPlayer(p.dmg);
        p.life = 0;
      }
    }
  }

  function nearestEnemy(p) {
    let best = null, bd = 1e9;
    for (const e of enemies) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (boss) {
      const d = Math.hypot(boss.x - p.x, boss.y - p.y);
      if (d < bd) best = boss;
    }
    return best;
  }

  /* ---------- 碰撞 ---------- */
  function rectCircle(o, c) {
    const cx = clamp(c.x, o.x, o.x + o.w);
    const cy = clamp(c.y, o.y, o.y + o.h);
    const dx = c.x - cx, dy = c.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < c.r) {
      if (d === 0) { c.x = o.x - c.r; return; }
      c.x += dx / d * (c.r - d);
      c.y += dy / d * (c.r - d);
    }
  }
  function resolveObstacles(c) {
    for (const o of obstacles) rectCircle(o, c);
  }

  /* ---------- 伤害 ---------- */
  function hurtPlayer(dmg, silent) {
    if (!player || G.mode !== 'play') return;
    if (silent || dmg <= 0) return;
    if (player.iframe > 0) return;
    // 护盾条：先扣盾，溢出才扣血
    player.shieldT = 0;
    if (player.shield > 0) {
      const use = Math.min(player.shield, dmg);
      player.shield -= use;
      dmg -= use;
      burst(player.x, player.y, 8, '#7fb4d8', 160, 0.4, 2.5);
      if (dmg <= 0) {
        player.iframe = Math.max(player.iframe, 0.45);
        G.shake = 6;
        sfx('hit');
        return;
      }
    }


    if (player.fireCurse && player.weapon === 'laevateinn') dmg += 1;

    player.hp -= dmg;
    player.iframe = 1.05 + (player.iframeBonus || 0);
    player.hurtFlash = 0.35;
    G.hits++;
    G.shake = 10;
    G.flash = 0.18;
    sfx('hurt');
    burst(player.x, player.y, 12, '#c25b4e', 180, 0.45, 3);

    if (player.hp <= 0) {
      if (player.lastThread) {
        player.lastThread = false;
        player.hp = player.maxHp;
        G.banner = 2; G.bannerText = '最后一根线 · 断了又接上';
        popText(player.x, player.y - 30, '命运回响', '#9cd8f2', 20);
        return;
      }
      player.hp = 0;
      die();
    }
  }

  function die() {
    G.mode = 'dead';
    const deaths = +(LS.get('hh_deaths') || 0) + 1;
    LS.set('hh_deaths', deaths);
    G.shake = 20;
    burst(player.x, player.y, 50, '#c25b4e', 380, 0.9, 4);
    document.getElementById('dKills').textContent = G.kills;
    document.getElementById('dTime').textContent = Math.floor(G.time) + 's';
    document.getElementById('dHits').textContent = G.hits;
    document.getElementById('dRoom').textContent = LEVELS[G.level].name;
    document.getElementById('deadMeta').textContent = '第 ' + deaths + ' 次回到英灵殿 · 织机记住了你';
    show('ovDead');
  }

  function win() {
    G.mode = 'win';
    const wins = +(LS.get('hh_wins') || 0) + 1;
    LS.set('hh_wins', wins);
    document.getElementById('wKills').textContent = G.kills;
    document.getElementById('wTime').textContent = Math.floor(G.time) + 's';
    document.getElementById('wHits').textContent = G.hits;
    document.getElementById('wFate').textContent = player.prophecies.length + ' 条';
    show('ovWin');
  }

  /* ---------- 玩家更新 ---------- */
  function updatePlayer(dt) {
    const p = player;
    p.cd -= dt; p.iframe -= dt; p.dashCd -= dt; p.hurtFlash -= dt;
    // 脱战 3 秒后护盾自动回充
    p.shieldT += dt;
    if (p.shieldT > 3 && p.shield < p.shieldMax) {
      p.shield = Math.min(p.shieldMax, p.shield + dt * 2.2);
    }

    // 冲刺
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVx * dt; p.y += p.dashVy * dt;
      if (Math.random() < 0.7) parts.push({
        x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20),
        life: 0.25, max: 0.25, color: '#9cd8f2', size: 2.5
      });
    } else {
      let mx = 0, my = 0;
      if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
      if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) my += 1;
      const m = Math.hypot(mx, my);
      if (m > 0) { mx /= m; my /= m; p.walk += dt * 10; } else { p.walk *= 0.9; }
      const spd = p.speed * (p.slowT > 0 ? 0.55 : 1);
      p.slowT = Math.max(0, p.slowT - dt);
      p.x += mx * spd * dt;
      p.y += my * spd * dt;

      if ((keys['Space']) && p.dashCd <= 0) {
        p.dashCd = p.dashCdBase;
        p.dashT = 0.16;
        p.iframe = Math.max(p.iframe, 0.3);
        const a = m > 0 ? Math.atan2(my, mx) : p.aim;
        p.dashVx = Math.cos(a) * 620; p.dashVy = Math.sin(a) * 620;
        sfx('dash');
        burst(p.x, p.y, 8, '#9cd8f2', 140, 0.3, 2);
      }
    }

    p.x = clamp(p.x, X0 + p.r, X1 - p.r);
    p.y = clamp(p.y, Y0 + p.r, Y1 - p.r);
    resolveObstacles(p);

    // 演示模式自动瞄准（仅供截图/录屏）
    if (window.__DEMO) {
      const tgt = nearestEnemy(p);
      if (tgt) { mouse.x = tgt.x; mouse.y = tgt.y; }
    }
    // 瞄准
    p.aim = Math.atan2(mouse.y - p.y, mouse.x - p.x);

    // 布里辛加门：光环减速
    if (p.weapon === 'brisingamen') {
      for (const e of enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) < 132) e.slowT = 0.18;
      }
    }

    // 达因斯莱夫的诅咒：5 秒内不杀人就掉血
    if (p.curseT > 0) {
      p.curseT -= dt;
      if (p.curseT <= 0) {
        p.curseT = 0;
        popText(p.x, p.y - 34, '诅咒反噬', '#e04a3a', 15);
        hurtPlayer(1);
      }
    }

    // 开火
    const firing = mouse.down || keys['KeyJ'] || (window.__DEMO && !!nearestEnemy(p));
    const wp = WEAPONS[p.weapon];
    if (firing && p.cd <= 0) {
      p.cd = wp.cd * p.cdMul;
      wp.fire(p, p.aim);
      sfx('shoot');
      G.shake = Math.max(G.shake, 1.5);
    }

    // 换武器
    ['Digit1', 'Digit2', 'Digit3', 'Digit4'].forEach((k, i) => {
      if (keys[k] && p.owned[i]) { p.weapon = p.owned[i]; keys[k] = false; }
    });

    // 商店：靠近按 E 购买
    if (LEVELS[G.level].shop) {
      for (const it of shopItems) {
        if (it.sold) continue;
        if (Math.hypot(it.x - p.x, it.y - p.y) < 52) {
          if (keys['KeyE']) {
            keys['KeyE'] = false;
            if (p.coins >= it.price) {
              p.coins -= it.price;
              it.sold = true;
              applyShopItem(it);
              sfx('pick');
            } else {
              popText(it.x, it.y - 42, '金币不够', '#c25b4e', 14);
            }
          }
        }
      }
    }

    // 金币 / 血瓶：自动拾取
    for (const it of pickups.slice()) {
      if (it.kind !== 'weapon' && Math.hypot(it.x - p.x, it.y - p.y) < 36) takePickup(it);
    }
    // 武器：玩家自己决定，靠近按 E 才拿
    for (const it of pickups.slice()) {
      if (it.kind !== 'weapon') continue;
      if (Math.hypot(it.x - p.x, it.y - p.y) < 72 && keys['KeyE']) {
        keys['KeyE'] = false;
        takePickup(it);
        break;
      }
    }
  }

  function applyShopItem(it) {
    if (it.kind === 'heal') {
      player.hp = Math.min(player.maxHp, player.hp + 2);
      popText(player.x, player.y - 40, '+2 生命', '#7ee0a0', 16);
    } else if (it.kind === 'maxhp') {
      player.maxHp += 1;
      player.hp = Math.min(player.maxHp, player.hp + 1);
      popText(player.x, player.y - 40, '上限 +1', '#7ee0a0', 16);
    } else if (it.kind === 'dmg') {
      player.dmg *= 1.3;
      popText(player.x, player.y - 40, '伤害 +30%', '#e8c866', 16);
    } else if (it.kind === 'weapon') {
      const w = pick(WEAPON_KEYS);
      if (!player.owned.includes(w)) {
        player.owned.push(w);
        if (player.owned.length > 4) player.owned.shift();
      }
      player.weapon = w;
      popText(player.x, player.y - 40, WEAPONS[w].name, WEAPONS[w].color, 16);
    }
  }

  function takePickup(it) {
    const i = pickups.indexOf(it);
    if (i >= 0) pickups.splice(i, 1);
    sfx('pick');
    if (it.kind === 'heart') {
      player.hp = Math.min(player.maxHp, player.hp + 1);
      popText(it.x, it.y - 16, '+1', '#7ee0a0', 16);
    } else if (it.kind === 'coin') {
      player.coins += Math.ceil(it.value * (player.coinMul || 1));
      popText(it.x, it.y - 16, '+' + it.value, '#e8c866', 14);
      sfx('pick');
    } else if (it.kind === 'weapon') {
      if (!player.owned.includes(it.weapon)) {
        player.owned.push(it.weapon);
        if (player.owned.length > 4) player.owned.shift();
      }
      player.weapon = it.weapon;
      popText(it.x, it.y - 16, WEAPONS[it.weapon].name, WEAPONS[it.weapon].color, 16);
    }
  }

  /* ---------- 关卡状态 ---------- */
  function setCleared() {
    if (cleared) return;
    if (LEVELS[G.level].shop) return;
    cleared = true;
    G.banner = 1.8;
    G.bannerText = '此地已净';
    sfx('clear');
    if (player) {
      if (LEVELS[G.level].boss) {
        player.hp = player.maxHp;
        player.shield = player.shieldMax;
        player.shieldT = 0;
      }
      player.hp = Math.min(player.maxHp, player.hp + (player.clearHeal || 1));
    }
    if (LEVELS[G.level].boss) offerBlessings();
    if (!boss) {
      // 掉落：血瓶 + 概率武器（BOSS 必掉两把）
      pickups.push({ kind: 'heart', x: W / 2 - 90, y: H / 2 + 40, r: 12, t: 0 });
      const nDrop = G.justBoss ? 2 : (Math.random() < 0.65 ? 1 : 0);
      for (let i = 0; i < nDrop; i++) {
        const w = pick(WEAPON_KEYS);
        pickups.push({
          kind: 'weapon', weapon: w,
          x: W / 2 - 60 + i * 120 + rand(-20, 20), y: H / 2 + 60, r: 16, t: 0
        });
      }
      portal = { x: X1 - 30, y: H / 2, r: 30, t: 0 };
    }
  }

  /* ---------- 主更新 ---------- */
  function update(dt) {
    if (G.mode !== 'play') { G.banner = Math.max(0, G.banner - dt * 0.2); return; }

    // 塔罗牌入场演出：暂停战斗，只跑粒子和计时
    if (G.cutscene > 0) {
      const prev = G.cutscene;
      G.cutscene -= dt;
      // 卡牌崩解瞬间：炸出一把金屑
      if (prev > 0.5 && G.cutscene <= 0.5) {
        for (let i = 0; i < 70; i++) {
          const a = rand(0, TAU), sp = rand(70, 420);
          parts.push({
            x: W / 2 + rand(-120, 120), y: H / 2 - 12 + rand(-200, 200),
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: rand(0.5, 1.3), max: 1.3,
            color: pick(['#e8c866', '#f2e8d2', '#b8932f', '#fff3c8']),
            size: rand(2, 5)
          });
        }
        G.shake = 20; G.flash = 0.35; sfx('boom');
      }
      if (G.cutscene <= 0) {
        G.shake = 14;
        if (boss) burst(boss.x, boss.y, 26, '#c25b4e', 300, 0.7, 4);
      }
      G.fade = Math.max(0, G.fade - dt * 2.2);
      for (const pt of parts) { pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
      parts = parts.filter(p => p.life > 0);
      if (G.cutscene <= 0) G.cutscene = 0;
      return;
    }
    if (G.bossOut > 0) G.bossOut = Math.max(0, G.bossOut - dt);
    G.time += dt;
    G.shake *= 0.88;
    G.flash = Math.max(0, G.flash - dt * 3);
    G.fade = Math.max(0, G.fade - dt * 2.2);
    G.roomIntro = Math.max(0, G.roomIntro - dt);
    if (G.banner > 0) G.banner -= dt;

    updatePlayer(dt);

    for (const e of enemies.slice()) updateEnemy(e, dt);

    // 敌人互斥，避免重叠成一团
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i], b = enemies[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d < min) {
          const push = (min - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        }
      }
    }
    for (const e of enemies) {
      e.x = clamp(e.x, X0 + e.r, X1 - e.r);
      e.y = clamp(e.y, Y0 + e.r, Y1 - e.r);
    }
    if (boss) updateBoss(dt);
    updateHazards(dt);
    updateWaves(dt);
    updateZones(dt);

    for (const p of projs.slice()) updateProj(p, dt);
    projs = projs.filter(p => p.life > 0);

    for (const pt of parts) {
      pt.life -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
    }
    parts = parts.filter(p => p.life > 0);

    for (const t of texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= 0.94; }
    texts = texts.filter(t => t.life > 0);

    for (const it of pickups) it.t += dt;
    for (const s of slashes) s.t -= dt;
    slashes = slashes.filter(s => s.t > 0);
    for (const s of shields) s.t -= dt;
    shields = shields.filter(s => s.t > 0);

    if (!cleared && !boss && enemies.length === 0) setCleared();

    if (portal) {
      portal.t += dt;
      if (Math.hypot(player.x - portal.x, player.y - portal.y) < portal.r + player.r) {
        if (G.level + 1 >= LEVELS.length) win();
        else { initLevel(G.level + 1); }
      }
    }
  }

  /* ---------- 绘制：背景 ---------- */
  const THEME = {
    ice: { bg1: '#0a1524', bg2: '#122437', line: '#1b3350', wall: '#0d1a2b', wallLine: '#2a4a6a', mote: '#9cd8f2' },
    stone: { bg1: '#0d1410', bg2: '#16211a', line: '#20301f', wall: '#101a14', wallLine: '#2e4030', mote: '#9fb89a' },
    fire: { bg1: '#1a0b08', bg2: '#2a120c', line: '#3a1a10', wall: '#150a07', wallLine: '#5a2a12', mote: '#f28e34' },
    boss: { bg1: '#0c0a14', bg2: '#171226', line: '#241a3a', wall: '#0e0b18', wallLine: '#3a2a5a', mote: '#c9a0ff' },
    sea: { bg1: '#04121a', bg2: '#0a2630', line: '#12333c', wall: '#061620', wallLine: '#1e4a52', mote: '#7fd8d0' },
    hel: { bg1: '#050a0a', bg2: '#0b1a18', line: '#132624', wall: '#071110', wallLine: '#21403a', mote: '#7fd0b0' },
    shop: { bg1: '#140f0a', bg2: '#241a10', line: '#33261a', wall: '#120d08', wallLine: '#5a4426', mote: '#e8c866' }
  };

  function drawBackground(t) {
    const th = THEME[LEVELS[G.level].theme] || THEME.ice;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.bg1);
    g.addColorStop(1, th.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 地砖
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    for (let x = X0; x <= X1; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, Y0); ctx.lineTo(x, Y1); ctx.stroke();
    }
    for (let y = Y0; y <= Y1; y += 48) {
      ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.stroke();
    }
    // 墙
    ctx.fillStyle = th.wall;
    ctx.fillRect(0, 0, W, WALL);
    ctx.fillRect(0, H - WALL, W, WALL);
    ctx.fillRect(0, 0, WALL, H);
    ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.strokeStyle = th.wallLine;
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL, WALL, W - WALL * 2, H - WALL * 2);
    // 墙面刻痕
    ctx.strokeStyle = th.wallLine;
    ctx.globalAlpha = 0.35;
    for (let x = 20; x < W; x += 90) {
      ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x + 26, WALL - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, H - 8); ctx.lineTo(x + 26, H - WALL + 8); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 环境粒子
    for (let i = 0; i < 26; i++) {
      const px = (i * 137 + t * (i % 2 ? 14 : -10)) % W;
      const py = (i * 83 + t * (i % 3 ? 8 : 16)) % H;
      ctx.globalAlpha = 0.12 + 0.12 * Math.sin(t * 2 + i);
      ctx.fillStyle = th.mote;
      ctx.fillRect(px | 0, py | 0, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawDecals() {
    const th = THEME[LEVELS[G.level].theme] || THEME.ice;
    for (const d of props) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.a);
      ctx.scale(d.s, d.s);
      ctx.globalAlpha = 0.20;
      if (d.k === 0) {              // 裂纹
        ctx.strokeStyle = th.wallLine; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-12, 0); ctx.lineTo(-4, 3); ctx.lineTo(2, -2); ctx.lineTo(9, 4); ctx.lineTo(16, 0);
        ctx.stroke();
      } else if (d.k === 1) {       // 骨
        ctx.strokeStyle = '#cfc8b4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0.3, 2.6); ctx.stroke();
        ctx.fillStyle = '#cfc8b4';
        ctx.fillRect(-8, -2, 3, 3); ctx.fillRect(6, -2, 3, 3);
      } else {                      // 卢恩刻痕
        ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-5, -8); ctx.lineTo(-5, 8);
        ctx.moveTo(-5, -4); ctx.lineTo(6, -9);
        ctx.moveTo(-5, 2); ctx.lineTo(6, 7);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawObstacles() {
    for (const o of obstacles) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(o.x + 4, o.y + 6, o.w, o.h);
      const th = THEME[LEVELS[G.level].theme] || THEME.ice;
      ctx.fillStyle = th.wall;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = th.wallLine;
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = th.wallLine;
      ctx.beginPath();
      ctx.moveTo(o.x + 6, o.y + 6); ctx.lineTo(o.x + o.w - 6, o.y + o.h - 6);
      ctx.moveTo(o.x + o.w - 6, o.y + 6); ctx.lineTo(o.x + 6, o.y + o.h - 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- 绘制：角色 ---------- */
  function drawShadow(x, y, r) {
    ctx.globalAlpha = 0.28;
    ell(x, y + r * 0.85, r * 0.95, r * 0.38, '#000');
    ctx.globalAlpha = 1;
  }

  /* ---------- 手持武器（朝 +X，握把在原点，像素风） ---------- */
  const OUTLINE = '#0d1420';
  function drawWeaponInHand(key, sc) {
    ctx.save();
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    switch (key) {
      case 'bow': {
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(4, 0, 15, -1.1, 1.1); ctx.stroke();
        ctx.strokeStyle = '#d8d0b8'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(10.8, -13.2); ctx.lineTo(10.8, 13.2); ctx.stroke();
        ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(24, 0); ctx.stroke();
        poly([[24, -3], [31, 0], [24, 3]], '#dce6f0', OUTLINE, 1);
        break;
      }
      case 'gungnir': {
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(22, 0); ctx.stroke();
        ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(2, 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(13, -4); ctx.lineTo(13, 4); ctx.stroke();
        poly([[22, -6], [40, 0], [22, 6]], '#e6f4ff', '#7fb4d4', 2);
        ctx.fillStyle = '#d4a832';
        ctx.fillRect(24, -6, 2, 12);
        break;
      }
      case 'mjolnir': {
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(10, 0); ctx.stroke();
        ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2;
        for (const x of [-8, -2, 4]) { ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x, 3); ctx.stroke(); }
        ctx.fillStyle = '#8fa4bc'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2;
        ctx.fillRect(10, -12, 22, 24); ctx.strokeRect(10, -12, 22, 24);
        ctx.fillStyle = '#cfe0ee'; ctx.fillRect(10, -12, 22, 7);
        ctx.fillStyle = '#d4a832'; ctx.fillRect(26, -12, 3, 24);
        break;
      }
      case 'laevateinn': {
        poly([[8, -3], [34, -2], [42, 0], [34, 2], [8, 3]], '#f2e8d2', '#a8481a', 2);
        ctx.fillStyle = '#f28e34';
        poly([[10, -3], [22, -11], [27, -3]], '#f28e34', null);
        poly([[12, 3], [24, 11], [29, 3]], '#f28e34', null);
        ctx.fillStyle = 'rgba(255,220,140,.85)';
        poly([[14, -2], [30, -1], [34, 0], [30, 1], [14, 2]], 'rgba(255,220,140,.85)', null);
        ctx.fillStyle = '#d4a832'; ctx.fillRect(4, -8, 4, 16);
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(-12, -2, 16, 4);
        break;
      }
      case 'runestaff': {
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(18, 0); ctx.stroke();
        ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(25, 0, 9, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(126,224,160,.9)';
        ctx.beginPath(); ctx.arc(25, 0, 5.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8ffe8';
        ctx.beginPath(); ctx.arc(24, -1.5, 2, 0, TAU); ctx.fill();
        break;
      }
      case 'tyrsword': {
        poly([[8, -3], [26, -3], [30, -1], [30, 1], [26, 3], [8, 3]], '#b8cce0', OUTLINE, 2);
        ctx.fillStyle = '#8fa4bc';
        poly([[26, -3], [31, 0], [26, 3]], '#8fa4bc', OUTLINE, 1);
        ctx.fillStyle = '#d4a832'; ctx.fillRect(4, -8, 4, 16);
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(-12, -2, 16, 4);
        break;
      }
      case 'dainsleif': {
        poly([[8, -3], [34, -2], [42, 0], [34, 2], [8, 3]], '#5a6070', OUTLINE, 2);
        poly([[13, -1], [31, -1], [35, 0], [31, 1], [13, 1]], '#e04a3a', null);
        ctx.fillStyle = '#d4a832'; ctx.fillRect(4, -8, 4, 16);
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(-12, -2, 16, 4);
        break;
      }
      case 'axe': {
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(22, 0); ctx.stroke();
        ctx.fillStyle = '#b8c4d0'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2;
        poly([[14, -2], [30, -15], [35, -2], [30, 11]], '#b8c4d0', OUTLINE, 2);
        ctx.fillStyle = '#dce8f2';
        poly([[15, -2], [29, -12], [32, -2]], '#dce8f2', null);
        break;
      }
      case 'shield': {
        ctx.fillStyle = '#a8403a'; ctx.strokeStyle = '#3a1a12'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(13, 0, 13, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(13, 0, 8, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#d4a832';
        ctx.beginPath(); ctx.arc(13, 0, 3.2, 0, TAU); ctx.fill();
        break;
      }
      case 'brisingamen': {
        ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(12, 0, 11, -0.95, 0.95); ctx.stroke();
        ctx.fillStyle = '#e05a7a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1;
        poly([[20, -7], [27, 0], [20, 7], [15, 0]], '#e05a7a', OUTLINE, 1);
        ctx.fillStyle = '#ffd0e0';
        ctx.beginPath(); ctx.arc(20, -2, 1.6, 0, TAU); ctx.fill();
        break;
      }
      case 'draupnir': {
        ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(17, 0, 8, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#f0e0a0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(17, 0, 8, -1.2, 0.4); ctx.stroke();
        break;
      }
      case 'skidbladnir': {
        poly([[-2, 3], [24, 3], [18, 14], [4, 14]], '#6b4a2a', '#3a2614', 2);
        ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(10, 3); ctx.lineTo(10, -13); ctx.stroke();
        poly([[10, -13], [21, 1], [10, 1]], '#e8dcc0', '#9a9080', 1);
        ctx.strokeStyle = '#9ad0c8'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(22, 9); ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = player;
    const bob = Math.sin(p.walk) * (Math.hypot(p.vx, p.vy) > 1 ? 1 : 0);
    drawShadow(p.x, p.y, p.r);
    ctx.save();
    ctx.translate(p.x, p.y + bob);

    if (p.iframe > 0 && Math.floor(p.iframe * 20) % 2 === 0) ctx.globalAlpha = 0.45;

    // 披风
    poly([[-11, -4], [-17, 14], [10, 14], [11, -4]], '#8c2f2f', '#2a0f0f', 2);
    // 腿
    ctx.fillStyle = '#2c3346';
    ctx.fillRect(-8, 6, 6, 12); ctx.fillRect(3, 6, 6, 12);
    // 身体
    poly([[-11, -8], [11, -8], [9, 9], [-9, 9]], '#5c6b84', '#0d1420', 2);
    // 红色战袍
    poly([[-3, -6], [3, -6], [2, 12], [-2, 12]], '#a83a34', null);
    // 肩甲
    ell(-11, -6, 6, 5, '#76879e', '#0d1420', 2);
    ell(11, -6, 6, 5, '#76879e', '#0d1420', 2);
    // 头
    ell(0, -16, 9, 9, '#e2b68e', '#0d1420', 2);
    // 头盔
    poly([[-9, -19], [9, -19], [11, -12], [-11, -12]], '#76879e', '#0d1420', 2);
    // 角
    poly([[-8, -19], [-16, -29], [-4, -20]], '#9aa8bc', '#0d1420', 2);
    poly([[8, -19], [16, -29], [4, -20]], '#9aa8bc', '#0d1420', 2);
    // 眼
    ctx.fillStyle = '#9cd8f2';
    ctx.fillRect(-5, -16, 3, 3); ctx.fillRect(2, -16, 3, 3);

    // 武器
    ctx.rotate(p.aim);
    drawWeaponInHand(p.weapon, 0.72);
    ctx.restore();

    if (p.hurtFlash > 0) {
      ctx.globalAlpha = p.hurtFlash * 1.6;
      ell(p.x, p.y, p.r + 6, p.r + 6, '#ff5a4a');
      ctx.globalAlpha = 1;
    }
  }

  function drawDraugr(e, s) {
    ctx.save(); ctx.translate(e.x, e.y); ctx.scale(s, s);
    // 斗篷
    poly([[-11, -2], [11, -2], [15, 15], [-15, 15]], '#3f5a3f', '#0c120c', 2);
    // 兜帽
    poly([[-8, -14], [8, -14], [11, -1], [-11, -1]], '#4c6b4c', '#0c120c', 2);
    // 脸
    poly([[-5, -11], [5, -11], [4, -3], [-4, -3]], '#8fa07e', null);
    ctx.fillStyle = '#9cd8f2';
    ctx.fillRect(-4, -8, 2, 2); ctx.fillRect(2, -8, 2, 2);
    // 手臂
    ctx.strokeStyle = '#3f5a3f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-15, 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(15, 9); ctx.stroke();
    // 斧
    ctx.fillStyle = '#6a6a5a'; ctx.fillRect(14, -11, 3, 19);
    poly([[17, -11], [24, -9], [23, -2], [17, -3]], '#8a8a76', '#3a3a30', 1);
    ctx.restore();
  }

  function drawWolf(e, s) {
    const ang = (e.state === 'wind' || e.state === 'dash') ? e.dir : Math.atan2(e.vy, e.vx);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(ang || 0); ctx.scale(s, s);
    // 尾
    poly([[-14, 0], [-25, -9], [-12, -3]], '#b9cad8', '#1a2430', 2);
    // 身体
    ell(0, 0, 16, 10, '#c7d9e6', '#1a2430', 2);
    // 腿
    ctx.fillStyle = '#9fb2c4';
    ctx.fillRect(-10, 8, 4, 7); ctx.fillRect(-2, 8, 4, 7);
    ctx.fillRect(6, 8, 4, 7); ctx.fillRect(12, 8, 4, 7);
    // 头
    ell(13, -3, 9, 8, '#e2ecf4', '#1a2430', 2);
    // 耳
    poly([[8, -9], [6, -17], [12, -10]], '#e2ecf4', '#1a2430', 1);
    poly([[15, -9], [17, -17], [20, -10]], '#e2ecf4', '#1a2430', 1);
    // 吻
    poly([[19, -6], [26, -3], [19, 1]], '#e2ecf4', '#1a2430', 1);
    // 眼
    ctx.fillStyle = '#d0503f';
    ctx.fillRect(13, -6, 3, 2);
    ctx.restore();
  }

  function drawSalamander(e, s) {
    const ang = Math.atan2(e.vy, e.vx);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(ang || 0); ctx.scale(s, s);
    // 尾
    poly([[-12, 2], [-25, -2], [-12, 8]], '#c25b24', '#2a1008', 2);
    // 身体
    ell(0, 1, 15, 10, '#e07a2a', '#2a1008', 2);
    // 背刺
    poly([[-4, -9], [0, -18], [4, -9]], '#f28e34', '#2a1008', 1);
    poly([[3, -8], [8, -16], [11, -7]], '#f28e34', '#2a1008', 1);
    // 头
    ell(12, -1, 8, 7, '#e8944a', '#2a1008', 2);
    // 眼
    ctx.fillStyle = '#ffe07a';
    ctx.fillRect(14, -3, 3, 3);
    // 腿
    ctx.fillStyle = '#a84a1a';
    ctx.fillRect(-8, 9, 4, 5); ctx.fillRect(0, 9, 4, 5); ctx.fillRect(8, 9, 4, 5);
    ctx.restore();
  }
  function drawElite(e, s) {
    drawDraugr(e, s * 1.45);
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.strokeStyle = 'rgba(232,200,102,.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, e.r + 10, 0, TAU); ctx.stroke();
    // 王冠
    poly([[-10, -26], [-6, -34], [-2, -27], [2, -34], [6, -27], [10, -34], [12, -26]], '#e8c866', '#6a5418', 1);
    ctx.restore();
  }

  function drawEnemy(e) {
    if (e.hitT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      e.hitT = Math.max(0, e.hitT);
      ctx.restore();
    }
    drawShadow(e.x, e.y, e.r);
    if (e.type === 'draugr') drawDraugr(e, 1);
    else if (e.type === 'wolf') drawWolf(e, 1);
    else if (e.type === 'salamander') drawSalamander(e, 1);
    else if (e.type === 'clone') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.filter = 'none';
      drawWolf(e, 1.15);
      ctx.restore();
    }
    else drawElite(e, 1);

    // 登场光圈
    if (e.spawnT > 0) {
      const k = clamp(1 - e.spawnT / 0.55, 0, 1);
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.strokeStyle = '#9cd8f2';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 12 + k * 18, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 血条
    if (e.hp < e.maxHp) {
      const w = e.r * 2.2;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 4);
      ctx.fillStyle = e.type === 'elite' ? '#e8c866' : '#c25b4e';
      ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * (e.hp / e.maxHp), 4);
    }
  }

  function drawFenrirBody(b) {
    // 身体
    ell(0, 6, 46, 26, '#12141c', '#c25b4e', 3);
    // 头
    ell(-24, -18, 26, 22, '#181a24', '#c25b4e', 3);
    poly([[-40, -36], [-48, -62], [-26, -38]], '#181a24', '#c25b4e', 2);
    poly([[-14, -38], [-6, -64], [-2, -36]], '#181a24', '#c25b4e', 2);
    poly([[-46, -10], [-58, 2], [-40, 10]], '#181a24', '#c25b4e', 2);
    ctx.fillStyle = b.phase === 3 ? '#ff7a5a' : '#e04a3a';
    ctx.fillRect(-38, -24, 9, 5); ctx.fillRect(-20, -24, 7, 5);
    poly([[-44, 2], [-38, 2], [-41, 12]], '#e8e2d0', null);
    poly([[-32, 2], [-26, 2], [-29, 13]], '#e8e2d0', null);
    ctx.strokeStyle = '#5a6070'; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.ellipse(6 + i * 14, 14 + Math.sin(i) * 4, 8, 5, 0, 0, TAU); ctx.stroke();
    }
  }

  function drawJormBody(b) {
    const t = b.slither || 0;
    const tone = '#5ec08a';

    // 沿椭圆盘着的身体：半径叠加行波 + 整体缓慢旋转 = 蛇在滚
    const N = 84;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wave = Math.sin(a * 3 + t * 2.4) * 6.5;
      const rx = 66 + wave;
      const ry = 56 + wave * 0.6;
      const ang = a + t * 0.55;
      pts.push([Math.cos(ang) * rx, 6 + Math.sin(ang) * ry]);
    }
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    };
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    trace(); ctx.strokeStyle = '#08170f'; ctx.lineWidth = 36; ctx.stroke();
    trace(); ctx.strokeStyle = '#245039'; ctx.lineWidth = 28; ctx.stroke();
    trace(); ctx.strokeStyle = tone; ctx.lineWidth = 3; ctx.stroke();

    // 鳞片沿身体流动
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const ang = a + t * 0.55;
      const wave = Math.sin(a * 3 + t * 2.4) * 6.5;
      const x = Math.cos(ang) * (66 + wave);
      const y = 6 + Math.sin(ang) * (56 + wave * 0.6);
      const al = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(a * 2 + t * 3));
      ctx.fillStyle = 'rgba(150,240,190,' + al.toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
    }

    // 头：左右摆 + 上下浮
    const hx = Math.sin(t * 1.9) * 6;
    const hy = -58 + Math.cos(t * 1.5) * 4;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.sin(t * 1.7) * 0.07);
    poly([[-34, -6], [34, -6], [46, 34], [26, 70], [-26, 70], [-46, 34]],
      '#1c3a2c', tone, 4);
    // 眼
    ctx.fillStyle = b.phase === 3 ? '#ffe07a' : '#e8c866';
    ctx.beginPath(); ctx.arc(-14, 22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 22, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#141a12';
    ctx.beginPath(); ctx.arc(-14, 22, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14, 22, 3, 0, Math.PI * 2); ctx.fill();
    // 牙
    poly([[-24, 62], [-14, 62], [-19, 86]], '#e8e2d0', null);
    poly([[14, 62], [24, 62], [19, 86]], '#e8e2d0', null);
    // 吐信（伸缩）
    const tongue = 10 + (Math.sin(t * 4) * 0.5 + 0.5) * 16;
    ctx.strokeStyle = '#d0503f'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 66); ctx.quadraticCurveTo(6, 66 + tongue, 2, 66 + tongue + 6);
    ctx.moveTo(0, 66); ctx.quadraticCurveTo(-6, 66 + tongue, -2, 66 + tongue + 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawHelBody(b) {
    const tone = '#a98cc8';
    // 斗篷
    poly([[-52, 34], [-34, -34], [34, -34], [52, 34], [40, 60], [-40, 60]],
      '#141020', tone, 3);
    // 长袍
    poly([[-34, 12], [34, 12], [46, 62], [-46, 62]], '#1a1424', tone, 3);
    // 身体左活右死
    poly([[-34, 12], [0, 12], [0, 62], [-44, 62]], 'rgba(120,116,96,.9)');
    poly([[0, 12], [34, 12], [44, 62], [0, 62]], 'rgba(70,96,72,.9)');
    // 肩
    poly([[-40, 6], [-18, -8], [18, -8], [40, 6], [32, 16], [-32, 16]], '#242030', tone, 2);
    // 头
    const hy = -46;
    ctx.fillStyle = '#b8b29a';
    ctx.beginPath(); ctx.arc(-14, hy, 22, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
    ctx.beginPath(); ctx.arc(0, hy, 22, Math.PI * 1.5, Math.PI * 0.5); ctx.fill();
    ctx.fillStyle = '#7d9a78';
    ctx.beginPath(); ctx.arc(0, hy, 22, -Math.PI * 0.5, Math.PI * 0.5); ctx.fill();
    // 左眼 / 右眼窝
    ctx.fillStyle = '#f0ead2';
    ctx.beginPath(); ctx.arc(-14, hy - 4, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a20';
    ctx.beginPath(); ctx.arc(-14, hy - 4, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0d0d12';
    ctx.beginPath(); ctx.arc(12, hy - 4, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#cfc8ae'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(12, hy - 4, 7, 0, TAU); ctx.stroke();
    // 中缝
    ctx.strokeStyle = '#efe8d0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, hy - 22); ctx.lineTo(0, hy + 22); ctx.stroke();
    // 枝冠
    ctx.strokeStyle = tone; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, hy - 22); ctx.lineTo(-30, hy - 56); ctx.moveTo(-16, hy - 36); ctx.lineTo(-34, hy - 42);
    ctx.moveTo(0, hy - 22); ctx.lineTo(30, hy - 56); ctx.moveTo(16, hy - 36); ctx.lineTo(34, hy - 42);
    ctx.stroke();
    // 手
    ctx.fillStyle = '#8a8470';
    ctx.beginPath(); ctx.arc(-44, 30, 9, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(44, 30, 9, 0, TAU); ctx.fill();
  }

  function drawBoss() {
    const b = boss;
    const def = BOSS_DEFS[b.kind] || BOSS_DEFS.fenrir;
    drawShadow(b.x, b.y, b.r);
    ctx.save(); ctx.translate(b.x, b.y);
    if (player.x < b.x) ctx.scale(-1, 1);

    if (b.state === 'tele' || b.state === 'shadow') {
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(G.time * 40);
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(b.dir) * 300, Math.sin(b.dir) * 300);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (b.enraged) {
      ctx.globalAlpha = 0.22 + 0.1 * Math.sin(G.time * 12);
      ell(0, -6, 66, 56, '#ff3a2a');
      ctx.globalAlpha = 1;
    }

    if (b.kind === 'jorm') drawJormBody(b);

    // 沼泽地面
    if (b.kind === 'jorm') {
      const pulse = 1 + Math.sin(G.time * 2) * 0.04;
      ctx.globalAlpha = 0.22;
      ell(0, 26, 128 * pulse, 96 * pulse, '#1d3a26');
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(126,224,160,.45)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 26, 128 * pulse, 96 * pulse, 0, 0, TAU); ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const a = G.time * 0.6 + i * 0.9;
        const bx = Math.cos(a) * 80 + Math.sin(G.time * 2 + i) * 8;
        const by = 26 + Math.sin(a) * 58;
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(G.time * 3 + i);
        ctx.fillStyle = '#8ae0a8';
        ctx.beginPath(); ctx.arc(bx, by, 3 + Math.sin(G.time * 2 + i) * 1.5, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    else if (b.kind === 'hel') drawHelBody(b);
    else drawFenrirBody(b);

    if (b.hitT > 0) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ffe6a8';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, -8, b.r + 12, b.r + 2, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 射线（画在世界坐标，避免被镜像）
    if (b.kind === 'jorm') {
      if (b.state === 'ray') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rayAng || 0);
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(G.time * 30);
        ctx.strokeStyle = '#ff5a4a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(560, 0); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (b.state === 'beam') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.beamAng || 0);
        const gr = ctx.createLinearGradient(0, 0, 560, 0);
        gr.addColorStop(0, 'rgba(210,255,180,.95)');
        gr.addColorStop(0.55, 'rgba(120,220,120,.7)');
        gr.addColorStop(1, 'rgba(80,180,90,0)');
        ctx.strokeStyle = gr;
        ctx.lineWidth = 30; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(560, 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(245,255,230,.95)';
        ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(560, 0); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ---------- 绘制：投射物 ---------- */
  function drawProj(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    if (p.kind === 'arrow') {
      // 速度拖影
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#ffe6a8';
      poly([[-22, -2], [-6, -2], [-6, 2], [-22, 2]], '#ffe6a8', null);
      ctx.globalAlpha = 1;
      // 尾羽
      poly([[-12, 0], [-18, -5], [-14, 0], [-18, 5]], '#c8a878', '#7a5a32', 1);
      // 箭杆
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(8, 0); ctx.stroke();
      // 箭头
      poly([[7, -4], [17, 0], [7, 4]], '#dce6f0', '#6a7a8a', 1.5);
    } else if (p.kind === 'spear') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#9cd8f2';
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.strokeStyle = '#d4a832'; ctx.lineWidth = 2;
      for (const x of [-16, -6]) { ctx.beginPath(); ctx.moveTo(x, -4); ctx.lineTo(x, 4); ctx.stroke(); }
      poly([[12, -7], [32, 0], [12, 7]], '#e6f4ff', '#7fb4d4', 2);
      ctx.fillStyle = '#d4a832'; ctx.fillRect(13, -7, 2, 14);
    } else if (p.kind === 'hammer') {
      ctx.rotate(p.life * 16);
      ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#8fa4bc'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2;
      ctx.fillRect(4, -13, 22, 26); ctx.strokeRect(4, -13, 22, 26);
      ctx.fillStyle = '#cfe0ee'; ctx.fillRect(4, -13, 22, 8);
      ctx.fillStyle = '#d4a832'; ctx.fillRect(20, -13, 4, 26);
    } else if (p.kind === 'flame') {
      poly([[-p.r * 2.2, -p.r * 0.5], [-p.r * 0.8, 0], [-p.r * 2.2, p.r * 0.5]],
        'rgba(242,142,52,.35)', null);
      ell(0, 0, p.r, p.r * 0.82, 'rgba(242,142,52,.9)');
      ell(0, 0, p.r * 0.62, p.r * 0.5, 'rgba(255,214,120,.95)');
      ell(0, 0, p.r * 0.3, p.r * 0.24, '#fff6dc');
    } else if (p.kind === 'rune') {
      ctx.globalAlpha = 0.3;
      ell(0, 0, p.r + 6, p.r + 6, 'rgba(126,224,160,.5)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(126,224,160,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 3, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#9dffbe'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-5, -7); ctx.lineTo(0, 7); ctx.lineTo(5, -7);
      ctx.moveTo(0, -2); ctx.lineTo(5, 2);
      ctx.stroke();
    } else if (p.kind === 'fireball') {
      poly([[-p.r * 2, -p.r * 0.5], [-p.r * 0.7, 0], [-p.r * 2, p.r * 0.5]],
        'rgba(224,122,42,.45)', null);
      ell(0, 0, p.r, p.r, '#e07a2a');
      ell(0, 0, p.r * 0.62, p.r * 0.62, '#ffb14a');
      ell(0, 0, p.r * 0.28, p.r * 0.28, '#fff0c8');
    } else if (p.kind === 'bolt') {
      ctx.globalAlpha = 0.35;
      ell(0, 0, p.r + 3, p.r + 3, 'rgba(176,106,208,.6)');
      ctx.globalAlpha = 1;
      ell(0, 0, p.r * 0.8, p.r * 0.8, '#8a4aa8');
      ell(0, 0, p.r * 0.45, p.r * 0.45, '#e8c8ff');
    } else if (p.kind === 'swordwave') {
      ctx.globalAlpha = 0.45;
      poly([[-26, -12], [6, -8], [22, 0], [6, 8], [-26, 12]], 'rgba(168,196,224,.5)', null);
      ctx.globalAlpha = 1;
      poly([[-18, -9], [8, -6], [24, 0], [8, 6], [-18, 9]], '#dce8f6', '#5a7a9a', 2);
      ctx.fillStyle = '#ffffff';
      poly([[-16, -3], [10, -2], [20, 0], [10, 2], [-16, 3]], 'rgba(255,255,255,.75)', null);
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = 'rgba(232,200,102,.35)'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 3, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#e8c866'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff2c0';
      ctx.beginPath(); ctx.arc(p.r * 0.7, -p.r * 0.7, 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 绘制：拾取物与传送门 ---------- */
  function drawPickups() {
    for (const it of pickups) {
      const bob = Math.sin(it.t * 4) * 3;
      if (it.kind === 'heart') {
        drawHeart(it.x, it.y + bob, 9, '#c25b4e');
      } else if (it.kind === 'coin') {
        ctx.save();
        ctx.translate(it.x, it.y + bob);
        ctx.globalAlpha = 0.28;
        ell(0, 0, 15, 15, '#e8c866');
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#d9a92f';
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 9, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.ellipse(-2.5, -2.5, 3.2, 2.4, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
        ctx.restore();
      } else if (it.kind === 'weapon') {
        ctx.save();
        ctx.translate(it.x, it.y + bob);
        ctx.globalAlpha = 0.30;
        ell(0, 0, 26, 26, WEAPONS[it.weapon].color);
        ctx.globalAlpha = 1;
        ctx.rotate(-0.5 + Math.sin(it.t * 2) * 0.12);
        drawWeaponInHand(it.weapon, 1.0);
        ctx.rotate(0);
        text(WEAPONS[it.weapon].name, 0, 34, 11, WEAPONS[it.weapon].color, 'center');
        if (player && Math.hypot(it.x - player.x, it.y - player.y) < 72) {
          text('按 E 拾取', 0, 52, 12, '#ffffff', 'center');
        }
        ctx.restore();
      }
    }
  }

  function drawHeart(x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s, -s * 0.4, -s * 0.55, -s, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.55, -s, s, -s * 0.4, 0, s * 0.35);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#2a0f0f'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  function drawPortal() {
    if (!portal) return;
    const p = portal;
    ctx.save();
    ctx.translate(p.x, p.y);
    const pulse = 1 + Math.sin(p.t * 4) * 0.08;
    ctx.globalAlpha = 0.25;
    ell(0, 0, 34 * pulse, 34 * pulse, '#9cd8f2');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#9cd8f2';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24 * pulse, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(156,216,242,.5)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(0, 0, 24 * pulse, p.t * 2, p.t * 2 + 1.6); ctx.stroke();
    text('▶', 0, 0, 18, '#e8f6ff', 'center', 'bold');
    ctx.restore();
  }

  /* ---------- 绘制：BOSS 塔罗牌演出 ---------- */
  function drawCardArt(w, h) {
    const img = CARD_IMG[G.bossKind];
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      return;
    }
    // 程序卡面兜底：深底金框 + 狼头剪影
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
    ctx.strokeRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20);
    const s2 = h / 420;
    ctx.save();
    ctx.translate(0, -h * 0.16);
    ctx.scale(s2, s2);
    ctx.fillStyle = '#12141c';
    ctx.strokeStyle = '#c25b4e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-70, -30); ctx.lineTo(-58, -92); ctx.lineTo(-26, -44);
    ctx.lineTo(26, -44); ctx.lineTo(58, -92); ctx.lineTo(70, -30);
    ctx.lineTo(58, 34); ctx.lineTo(24, 66); ctx.lineTo(-24, 66); ctx.lineTo(-58, 34);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e04a3a';
    ctx.fillRect(-40, -16, 26, 9);
    ctx.fillRect(14, -16, 26, 9);
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath(); ctx.moveTo(-20, 30); ctx.lineTo(-4, 30); ctx.lineTo(-12, 56); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, 30); ctx.lineTo(20, 30); ctx.lineTo(12, 56); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8dcc0';
    ctx.font = 'bold ' + Math.round(h * 0.062) + 'px "Microsoft YaHei",sans-serif';
    ctx.fillText((BOSS_DEFS[G.bossKind] || BOSS_DEFS.fenrir).cn, 0, h * 0.2);
    ctx.fillStyle = '#c9a227';
    ctx.font = Math.round(h * 0.03) + 'px "Microsoft YaHei",sans-serif';
    ctx.fillText((G.bossKind || 'fenrir').toUpperCase(), 0, h * 0.25);
    ctx.fillStyle = '#9aa0b0';
    ctx.font = Math.round(h * 0.032) + 'px "Microsoft YaHei",sans-serif';
    ctx.fillText('咬合 · 裂誓', 0, h * 0.33);
    ctx.textAlign = 'left';
  }

  function drawBossCard() {

    if (G.bossOut > 0) {
      // 击破演出：卡牌放大旋转、淡出
      const p = 1 - G.bossOut / 1.4;
      const scale = 1 + p * 0.6;
      ctx.fillStyle = 'rgba(4,6,12,' + (0.4 * (1 - p)) + ')';
      ctx.fillRect(0, 0, W, H);
      const h = 420 * scale, w = h * (620 / 1080);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.translate(W / 2, H / 2 - 12);
      ctx.rotate(p * 0.4);
      ctx.shadowColor = 'rgba(232,200,102,.9)';
      ctx.shadowBlur = 40;
      drawCardArt(w, h);
      ctx.shadowBlur = 0;
      ctx.restore();
      return;
    }

    if (G.cutscene <= 0) return;

    const T = 3.2;
    const t = 1 - G.cutscene / T;          // 0 → 1
    const easeOut = k => 1 - Math.pow(1 - k, 3);

    // 阶段
    const P1 = 0.30, P2 = 0.70, P3 = 0.86;
    let alpha = 1, scale = 1, rot = 0, cx = W / 2, cy = H / 2 - 40, shakeX = 0, glow = 0.45;

    if (t < P1) {
      const k = easeOut(t / P1);
      alpha = Math.min(1, k * 1.4);
      scale = 0.42 + 0.58 * k;
      rot = (1 - k) * 0.85;
      cx = W / 2 + (1 - k) * 300;
      cy = H / 2 - 40 + (1 - k) * 240;
      glow = 0.25 + 0.5 * k;
    } else if (t < P2) {
      const k = (t - P1) / (P2 - P1);
      scale = 1 + Math.sin(k * Math.PI) * 0.02;
      cy = H / 2 - 40 + Math.sin(t * 8) * 4;
      glow = 0.55 + Math.sin(t * 6) * 0.12;
    } else if (t < P3) {
      const k = (t - P2) / (P3 - P2);
      const jitter = 3 * k;
      shakeX = rand(-jitter, jitter);
      scale = 1.02 + k * 0.05;
      glow = 0.6 + k * 0.8;
    } else {
      const k = (t - P3) / (1 - P3);
      scale = 1.07 + k * 0.35;
      alpha = 1 - k;
      rot = k * 0.12;
      glow = 1.2;
      cx = W / 2 + rand(-4, 4);
    }

    // 背景压暗 + 速度线
    ctx.fillStyle = 'rgba(4,6,12,' + (0.86 * Math.min(1, alpha + 0.2)) + ')';
    ctx.fillRect(0, 0, W, H);

    if (t > 0.02 && t < P3 + 0.06) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.1 * Math.sin(t * 20);
      ctx.strokeStyle = '#e8c866';
      ctx.lineWidth = 1;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU + t * 0.6;
        const r0 = 180, r1 = 180 + 260 * (0.6 + 0.4 * Math.sin(i * 1.7 + t * 5));
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0);
        ctx.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 光晕
    const g = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 360);
    g.addColorStop(0, 'rgba(232,200,102,' + (glow * 0.42 * alpha) + ')');
    g.addColorStop(1, 'rgba(232,200,102,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 卡牌
    const h = 420 * scale;
    const w = h * (620 / 1080);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(cx + shakeX, cy);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(232,200,102,' + glow + ')';
    ctx.shadowBlur = 30 + glow * 40;
    drawCardArt(w, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#e8c866';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();

    // 底部字幕
    if (alpha > 0.35) {
      const a2 = (alpha - 0.35) / 0.65;
      ctx.globalAlpha = a2;
      text('命 运 牌 · 逆 位', W / 2, 468, 13, '#8a6a2a', 'center');
      ctx.globalAlpha = a2 * 0.95;
      text('第 ' + ['一', '二', '三'][(G.bossLayer || 1) - 1] + ' 层 · 关 底', W / 2, 494, 16, '#c9a227', 'center');
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- 绘制：商店 ---------- */
  function drawShop() {
    if (!LEVELS[G.level].shop) return;

    // 柜台
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(120, 372, 660, 26);
    ctx.strokeStyle = '#6a4f28'; ctx.lineWidth = 2;
    ctx.strokeRect(120, 372, 660, 26);
    ctx.fillStyle = '#2a1e10';
    ctx.fillRect(120, 398, 660, 16);

    // 吟游诗人
    const mx = 786, my = 322 + Math.sin(G.time * 2) * 2;
    ctx.save();
    ctx.translate(mx, my);
    // 斗篷
    poly([[-34, 70], [-22, -4], [22, -4], [34, 70]], '#2e1c2a', '#140a14', 2);
    poly([[-24, -6], [24, -6], [28, 70], [-28, 70]], '#4a2e46', '#140a14', 2);
    // 腰带
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(-26, 28, 52, 4);
    // 鲁特琴（斜挎）
    ctx.save();
    ctx.rotate(-0.55);
    ell(18, 26, 17, 12, '#8a5a2a', '#3a2410', 2);
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(30, 17, 30, 6);
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(56, 12, 9, 16);
    ctx.restore();
    // 头 + 兜帽
    ell(0, -30, 19, 21, '#2a1c26', '#140c12', 2);
    poly([[-23, -26], [0, -76], [23, -26]], '#5a3a56', '#140a14', 2);
    // 眼
    ctx.fillStyle = '#f2d98a';
    ctx.fillRect(-10, -34, 5, 4); ctx.fillRect(5, -34, 5, 4);
    // 拨弦的手
    ell(-22, 16, 8, 8, '#2a1c26');
    ctx.restore();
    text('吟 游 诗 人', mx, my + 98, 14, '#c9a227', 'center', 'bold');
    // 飘起来的音符
    for (let i = 0; i < 3; i++) {
      const k = (G.time * 0.42 + i * 0.33) % 1;
      ctx.globalAlpha = (1 - k) * 0.85;
      text('♪', mx + 34 + Math.sin(k * 6 + i * 2) * 12, my - 34 - k * 64, 14, '#e8c866', 'center');
    }
    ctx.globalAlpha = 1;

    // 商品
    for (const it of shopItems) {
      const bob = Math.sin(G.time * 3 + it.x) * 2;
      // 台座
      ctx.fillStyle = '#2a1e12';
      ctx.fillRect(it.x - 26, it.y + 30, 52, 14);
      ctx.strokeStyle = '#6a4f28'; ctx.lineWidth = 1;
      ctx.strokeRect(it.x - 26, it.y + 30, 52, 14);

      if (it.sold) {
        text('已售出', it.x, it.y, 13, '#4a4238', 'center');
        continue;
      }
      // 光
      ctx.globalAlpha = 0.25;
      ell(it.x, it.y + bob, 24, 24, it.color);
      ctx.globalAlpha = 1;

      if (it.kind === 'heal') drawHeart(it.x, it.y + bob, 12, '#c25b4e');
      else if (it.kind === 'maxhp') {
        drawHeart(it.x, it.y + bob, 12, '#7ee0a0');
        text('+', it.x, it.y + bob - 1, 12, '#e8ffe8', 'center', 'bold');
      } else if (it.kind === 'dmg') {
        ctx.strokeStyle = '#e8c866'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(it.x - 10, it.y + bob + 12); ctx.lineTo(it.x + 10, it.y + bob - 12); ctx.stroke();
        poly([[it.x + 10, it.y + bob - 12], [it.x + 4, it.y + bob - 6], [it.x + 8, it.y + bob - 4]],
          '#fff0c0', null);
      } else {
        ctx.save();
        ctx.translate(it.x, it.y + bob);
        ctx.rotate(-0.6);
        drawWeaponInHand('gungnir', 0.6);
        ctx.restore();
      }

      text(it.name, it.x, it.y + 54, 13, '#e8dcc0', 'center', 'bold');
      text(it.desc, it.x, it.y + 70, 11, '#9a8f78', 'center');
      // 价格
      const afford = player.coins >= it.price;
      text(it.price + ' 金', it.x, it.y + 88, 13, afford ? '#e8c866' : '#7a5a4a', 'center', 'bold');

      if (Math.hypot(it.x - player.x, it.y - player.y) < 52) {
        text('按 E 购买', it.x, it.y - 48, 12, '#ffffff', 'center');
      }
    }

    // 提示
    text('吟游诗人的回响 · 按 E 购买 · 走入右侧传送门继续', W / 2, 96, 13, 'rgba(200,180,140,.55)', 'center');
  }

  /* ---------- 绘制：HUD ---------- */
  function drawHUD() {
    // 生命
    for (let i = 0; i < player.maxHp; i++) {
      const x = 26 + i * 26, y = 26;
      drawHeart(x, y, 9, i < player.hp ? '#c25b4e' : 'rgba(90,50,50,.35)');
    }
    // 护盾条
    const sw = 22, sgap = 3;
    for (let i = 0; i < player.shieldMax; i++) {
      const x = 26 + i * (sw + sgap), y = 42;
      const full = player.shield >= i + 1;
      const part = !full && player.shield > i;
      ctx.fillStyle = full ? '#7fb4d8' : (part ? 'rgba(127,180,216,.55)' : 'rgba(60,80,100,.35)');
      ctx.fillRect(x, y, sw, 5);
      ctx.strokeStyle = 'rgba(150,200,235,.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, sw, 5);
    }

    // 金币
    ctx.save();
    ctx.translate(34, 66);
    ctx.fillStyle = '#d9a92f';
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    text(String(player.coins), 48, 66, 15, '#e8c866', 'left', 'bold');

    // 武器
    const wp = WEAPONS[player.weapon];
    ctx.fillStyle = 'rgba(8,12,20,.72)';
    rr(22, H - 58, 210, 38, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(120,132,154,.35)'; ctx.lineWidth = 1; ctx.stroke();
    text(wp.name, 36, H - 39, 15, wp.color, 'left', 'bold');
    text(wp.desc, 36, H - 22, 11, '#7f8798', 'left');
    // 冷却
    const cdf = clamp(player.cd / wp.cd, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(22, H - 58, 210 * (1 - cdf), 2);

    // 关卡名
    text(LEVELS[G.level].name + '　' + (G.level + 1) + ' / ' + LEVELS.length, W / 2, 22, 14, 'rgba(200,210,226,.55)', 'center');

    // 武器槽
    player.owned.forEach((k, i) => {
      const x = W - 40 - i * 44, y = H - 44;
      ctx.fillStyle = k === player.weapon ? 'rgba(216,174,66,.25)' : 'rgba(255,255,255,.06)';
      rr(x - 16, y - 16, 32, 32, 4); ctx.fill();
      ctx.strokeStyle = k === player.weapon ? '#d8ae42' : 'rgba(150,160,180,.3)';
      ctx.lineWidth = 1; ctx.stroke();
      text(String(i + 1), x, y + 1, 13, k === player.weapon ? '#d8ae42' : '#6f7a8c', 'center', 'bold');
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.55);
      ctx.globalAlpha = k === player.weapon ? 1 : 0.55;
      drawWeaponInHand(k, 0.46);
      ctx.globalAlpha = 1;
      ctx.restore();
    });

    // BOSS 血条
    if (boss) {
      const bw = 460, bx = (W - bw) / 2, by = 46;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = boss.phase === 3 ? '#ff6a4a' : '#c25b4e';
      ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxHp, 0, 1), 10);
      ctx.strokeStyle = 'rgba(216,174,66,.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, 10);
      const bd = BOSS_DEFS[boss.kind] || BOSS_DEFS.fenrir;
      text(bd.name + '　阶段 ' + boss.phase, W / 2, by + 24, 12, 'rgba(220,210,190,.75)', 'center');
    }

    // 诅咒倒计时
    if (player.curseT > 0) {
      ctx.fillStyle = 'rgba(224,74,58,.85)';
      ctx.fillRect(W / 2 - 90, 62, 180 * (player.curseT / 5), 3);
      text('达因斯莱夫的诅咒', W / 2, 74, 11, 'rgba(224,74,58,.9)', 'center');
    }

    // 剩余敌人
    const remain = enemies.length + (boss ? 1 : 0);
    if (remain > 0) text('残余 ' + remain, W - 26, 26, 13, 'rgba(200,210,226,.5)', 'right');

    // 换场景神话字幕
    if (G.roomIntro > 0) {
      const elapsed = G.roomIntroMax - G.roomIntro;
      const a = Math.min(1, elapsed / 0.5) * Math.min(1, G.roomIntro / 0.8);
      const lv = LEVELS[G.level];
      ctx.globalAlpha = a * 0.75;
      ctx.fillStyle = 'rgba(6,9,15,.72)';
      rr(W / 2 - 300, H * 0.24 - 40, 600, 104, 6);
      ctx.fill();
      ctx.globalAlpha = a;
      text(lv.name, W / 2, H * 0.24, 30, '#e8dcc0', 'center', 'bold');
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 150, H * 0.24 + 26);
      ctx.lineTo(W / 2 + 150, H * 0.24 + 26);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      if (lv.lore) text(lv.lore, W / 2, H * 0.24 + 52, 16, '#cfd6e4', 'center');
      ctx.globalAlpha = 1;
    }

    // 首次操作提示
    if (G.time < 9) {
      ctx.globalAlpha = clamp(9 - G.time, 0, 1) * 0.75;
      text('WASD 移动 · 鼠标瞄准 · 左键 / J 射击 · 空格冲刺 · 1-4 换武器', W / 2, H - 22, 13, '#9aa6bc', 'center');
      ctx.globalAlpha = 1;
    }

    // 横幅
    if (G.banner > 0) {
      const a = clamp(G.banner, 0, 1);
      ctx.globalAlpha = a;
      text(G.bannerText, W / 2, H * 0.26, 26, '#e8c866', 'center', 'bold');
      ctx.globalAlpha = 1;
    }

    // 预言（开局 4 秒）
    if (G.time < 5 && player.prophecies) {
      const a = clamp(5 - G.time, 0, 1);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = 'rgba(8,12,20,.55)';
      rr(W / 2 - 220, H - 150, 440, 24 * player.prophecies.length + 24, 6); ctx.fill();
      text('命运丝线　·　织机压力 ×' + G.pressure.toFixed(2), W / 2, H - 132, 12, '#8f97a8', 'center');
      player.prophecies.forEach((s, i) => {
        text(s, W / 2, H - 110 + i * 22, 12, '#d8cfae', 'center');
      });
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- 绘制主流程 ---------- */
  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sx = G.shake ? rand(-G.shake, G.shake) : 0;
    const sy = G.shake ? rand(-G.shake, G.shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground(t);
    drawDecals();
    drawObstacles();
    drawPortal();
    drawPickups();

    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const w of waves) {
      const k = 1 - w.r / w.maxR;
      ctx.globalAlpha = Math.max(0, k) * 0.85;
      ctx.strokeStyle = '#e04a3a';
      ctx.lineWidth = 5 * k + 1;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = Math.max(0, k) * 0.3;
      ctx.strokeStyle = '#ffd98a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r - 6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 环境陷阱
    for (const h of hazards) {
      if (h.k === 'barrel') {
        ctx.save(); ctx.translate(h.x, h.y);
        ctx.fillStyle = h.hp < 3 ? '#b04a2a' : '#8a3a24';
        ctx.fillRect(-11, -14, 22, 28);
        ctx.strokeStyle = '#3a1a10'; ctx.lineWidth = 2;
        ctx.strokeRect(-11, -14, 22, 28);
        ctx.fillStyle = '#4a2418';
        ctx.fillRect(-11, -6, 22, 4); ctx.fillRect(-11, 4, 22, 4);
        ctx.fillStyle = '#e8c866'; ctx.fillRect(-4, -18, 8, 4);
        ctx.restore();
      } else if (h.k === 'poison') {
        const pulse = 1 + Math.sin(G.time * 2.2 + h.x) * 0.05;
        ctx.globalAlpha = 0.22;
        ell(h.x, h.y, h.r * pulse, h.r * 0.7 * pulse, '#3f8a5a');
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = 'rgba(126,224,160,.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * pulse, h.r * 0.7 * pulse, 0, 0, TAU); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = G.time * 0.8 + i * 1.6;
          ctx.globalAlpha = 0.3 + 0.3 * Math.sin(G.time * 3 + i);
          ctx.fillStyle = '#8ae0a8';
          ctx.beginPath(); ctx.arc(h.x + Math.cos(a) * h.r * 0.55, h.y + Math.sin(a) * h.r * 0.4, 2.5, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        const flick = 0.5 + 0.5 * Math.sin(G.time * 9 + h.x);
        ctx.globalAlpha = 0.25 + flick * 0.12;
        ell(h.x, h.y, h.r, h.r * 0.72, '#f28e34');
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = 'rgba(255,170,80,.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.72, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.35 + flick * 0.3;
        ell(h.x, h.y - 2, h.r * 0.4, h.r * 0.3, '#ffd98a');
        ctx.globalAlpha = 1;
      }
    }

    drawShop();
    for (const e of enemies) drawEnemy(e);
    if (boss && G.cutscene < 0.45) drawBoss();

    // 近战残影
    for (const s of slashes) {
      const k = s.t / s.max;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.ang);
      ctx.globalAlpha = k * 0.75;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3 + 7 * k;
      ctx.beginPath();
      ctx.arc(0, 0, s.range * 0.72, -s.arc / 2, s.arc / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 战船掩体
    for (const s of shields) {
      const k = Math.min(1, s.t / 0.6);
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.globalAlpha = 0.9 * k;
      ctx.strokeStyle = '#9ad0c8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.stroke();
      poly([[-28, -4], [28, -4], [20, 12], [-20, 12]], '#6b4a2a', '#3a2614', 2);
      ctx.strokeStyle = '#d8c9a8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, -30); ctx.stroke();
      poly([[0, -30], [18, -6], [0, -6]], '#e8dcc0', null);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (player) drawPlayer();
    for (const p of projs) drawProj(p);

    for (const tx of texts) {
      ctx.globalAlpha = clamp(tx.life, 0, 1);
      text(tx.str, tx.x, tx.y, tx.size, tx.color, 'center', 'bold');
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    if (player && G.cutscene <= 0) drawHUD();

    drawBossCard();

    if (G.flash > 0) {
      ctx.fillStyle = 'rgba(200,60,50,' + (G.flash * 1.4) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // 过场淡入
    if (G.fade > 0) {
      ctx.fillStyle = 'rgba(4,6,11,' + (G.fade * 0.95) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // 暗角
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------- 主循环 ---------- */
  let last = performance.now();
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    if (G.mode === 'play') update(dt);
    else { G.banner = Math.max(0, G.banner - dt); }
    if (G.mode === 'play' || G.mode === 'pause' || G.mode === 'dead' || G.mode === 'win') {
      if (player) draw(ts / 1000);
    } else {
      // 标题页静态背景
      drawBackground(ts / 1000);
      drawObstacles();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- UI ---------- */
  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }
  function hideAll() {
    ['ovTitle', 'ovPause', 'ovDead', 'ovWin', 'ovIntro', 'ovBless'].forEach(hide);
  }

  /* ---------- 开场叙述 ---------- */
  const INTRO = [
    { tag: '序 章', title: '轮 回',
      text: '诸神黄昏烧过一次世界。火焰熄灭之后，诺伦三女神把时间重新织了一遍——但布上总有一处，怎么织都漏。' },
    { tag: '第 一 章', title: '第 1001 个死者',
      text: '她们从英灵殿里唤出一个死者，用蜜酒把他灌活。他死在黄昏里，就再被叫醒一次。\n你是那第 1001 个。' },
    { tag: '第 二 章', title: '织 机 之 线',
      text: '穿过六界，抵达黄昏战场，砍断织机上的一根线。\n或者，死回去，让她们再灌你一次。' }
  ];
  let introIdx = 0, introOpen = false;

  function renderIntro() {
    const it = INTRO[introIdx];
    document.getElementById('introTag').textContent = it.tag;
    document.getElementById('introTitle').textContent = it.title;
    document.getElementById('introText').innerHTML = it.text.replace(/\n/g, '<br>');
    document.getElementById('btnIntroNext').textContent =
      introIdx === INTRO.length - 1 ? '醒 来' : '继 续';
  }
  function showIntro() {
    introIdx = 0; introOpen = true;
    renderIntro();
    hideAll(); show('ovIntro');
  }
  function introNext() {
    introIdx++;
    if (introIdx >= INTRO.length) {
      introOpen = false; hide('ovIntro'); startRun();
    } else renderIntro();
  }

  document.getElementById('btnStart').addEventListener('click', showIntro);
  document.getElementById('btnIntroNext').addEventListener('click', introNext);
  document.getElementById('btnIntroSkip').addEventListener('click', () => {
    introOpen = false; hide('ovIntro'); startRun();
  });
  document.getElementById('btnIntroBoss').addEventListener('click', bossRush);

  /* 序章里的「直接挑战 BOSS」：给一套基础装备，直接跳到黄昏战场 */
  function bossRush() {
    introOpen = false; hide('ovIntro');
    startRun();
    if (G.mode === 'bless') chooseBlessing(0);
    player.owned = ['bow', 'gungnir', 'mjolnir', 'laevateinn'];
    player.weapon = 'mjolnir';
    player.hp = player.maxHp;
    initLevel(2);  // 第一层 BOSS（芬里尔）
  }
  document.getElementById('btnRetry').addEventListener('click', () => { hide('ovDead'); startRun(); });
  document.getElementById('btnAgain').addEventListener('click', () => { hide('ovWin'); startRun(); });

  // 元进度文案
  const deaths = +(LS.get('hh_deaths') || 0);
  const wins = +(LS.get('hh_wins') || 0);
  const meta = document.getElementById('metaLine');
  if (meta) meta.textContent = '死于英灵殿 ' + deaths + ' 次 · 走完轮回 ' + wins + ' 次';

  updateMouseScale();
  requestAnimationFrame(loop);

  // 调试参数：?auto=1 自动开局，&room=N 跳到指定层（用于截图/测试）
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get('demo')) window.__DEMO = true;
    if (qs.get('intro')) { showIntro(); }
    if (qs.get('nobless')) setTimeout(() => { if (G.mode === 'bless') chooseBlessing(0); }, 200);
    if (qs.get('bstate')) setTimeout(() => { if (boss) { boss.state = qs.get('bstate'); boss.t = 999; boss.beamAng = Math.PI/2; boss.rayAng = Math.PI/2; } }, 400);
    if (qs.get('bless')) setTimeout(() => offerBlessings(), 500);
    if (qs.get('sl')) setTimeout(() => { if (boss) boss.slither = parseFloat(qs.get('sl')) || 0; }, 300);
    if (qs.get('cs')) setTimeout(() => { G.cutscene = parseFloat(qs.get('cs')) || 1.2; }, 300);
    if (qs.get('ri')) setTimeout(() => { G.roomIntro = parseFloat(qs.get('ri')) || 1.2; }, 400);
    if (qs.get('auto')) {
      setTimeout(() => {
        startRun();
        const r = parseInt(qs.get('room') || '0', 10);
        if (r > 0) initLevel(Math.min(r, LEVELS.length - 1));
        if (qs.get('nofade')) { G.fade = 0; enemies.forEach(e => e.spawnT = 0); }
        const w = qs.get('weapon');
        if (w && WEAPONS[w]) {
          if (!player.owned.includes(w)) player.owned.push(w);
          player.weapon = w;
        }
      }, 60);
    }
  } catch (e) {}

  /* 调试/测试钩子（不影响正常游玩） */
  window.__HH = {
    G, keys, mouse, startRun, initLevel, spawnEnemy, spawnBoss, spawnProj,
    update, draw, hurtPlayer, hurtBoss, takePickup, setCleared, win, die,
    get player() { return player; },
    get enemies() { return enemies; },
    get boss() { return boss; },
    get projs() { return projs; },
    get pickups() { return pickups; },
    get portal() { return portal; },
    get obstacles() { return obstacles; },
    get zones() { return zones; },
    get shopItems() { return shopItems; },
    get hazards() { return hazards; },
    get waves() { return waves; },
    bossRush, showIntro, introNext
  };
})();

















