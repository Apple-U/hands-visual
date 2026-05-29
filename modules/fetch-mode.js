// 玩球模式（fetch mode）
// 通过 PuppyFetch.init(deps) 注入主程序的依赖（state、puppy、面板控制、绘制工具等），
// 返回一个 api 对象，给 onResults / updatePuppy 在合适的位置回调。

(function () {
  const FETCH_DEFAULTS = {
    ballSpeedMul: 1.0,
    gravity: 0.45,
    bounce: 0.55,
    puppyMaxSpeed: 28,
    safeZoneRatio: 0.80,
    missChance: 0.05,
    throwSensitivity: 0.5,
    version: 1,
  };
  const FETCH_STORAGE_KEY = 'puppy.fetchConfig';

  function loadFetchConfig() {
    try {
      const raw = localStorage.getItem(FETCH_STORAGE_KEY);
      if (!raw) return { ...FETCH_DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...FETCH_DEFAULTS, ...parsed, version: FETCH_DEFAULTS.version };
    } catch (e) {
      return { ...FETCH_DEFAULTS };
    }
  }
  function saveFetchConfig(cfg) {
    try { localStorage.setItem(FETCH_STORAGE_KEY, JSON.stringify(cfg)); }
    catch (e) { console.warn('save fetch config failed', e); }
  }

  function init(deps) {
    const {
      state,
      puppy,
      mctx,
      moodTag,
      moodBadge,
      moodText,
      flipX,
      dist,
      lerp,
      clamp,
      spawnBubble,
      spawnDust,
      spawnFlowerBurst,
      showMood,
      moodLabel,
      chooseSpriteVariant,
      characterBubble,
    } = deps;

    const fetchCfg = loadFetchConfig();
    const fetchDraft = { ...fetchCfg };

    const fetchState = {
      enabled: false,
      ball: null,
      lastHandStates: new Map(),
      throwLockUntil: 0,
      catchEvent: null,
      lastBallLandPredict: null,
      // —— 邀请玩球 ——
      invitePending: false,
      inviteShownAt: 0,
      inviteCooldownUntil: 0,
      inviteEnterAt: 0,
      okHoldStart: 0,
    };

    // 面板元素
    const fetchPanel = document.getElementById('fetchPanel');
    const fetchPanelToggle = document.getElementById('fetchPanelToggle');
    const fetchModeBtn = document.getElementById('fetchModeBtn');
    const fetchResetBtn = document.getElementById('fetchResetBtn');
    const fetchSaveBtn = document.getElementById('fetchSaveBtn');
    const fetchSaveTip = document.getElementById('fetchSaveTip');
    const fetchSliders = Array.from(document.querySelectorAll('#fetchPanel input[type=range]'));

    function formatFetchVal(key, v) {
      if (key === 'safeZoneRatio') return Math.round(v * 100) + '%';
      if (key === 'missChance') return Math.round(v * 100) + '%';
      if (key === 'puppyMaxSpeed') return String(Math.round(v));
      return Number(v).toFixed(2);
    }
    function syncSlidersFromCfg(cfg) {
      fetchSliders.forEach((slider) => {
        const key = slider.dataset.cfg;
        if (key in cfg) {
          slider.value = cfg[key];
          const valEl = document.getElementById('fetchVal-' + key);
          if (valEl) valEl.textContent = formatFetchVal(key, cfg[key]);
        }
      });
    }
    function refreshFetchModeBtn() {
      fetchModeBtn.classList.toggle('on', fetchState.enabled);
      fetchModeBtn.textContent = fetchState.enabled ? '✓ 已开启' : '关闭';
    }

    if (fetchPanelToggle) {
      fetchPanelToggle.addEventListener('click', () => {
        const collapsed = fetchPanel.classList.toggle('collapsed');
        fetchPanelToggle.setAttribute('aria-expanded', String(!collapsed));
      });
    }
    if (fetchModeBtn) {
      fetchModeBtn.addEventListener('click', () => {
        fetchState.enabled = !fetchState.enabled;
        if (!fetchState.enabled) {
          fetchState.ball = null;
          fetchState.catchEvent = null;
          fetchState.invitePending = false;
          fetchState.inviteEnterAt = 0;
          fetchState.okHoldStart = 0;
          fetchState.inviteCooldownUntil = performance.now() + 30000;
        }
        refreshFetchModeBtn();
        showMood(fetchState.enabled ? 'fetchWait' : (puppy.mood || 'sit'));
      });
    }
    fetchSliders.forEach((slider) => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.cfg;
        const v = parseFloat(slider.value);
        fetchDraft[key] = v;
        const valEl = document.getElementById('fetchVal-' + key);
        if (valEl) valEl.textContent = formatFetchVal(key, v);
      });
    });
    if (fetchResetBtn) {
      fetchResetBtn.addEventListener('click', () => {
        Object.assign(fetchDraft, FETCH_DEFAULTS);
        syncSlidersFromCfg(fetchDraft);
      });
    }
    if (fetchSaveBtn) {
      fetchSaveBtn.addEventListener('click', () => {
        Object.assign(fetchCfg, fetchDraft);
        saveFetchConfig(fetchCfg);
        if (fetchSaveTip) {
          fetchSaveTip.textContent = '✓ 已保存到本地';
          fetchSaveTip.classList.add('show');
          clearTimeout(fetchSaveBtn._t);
          fetchSaveBtn._t = setTimeout(() => fetchSaveTip.classList.remove('show'), 1600);
        }
      });
    }

    syncSlidersFromCfg(fetchCfg);
    refreshFetchModeBtn();

    // ====== 手势工具 ======
    function handOpenness(lm) {
      const wrist = lm[0];
      const palmRef = lm[9];
      const palmSize = Math.max(dist(wrist, palmRef), 0.001);
      const tips = [8, 12, 16, 20];
      const knuckles = [5, 9, 13, 17];
      let extendSum = 0;
      for (let i = 0; i < tips.length; i++) {
        const tipD = dist(lm[tips[i]], lm[knuckles[i]]);
        extendSum += clamp((tipD / palmSize - 0.45) / 0.85, 0, 1);
      }
      return extendSum / tips.length;
    }
    function handCenterPx(lm) {
      const c = lm[9];
      return { x: flipX(c.x) * state.width, y: c.y * state.height };
    }
    function handDirectionPx(lm) {
      const a = lm[0], b = lm[9];
      const ax = flipX(a.x) * state.width, ay = a.y * state.height;
      const bx = flipX(b.x) * state.width, by = b.y * state.height;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    function isOkGesture(lm) {
      const wrist = lm[0];
      const palmRef = lm[9];
      const palmSize = Math.max(dist(wrist, palmRef), 0.001);
      const pinch = dist(lm[4], lm[8]) / palmSize;
      const midExt = dist(lm[12], lm[9]) / palmSize;
      const ringExt = dist(lm[16], lm[13]) / palmSize;
      const pinkyExt = dist(lm[20], lm[17]) / palmSize;
      const otherOpen = (midExt + ringExt + pinkyExt) / 3;
      return pinch < 0.45 && otherOpen > 0.85;
    }

    // ====== 邀请玩球 ======
    function updateFetchInvite(allHands) {
      const now = performance.now();
      const idleMoods = new Set(['sit', 'bored', 'lookAround']);
      const isIdle = idleMoods.has(puppy.mood) ||
        (puppy.mood === 'run' && puppy.fingerSpeedAvg < 4 && puppy.targetDistanceAvg > 220);

      if (!fetchState.invitePending) {
        if (!fetchState.inviteEnterAt && isIdle) {
          fetchState.inviteEnterAt = now;
        } else if (fetchState.inviteEnterAt && !isIdle) {
          fetchState.inviteEnterAt = 0;
        }
        const idleSeconds = fetchState.inviteEnterAt ? (now - fetchState.inviteEnterAt) / 1000 : 0;
        const offCooldown = now >= fetchState.inviteCooldownUntil;
        if (idleSeconds > 6 && offCooldown && allHands.length > 0 && Math.random() < 0.012) {
          fetchState.invitePending = true;
          fetchState.inviteShownAt = now;
          fetchState.okHoldStart = 0;
          spawnBubble(puppy.x + puppy.facing * 36, puppy.y - 200, '陪我玩球嘛?');
          showMood('fetchWait');
          moodTag.textContent = '🎾 陪我玩球嘛？比个 OK 👌 答应我！';
          moodTag.classList.add('show');
          clearTimeout(showMood._t);
          showMood._t = setTimeout(() => moodTag.classList.remove('show'), 4500);
        }
        return;
      }

      const inviteAge = now - fetchState.inviteShownAt;
      if (inviteAge > 8000) {
        fetchState.invitePending = false;
        fetchState.inviteCooldownUntil = now + 25000 + Math.random() * 15000;
        fetchState.inviteEnterAt = 0;
        spawnBubble(puppy.x + puppy.facing * 36, puppy.y - 220, '哼，下次再玩…');
        return;
      }

      let okSeen = false;
      for (const lm of allHands) {
        if (isOkGesture(lm)) { okSeen = true; break; }
      }
      if (okSeen) {
        if (!fetchState.okHoldStart) fetchState.okHoldStart = now;
        const heldMs = now - fetchState.okHoldStart;
        if (heldMs >= 500) {
          fetchState.invitePending = false;
          fetchState.inviteEnterAt = 0;
          fetchState.okHoldStart = 0;
          enterFetchMode();
        } else {
          if (Math.random() < 0.06) {
            spawnBubble(puppy.x + puppy.facing * 36, puppy.y - 220, '保持住!');
          }
        }
      } else {
        fetchState.okHoldStart = 0;
      }
    }

    function enterFetchMode() {
      fetchState.enabled = true;
      fetchState.ball = null;
      fetchState.catchEvent = null;
      refreshFetchModeBtn();
      showMood('fetchWait');
      moodTag.textContent = '🎾 太棒啦！握拳→张开抛球！';
      moodTag.classList.add('show');
      clearTimeout(showMood._t);
      showMood._t = setTimeout(() => moodTag.classList.remove('show'), 2200);
      spawnFlowerBurst(puppy.x, puppy.y - 30);
    }

    // ====== 抛球手势 ======
    function detectThrowGesture(allHands) {
      const now = performance.now();
      if (now < fetchState.throwLockUntil) return;

      const sensitivity = fetchCfg.throwSensitivity;
      const closeThresh = Math.max(0.05, sensitivity * 0.55);
      const openThresh = Math.min(0.95, sensitivity);

      const seen = new Set();
      const triggered = [];
      for (let i = 0; i < allHands.length; i++) {
        const lm = allHands[i];
        const op = handOpenness(lm);
        seen.add(i);
        const prev = fetchState.lastHandStates.get(i);
        const isClosed = op < closeThresh;
        const isOpen = op > openThresh;
        if (prev && prev.closed && isOpen && now - prev.t < 700) {
          triggered.push({ lm, op, prev, gapMs: now - prev.t });
        }
        if (isClosed) {
          fetchState.lastHandStates.set(i, { closed: true, t: now, op });
        } else if (isOpen) {
          fetchState.lastHandStates.set(i, { closed: false, t: now, op });
        }
      }
      for (const k of Array.from(fetchState.lastHandStates.keys())) {
        if (!seen.has(k)) fetchState.lastHandStates.delete(k);
      }
      if (triggered.length === 0) return;

      const isDoubleHand = triggered.length >= 2;
      const refLm = triggered[0].lm;
      const fromCenter = handCenterPx(refLm);
      const handDir = handDirectionPx(refLm);
      const gapMs = Math.min(...triggered.map(t => t.gapMs));
      const speedFactor = clamp(1 - (gapMs - 80) / 500, 0.4, 1.2);
      const baseSpeed = (state.width * 0.45) / 60;
      const power = baseSpeed * fetchCfg.ballSpeedMul * speedFactor * (isDoubleHand ? 1.5 : 1.0);

      const baseAngle = Math.atan2(handDir.y, handDir.x);
      const jitter = (Math.random() - 0.5) * (Math.PI / 12);
      const angle = baseAngle + jitter;

      const sx = fromCenter.x + handDir.x * 30;
      const sy = fromCenter.y + handDir.y * 30;

      fetchState.ball = {
        x: sx, y: sy,
        vx: Math.cos(angle) * power * 6,
        vy: Math.sin(angle) * power * 6 - 6,
        r: Math.max(18, state.width * 0.018),
        phase: 'flying',
        bornAt: now,
        bounceCount: 0,
        forcedMiss: Math.random() < fetchCfg.missChance,
      };
      fetchState.throwLockUntil = now + 600;
      fetchState.catchEvent = null;
    }

    // ====== 球物理与渲染 ======
    function predictBallLanding(ball) {
      const g = fetchCfg.gravity;
      let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
      const targetY = state.height - ball.r - 4;
      let t = 0;
      while (y < targetY && t < 240) {
        vy += g;
        x += vx;
        y += vy;
        t++;
      }
      return { x, y, framesToLand: t };
    }

    function isInSafeZone(point) {
      const ratio = fetchCfg.safeZoneRatio;
      const cx = state.width / 2, cy = state.height / 2;
      const halfW = (state.width * ratio) / 2;
      const halfH = (state.height * ratio) / 2;
      return Math.abs(point.x - cx) <= halfW && Math.abs(point.y - cy) <= halfH;
    }

    function updateAndDrawBall() {
      const now = performance.now();
      if (fetchState.catchEvent && now >= fetchState.catchEvent.until) {
        fetchState.catchEvent = null;
      }
      if (!fetchState.ball) return;
      const b = fetchState.ball;
      if (b.phase === 'flying') {
        b.vy += fetchCfg.gravity;
        b.x += b.vx;
        b.y += b.vy;
        const floorY = state.height - b.r - 4;
        if (b.y >= floorY && b.vy > 0) {
          b.y = floorY;
          b.vy = -b.vy * fetchCfg.bounce;
          b.vx *= 0.85;
          b.bounceCount++;
          if (Math.abs(b.vy) < 1.5 || b.bounceCount > 3) {
            resolveCatch(b);
          }
        }
        if (b.x < -b.r || b.x > state.width + b.r || b.y > state.height + b.r * 4) {
          resolveCatch(b);
        }
        fetchState.lastBallLandPredict = predictBallLanding(b);
      }
      drawBall(b);
    }

    function resolveCatch(ball) {
      const now = performance.now();
      const landPoint = { x: ball.x, y: ball.y };
      const inSafe = isInSafeZone(landPoint);
      const caught = inSafe && !ball.forcedMiss;
      fetchState.catchEvent = {
        type: caught ? 'catch' : 'miss',
        until: now + 1200,
        at: { x: ball.x, y: ball.y },
      };
      ball.phase = caught ? 'caught' : 'missed';
      fetchState.ball = null;
      fetchState.lastBallLandPredict = null;

      const moodKey = caught ? 'fetchCatch' : 'fetchMiss';
      showMood(moodKey);
      const bubbleKey = caught ? 'fetchCatch' : 'fetchMiss';
      spawnBubble(puppy.x + puppy.facing * 36, puppy.y - 200, characterBubble(bubbleKey, caught ? ['接住!'] : ['哎呀!']));
      if (caught) {
        spawnFlowerBurst(landPoint.x, landPoint.y);
      }
    }

    function drawBall(b) {
      const ctx = mctx;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(b.x, Math.min(state.height - 6, b.y + b.r * 0.6), b.r * 0.8, b.r * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      const grd = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.4, b.r * 0.2, b.x, b.y, b.r);
      grd.addColorStop(0, '#fff8a8');
      grd.addColorStop(0.5, '#f5c542');
      grd.addColorStop(1, '#b07f1e');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, -Math.PI * 0.7, -Math.PI * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, Math.PI * 0.3, Math.PI * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    // ====== 玩球模式：小狗专属状态机 ======
    function updatePuppyForFetch(now, dt) {
      const ball = fetchState.ball;
      const event = fetchState.catchEvent;

      let target = null;
      let mood = 'fetchWait';
      let accel = 1.0;
      let damp = 0.86;
      let useDirectFollow = false;

      if (ball && ball.phase === 'flying') {
        const land = fetchState.lastBallLandPredict || { x: ball.x, y: ball.y, framesToLand: 30 };
        target = { x: land.x, y: land.y };
        const dx = target.x - puppy.x;
        const dy = target.y - puppy.y;
        const d = Math.hypot(dx, dy);
        const framesAvail = Math.max(land.framesToLand, 6);
        const requiredSpeed = d / framesAvail;
        const fetchMaxSpeed = clamp(requiredSpeed * 1.15, 6, fetchCfg.puppyMaxSpeed);
        const ux = dx / (d || 1);
        const uy = dy / (d || 1);
        accel = clamp(requiredSpeed / 6, 0.6, 3.0);
        puppy.vx += ux * accel;
        puppy.vy += uy * accel;
        const sp0 = Math.hypot(puppy.vx, puppy.vy);
        if (sp0 > fetchMaxSpeed) {
          puppy.vx = puppy.vx / sp0 * fetchMaxSpeed;
          puppy.vy = puppy.vy / sp0 * fetchMaxSpeed;
        }
        damp = 0.92;
        mood = 'fetchChase';
        useDirectFollow = true;
        puppy.heading = Math.atan2(dy, dx);
        puppy.facing = Math.cos(puppy.heading) >= 0 ? 1 : -1;
      } else if (event) {
        target = event.at;
        const dx = target.x - puppy.x;
        const dy = target.y - puppy.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) {
          puppy.vx += (dx / d) * 0.4;
          puppy.vy += (dy / d) * 0.4;
        }
        damp = 0.78;
        mood = event.type === 'catch' ? 'fetchCatch' : 'fetchMiss';
        useDirectFollow = true;
      } else {
        const cx = state.width / 2;
        const cy = state.height * 0.65;
        const dx = cx - puppy.x;
        const dy = cy - puppy.y;
        const d = Math.hypot(dx, dy);
        if (d > 30) {
          puppy.vx += (dx / d) * 0.45;
          puppy.vy += (dy / d) * 0.45;
        }
        puppy.heading = Math.sin(now / 600) * 0.3;
        puppy.facing = Math.cos(puppy.heading) >= 0 ? 1 : -1;
        const sp0 = Math.hypot(puppy.vx, puppy.vy);
        if (sp0 > 8) {
          puppy.vx = puppy.vx / sp0 * 8;
          puppy.vy = puppy.vy / sp0 * 8;
        }
        damp = 0.85;
        mood = 'fetchWait';
      }

      if (!useDirectFollow) {
        const sp = Math.hypot(puppy.vx, puppy.vy);
        const cap = fetchCfg.puppyMaxSpeed;
        if (sp > cap) {
          puppy.vx = puppy.vx / sp * cap;
          puppy.vy = puppy.vy / sp * cap;
        }
      }
      puppy.vx *= damp;
      puppy.vy *= damp;
      puppy.x += puppy.vx;
      puppy.y += puppy.vy;
      puppy.speed = Math.hypot(puppy.vx, puppy.vy);

      const margin = 60;
      puppy.x = clamp(puppy.x, margin, state.width - margin);
      puppy.y = clamp(puppy.y, margin, state.height - margin);

      const stepFreq = mood === 'fetchChase' ? 22 : 8;
      puppy.bounce = puppy.speed > 0.5 ? Math.sin(now / 1000 * stepFreq) : 0;
      puppy.tailWag += dt * (mood === 'fetchCatch' ? 18 : (mood === 'fetchChase' ? 14 : 6));
      puppy.earWag += dt * (puppy.speed * 0.6 + 2);
      puppy.sitPose = lerp(puppy.sitPose, 0, 0.1);

      if (puppy.mood !== mood) {
        puppy.mood = mood;
        puppy.moodTimer = 0;
        chooseSpriteVariant(mood);
        showMood(mood);
      } else {
        puppy.moodTimer += dt;
      }
      moodBadge.classList.add('ok');
      moodText.textContent = moodLabel(mood);

      if (puppy.speed > 6 && Math.random() < 0.4) {
        spawnDust(puppy.x - puppy.facing * 18, puppy.y + 28);
      }
      if (mood === 'fetchWait' && Math.random() < 0.005) {
        spawnBubble(puppy.x + puppy.facing * 30, puppy.y - 175, characterBubble('fetchWait', ['抛球嘛!']));
      }
    }

    return {
      get enabled() { return fetchState.enabled; },
      get hasBall() { return !!fetchState.ball; },
      handleFrame(allHands) {
        if (fetchState.enabled && !fetchState.ball) {
          detectThrowGesture(allHands);
        }
        if (!fetchState.enabled) {
          updateFetchInvite(allHands);
        }
      },
      updatePuppy: updatePuppyForFetch,
      drawBall: updateAndDrawBall,
    };
  }

  window.PuppyFetch = { init };
})();
