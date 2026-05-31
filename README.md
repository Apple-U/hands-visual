# 🐶 Hands Visual · 用手势和小狗一起玩

一个基于 **MediaPipe Hands** 的浏览器端互动项目，用摄像头识别你的手势，然后让画面里的小狗陪你玩。
没有后端、没有打包工具，所有页面都是纯静态的 HTML + 原生 JS + 原生 Canvas，本地起一个静态服务就能跑。

> 主玩法：**🐶 Puppy Chase · 小狗追指尖 (`puppy.html`)** — 一只会追着你食指跑的治愈系小狗

***

## 🎮 玩法：puppy.html · 小狗追指尖

### 玩法

- 伸出 **食指 ☝️**，让小狗看到你
- 移动指尖，小狗会 **追着跑** 🏃
- 停下来不动，小狗会 **嗅嗅闻闻** 👃
- 指尖太靠近它，小狗会 **兴奋打转** ✨
- 看不到手时，小狗会 **坐下等你** 🐶

### 情绪模式

小狗的 GIF / 文案 / 头顶气泡都绑在同一份 [characters/puppy.js](characters/puppy.js) 配置里（**Single Source of Truth**），目前覆盖的状态：

| 状态                      | GIF                                                                                                          | 触发条件                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `idleHappy`             | [happy-humming.gif](gif/happy-humming.gif)                                                                   | 默认在原地哼歌等你              |
| `chase`                 | [happy-run.gif](gif/happy-run.gif)                                                                           | 食指快速移动，追着指尖跑           |
| `closeCurious`          | [happy-humming.gif](gif/happy-humming.gif)                                                                   | 指尖停下来不动，凑近闻一闻          |
| `excited`               | [happy.gif](gif/happy.gif) / [super-happy.gif](gif/super-happy.gif) / [gift-flower.gif](gif/gift-flower.gif) | 指尖贴它太近，开心打转 ✨ 偶尔送花花 🌸 |
| `bored`                 | [bored.gif](gif/bored.gif)                                                                                   | 等你太久没出现                |
| `lookAround`            | [close-up.gif](gif/close-up.gif)                                                                             | 找不到主人，东张西望             |
| `teased` / `stopTeased` | [cry.gif](gif/cry.gif) / [stop-tantrum.gif](gif/stop-tantrum.gif)                                            | 你逗它就跑、贴上去又溜，被气哭 / 哭完拉倒 |

每种情绪都有一组随机文案池（`moodLines`）和头顶气泡（`bubbles`），不会重复同一句话哦～ 🎵

### 多角色架构

通过 URL 参数切换角色：`puppy.html?character=puppy` （后续可以加 `?character=bear` 等）。
角色拆成三层：

- **互动模式层**：定义通用情绪 (`idleHappy` / `chase` / `sniff` / `excited` …)
- **角色素材层**：每个角色一份 GIF / 尺寸 / 朝向 / 权重表
- **语言人格层**：每个角色独立的 `moodLines` + `bubbles` 语气包

### 隐藏的玩球模式（fetch mode）

[modules/fetch-mode.js](modules/fetch-mode.js) 实现了一套"握拳→张开抛球→小狗去追→接住/漏接"的物理模拟，包含重力、弹跳衰减、扔偏概率等参数。当前入口在 [puppy.html](puppy.html) 用 `hidden` 隐藏（因为尚未调试，保留 DOM 结构方便日后开启），改 `<div id="fetchPanel" hidden>` 即可恢复入口。

***

## 📁 项目结构

