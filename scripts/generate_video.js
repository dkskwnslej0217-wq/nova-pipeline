// scripts/generate_video.js — NOVA 영상 파이프라인 v6
// Remotion 애니메이션 영상 → ffmpeg 오디오 합성 → Supabase → IG/FB/YT

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  SCRIPT_TOOL_NAME, SCRIPT_COMPARE, SCRIPT_COMBO, SCRIPT_TOOL_URL,
  SCRIPT_IG_SLIDES,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
} = process.env;

// ── Chromium 경로 탐색 ────────────────────────────────────────────
function findChromium() {
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  return candidates.find(p => fs.existsSync(p)) || '';
}

// ── 자동 재시도 ────────────────────────────────────────────────────
async function withRetry(label, fn, retries = 2, delayMs = 6000) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.warn(`⚠️ ${label} 실패 (${i + 1}/${retries} 재시도): ${e.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ── Telegram 알림 ──────────────────────────────────────────────────
async function tg(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  }).catch(() => {});
}

// ── Puppeteer 툴 스크린샷 ──────────────────────────────────────────
async function captureToolScreenshot(url) {
  if (!url) return null;
  try {
    const puppeteer = (await import('puppeteer')).default;
    const chromiumPaths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
    ];
    const executablePath = chromiumPaths.find(p => fs.existsSync(p));

    const launchOpts = {
      headless: 'new',
      args: ['--disable-gpu', '--no-first-run', '--disable-extensions', '--window-size=1080,1920'],
    };
    if (executablePath) launchOpts.executablePath = executablePath;

    const browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // 쿠키 배너 숨기기
    await page.evaluate(() => {
      const selectors = [
        '[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]',
        '[class*="consent"]', '[id*="banner"]', '[class*="banner"]',
        '[id*="gdpr"]', '[class*="gdpr"]',
      ];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
      });
    });

    const buf = await page.screenshot({ type: 'png', fullPage: false });
    await browser.close();
    console.log(`✅ 스크린샷 캡처: ${url}`);
    return buf;
  } catch (e) {
    console.warn(`⚠️ 스크린샷 실패 (${url}): ${e.message} → 그라데이션 배경 사용`);
    return null;
  }
}

// ── 오디오 길이 추출 ────────────────────────────────────────────────
function getAudioDuration(file) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
      { encoding: 'utf8' }
    ).trim();
    return Math.max(15, parseFloat(out) || 30);
  } catch { return 30; }
}

// ── SRT 자막 fallback ──────────────────────────────────────────────
function fmtTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  const ms = String(Math.floor((sec % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}
function generateSRT(text) {
  const sentences = text.match(/[^.!?。~\n]+[.!?。~]*/g) || [text];
  let srt = '', time = 0;
  sentences.forEach((s, i) => {
    const clean = s.trim();
    if (!clean) return;
    const dur = Math.max(1.5, clean.length * 0.065);
    srt += `${i + 1}\n${fmtTime(time)} --> ${fmtTime(time + dur)}\n${clean}\n\n`;
    time += dur + 0.25;
  });
  return srt;
}

// ── Remotion 렌더 ─────────────────────────────────────────────────
async function renderWithRemotion(props, outputPath) {
  const propsFile = 'remotion_props.json';
  fs.writeFileSync(propsFile, JSON.stringify(props));

  const chromium  = findChromium();
  const chromFlag = chromium ? ` --browser-executable-path="${chromium}"` : '';
  const entry     = path.resolve('remotion/index.jsx');

  console.log('\n🎬 Remotion 렌더링 중...');
  execSync(
    `./node_modules/.bin/remotion render "${entry}" NovaVideo "${outputPath}"` +
    ` --codec=h264 --crf=20 --props="${propsFile}"` +
    chromFlag,
    { stdio: 'inherit', timeout: 600000 }
  );

  try { fs.unlinkSync(propsFile); } catch {}
  console.log(`✅ Remotion 렌더링 완료: ${outputPath}`);
}

// ── 슬라이드 영상 생성 (Remotion) ────────────────────────────────
async function buildSlideVideo(toolName, scriptText, compareWith, combo, audioDuration, srtPath, toolUrl) {
  const { toolDesc, bullets, steps, compareText } = parseContent(scriptText, toolName, compareWith, combo);

  // 스크린샷 → base64 data URL
  console.log('\n📸 툴 스크린샷 캡처 중...');
  const screenshotBuf     = await captureToolScreenshot(toolUrl);
  const screenshotDataUrl = screenshotBuf
    ? `data:image/png;base64,${screenshotBuf.toString('base64')}`
    : null;

  // Remotion 영상 렌더 (오디오 없음)
  const totalFrames = Math.round(Math.min(audioDuration, 60) * 30);
  await renderWithRemotion(
    { toolName, toolDesc, bullets, steps, compareText, screenshotDataUrl, totalFrames },
    'output_silent.mp4'
  );

  // ffmpeg — 오디오 합성
  console.log('\n🔊 오디오 합성 중...');
  execSync(
    `ffmpeg -y -i output_silent.mp4 -i audio.mp3 ` +
    `-c:v copy -c:a aac -b:a 192k -shortest output.mp4`,
    { stdio: 'inherit' }
  );
  console.log('✅ output.mp4 생성 완료 (Remotion 애니메이션)');

  try { fs.unlinkSync('output_silent.mp4'); } catch {}
}

function parseContent(scriptText, toolName, compareWith, combo) {
  const sentences = (scriptText.match(/[^.!?。\n]+[.!?。]*/g) || [scriptText])
    .map(s => s.trim()).filter(s => s.length > 5);

  const n = sentences.length;
  const toolDesc = sentences[0] || `${toolName}을 소개합니다`;

  const bullets = n >= 4
    ? sentences.slice(1, 4)
    : ['핵심 작업에 특화된 AI 엔진', '무료로 바로 시작 가능', '결과물을 바로 복사·활용'];

  const steps = n >= 7
    ? sentences.slice(Math.floor(n * 0.55), Math.floor(n * 0.55) + 3)
    : [`${toolName} 사이트에서 무료 가입`, '원하는 내용을 입력하거나 업로드', '결과를 확인하고 바로 활용'];

  return {
    toolDesc,
    bullets,
    steps,
    compareText: compareWith || 'ChatGPT',
    comboText: combo || `${toolName}로 반복 작업 자동화`,
  };
}

// ── Supabase Storage 업로드 ────────────────────────────────────────
async function uploadToSupabase(filePath) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  await supabase.storage.createBucket('videos', { public: true }).catch(() => {});
  const fileName = `nova_${Date.now()}.mp4`;
  const fileBuffer = fs.readFileSync(filePath);
  const { data, error } = await supabase.storage
    .from('videos')
    .upload(fileName, fileBuffer, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error(`Supabase 업로드 실패: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(data.path);
  console.log(`✅ Supabase 업로드 완료: ${publicUrl}`);
  return publicUrl;
}

