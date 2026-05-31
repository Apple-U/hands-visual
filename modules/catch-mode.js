'use strict';

// ===== 《我会稳稳地接住你》游戏模块 =====
// 设计要点：
// - 屏幕正中固定一条竖线 = 接住区
// - 白狗 y 跟随食指；黄狗从右往左匀速滑动
// - 黄狗经过判定区时，白狗 y 与黄狗 y 接近就开始充电
// - 充电进度 ≥ 阈值 → Perfect / Good；偏低 → Bad；完全没碰 → Miss
// - 单一真相源：每只黄狗的 config 决定它的 mood / GIF / 充电时长 / 气泡
// - 谱面来源：使用 OfflineAudioContext 离线分析音频低频能量峰值，自动卡点
// - 音效：使用 Web Audio API 合成 ding / 失败音 / 鼓点小拍点

(function () {
  const MOOD_LIBRARY = [
    {
      mood: 'bored',
      gif: 'gif/bored.gif',
      label: '无聊',
      bubbles: ['今天好累呀…', '好无聊…', '提不起精神…'],
    },
    {
      mood: 'cry',
      gif: 'gif/cry.gif',
      label: '难过',
      bubbles: ['呜呜呜…', '想被抱抱…', '心里好酸…'],
    },
    {
      mood: 'sad',
      gif: 'gif/cry2.gif',
      label: '失落',
      bubbles: ['今天不太顺…', '心情有点糟…', '唉…'],
    },
    {
      mood: 'tantrum',
      gif: 'gif/fever.gif',
      label: '生气',
      bubbles: ['生病了', '哼！', '别管我！'],
    },
  ];

  const HAPPY_GIFS = ['gif/super-happy.gif'];
  const DUO_GIFS = ['gif/two/hug.gif', 'gif/two/naughty.gif', 'gif/two/play2.gif','gif/two/play.gif'];
  // 接住瞬间专属：固定使用"贴贴拥抱"画面，作为接住的标志性表达
  const HUG_GIF = 'gif/two/hug.gif';
  // 屏幕中央 hero 放大动画的候选：剔除 hug.gif，避免和轨道上的接住表演重复
  const HERO_GIFS = DUO_GIFS.filter((g) => g !== HUG_GIF);
  const WHITE_PUPPY_GIF = 'gif/white/high.gif';
  // 没接住时统一显示 angry
  const ANGRY_GIF = 'gif/angry.gif';

  // ===== GIF 单图尺寸覆盖（width %，相对 #wrap）=====
  // 用 gif-debug.html 调好后，把 “复制配置” 的结果粘到这里就好。
  const GIF_SIZE_OVERRIDES = {
    'gif/white/high.gif': 9,
    'gif/bored.gif': 13,
    'gif/cry.gif': 10,
    'gif/cry2.gif': 10,
    'gif/stop-tantrum.gif': 10,
    'gif/angry.gif': 10,
    'gif/happy.gif': 14.5,
    'gif/super-happy.gif': 10,
    'gif/happy-run.gif': 10,
    'gif/happy-walk.gif': 10,
    'gif/happy-humming.gif': 10,
    'gif/fever.gif': 10,
    'gif/close-up.gif': 7,
    'gif/wait-ball.gif': 14.5,
    'gif/gift-flower.gif': 10.5,
    'gif/two/hug.gif': 24,
    'gif/two/naughty.gif': 16,
    'gif/two/play2.gif': 24,
  };

  function gifKey(src) {
    if (!src) return '';
    try {
      const u = new URL(src, window.location.href);
      return u.pathname.replace(/^\//, '').replace(/^.*?(gif\/)/, '$1');
    } catch (_) {
      return src;
    }
  }

  function applyGifSize(el, src) {
    const w = GIF_SIZE_OVERRIDES[gifKey(src ?? el.src)];
    if (typeof w === 'number') el.style.width = w + '%';
  }

  function setGifSrc(el, newSrc) {
    el.src = newSrc;
    applyGifSize(el, newSrc);
  }

  // ====== 小狗情绪文案池（按"小狗的感受"而非"玩家的得分"命名） ======
  // 设计原则：
  //   - 站在小狗的视角描述这一刻的情绪，不站在系统的视角评判玩家
  //   - 短句 + 拟声 + 动作感，保持小奶狗语气
  //   - 失败也不丧气，依然是撒娇语气，避免治愈游戏出现"打分感"

  // 贴到主人那一刻：满足、撒娇式开心
  const PUPPY_HUG_BUBBLES = [
    '汪汪汪🐶!',
    '贴贴成功啦!',
    '尾巴摇飞啦❤️~',
    '你是我的大可爱呀~',
    '你最好啦!💛',
    '好喜欢你呀!💛',
    '心都化啦~',
    '和你在一起无敌开心！！',
  ];
  // 没追上主人：失落但不丧气，依然在撒娇
  const PUPPY_MISS_BUBBLES = [
    '哎呀…',
    '没追上啦…',
    '溜走啦…',
    '汪…',
    '下一只我一定接住!',
    '差一点点~',
    '呜…',
    '等下一只…',
  ];
  // 正在蹭你（贴贴中）：撒娇要更多、不让你走
  const PUPPY_NUZZLE_BUBBLES = [
    '别动嘛~',
    '再贴一会儿!',
    '蹭蹭中~',
    '尾巴在摇啦!',
    '舒服~',
    '快充满啦!',
    '别走别走~',
    '汪~别松手!',
    '再来一点点~',
  ];

  // 黄狗从屏幕右侧出现到达中线所用秒数（决定移动速度）
  const TRAVEL_TIME = 3.2;
  // 判定区半宽（像素，逻辑坐标系）
  const JUDGE_HALF_WIDTH = 140; // 判定窗口（左右各 140px，原 80）
  // 同 lane 内白狗 y 与黄狗 y 距离阈值（其实激活后基本不会用到，留兜底）
  const Y_TOLERANCE = 80;
  // 5 条 lane（与 catch.html 中保持一致）
  const LANE_COUNT = 5;
  const LANE_Y_RATIOS = [0.2, 0.35, 0.5, 0.65, 0.8];

  // Fallback 谱面（音频分析失败时使用），节奏更密
  const FALLBACK_BEATMAP = [
    2.0, 2.8, 3.6, 4.4, 5.2, 6.0, 6.8, 7.4, 8.2, 9.0,
    9.8, 10.4, 11.2, 12.0, 12.8, 13.6, 14.4, 15.0, 15.8, 16.6,
    17.4, 18.2, 19.0, 19.8, 20.6, 21.4, 22.2, 23.0,
  ].map((t, i) => ({ time: t, duration: 0.6 + (i % 3) * 0.2 }));

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  // 过滤掉间隔太近的鼓点：黄狗到达中线后还要充电 280~700ms，
  // 锁死困难模式（0.5s 间隔，几乎不过滤，原汁原味鼓点轰炸）
  const HARD_GAP = 0.5;
  function filterTooClose(beatmap) {
    if (!Array.isArray(beatmap) || beatmap.length < 2) return beatmap;
    const out = [beatmap[0]];
    for (let i = 1; i < beatmap.length; i++) {
      const t = beatmap[i].time ?? beatmap[i];
      const prev = out[out.length - 1].time ?? out[out.length - 1];
      if (t - prev >= HARD_GAP) out.push(beatmap[i]);
    }
    return out;
  }

  // ====== 离线分析音频鼓点 ======
  // 思路：解码音频 → 低通过滤（保留低频鼓点）→ 滑动窗口能量峰值 → 时间戳数组
  async function analyzeBeats(audioUrl) {
    try {
      const resp = await fetch(audioUrl);
      const buf = await resp.arrayBuffer();
      // 用一次性 OfflineAudioContext 解码
      const tempCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
      const audioBuf = await tempCtx.decodeAudioData(buf.slice(0));

      // 重新建一个 OfflineAudioContext 跑低通滤波
      const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        1, audioBuf.length, audioBuf.sampleRate
      );
      const src = offline.createBufferSource();
      src.buffer = audioBuf;
      const lp = offline.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 150; // 只保留低频（kick drum 范围）
      src.connect(lp).connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      const data = rendered.getChannelData(0);
      const sr = rendered.sampleRate;

      // 滑动窗口能量
      const winSize = Math.floor(sr * 0.025); // 25ms 窗口
      const hopSize = Math.floor(sr * 0.012); // 12ms 步长
      const energies = [];
      for (let i = 0; i + winSize < data.length; i += hopSize) {
        let e = 0;
        for (let j = 0; j < winSize; j++) e += data[i + j] * data[i + j];
        energies.push({ t: i / sr, e });
      }

      // 计算局部最大值 + 阈值过滤
      const beats = [];
      // 平均能量做基线
      const avg = energies.reduce((s, x) => s + x.e, 0) / energies.length;
      for (let i = 2; i < energies.length - 2; i++) {
        const cur = energies[i].e;
        if (
          cur > avg * 2.2 &&
          cur > energies[i - 1].e &&
          cur > energies[i + 1].e &&
          cur > energies[i - 2].e &&
          cur > energies[i + 2].e
        ) {
          // 防止太密：与上一拍间隔 > 220ms 才算一拍
          if (!beats.length || energies[i].t - beats[beats.length - 1] > 0.22) {
            beats.push(energies[i].t);
          }
        }
      }

      console.log(`[catch-mode] 分析得到 ${beats.length} 个鼓点`);
      // 转成谱面，每拍 duration 在 0.5~1.0 之间随机但稳定
      return beats.map((t, i) => ({
        time: t,
        duration: 0.5 + ((i * 7) % 6) * 0.1, // 0.5/0.6/.../1.0 周期循环
      }));
    } catch (err) {
      console.warn('[catch-mode] 鼓点分析失败，使用 fallback 谱面', err);
      return null;
    }
  }

  // ====== Web Audio 音效合成 ======
  function createSfxEngine() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);

    function playTone({ freq, type = 'sine', duration = 0.18, vol = 0.4, sweepTo = null, attack = 0.005 }) {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (sweepTo !== null) {
        osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
      }
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(masterGain);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }

    return {
      ctx,
      resume: () => ctx.resume(),
      perfect: () => {
        // 三和弦上行，亮晶晶
        playTone({ freq: 880, type: 'triangle', duration: 0.18, vol: 0.32 });
        setTimeout(() => playTone({ freq: 1320, type: 'triangle', duration: 0.18, vol: 0.32 }), 50);
        setTimeout(() => playTone({ freq: 1760, type: 'sine', duration: 0.28, vol: 0.32 }), 110);
      },
      good: () => {
        playTone({ freq: 660, type: 'triangle', duration: 0.16, vol: 0.3 });
        setTimeout(() => playTone({ freq: 990, type: 'sine', duration: 0.22, vol: 0.3 }), 70);
      },
      bad: () => {
        playTone({ freq: 330, type: 'sawtooth', duration: 0.22, vol: 0.25, sweepTo: 220 });
      },
      miss: () => {
        playTone({ freq: 240, type: 'sawtooth', duration: 0.4, vol: 0.28, sweepTo: 90 });
      },
      // 鼓点小拍点（中线脉冲时叠加）
      tick: () => {
        playTone({ freq: 1100, type: 'square', duration: 0.06, vol: 0.12, attack: 0.001 });
      },
    };
  }

  // ====== 工厂函数 ======
  function init(deps) {
    const {
      wrapEl, whitePuppyEl, chargeBarEl, chargeFillEl,
      judgeTextEl, judgeLastEl, scoreNumEl, comboNumEl, moodTagEl,
      audioEl, fxCanvas, mainCanvas,
      stateRef,
    } = deps;

    const fctx = fxCanvas.getContext('2d');

    // ====== lane 白狗 + 充电条（按需懒加载，仅 active lane 显示） ======
    // 老的 #whitePuppy 隐藏，由 catch-mode 接管 lane 白狗
    if (whitePuppyEl) whitePuppyEl.style.display = 'none';
    if (chargeBarEl) chargeBarEl.style.display = 'none';

    const lanePuppies = new Array(LANE_COUNT); // 稀疏数组，按需创建
    function ensureLanePuppy(i) {
      if (lanePuppies[i]) return lanePuppies[i];
      const ly = LANE_Y_RATIOS[i];
      const el = document.createElement('img');
      el.className = 'lane-puppy';
      el.src = WHITE_PUPPY_GIF;
      el.alt = `lane-${i}`;
      el.dataset.gif = 'white/high.gif';
      el.style.top = `${ly * 100}%`;
      el.style.left = '50%';
      // 初始隐藏，由主循环按 active 控制
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      applyGifSize(el);
      el.classList.add('lane-puppy-spawn');
      wrapEl.appendChild(el);
      requestAnimationFrame(() => el.classList.remove('lane-puppy-spawn'));

      const bar = document.createElement('div');
      bar.className = 'lane-charge-bar';
      bar.style.top = `${ly * 100 + 8}%`;
      const fill = document.createElement('div');
      fill.className = 'fill';
      bar.appendChild(fill);
      wrapEl.appendChild(bar);

      const lp = { el, chargeBar: bar, chargeFill: fill, y: ly, currentY: ly };
      lanePuppies[i] = lp;
      return lp;
    }
    // 默认中央 lane（index 2）：作为没有手指时的默认陪伴小狗
    const DEFAULT_LANE = 2;
    ensureLanePuppy(DEFAULT_LANE);

    const game = {
      startedAt: 0,
      cursor: 0,
      yellowPuppies: [],
      score: 0,
      combo: 0,
      maxCombo: 0,
      whiteY: 0,
      chargingPuppy: null,
      // 优先使用预计算谱面（scripts/analyze-beats.mjs 离线生成），没有就用 fallback
      beatmap: filterTooClose(
        (window.PRECOMPUTED_BEATMAP && window.PRECOMPUTED_BEATMAP.length > 6)
          ? window.PRECOMPUTED_BEATMAP
          : FALLBACK_BEATMAP,
      ),
      // 视觉特效
      particles: [],
      ripples: [],     // 中线鼓点脉冲
      starbursts: [],  // 治愈星星爆发
      shakeUntil: 0,
      shakeIntensity: 0,
      // 暂停状态
      paused: false,
      pausedAt: 0,
    };

    const sfx = createSfxEngine();

    // ====== 创建黄狗 DOM ======
    function spawnYellow(now, beat) {
      const moodCfg = pick(MOOD_LIBRARY);
      const img = document.createElement('img');
      img.className = 'yellow-puppy';
      img.src = moodCfg.gif;
      img.alt = moodCfg.label;
      applyGifSize(img);
      wrapEl.appendChild(img);

      // 随机分到一条 lane，y 锁定
      const laneIdx = Math.floor(Math.random() * LANE_COUNT);
      const startY = LANE_Y_RATIOS[laneIdx] * stateRef.height;

      // 每只小狗自己的气泡
      const bubble = document.createElement('div');
      bubble.className = 'yellow-bubble';
      wrapEl.appendChild(bubble);

      const yellow = {
        el: img,
        bubbleEl: bubble,
        spawnAt: now,
        startX: stateRef.width + 100,
        y: startY,
        startY,
        laneIdx, // 关键：黄狗绑定的轨道索引
        mood: moodCfg.mood,
        moodCfg,
        // 充电时长：把鼓点 duration 减半，最低 280ms，最高 700ms
        chargeDuration: clamp(beat.duration * 500, 280, 700),
        chargeProgress: 0,
        state: 'incoming',
        resolved: false,
        bubbleShownAt: 0,
        bubbleHideAt: 0,
        trailEmitAt: 0,
        wobblePhase: Math.random() * Math.PI * 2,
        currentX: stateRef.width + 100,
      };
      const centerX = stateRef.width / 2;
      yellow.speed = (centerX - yellow.startX) / (TRAVEL_TIME * 1000);
      game.yellowPuppies.push(yellow);

      // 出场气泡：跟着小狗自己飘
      if (Math.random() < 0.7) {
        showYellowBubble(yellow, pick(moodCfg.bubbles), now, 1800);
      }
    }

    // ====== 单只小狗自己的气泡 ======
    function showYellowBubble(yellow, text, now, duration = 1500) {
      if (!yellow.bubbleEl) return;
      yellow.bubbleEl.textContent = text;
      yellow.bubbleEl.classList.add('show');
      yellow.bubbleEl.dataset.mood = yellow.mood || '';
      yellow.bubbleShownAt = now;
      yellow.bubbleHideAt = now + duration;
    }

    // ====== 中线鼓点脉冲：黄狗到达中线时触发 ======
    function spawnCenterRipple(y) {
      game.ripples.push({
        x: stateRef.width / 2,
        y,
        r: 30,
        maxR: 220,
        life: 1,
      });
      sfx.tick();
    }

    // ====== 黄狗拖尾粒子（已禁用以提升性能）======
    function spawnTrail(_yellow, _x) {
      // no-op: 拖尾粒子已移除，减少 Canvas 绘制压力
    }

    // ====== 治愈成功爆发：贴贴成功时撒一圈温柔的星星
    // level 来自判定（perfect / good / 其他），用来决定数量和大小，但视觉风格统一温和，
    // 不让玩家感觉自己在被打分——只是小狗心情好的程度不一样。 ======
    function spawnStarburst(x, y, level) {
      // 数量：perfect 多一些，good 少一些；都不要太多，避免"金币爆炸"的奖励感
      const count = level === 'perfect' ? 14 : (level === 'good' ? 10 : 7);
      // 暖色相区间：粉橙 → 浅黄 → 奶白偏粉，避免冷色，保持治愈感
      const hueBase = 30; // 偏暖
      const hueRange = 30;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        // perfect 速度稍快、星星稍大；good 收一点
        const speed = (level === 'perfect' ? 3.2 : 2.4) + Math.random() * 1.4;
        const size = (level === 'perfect' ? 9 : 7) + Math.random() * 4;
        game.particles.push({
          type: 'star',
          x: x + (Math.random() - 0.5) * 14,
          y: y + (Math.random() - 0.5) * 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.6, // 整体略向上，给"飞起来"的感觉
          life: 1,
          decay: 0.018,
          size,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.18,
          hue: hueBase + Math.random() * hueRange, // 30~60 度，暖色
        });
      }
    }

    // ====== 治愈系：失败时不再撒水滴粒子，避免"被打分"的视觉负反馈。
    // 失败的情绪由小狗自己（angry.gif + 委屈气泡）表达，画面不再叠泪滴粒子。 ======
    function spawnFailDrops(_x, _y) {
      // no-op: 治愈游戏不要让失败有"特效惩罚"，留给角色自己表达
    }

    // ====== 屏幕震动（combo 高时触发） ======
    function triggerShake(intensity, duration) {
      game.shakeIntensity = Math.max(game.shakeIntensity, intensity);
      game.shakeUntil = Math.max(game.shakeUntil, performance.now() + duration);
    }

    // ====== 更新 / 渲染单只黄狗 ======
    function updateYellow(yellow, now) {
      if (yellow.state === 'gone') return false;

      const elapsed = now - yellow.spawnAt;
      const centerX = stateRef.width / 2;

      let currentX;
      if (yellow.exitMode === 'happySlide') {
        // 治愈成功后：保留原速度从中线继续往左滑出屏幕
        currentX = yellow.startX + yellow.speed * elapsed;
        // 开心地小幅蹦跳
        yellow.y = yellow.startY + Math.sin((now - yellow.spawnAt) * 0.012) * 10;
        if (currentX < -150) {
          cleanupYellow(yellow);
          return false;
        }
      } else if (yellow.exitMode === 'sadSlide') {
        currentX = yellow.startX + yellow.speed * elapsed;
        yellow.y = yellow.startY + Math.sin((now - yellow.spawnAt) * 0.003) * 6;
        if (currentX < -150) {
          cleanupYellow(yellow);
          return false;
        }
      } else {
        currentX = yellow.startX + yellow.speed * elapsed;
        // 上下轻微飘动，更生动
        yellow.y = yellow.startY + Math.sin(yellow.wobblePhase + elapsed * 0.004) * 8;
      }

      // 拖尾粒子
      if (yellow.exitMode === undefined && now - yellow.trailEmitAt > 35) {
        yellow.trailEmitAt = now;
        spawnTrail(yellow, currentX);
      }

      const inJudge = Math.abs(currentX - centerX) < JUDGE_HALF_WIDTH;
      const passedCenter = currentX < centerX - JUDGE_HALF_WIDTH;

      // 检测「刚到达中线」：触发鼓点脉冲
      if (!yellow.rippleEmitted && currentX <= centerX + 6) {
        yellow.rippleEmitted = true;
        spawnCenterRipple(yellow.y);
      }

      if (!yellow.resolved && yellow.exitMode === undefined) {
        // 关键变化：判定依据 = 黄狗所在 lane 是否在 state.activeLanes 中（手指激活）
        const laneActive = stateRef.activeLanes && stateRef.activeLanes.has(yellow.laneIdx);
        if (inJudge) {
          if (laneActive) {
            if (!game.chargingPuppy || game.chargingPuppy === yellow) {
              game.chargingPuppy = yellow;
              yellow.state = 'charging';
              if (now - yellow.bubbleShownAt > 1500) {
                if (Math.random() < 0.45) {
                  showYellowBubble(yellow, pick(PUPPY_NUZZLE_BUBBLES), now, 1200);
                }
              }
            }
          } else {
            if (game.chargingPuppy === yellow) {
              game.chargingPuppy = null;
              yellow.state = 'incoming';
            }
          }
        } else if (passedCenter) {
          resolveYellow(yellow, now);
        }
      }

      yellow.currentX = currentX;

      const xPercent = (currentX / stateRef.width) * 100;
      const yPercent = (yellow.y / stateRef.height) * 100;
      yellow.el.style.left = `${xPercent}%`;
      yellow.el.style.top = `${yPercent}%`;

      // 同步气泡位置：跟着小狗头顶飘
      if (yellow.bubbleEl) {
        // 充电时气泡飘到该 lane 的白狗上方；其他时候跟黄狗头顶
        const lanePuppy = lanePuppies[yellow.laneIdx];
        const bubbleX = yellow.state === 'charging' ? stateRef.width / 2 : currentX;
        const bubbleY = yellow.state === 'charging' && lanePuppy
          ? (lanePuppy.currentY ?? lanePuppy.y) * stateRef.height
          : yellow.y;
        yellow.bubbleEl.style.left = `${(bubbleX / stateRef.width) * 100}%`;
        yellow.bubbleEl.style.top = `${(bubbleY / stateRef.height) * 100}%`;

        // 自动隐藏
        if (yellow.bubbleHideAt && now > yellow.bubbleHideAt) {
          yellow.bubbleEl.classList.remove('show');
          yellow.bubbleHideAt = 0;
        }
      }

      return true;
    }

    function cleanupYellow(yellow) {
      yellow.state = 'gone';
      if (yellow.el?.parentNode) yellow.el.parentNode.removeChild(yellow.el);
      if (yellow.bubbleEl?.parentNode) yellow.bubbleEl.parentNode.removeChild(yellow.bubbleEl);
      if (game.chargingPuppy === yellow) game.chargingPuppy = null;
    }

    function resolveYellow(yellow, now) {
      yellow.resolved = true;
      if (activeDuoEl?.parentNode) activeDuoEl.parentNode.removeChild(activeDuoEl);
      activeDuoEl = null;
      // 恢复所有 lane 白狗显示
      for (const lp of lanePuppies) { if (lp) lp.el.style.opacity = ''; }

      const p = yellow.chargeProgress;
      let level, points;
      // 评级阈值放宽：更容易拿 perfect / good
      if (p >= 0.7) { level = 'perfect'; points = 100; }
      else if (p >= 0.35) { level = 'good'; points = 60; }
      else if (p > 0.05) { level = 'bad'; points = 20; }
      else { level = 'miss'; points = 0; }

      showJudge(level);
      // 接住啦！屏幕中央炸裂一句温馨气泡词（perfect/good/bad 都给）
      if (level !== 'miss') {
        showCatchHero(pick(PUPPY_HUG_BUBBLES), level);
      }
      sfx[level]();

      if (level === 'miss' || level === 'bad') {
        game.combo = 0;
      } else {
        game.combo += 1;
        game.maxCombo = Math.max(game.maxCombo, game.combo);
      }
      game.score += points + Math.floor(game.combo * 1.5);
      updateScoreboard();

      if (yellow.el) yellow.el.style.opacity = '1';

      const cx = stateRef.width / 2;
      if (level === 'perfect' || level === 'good') {
        // 治愈成功：换成开心 GIF，继续按原速度从左边滑走（不再飞天）
        setGifSrc(yellow.el, pick(HAPPY_GIFS));
        yellow.exitMode = 'happySlide';
        // 反馈层精简：保留屏幕震动 + 中央 hero 大图，去掉黄狗头顶气泡和星星粒子，
        // 让"接住"的视觉表达集中在 hero 大图和轨道 hug.gif，不堆叠多种粒子/气泡。
        if (level === 'perfect') triggerShake(8, 280);
        else triggerShake(4, 180);
      } else {
        // 没接住：换成 angry.gif，原速度滑走
        setGifSrc(yellow.el, ANGRY_GIF);
        yellow.exitMode = 'sadSlide';
        spawnFailDrops(cx, yellow.y);
        if (level === 'miss') triggerShake(3, 200);
        showYellowBubble(yellow, pick(PUPPY_MISS_BUBBLES), now, 1500);
      }

      if (game.chargingPuppy === yellow) game.chargingPuppy = null;
    }

    // ====== 充电中实时叠加 duo gif ======
    let activeDuoEl = null;
    function syncDuoOverlay() {
      if (game.chargingPuppy && game.chargingPuppy.state === 'charging') {
        const charging = game.chargingPuppy;
        const lanePuppy = ensureLanePuppy(charging.laneIdx);
        if (!activeDuoEl) {
          activeDuoEl = document.createElement('img');
          activeDuoEl.className = 'duo-puppy';
          // 轨道上的"接住"画面固定使用 hug.gif，让两狗贴贴成为接住的视觉签名
          activeDuoEl.src = HUG_GIF;
          applyGifSize(activeDuoEl);
          wrapEl.appendChild(activeDuoEl);
        }
        activeDuoEl.style.left = '50%';
        activeDuoEl.style.top = `${(lanePuppy?.currentY ?? lanePuppy?.y ?? 0.5) * 100}%`;
        // 只隐藏当前 lane 的白狗，其他 lane 保持
        for (const lp of lanePuppies) {
          if (!lp) continue;
          lp.el.style.opacity = lp === lanePuppy ? '0' : '';
        }
        if (charging.el) charging.el.style.opacity = '0';
      } else {
        if (activeDuoEl?.parentNode) activeDuoEl.parentNode.removeChild(activeDuoEl);
        activeDuoEl = null;
        for (const lp of lanePuppies) { if (lp) lp.el.style.opacity = ''; }
        for (const y of game.yellowPuppies) {
          if (y.state !== 'gone' && y.exitMode === undefined) {
            y.el.style.opacity = '1';
          }
        }
      }
    }

    let judgeTimer = null;
    function showJudge(level) {
      const labels = { perfect: 'PERFECT', good: 'GOOD', bad: 'BAD', miss: 'MISS' };
      judgeTextEl.className = 'judge-text';
      // eslint-disable-next-line no-unused-expressions
      judgeTextEl.offsetWidth;
      judgeTextEl.classList.add(level, 'show');
      judgeTextEl.textContent = labels[level];
      if (judgeLastEl) {
        const comboTxt = game.combo > 1 ? ` · 连击 ${game.combo}` : '';
        judgeLastEl.textContent = `上一拍：${labels[level]}${comboTxt}`;
      }
      clearTimeout(judgeTimer);
      judgeTimer = setTimeout(() => {
        judgeTextEl.classList.remove('show');
      }, 600);
    }

    // ===== 屏幕中央 · 接住成功的炸裂提示（温馨文字 + 放大 duo gif） =====
    const catchHeroEl = document.getElementById('catchHero');
    const catchHeroTextEl = catchHeroEl?.querySelector('.hero-text');
    const catchHeroImgEl = catchHeroEl?.querySelector('.hero-img');
    let heroTimer = null;
    function showCatchHero(text, level) {
      if (!catchHeroEl) return;
      if (catchHeroTextEl) catchHeroTextEl.textContent = text;
      if (catchHeroImgEl) {
        // hero 放大动画从不含 hug 的候选里抽，避免和轨道上的"贴贴"表演视觉重复
        const gifSrc = pick(HERO_GIFS);
        // 加时间戳避免缓存让 GIF 不重新播放
        catchHeroImgEl.src = `${gifSrc}?t=${performance.now() | 0}`;
      }
      catchHeroEl.className = '';
      // 强制 reflow，让动画每次都能重新触发
      // eslint-disable-next-line no-unused-expressions
      catchHeroEl.offsetWidth;
      catchHeroEl.classList.add('show');
      if (level === 'perfect') catchHeroEl.classList.add('perfect');
      clearTimeout(heroTimer);
      heroTimer = setTimeout(() => {
        catchHeroEl.classList.remove('show', 'perfect');
      }, 1100);
    }

    let moodTagTimer = null;
    // 已废弃：现在每只小狗都有自己的 .yellow-bubble，不再使用全局 #moodTag
    // 保留 noop 防外部引用
    function showBubble(_text) {
      void moodTagTimer;
    }
    void showBubble;

    function updateScoreboard() {
      if (scoreNumEl) scoreNumEl.textContent = String(game.score);
      if (comboNumEl) comboNumEl.textContent = String(game.combo);
    }

    // ====== 谱面推进：考虑 TRAVEL_TIME 提前量 ======
    function tickBeatmap(now) {
      // 黄狗需要 TRAVEL_TIME 秒到达中线，所以提前 TRAVEL_TIME 生成
      const songElapsed = (now - game.startedAt) / 1000;
      while (game.cursor < game.beatmap.length) {
        const beat = game.beatmap[game.cursor];
        // 当当前歌曲时间 + TRAVEL_TIME 已经达到鼓点时间，就生成
        if (songElapsed + TRAVEL_TIME >= beat.time) {
          spawnYellow(now, beat);
          game.cursor += 1;
        } else {
          break;
        }
      }
    }

    // ====== 视觉特效绘制 ======
    function drawFX(now) {
      const w = stateRef.width, h = stateRef.height;
      fctx.clearRect(0, 0, w, h);

      // 屏幕震动：通过 transform 实现
      let shakeX = 0, shakeY = 0;
      if (now < game.shakeUntil) {
        const t = (game.shakeUntil - now) / 280;
        shakeX = (Math.random() - 0.5) * game.shakeIntensity * t;
        shakeY = (Math.random() - 0.5) * game.shakeIntensity * t;
      } else {
        game.shakeIntensity = 0;
      }
      // 通过 wrap CSS transform 模拟整屏抖动
      wrapEl.style.transform = `translate(${shakeX}px, ${shakeY}px)`;

      // 中线鼓点 ripple
      for (let i = game.ripples.length - 1; i >= 0; i--) {
        const r = game.ripples[i];
        r.r += 6;
        r.life -= 0.025;
        if (r.life <= 0 || r.r > r.maxR) { game.ripples.splice(i, 1); continue; }
        fctx.save();
        fctx.strokeStyle = `rgba(255, 216, 107, ${r.life * 0.6})`;
        fctx.lineWidth = 3 * r.life;
        fctx.shadowColor = '#ffd86b';
        fctx.shadowBlur = 18;
        fctx.beginPath();
        fctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        fctx.stroke();
        fctx.restore();
      }

      // 治愈成功大光环
      for (let i = game.starbursts.length - 1; i >= 0; i--) {
        const s = game.starbursts[i];
        s.r += 9;
        s.life -= 0.022;
        if (s.life <= 0 || s.r > s.maxR) { game.starbursts.splice(i, 1); continue; }
        fctx.save();
        const grad = fctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        grad.addColorStop(0, `hsla(${s.hue}, 95%, 70%, ${s.life * 0.5})`);
        grad.addColorStop(0.7, `hsla(${s.hue}, 95%, 70%, ${s.life * 0.15})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        fctx.fillStyle = grad;
        fctx.beginPath();
        fctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        fctx.fill();
        fctx.restore();
      }

      // 粒子
      for (let i = game.particles.length - 1; i >= 0; i--) {
        const p = game.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.type === 'trail') {
          p.vx *= 0.92;
          p.vy *= 0.92;
        } else if (p.type === 'star') {
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.vy += 0.06;
          p.rot += p.spin;
        } else if (p.type === 'drop') {
          p.vy += 0.12;
        }
        p.life -= p.decay;
        if (p.life <= 0) { game.particles.splice(i, 1); continue; }

        fctx.save();
        if (p.type === 'trail') {
          fctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${p.life * 0.65})`;
          fctx.shadowColor = `hsla(${p.hue}, 95%, 70%, ${p.life})`;
          fctx.shadowBlur = 14;
          fctx.beginPath();
          fctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          fctx.fill();
        } else if (p.type === 'star') {
          fctx.translate(p.x, p.y);
          fctx.rotate(p.rot);
          fctx.fillStyle = `hsla(${p.hue}, 95%, 72%, ${p.life})`;
          fctx.shadowColor = `hsla(${p.hue}, 95%, 72%, ${p.life})`;
          fctx.shadowBlur = 18;
          drawStar(fctx, 0, 0, p.size, p.size * 0.45, 5);
        } else if (p.type === 'drop') {
          fctx.fillStyle = `rgba(140, 180, 220, ${p.life * 0.7})`;
          fctx.shadowColor = 'rgba(140, 180, 220, 0.7)';
          fctx.shadowBlur = 8;
          fctx.beginPath();
          fctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          fctx.fill();
        }
        fctx.restore();
      }

      // 充电光环（在该 lane 的白狗周围）
      if (game.chargingPuppy && game.chargingPuppy.state === 'charging') {
        const cx = stateRef.width / 2;
        const lp = lanePuppies[game.chargingPuppy.laneIdx];
        const cy = (lp?.currentY ?? lp?.y ?? 0.5) * stateRef.height;
        const prog = game.chargingPuppy.chargeProgress;
        const pulse = 1 + Math.sin(now / 80) * 0.08;
        fctx.save();
        // 外圈进度环
        fctx.strokeStyle = `hsla(${50 + prog * 40}, 95%, 70%, 0.85)`;
        fctx.lineWidth = 6;
        fctx.shadowColor = '#ffd86b';
        fctx.shadowBlur = 20;
        fctx.beginPath();
        fctx.arc(cx, cy, 90 * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
        fctx.stroke();
        // 内圈柔光
        const grad = fctx.createRadialGradient(cx, cy, 0, cx, cy, 130);
        grad.addColorStop(0, `hsla(${50 + prog * 40}, 95%, 80%, ${0.25 + prog * 0.25})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        fctx.fillStyle = grad;
        fctx.beginPath();
        fctx.arc(cx, cy, 130, 0, Math.PI * 2);
        fctx.fill();
        fctx.restore();
      }
    }

    function drawStar(ctx, cx, cy, outerR, innerR, spikes) {
      let rot = -Math.PI / 2;
      const step = Math.PI / spikes;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
        rot += step;
      }
      ctx.closePath();
      ctx.fill();
    }

    // ====== 主循环 ======
    let lastFrameAt = 0;
    function frame(now) {
      if (game.paused) return; // 暂停时直接退出，由 resume() 重新启动
      const dt = lastFrameAt ? (now - lastFrameAt) : 16;
      lastFrameAt = now;

      // ===== lane 白狗渲染 =====
      // 规则：
      // 1. 没有手指时：仅显示中央默认 lane 的白狗，y 固定在 lane 中心
      // 2. 有手指时：仅显示 active lane 的白狗，y 跟随该 lane 内手指 y
      const active = stateRef.activeLanes || new Set();
      const laneFingerY = stateRef.laneFingerY || {};
      const laneSide = stateRef.laneSide || {};
      const noFinger = active.size === 0;
      // 决定要显示的 lane 集合
      const showSet = new Set(noFinger ? [DEFAULT_LANE] : active);
      // 懒加载需要显示的 lane
      for (const idx of showSet) ensureLanePuppy(idx);

      for (let i = 0; i < LANE_COUNT; i++) {
        const lp = lanePuppies[i];
        if (!lp) continue;
        const shouldShow = showSet.has(i);
        if (shouldShow) {
          // 计算目标 y 比例：有手指→跟手指，无手指→lane 中心
          const targetY = (noFinger || laneFingerY[i] === undefined)
            ? LANE_Y_RATIOS[i]
            : laneFingerY[i];
          // 平滑跟随（lerp）
          lp.currentY = lp.currentY + (targetY - lp.currentY) * 0.35;
          lp.el.style.top = `${lp.currentY * 100}%`;
          lp.el.style.visibility = 'visible';
          // 通过 active 类切换显示亮度
          if (active.has(i)) lp.el.classList.add('active');
          else lp.el.classList.remove('active');
          // 根据手指所在屏幕一侧，给白狗打 data-side（用于 CSS 着色）
          const side = laneSide[i];
          if (side) {
            lp.el.setAttribute('data-side', side);
          } else {
            lp.el.removeAttribute('data-side');
          }
          // 充电中的 lane opacity 由 syncDuoOverlay 控制，其他时候置 1
          if (!game.chargingPuppy || game.chargingPuppy.laneIdx !== i) {
            lp.el.style.opacity = '1';
          }
        } else {
          lp.el.classList.remove('active');
          lp.el.style.opacity = '0';
          lp.el.style.visibility = 'hidden';
        }
      }

      tickBeatmap(now);

      const charging = game.chargingPuppy;
      if (charging && charging.state === 'charging') {
        charging.chargeProgress = clamp(
          charging.chargeProgress + dt / charging.chargeDuration,
          0, 1
        );
        // 充满电：立刻结算，不再等到滑过中线（用户体感"转完圈就消失"）
        if (charging.chargeProgress >= 1 && !charging.resolved) {
          resolveYellow(charging, now);
        }
      }

      for (const y of game.yellowPuppies) updateYellow(y, now);
      game.yellowPuppies = game.yellowPuppies.filter(y => y.state !== 'gone');

      // 显示当前 charging 黄狗所在 lane 的充电条
      for (const lp of lanePuppies) {
        if (!lp) continue;
        lp.chargeBar.classList.remove('show');
        lp.chargeFill.style.width = '0%';
      }
      if (charging && charging.state === 'charging') {
        const lp = lanePuppies[charging.laneIdx];
        if (lp) {
          // 充电条跟随白狗当前位置（白狗下方一点）
          const cy = (lp.currentY ?? lp.y) * 100 + 8;
          lp.chargeBar.style.top = `${cy}%`;
          lp.chargeBar.classList.add('show');
          lp.chargeFill.style.width = `${charging.chargeProgress * 100}%`;
        }
      }

      syncDuoOverlay();
      drawFX(now);

      requestAnimationFrame(frame);
    }

    function start() {
      // 白狗已在 init 阶段创建，此处只重置游戏状态
      updateScoreboard();

      // 立刻启动主循环（让白狗能跟手指动起来）
      game.startedAt = performance.now();
      requestAnimationFrame(frame);

      // 立刻播音乐（用户点击「开始」就触发了用户手势，可以播）
      if (audioEl) {
        audioEl.volume = 0.55;
        try { sfx.resume(); } catch (_) {}
        const tryPlay = audioEl.play();
        if (tryPlay && typeof tryPlay.catch === 'function') {
          tryPlay.catch((e) => console.warn('音乐播放失败：', e));
        }
      }

      console.log(
        `[catch-mode] 谱面已就绪：${game.beatmap.length} 拍 (${
          window.PRECOMPUTED_BEATMAP?.length > 6 ? '预计算' : 'fallback'
        })`
      );
    }

    // ====== 暂停 / 继续 ======
    // 思路：记录暂停那一刻的时间戳，恢复时把所有"以 performance.now() 为基准的时间戳"整体平移
    //      暂停时长 delta，这样黄狗、气泡、震动、ripple、乐谱推进都不会"飞过"。
    function pause() {
      if (game.paused) return;
      game.paused = true;
      game.pausedAt = performance.now();
      // 暂停背景音乐
      if (audioEl && !audioEl.paused) {
        try { audioEl.pause(); } catch (_) {}
      }
    }
    function resume() {
      if (!game.paused) return;
      const now = performance.now();
      const delta = now - game.pausedAt;
      game.paused = false;
      game.pausedAt = 0;
      // 整体平移所有时间戳
      game.startedAt += delta;
      if (game.shakeUntil) game.shakeUntil += delta;
      for (const y of game.yellowPuppies) {
        y.spawnAt += delta;
        if (y.bubbleShownAt) y.bubbleShownAt += delta;
        if (y.bubbleHideAt) y.bubbleHideAt += delta;
        if (y.trailEmitAt) y.trailEmitAt += delta;
      }
      // 重置 lastFrameAt 让 dt 不会爆炸
      lastFrameAt = 0;
      // 恢复背景音乐
      if (audioEl && audioEl.paused) {
        const tryPlay = audioEl.play();
        if (tryPlay && typeof tryPlay.catch === 'function') {
          tryPlay.catch((e) => console.warn('恢复播放失败：', e));
        }
      }
      // 重新启动主循环
      requestAnimationFrame(frame);
    }
    function isPaused() { return game.paused; }

    // ====== 切歌：清场 + 换谱 + 重置时间轴 + 重置分数 ======
    function switchTrack(trackId) {
      const map = window.PRECOMPUTED_BEATMAPS || {};
      const info = map[trackId];
      if (!info || !info.beatmap) {
        console.warn('[catch-mode] 未知 trackId：', trackId);
        return;
      }
      // 清掉所有在场黄狗 + 它们的气泡
      for (const y of game.yellowPuppies) {
        if (y.el?.parentNode) y.el.parentNode.removeChild(y.el);
        if (y.bubbleEl?.parentNode) y.bubbleEl.parentNode.removeChild(y.bubbleEl);
      }
      game.yellowPuppies = [];
      game.chargingPuppy = null;
      // 清掉残留的 duo 叠加
      if (activeDuoEl?.parentNode) activeDuoEl.parentNode.removeChild(activeDuoEl);
      activeDuoEl = null;
      // 恢复所有 lane 白狗显示
      for (const lp of lanePuppies) {
        if (!lp) continue;
        lp.el.style.opacity = '';
        lp.chargeBar.classList.remove('show');
        lp.chargeFill.style.width = '0%';
      }
      // 清特效
      game.particles = [];
      game.ripples = [];
      game.starbursts = [];
      // 重置分数（新一局）
      game.score = 0;
      game.combo = 0;
      game.maxCombo = 0;
      updateScoreboard();
      // 切谱面 + 重置时间轴（顺手把太密的鼓点过滤掉，避免重叠点不上）
      game.beatmap = filterTooClose(info.beatmap);
      game.cursor = 0;
      game.startedAt = performance.now();
      console.log(`[catch-mode] 已切到 ${trackId}：${info.beatmap.length} → ${game.beatmap.length} 拍`);
    }

    return { start, switchTrack, pause, resume, isPaused, game };
  }

  window.CatchMode = { init };
})();
