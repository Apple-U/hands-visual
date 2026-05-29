// 可以抽象成三层

// - 互动模式层 ：定义通用情绪/行为，比如 idleHappy 、 chase 、 sniff 、 excited 、 bored 、 teased 、 lost 。
// - 角色素材层 ：小狗/小熊分别配置每个模式对应的 GIF、尺寸、朝向、权重
// - 语言人格层 ：每个角色有自己的语气包，小狗可以“汪汪/贴贴”，小熊可以“抱抱/蜂蜜/慢吞吞”，对应现在的 showMood 和气泡文案。

window.CHARACTER_PROFILES = window.CHARACTER_PROFILES || {};

window.CHARACTER_PROFILES.puppy = {
  id: 'puppy',
  displayName: '小狗',
  emoji: '🐶',
  initialMood: 'sit',
  moodToMode: {
    sit: 'idleHappy',
    run: 'chase',
    sniff: 'closeCurious',
    excited: 'excited',
    bored: 'bored',
    lookAround: 'lookAround',
    tantrum: 'teased',
    stopTantrum: 'stopTeased',
    fetchWait: 'fetchWait',
    fetchChase: 'fetchChase',
    fetchCatch: 'fetchCatch',
    fetchMiss: 'fetchMiss',
    fallback: 'idleHappy',
  },
  sprites: {
    idleHappy: { src: 'gif/happy-humming.gif', size: 180, anchorY: 0.54, naturalFacing: 1 },
    bored: { src: 'gif/bored.gif', size: 210, anchorY: 0.52, naturalFacing: 1 },
    lookAround: { src: 'gif/close-up.gif', size: 140, anchorY: 0.52, naturalFacing: 1 },
    chase: { src: 'gif/happy-run.gif', size: 195, anchorY: 0.56, naturalFacing: -1 },
    closeCurious: { src: 'gif/happy-humming.gif', size: 180, anchorY: 0.54, naturalFacing: 1 },
    excited: {
      variants: [
        // GIF 与文案的绑定关系：lineKey/bubbleKey/effect 任意字段缺省时回退到 mode 默认配置
        { src: 'gif/happy.gif', size: 265, anchorY: 0.56, naturalFacing: 1, weight: 5 },
        { src: 'gif/super-happy.gif', size: 190, anchorY: 0.56, naturalFacing: 1, weight: 3 },
        {
          src: 'gif/gift-flower.gif', size: 200, anchorY: 0.56, naturalFacing: 1, weight: 2,
          lineKey: 'excitedWithGift', // 中央 moodTag 文案
          bubbleKey: 'flowerGift',    // 头顶小气泡
          effect: 'flowerBurst',      // 触发粒子特效
        },
      ],
    },
    teased: { src: 'gif/cry.gif', size: 185, anchorY: 0.56, naturalFacing: 1 },
    stopTeased: { src: 'gif/stop-tantrum.gif', size: 190, anchorY: 0.56, naturalFacing: 1 },
    // 玩球模式：等待球（使用现有等球素材，请将文件命名为 gif/wait-ball.gif，找不到时回退到 happy-humming）
    fetchWait: { src: 'gif/wait-ball.gif', size: 185, anchorY: 0.56, naturalFacing: 1, fallbackSrc: 'gif/happy-humming.gif' },
    // 追球：复用"happy-run"
    fetchChase: { src: 'gif/happy-run.gif', size: 195, anchorY: 0.56, naturalFacing: -1 },
    // 接到球：复用"super-happy"
    fetchCatch: { src: 'gif/super-happy.gif', size: 200, anchorY: 0.56, naturalFacing: 1 },
    // 漏接：复用"cry"
    fetchMiss: { src: 'gif/cry.gif', size: 185, anchorY: 0.56, naturalFacing: 1 },
    fallback: { src: 'gif/happy-humming.gif', size: 180, anchorY: 0.54, naturalFacing: 1 },
  },
  labels: {
    chase: '🏃 全速追指尖！',
    closeCurious: '👃 嗅嗅看看',
    excited: '✨ 开心到转圈！',
    teased: '🥺 被你逗急啦',
    idleHappy: '🎵 开心哼歌等你',
    bored: '🐶 等到有点无聊啦',
    lookAround: '👀 东张西望',
    fetchWait: '🎾 等你抛球！',
    fetchChase: '🐾 我去捡球啦！',
    fetchCatch: '✨ 漂亮一接！',
    fetchMiss: '🥺 球飞走啦…',
    fallback: '🐶',
  },
  moodLines: {
    chase: ['🏃 我来啦！', '🏃 马上追到你啦！', '🐾 等等我呀！'],
    closeCurious: ['👃 靠近一点闻闻你~', '👃 是熟悉的主人味道！', '🐶 我确认一下，是你！'],
    excited: ['✨ 见到你太开心啦！', '😆 开心到冒泡泡！'],
    excitedWithGift: ['🌸 送你花花！'],
    teased: ['我都跑过来了，你怎么又跑啦！', '刚要贴贴，你又溜走啦！', '不许逗完小狗就跑！'],
    idleHappy: ['🎵 我先哼着歌等你来玩', '🎵 今天也想和你玩', '🐶 我乖乖在这里等你'],
    bored: ['🐶 等你好久啦，有点无聊了', '😴 主人怎么还不来呀', '🐾 我都快等困啦'],
    lookAround: ['👀 主人去哪儿啦？', '👀 咦，人呢？', '🐶 我找找你在哪里'],
    fetchWait: ['🎾 快抛球！握拳再张开～', '🐶 我准备好接啦！', '🎾 来一个长传！'],
    fetchChase: ['🐾 我去！我去！', '🏃 等等我，我跑过去！', '🐾 看我的！'],
    fetchCatch: ['🎾 接住啦！', '✨ 漂亮！再来一个！', '🐶 这球必接！', '😆 我超会接的！'],
    fetchMiss: ['🥺 哎呀漏掉啦…', '😢 球飞太远啦！', '😭 你是故意的吧？', '🐾 抛偏啦，再来一次！'],
  },
  bubbles: {
    excitedIdle: ['汪!', '开心!', '贴贴!'],
    closeCuriousIdle: ['?', '闻闻~', '是你呀'],
    idleHappy: ['哼哼~', '等你哦', '来玩嘛'],
    bored: ['等你好久啦...', '主人呢?', '有点无聊啦'],
    flowerGift: ['送你小花!', '花花给你!', '最喜欢你啦!'],
    orbit: ['绕一圈!', '转给你看!', '开心转圈圈!'],
    catchUp: ['等等我!', '别跑太快啦!', '我追我追!'],
    lost: ['主人去哪啦?', '我在这里等你哦', '回来陪我玩嘛'],
    teased: ['我都跑过来了，你怎么又跑啦！', '刚要贴贴，你又溜走啦！', '不许逗完小狗就跑！'],
    fetchWait: ['抛球嘛!', '我等着!', '来呀来呀'],
    fetchCatch: ['接住!', '漂亮!', '再来!'],
    fetchMiss: ['哎呀!', '飞走啦!', '抛偏啦!'],
  },
};