```
hands_visual/
├── puppy.html              # 主玩法：🐶 小狗追指尖（情绪状态机）
├── catch.html              # 🎵 我会稳稳地接住你 · 节奏大师 × 黄狗 lane
├── index.html              # ✋ 手势魔法：L 型取景框 + 烟花 + 画彩虹 + 爱心 + 清屏
├── drums.html              # 🥁 Air Drums · 空气架子鼓（双手收拢击打 pad）
├── guitar.html             # 🎸 Hand Guitar · 左手选根音 + 右手戳转盘弹和弦
├── galaxy.html             # 🌌 Galaxy Concert · 标签页音频驱动 GPU 粒子（Three.js）
├── mountains.html          # ⛰️ Sound Mountains · 标签页音频驱动山脉起伏（Three.js）
├── tree.html               # 🎄 Memory Tree · 把 images/ 里的图挂在树上，五指爆散/握拳聚合
├── gif-debug.html          # GIF 尺寸调试面板（独立工具页）
│
├── modules/
│   ├── catch-mode.js       # catch.html 的核心逻辑（lane / 判定 / 黄狗 / 评级）
│   ├── fetch-mode.js       # fetch 模式（已通过 hidden 隐藏入口）
│   └── precomputed-beats.js  # 预计算谱面：window.PRECOMPUTED_BEATMAPS
│
├── styles/
│   ├── catch.css           # catch.html 样式
│   └── puppy.css           # puppy.html 样式
│
├── scripts/
│   └── analyze-beats.mjs   # 离线鼓点分析脚本（Node.js + macOS afconvert）
│
├── gif/                    # 所有小狗表情（white/、two/、根目录）
├── music/                  # 背景音乐（.m4a / .mp3）
├── characters/puppy.js     # 小狗角色配置
└── fonts/                  # 自定义字体
```

***

## 🚀 本地启动

无需安装任何依赖，**只要一个静态 HTTP 服务器**：

```bash
# 方式 1: Python
python3 -m http.server 8000

# 方式 2: Node.js
npx serve

# 方式 3: VS Code Live Server 插件 → 右键 puppy.html → Open with Live Server
```

然后打开浏览器访问：

- 主玩法：<http://localhost:8000/puppy.html>
- 节奏大师：<http://localhost:8000/catch.html>

> ⚠️ 摄像头权限：浏览器要求 `https://` 或 `localhost`，直接 `file://` 打开 HTML 会被拒绝。

***

## 🎵 添加新歌

1. 把音频文件放到 `music/`（支持 `.mp3` / `.m4a` / `.wav`）
2. 在 `scripts/analyze-beats.mjs` 的 `TRACKS` 数组里加一项：
   ```js
   { id: 'mysong', file: 'music/mysong.mp3' }
   ```
3. 跑一下分析脚本（macOS 自带 afconvert，无需额外安装）：
   ```bash
   node scripts/analyze-beats.mjs
   ```
   它会更新 `modules/precomputed-beats.js`，写入 `window.PRECOMPUTED_BEATMAPS.mysong`
4. 在 `catch.html` 的 `#trackOptions` 里加一个按钮：
   ```html
   <button type="button" class="track-btn" data-track="mysong">My Song</button>
   ```

> 算法：mono 44.1kHz wav → IIR lowpass 150Hz → 25ms 滑窗能量 → avg×2.2 阈值 + 220ms 防密集

***

## 🎨 调整 GIF 尺寸

打开 [gif-debug.html](gif-debug.html) 独立调试页：

- 拖滑块实时预览所有 GIF 尺寸
- 点 **📋 复制配置** 导出 JSON
- 把 JSON 写死到 `modules/catch-mode.js` 的 `GIF_SIZE_OVERRIDES` 即可

***

## 🛠️ 技术栈

| 类别   | 技术                                                                               |
| ---- | -------------------------------------------------------------------------------- |
| 手势识别 | [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands.html) (CDN) |
| 渲染   | 原生 Canvas 2D + DOM `<img>` 双层混合（GIF 用 DOM 保留高质量）                                 |
| 音频   | Web Audio API（合成音效）+ HTMLAudioElement（背景乐）                                       |
| 鼓点分析 | OfflineAudioContext（运行时） + macOS `afconvert`（离线脚本）                               |
| 字体   | 自托管字体 `fonts/FuLuLingGanHeChaTi-2.ttf`                                           |
| 构建   | **零构建** — 纯 HTML + ES Module + 原生 JS                                             |

### 关键设计原则

- **Single Source of Truth**：每只小狗的 GIF / 气泡文案 / 特效，绑定在同一个 config 对象
- **HiDPI 支持**：canvas 用固定逻辑坐标 `720×1280`，物理像素通过 `setTransform` 缩放
- **16:9 强制**：`#wrap` 用 `aspect-ratio` 锁死比例，DOM 百分比定位与 canvas 内坐标 1:1 对齐
- **暂停安全**：所有时间戳基于 `performance.now()`，恢复时整体平移 `delta`
- **按需创建**：lane 白狗第一次激活才生成 DOM，避免一开局 5 只挤满屏幕

***

## 🐾 其他玩法

