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
      gif: 'gif/roll-in-sad.gif',
      label: '失落',
      bubbles: ['今天不太顺…', '心情有点糟…', '唉…'],
    },
    {
      mood: 'tantrum',
      gif: 'gif/stop-tantrum.gif',
      label: '生气',
      bubbles: ['气死啦！', '哼！', '别管我！'],
    },
  ];

  const HAPPY_GIFS = ['gif/happy.gif', 'gif/super-happy.gif', 'gif/happy-run.gif'];
  const DUO_GIFS = ['gif/two/hug.gif', 'gif/two/play.gif', 'gif/two/play2.gif'];
  const WHITE_PUPPY_GIF = 'gif/white/high.gif';

  const SUCCESS_BUBBLES = ['被你治愈啦！💛', '今天也是好日子！', '谢谢你～', '心情亮起来了！', '好暖呀～'];
  const FAIL_BUBBLES = ['唉…就这样吧', '下次再说吧…', '溜走了…', '没赶上呀…'];
  const MID_CHARGING_BUBBLES = ['再贴一会儿嘛～', '感觉好暖…', '快好啦～', '别走呀！'];

  // 黄狗从屏幕右侧出现到达中线所用秒数（决定移动速度）
  const TRAVEL_TIME = 3.2;
  // 判定区半宽（像素，逻辑坐标系）
  const JUDGE_HALF_WIDTH = 80;
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

    // ====== 5 条 lane 各自的白狗 + 充电条 ======
    // 老的 #whitePuppy 隐藏，由 catch-mode 接管 5 个 lane 白狗
    if (whitePuppyEl) whitePuppyEl.style.display = 'none';
    if (chargeBarEl) chargeBarEl.style.display = 'none';

    const lanePuppies = []; // Array<{el, chargeBar, chargeFill, y}>
    for (let i = 0; i < LANE_COUNT; i++) {
      const ly = LANE_Y_RATIOS[i];
      const el = document.createElement('img');
      el.className = 'lane-puppy';
      el.src = WHITE_PUPPY_GIF;
      el.alt = `lane-${i}`;
      el.style.top = `${ly * 100}%`;
      el.style.left = '50%';
      wrapEl.appendChild(el);

      const bar = document.createElement('div');
      bar.className = 'lane-charge-bar';
      bar.style.top = `${ly * 100 + 8}%`;
      const fill = document.createElement('div');
      fill.className = 'fill';
      bar.appendChild(fill);
      wrapEl.appendChild(bar);

      lanePuppies.push({ el, chargeBar: bar, chargeFill: fill, y: ly });
    }

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
      beatmap: (window.PRECOMPUTED_BEATMAP && window.PRECOMPUTED_BEATMAP.length > 6)
        ? window.PRECOMPUTED_BEATMAP
        : FALLBACK_BEATMAP,
      // 视觉特效
      particles: [],
      ripples: [],     // 中线鼓点脉冲
      starbursts: [],  // 治愈星星爆发
      shakeUntil: 0,
      shakeIntensity: 0,
    };

    const sfx = createSfxEngine();

    // ====== 创建黄狗 DOM ======
    function spawnYellow(now, beat) {
      const moodCfg = pick(MOOD_LIBRARY);
      const img = document.createElement('img');
      img.className = 'yellow-puppy';
      img.src = moodCfg.gif;
      img.alt = moodCfg.label;
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
        chargeDuration: beat.duration * 1000,
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

    // ====== 黄狗拖尾粒子 ======
    function spawnTrail(yellow, x) {
      game.particles.push({
        type: 'trail',
        x: x + (Math.random() - 0.5) * 14,
        y: yellow.y + (Math.random() - 0.5) * 14,
        vx: 1.5 + Math.random() * 0.8,
        vy: (Math.random() - 0.5) * 0.6,
        life: 1,
        decay: 0.04,
        size: 4 + Math.random() * 4,
        hue: 35 + Math.random() * 20,
      });
    }

    // ====== 治愈成功星星爆发 ======
    function spawnStarburst(x, y, level) {
      const count = level === 'perfect' ? 28 : 16;
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const sp = 4 + Math.random() * 6;
        game.particles.push({
          type: 'star',
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.012 + Math.random() * 0.008,
          size: 6 + Math.random() * 6,
          hue: level === 'perfect' ? 50 + Math.random() * 25 : 320 + Math.random() * 30,
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.2,
        });
      }
      // 大爆发光环
      game.starbursts.push({ x, y, r: 30, maxR: level === 'perfect' ? 320 : 200, life: 1, hue: level === 'perfect' ? 55 : 320 });
    }

    // ====== 失败碎屑（小水滴 / 灰心） ======
    function spawnFailDrops(x, y) {
      for (let i = 0; i < 8; i++) {
        game.particles.push({
          type: 'drop',
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 18,
          vx: (Math.random() - 0.5) * 1.6 - 1,
          vy: 0.5 + Math.random() * 1.2,
          life: 1,
          decay: 0.018,
          size: 4 + Math.random() * 3,
        });
      }
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
      if (yellow.exitMode === 'happyFly') {
        const exitElapsed = now - yellow.exitStartAt;
        const HOP_DURATION = 380;
        if (exitElapsed < HOP_DURATION) {
          const hopT = exitElapsed / HOP_DURATION;
          currentX = yellow.exitStartX;
          yellow.y = yellow.exitStartY - Math.abs(Math.sin(hopT * Math.PI * 3)) * 36;
        } else {
          const flyElapsed = exitElapsed - HOP_DURATION;
          currentX = yellow.exitStartX + yellow.exitVx * flyElapsed;
          yellow.y = yellow.exitStartY + yellow.exitVy * flyElapsed - 0.0006 * flyElapsed * flyElapsed;
        }
        if (currentX > stateRef.width + 200 || currentX < -200 || yellow.y < -200) {
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
                  showYellowBubble(yellow, pick(MID_CHARGING_BUBBLES), now, 1200);
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

      // 飞走时朝向调整
      if (yellow.exitMode === 'happyFly') {
        yellow.el.style.transform = `translate(-50%, -50%) scaleX(-1) scale(${1 + Math.sin(elapsed * 0.02) * 0.1})`;
      }

      // 同步气泡位置：跟着小狗头顶飘
      if (yellow.bubbleEl) {
        // 充电时气泡飘到该 lane 的白狗上方；其他时候跟黄狗头顶
        const lanePuppy = lanePuppies[yellow.laneIdx];
        const bubbleX = yellow.state === 'charging' ? stateRef.width / 2 : currentX;
        const bubbleY = yellow.state === 'charging' && lanePuppy
          ? lanePuppy.y * stateRef.height
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
      for (const lp of lanePuppies) lp.el.style.opacity = '';

      const p = yellow.chargeProgress;
      let level, points;
      if (p >= 0.95) { level = 'perfect'; points = 100; }
      else if (p >= 0.6) { level = 'good'; points = 60; }
      else if (p > 0.05) { level = 'bad'; points = 20; }
      else { level = 'miss'; points = 0; }

      showJudge(level);
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
        yellow.el.src = pick(HAPPY_GIFS);
        yellow.exitMode = 'happyFly';
        yellow.exitStartAt = now;
        yellow.exitStartX = cx;
        yellow.exitStartY = yellow.y;
        yellow.exitVx = 0.7 + Math.random() * 0.3;
        yellow.exitVy = -0.55 - Math.random() * 0.25;
        spawnStarburst(cx, yellow.y, level);
        if (level === 'perfect') triggerShake(8, 280);
        else triggerShake(4, 180);
        showYellowBubble(yellow, pick(SUCCESS_BUBBLES), now, 1600);
      } else {
        yellow.exitMode = 'sadSlide';
        spawnFailDrops(cx, yellow.y);
        if (level === 'miss') triggerShake(3, 200);
        showYellowBubble(yellow, pick(FAIL_BUBBLES), now, 1500);
      }

      if (game.chargingPuppy === yellow) game.chargingPuppy = null;
    }

    // ====== 充电中实时叠加 duo gif ======
    let activeDuoEl = null;
    function syncDuoOverlay() {
      if (game.chargingPuppy && game.chargingPuppy.state === 'charging') {
        const charging = game.chargingPuppy;
        const lanePuppy = lanePuppies[charging.laneIdx];
        if (!activeDuoEl) {
          activeDuoEl = document.createElement('img');
          activeDuoEl.className = 'duo-puppy';
          activeDuoEl.src = pick(DUO_GIFS);
          wrapEl.appendChild(activeDuoEl);
        }
        activeDuoEl.style.left = '50%';
        activeDuoEl.style.top = `${(lanePuppy?.y ?? 0.5) * 100}%`;
        // 只隐藏当前 lane 的白狗，其他 lane 保持
        for (const lp of lanePuppies) {
          lp.el.style.opacity = lp === lanePuppy ? '0' : '';
        }
        if (charging.el) charging.el.style.opacity = '0';
      } else {
        if (activeDuoEl?.parentNode) activeDuoEl.parentNode.removeChild(activeDuoEl);
        activeDuoEl = null;
        for (const lp of lanePuppies) lp.el.style.opacity = '';
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
        const cy = (lp?.y ?? 0.5) * stateRef.height;
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
      const dt = lastFrameAt ? (now - lastFrameAt) : 16;
      lastFrameAt = now;

      // 5 条 lane 白狗：根据 activeLanes 切换 active 类
      const active = stateRef.activeLanes || new Set();
      for (let i = 0; i < lanePuppies.length; i++) {
        const lp = lanePuppies[i];
        if (active.has(i)) lp.el.classList.add('active');
        else lp.el.classList.remove('active');
      }

      tickBeatmap(now);

      const charging = game.chargingPuppy;
      if (charging && charging.state === 'charging') {
        charging.chargeProgress = clamp(
          charging.chargeProgress + dt / charging.chargeDuration,
          0, 1
        );
      }

      for (const y of game.yellowPuppies) updateYellow(y, now);
      game.yellowPuppies = game.yellowPuppies.filter(y => y.state !== 'gone');

      // 显示当前 charging 黄狗所在 lane 的充电条
      for (const lp of lanePuppies) {
        lp.chargeBar.classList.remove('show');
        lp.chargeFill.style.width = '0%';
      }
      if (charging && charging.state === 'charging') {
        const lp = lanePuppies[charging.laneIdx];
        if (lp) {
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
      // 切谱面 + 重置时间轴
      game.beatmap = info.beatmap;
      game.cursor = 0;
      game.startedAt = performance.now();
      console.log(`[catch-mode] 已切到 ${trackId}：${info.beatmap.length} 拍`);
    }

    return { start, switchTrack, game };
  }

  window.CatchMode = { init };
})();