// ── Instagram 캐러셀 이미지 생성 ──────────────────────────────────
function parseIGSlides(raw, toolName) {
  const result = {};
  for (let i = 1; i <= 7; i++) {
    const m = raw?.match(new RegExp(`\\[S${i}\\]\\s*([^\\[]*)`));
    result[`s${i}`] = m ? m[1].trim() : '';
  }
  if (!result.s1) result.s1 = `오늘의 AI 툴: ${toolName}`;
  if (!result.s7) result.s7 = '지금 무료로 시작 가능 → 링크는 바이오 참고 🔗';
  return result;
}

function makeSlideHTML(slideNum, total, text, toolName, type) {
  const cfg = {
    title:   { accent: '#20B8CD', icon: '🤖', label: '오늘의 AI 툴' },
    problem: { accent: '#f97316', icon: '💡', label: '이런 문제 있으세요?' },
    feature: { accent: '#3b82f6', icon: '⚡', label: '핵심 기능' },
    pros:    { accent: '#3fb950', icon: '✅', label: '장점' },
    cons:    { accent: '#f85149', icon: '⚠️', label: '단점 (솔직하게)' },
    target:  { accent: '#a855f7', icon: '🎯', label: '이런 분께 추천' },
    cta:     { accent: '#20B8CD', icon: '🚀', label: '시작하기' },
  };
  const { accent, icon, label } = cfg[type] || cfg.title;
  const dots = Array.from({ length: total }, (_, i) =>
    `<div class="dot${i + 1 === slideNum ? ' on' : ''}"></div>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;background:#0d1117;
  font-family:'Noto Sans KR','NanumGothic',sans-serif;
  display:flex;flex-direction:column;justify-content:center;
  align-items:flex-start;padding:90px;position:relative;overflow:hidden}
.glow{position:absolute;top:-180px;right:-180px;width:540px;height:540px;
  border-radius:50%;background:radial-gradient(circle,${accent}25 0%,transparent 70%)}
.nova{position:absolute;top:52px;right:64px;border:2px solid ${accent};
  border-radius:40px;padding:14px 30px;color:${accent};font-size:30px;
  font-weight:900;background:${accent}18;letter-spacing:2px}
.label{color:${accent};font-size:34px;font-weight:700;margin-bottom:24px;
  display:flex;align-items:center;gap:14px}
.bar{width:72px;height:6px;border-radius:3px;background:${accent};margin-bottom:44px}
.title{color:#e6edf3;font-size:60px;font-weight:900;margin-bottom:28px;line-height:1.2}
.body{color:#c9d1d9;font-size:50px;font-weight:400;line-height:1.7;word-break:keep-all;max-width:900px}
.dots{position:absolute;bottom:52px;left:50%;transform:translateX(-50%);
  display:flex;gap:12px}
.dot{width:12px;height:12px;border-radius:50%;background:#30363d}
.dot.on{background:${accent}}
</style></head><body>
<div class="glow"></div>
<div class="nova">NOVA</div>
<div class="label"><span>${icon}</span>${label}</div>
<div class="bar"></div>
${type === 'title' ? `<div class="title">${toolName}</div>` : ''}
<div class="body">${text.replace(/\n/g, '<br>').replace(/→/g, '<span style="color:${accent}">→</span>')}</div>
<div class="dots">${dots}</div>
</body></html>`;
}

async function generateCarouselImages(slides, toolName) {
  const types = ['title', 'problem', 'feature', 'pros', 'cons', 'target', 'cta'];
  const keys  = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

  const puppeteer = (await import('puppeteer')).default;
  const chromiumPaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  const executablePath = chromiumPaths.find(p => fs.existsSync(p));
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-setuid-sandbox', '--window-size=1080,1080'],
  };
  if (executablePath) launchOpts.executablePath = executablePath;

  const browser = await puppeteer.launch(launchOpts);
  const paths = [];

  for (let i = 0; i < 7; i++) {
    const html   = makeSlideHTML(i + 1, 7, slides[keys[i]] || '', toolName, types[i]);
    const imgOut = `/tmp/ig_carousel_${i}.png`;

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: imgOut, type: 'png' });
    await page.close();

    paths.push(imgOut);
    console.log(`  🖼️ 슬라이드 ${i + 1}/7 완료`);
  }

  await browser.close();
  return paths;
}