| 文件                               | 标题                 | 玩法                                                                                                                                            |
| -------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [catch.html](catch.html)         | 🎵 我会稳稳地接住你        | 节奏大师玩法：黄狗沿 5 条 lane 从右往左飘，左右手食指控对应颜色白狗，到中央"贴住"小狗充电 280–700ms 即接住；带 Perfect/Good/Bad/Miss 评级、双歌切换（boybee / happyfly）、空格暂停 |
| [index.html](index.html)         | ✋ 手势魔法             | 双手 L 型框景（框内彩色框外灰度）· 五指张开放烟花 · 食指拇指捏合画彩虹 · 点赞冒爱心 · 比耶清屏                                                                                        |
| [drums.html](drums.html)         | 🥁 Air Drums       | 把手放到鼓 pad 上，**手指朝掌心快速收拢**触发击打；双手可同时打不同的鼓                                                                                                      |
| [guitar.html](guitar.html)       | 🎸 Hand Guitar     | 左手伸 1–7 根手指选根音（C/D/E/F/G/A/B），右手食指戳右下转盘选和弦类型，组合一变自动弹奏                                                                                         |
| [galaxy.html](galaxy.html)       | 🌌 Galaxy Concert  | 接 `npx NeteaseCloudMusicApi` 本地后端，扫码登录网易云后可搜歌 / 看我的歌单 / 上下首 / 歌词同步，让 GPU 万粒子随频段起舞（Three.js）— 详见下面独立章节                                         |
| [mountains.html](mountains.html) | ⛰️ Sound Mountains | 共享标签页音频，线条山脉随旋律呼吸、金色光带扫过山脊（Three.js）                                                                                                          |
| [tree.html](tree.html)           | 🎄 Memory Tree     | 把图片放进 `images/`，五指张开 → 挂件爆散为球面，握拳 → 收回成树，食指 → 选中放大                                                                                            |

***

## 🌌 galaxy.html · 单独说明（需要本地后端）

galaxy.html 跟其他玩法不太一样：它**不是**通过共享标签页音频来驱动的，而是直接对接 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 这个本地网易云后端，把音乐的频谱实时喂给 GPU 粒子。

### 启动步骤

1. **先起后端**（必须，否则页面右上角浮层会显示"后端未启动"）：
   ```bash
   npx NeteaseCloudMusicApi
   ```
   它会监听 `http://localhost:3000`，galaxy.html 写死 `const NCM_API = 'http://localhost:3000';` 去调用它。
2. **再起静态服务器**（任选一个）：
   ```bash
   python3 -m http.server 8000
   # 或 npx serve
   ```
3. 打开 <http://localhost:8000/galaxy.html>。

### 玩法

- 右上角浮层 🔍 **搜歌** / 📃 **我的歌单**（需扫码登录网易云账号）/ ⏮ ⏭ 上下首
- 选好歌后点 ▶，HTML5 `<audio>` 播放音乐 + `currentTime` 驱动 LRC 歌词同步（精度 ±50ms）
- 同时 Web Audio `AnalyserNode` 把频谱拆成低频（鼓点）/ 中频（旋律）/ 高频（镲片）三段，喂给 Three.js GPU 粒子
- 可以看到右下面板的实时频段数值和粒子数

### 登录（可选）

- 点 📃 我的歌单时，如果未登录会弹出**二维码扫码框**
- 用网易云手机 App 扫一下就完事，登录态由后端管理（写在 `~/.NeteaseCloudMusicApi/` 这种本地 cookie 里）
- 不登录也能用 🔍 直接搜公开歌曲

### 常见问题

| 现象              | 原因 / 解决                                        |
| --------------- | ---------------------------------------------- |
| 浮层显示 ⚠️ "后端未启动" | 没跑 `npx NeteaseCloudMusicApi`；或被防火墙挡住 3000 端口  |
| 搜得到歌但播放不出来      | 这首歌是网易云 VIP 限定；换一首试试                           |
| 我的歌单点不开         | 需要先扫码登录；登录态过期了重新扫一次                            |
| 控制台 CORS 报错     | 把静态服务器跑在 `localhost`（不是 `file://`）上即可，后端默认允许跨域 |

***

## 💛 致谢

- 小狗 GIF 设计来自原作者素材包
- 字体 [福禄灵感盒茶体](fonts/FuLuLingGanHeChaTi/) 用于游戏内 UI 文案
- MediaPipe Hands by Google MediaPipe 团队

***

> _慢慢来，不着急，调到舒服为止哦～_ 🐶✨

