#!/usr/bin/env node
// 离线分析 music/ 下多首歌的鼓点，生成 PRECOMPUTED_BEATMAPS map
// 算法：afconvert 解到 mono 44100Hz wav → 一阶 IIR lowpass 150Hz
//   → 25ms 滑窗能量 → avg*2.2 阈值 + 220ms 防密集 → 输出 [{time, duration}, ...]

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const OUT_PATH = resolve(REPO_ROOT, 'modules/precomputed-beats.js');

// 配置：要分析哪些歌
const TRACKS = [
  { id: 'boyboyboybee', file: 'music/boyboyboybee.m4a' },
  { id: 'happyfly', file: 'music/happyfly.mp3' },
];

const SR = 44100;

// 用 macOS 自带 afconvert 把音频解码成 wav，然后手动解 WAV header
function decodePcm(audioPath) {
  const tmpWav = resolve(tmpdir(), `beats_${process.pid}_${Date.now()}.wav`);
  return new Promise((resolveP, rejectP) => {
    const af = spawn('afconvert', [
      '-f', 'WAVE',
      '-d', `LEI16@${SR}`,
      '-c', '1',
      audioPath,
      tmpWav,
    ]);
    af.stderr.on('data', (c) => process.stderr.write(c));
    af.on('close', (code) => {
      if (code !== 0) return rejectP(new Error(`afconvert exit ${code}`));
      try {
        const buf = readFileSync(tmpWav);
        let i = 12; // 跳过 "RIFF...WAVE"
        let dataOffset = -1, dataSize = 0;
        while (i < buf.length - 8) {
          const tag = buf.toString('ascii', i, i + 4);
          const sz = buf.readUInt32LE(i + 4);
          if (tag === 'data') {
            dataOffset = i + 8;
            dataSize = sz;
            break;
          }
          i += 8 + sz;
        }
        if (dataOffset < 0) return rejectP(new Error('未找到 WAV data chunk'));
        const i16 = new Int16Array(buf.buffer, buf.byteOffset + dataOffset, dataSize / 2);
        const f32 = new Float32Array(i16.length);
        for (let k = 0; k < i16.length; k++) f32[k] = i16[k] / 32768;
        try { unlinkSync(tmpWav); } catch (_) {}
        resolveP(f32);
      } catch (e) { rejectP(e); }
    });
    af.on('error', rejectP);
  });
}

// 一阶 IIR 低通近似（cutoff 150Hz @ 44100）
function lowpass(samples, cutoff = 150) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

function detectBeats(samples) {
  const winSize = Math.floor(SR * 0.025);
  const hopSize = Math.floor(SR * 0.012);
  const energies = [];
  for (let i = 0; i + winSize < samples.length; i += hopSize) {
    let e = 0;
    for (let j = 0; j < winSize; j++) e += samples[i + j] * samples[i + j];
    energies.push({ t: i / SR, e });
  }
  const avg = energies.reduce((s, x) => s + x.e, 0) / energies.length;
  const beats = [];
  for (let i = 2; i < energies.length - 2; i++) {
    const cur = energies[i].e;
    if (
      cur > avg * 2.2 &&
      cur > energies[i - 1].e &&
      cur > energies[i + 1].e &&
      cur > energies[i - 2].e &&
      cur > energies[i + 2].e
    ) {
      if (!beats.length || energies[i].t - beats[beats.length - 1] > 0.22) {
        beats.push(energies[i].t);
      }
    }
  }
  return beats;
}

async function analyzeOne(track) {
  const audioPath = resolve(REPO_ROOT, track.file);
  console.log(`[analyze-beats] === ${track.id} ===`);
  console.log(`[analyze-beats] 解码 ${audioPath} ...`);
  const samples = await decodePcm(audioPath);
  const seconds = samples.length / SR;
  console.log(`[analyze-beats] 时长 ${seconds.toFixed(2)}s, 样本数 ${samples.length}`);

  const filtered = lowpass(samples, 150);
  const beats = detectBeats(filtered);
  console.log(`[analyze-beats] 找到 ${beats.length} 个鼓点`);

  const beatmap = beats.map((t, i) => ({
    time: Number(t.toFixed(3)),
    duration: Number((0.5 + ((i * 7) % 6) * 0.1).toFixed(2)),
  }));
  return { ...track, seconds, beatmap };
}

(async () => {
  const results = [];
  for (const t of TRACKS) {
    results.push(await analyzeOne(t));
  }

  const lines = [
    '// 由 scripts/analyze-beats.mjs 自动生成，请勿手改',
    '// 多首音乐的预计算谱面 map: id => { file, seconds, beatmap }',
    'window.PRECOMPUTED_BEATMAPS = {',
  ];
  for (const r of results) {
    lines.push(`  ${JSON.stringify(r.id)}: {`);
    lines.push(`    file: ${JSON.stringify(r.file)},`);
    lines.push(`    seconds: ${r.seconds.toFixed(2)},`);
    lines.push(`    beatmap: [`);
    for (const b of r.beatmap) {
      lines.push(`      { time: ${b.time}, duration: ${b.duration} },`);
    }
    lines.push(`    ],`);
    lines.push(`  },`);
  }
  lines.push('};');
  // 兼容旧版（默认拿第一首）
  lines.push('window.PRECOMPUTED_BEATMAP = window.PRECOMPUTED_BEATMAPS[' + JSON.stringify(results[0].id) + '].beatmap;');
  lines.push('');

  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`[analyze-beats] 已写入 ${OUT_PATH}（${results.length} 首歌）`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