async function uploadCarouselToSupabase(paths) {
  const bucket = 'carousel';

  // 버킷 생성 (이미 있으면 무시)
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: bucket, public: true }),
  });

  const ts = Date.now();
  const urls = [];
  for (let i = 0; i < paths.length; i++) {
    const fileName = `${ts}_${i}.png`;
    const buf = fs.readFileSync(paths[i]);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${fileName}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: buf,
    });
    if (!res.ok) throw new Error(`Supabase 업로드 실패 [${i}]: ${res.status}`);
    urls.push(`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${fileName}`);
    console.log(`  ☁️ 업로드 ${i + 1}/7: ${fileName}`);
  }
  return urls;
}

// ── Instagram 캐러셀 발행 ──────────────────────────────────────────
async function postInstagramCarousel(imageUrls, caption) {
  const token  = INSTAGRAM_ACCESS_TOKEN;
  const userId = INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const base   = `https://graph.instagram.com/v21.0`;

  // 1. 이미지 컨테이너 생성
  const containerIds = [];
  for (const url of imageUrls) {
    const res = await fetch(`${base}/${userId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: token }),
    });
    const data = await res.json();
    if (!data.id) throw new Error(`IG 이미지 컨테이너 실패: ${JSON.stringify(data)}`);
    containerIds.push(data.id);
    console.log(`  📦 IG 컨테이너: ${data.id}`);
  }

  // 2. 캐러셀 컨테이너 생성
  const carRes = await fetch(`${base}/${userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: containerIds.join(','),
      caption: caption.slice(0, 2200),
      access_token: token,
    }),
  });
  const carData = await carRes.json();
  if (!carData.id) throw new Error(`IG 캐러셀 생성 실패: ${JSON.stringify(carData)}`);

  // 3. 발행
  const pubRes = await fetch(`${base}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: carData.id, access_token: token }),
  });
  const pubData = await pubRes.json();
  if (!pubData.id) throw new Error(`IG 캐러셀 발행 실패: ${JSON.stringify(pubData)}`);
  console.log(`✅ Instagram 캐러셀 발행: ${pubData.id}`);
  return pubData.id;
}

// ── Instagram 릴스 발행 ────────────────────────────────────────────
async function postInstagramReel(videoUrl, caption) {
  const token = INSTAGRAM_ACCESS_TOKEN;
  const userId = INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const base = `https://graph.instagram.com/v21.0`;

  const createRes = await fetch(`${base}/${userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption.slice(0, 2200),
      share_to_feed: 'true',
      access_token: token,
    }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error(`IG 컨테이너 생성 실패: ${JSON.stringify(createData)}`);
  const containerId = createData.id;
  console.log(`  📦 IG 컨테이너 ID: ${containerId}`);

  console.log('  ⏳ Instagram 영상 처리 대기 중...');
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await fetch(
      `${base}/${containerId}?fields=status_code&access_token=${token}`
    );
    const { status_code } = await statusRes.json();
    console.log(`  IG 상태: ${status_code}`);
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR') throw new Error('IG 영상 처리 오류');
  }

  const publishRes = await fetch(`${base}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const publishData = await publishRes.json();
  if (!publishData.id) throw new Error(`IG 게시 실패: ${JSON.stringify(publishData)}`);
  console.log(`✅ Instagram 릴스 발행: ${publishData.id}`);
  return publishData.id;
}

// ── Facebook 릴스 발행 ─────────────────────────────────────────────
async function postFacebookReel(videoUrl, description) {
  const token = FACEBOOK_ACCESS_TOKEN;
  const pageId = FACEBOOK_PAGE_ID;
  const base = `https://graph.facebook.com/v21.0`;

  const startRes = await fetch(`${base}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: token }),
  });
  const startData = await startRes.json();
  if (!startData.video_id || !startData.upload_url)
    throw new Error(`FB 업로드 시작 실패: ${JSON.stringify(startData)}`);
  const { video_id, upload_url } = startData;
  console.log(`  📦 FB video_id: ${video_id}`);

  const videoBuffer = fs.readFileSync('output.mp4');
  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${token}`,
      'Content-Type': 'video/mp4',
      'offset': '0',
      'file_size': String(videoBuffer.length),
    },
    body: videoBuffer,
    signal: AbortSignal.timeout(120000),
  });
  if (!uploadRes.ok) throw new Error(`FB 영상 업로드 실패: ${uploadRes.status}`);
  console.log('  ✅ FB 영상 업로드 완료');

  const finishRes = await fetch(`${base}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'finish',
      video_id,
      video_state: 'PUBLISHED',
      description: description.slice(0, 2200),
      title: SCRIPT_TITLE || 'NOVA AI',
      access_token: token,
    }),
  });
  const finishData = await finishRes.json();
  if (!finishData.success && !finishData.id)
    throw new Error(`FB 릴스 게시 실패: ${JSON.stringify(finishData)}`);
  console.log(`✅ Facebook 릴스 발행 완료`);
  return video_id;
}

// ── 메인 ──────────────────────────────────────────────────────────
async function run() {
  const scriptText = (SCRIPT_TEXT || 'NOVA AI 자동화 콘텐츠입니다.').slice(0, 2500);
  const title      = SCRIPT_TITLE || 'NOVA AI';
  const tags       = (SCRIPT_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);
  const toolName   = SCRIPT_TOOL_NAME || title.replace('오늘의 AI 툴: ', '').trim();
  const compareWith = SCRIPT_COMPARE  || '';
  const combo       = SCRIPT_COMBO    || '';
  const toolUrl     = SCRIPT_TOOL_URL || '';
  const shortsTitle = `${title} #Shorts`.slice(0, 100);

  // ── 1. TTS (edge-tts) ─────────────────────────────────────────
  console.log('\n🎙️ TTS 생성 중 (edge-tts)...');
  fs.writeFileSync('tts_script.txt', scriptText);
  fs.writeFileSync('run_tts.py', `
import asyncio, edge_tts

def to_srt_time(ns100):
    ms = ns100 // 10000
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

async def main():
    with open('tts_script.txt', encoding='utf-8') as f:
        text = f.read()
    comm = edge_tts.Communicate(text, "ko-KR-HyunsuNeural", rate="+10%", volume="+10%")
    words = []
    with open('audio.mp3', 'wb') as af:
        async for chunk in comm.stream():
            if chunk['type'] == 'audio':
                af.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                words.append((chunk['offset'], chunk['duration'], chunk['text']))
    cue_size = 4
    lines = []
    for i in range(0, len(words), cue_size):
        group = words[i:i+cue_size]
        start = to_srt_time(group[0][0])
        end   = to_srt_time(group[-1][0] + group[-1][1])
        txt   = ' '.join(w[2] for w in group)
        lines.append(f"{i//cue_size+1}\\n{start} --> {end}\\n{txt}\\n")
    with open('subtitles.srt', 'w', encoding='utf-8') as sf:
        sf.write('\\n'.join(lines))
    print(f"✅ 자막 {len(lines)}개 생성")

asyncio.run(main())
`);
  execSync('python3 run_tts.py', { stdio: 'inherit' });
  console.log('✅ audio.mp3 + subtitles.srt 저장');

  const audioDuration = getAudioDuration('audio.mp3');
  console.log(`⏱️  오디오 ${audioDuration.toFixed(1)}초`);

  // ── 2. SRT 자막 확인 ─────────────────────────────────────────
  const srtPath = path.resolve('subtitles.srt');
  if (!fs.existsSync(srtPath) || fs.statSync(srtPath).size < 10) {
    fs.writeFileSync(srtPath, generateSRT(scriptText));
    console.log('⚠️ subtitles.srt fallback');
  }

  // ── 3. 슬라이드 영상 생성 ─────────────────────────────────────
  await buildSlideVideo(toolName, scriptText, compareWith, combo, audioDuration, srtPath, toolUrl);

  // ── 4. Supabase Storage 업로드 (영상) ───────────────────────────
  console.log('\n☁️  Supabase 영상 업로드 중...');
  const videoUrl = await withRetry('Supabase 업로드', () => uploadToSupabase('output.mp4'));

  // ── 4b. 인스타 캐러셀 이미지 생성 + 업로드 ────────────────────
  console.log('\n🖼️  인스타 캐러셀 이미지 생성 중 (7장)...');
  const igSlides = parseIGSlides(SCRIPT_IG_SLIDES || '', toolName);
  const igImagePaths = await generateCarouselImages(igSlides, toolName);
  const igImageUrls  = await uploadCarouselToSupabase(igImagePaths);
  console.log(`✅ 캐러셀 이미지 ${igImageUrls.length}장 업로드 완료`);

  // ── 5. 플랫폼 발행 (순차: Instagram → YouTube → Facebook) ──────
  console.log('\n📤 플랫폼 발행 중...');

  // 인스타 캐러셀 캡션 — 링크 금지, 바이오 안내만
  const igHashtags = `#AI툴 #인공지능 #오늘의AI #새로운AI #AI추천 #${toolName.replace(/\s/g, '')}`;
  const igCaption = `${igSlides.s1}\n\n${igSlides.s2}\n\n🔗 링크는 바이오 참고\n\n${igHashtags}`.slice(0, 2200);

  // 페이스북 캡션 — 툴 URL 포함 가능
  const fbCaption = `${scriptText.slice(0, 400)}\n\n🔗 ${toolUrl}\n\n#AI툴 #오늘의AI`.slice(0, 2200);

  // ── Instagram ─────────────────────────────────────────────
  let igStatus;
  try {
    await withRetry('Instagram 캐러셀', () => postInstagramCarousel(igImageUrls, igCaption));
    igStatus = '✅';
    await tg(`📸 Instagram 발행 완료\n🔧 툴: ${toolName}`);
  } catch (e) {
    igStatus = `❌ ${e.message?.slice(0, 60)}`;
    await tg(`⚠️ Instagram 실패\n${igStatus}`);
  }

  // ── YouTube ───────────────────────────────────────────────
  let ytStatus;
  try {
    const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
    const youtube = google.youtube({ version: 'v3', auth });
    const allTags = [...(tags.length ? tags : ['NOVA', 'AI', '툴소개']), 'Shorts', 'AI툴', '오늘의AI'];
    const ytDesc = `${scriptText.slice(0, 400)}\n\n🔗 ${toolUrl}\n\n#Shorts #AI툴 #오늘의AI`;
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: shortsTitle,
          description: ytDesc,
          tags: allTags,
          categoryId: '28',
          defaultLanguage: 'ko',
        },
        status: { privacyStatus: 'public' },
      },
      media: { body: fs.createReadStream('output.mp4') },
    });
    const ytUrl = `https://youtu.be/${res.data.id}`;
    console.log(`✅ YouTube Shorts 업로드: ${ytUrl}`);
    ytStatus = `✅ ${ytUrl}`;
    await tg(`▶️ YouTube 업로드 완료\n${ytUrl}`);
  } catch (e) {
    ytStatus = `❌ ${e.message?.slice(0, 60)}`;
    await tg(`⚠️ YouTube 실패\n${ytStatus}`);
  }

  // ── Facebook ──────────────────────────────────────────────
  let fbStatus;
  try {
    await withRetry('Facebook 릴스', () => postFacebookReel(videoUrl, fbCaption));
    fbStatus = '✅';
    await tg(`📘 Facebook 발행 완료`);
  } catch (e) {
    fbStatus = `❌ ${e.message?.slice(0, 60)}`;
    await tg(`⚠️ Facebook 실패\n${fbStatus}`);
  }

  // ── 6. 임시 파일 정리 ─────────────────────────────────────────
  ['audio.mp3', 'tts_script.txt', 'run_tts.py', 'subtitles.srt', 'output.mp4'].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // ── 7. Telegram 최종 요약 ─────────────────────────────────────
  await tg(
    `🎬 NOVA 영상 발행 완료\n` +
    `🔧 툴: ${toolName}\n` +
    `📸 Instagram: ${igStatus}\n` +
    `▶️  YouTube Shorts: ${ytStatus}\n` +
    `📘 Facebook: ${fbStatus}`
  );
  console.log('\n✅ 모든 발행 완료');
}

run().catch(async (err) => {
  console.error('❌ 영상 파이프라인 실패:', err.message);
  await tg(`❌ 영상 파이프라인 실패\n${err.message}`).catch(() => {});
  process.exit(1);
});
