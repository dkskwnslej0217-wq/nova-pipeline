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
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_CHANNEL_ID,
  GEMINI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY,
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
  const { hookText, bullets } = parseContent(scriptText, toolName, compareWith);

  // Remotion 렌더 (고정 420프레임 = 14초)
  await renderWithRemotion({ toolName, hookText, bullets }, 'output_silent.mp4');

  // 오디오가 있으면 합성, 없으면 그대로 사용
  if (fs.existsSync('audio.mp3')) {
    console.log('\n🔊 오디오 합성 중...');
    execSync(
      `ffmpeg -y -i output_silent.mp4 -i audio.mp3 ` +
      `-c:v copy -c:a aac -b:a 192k -shortest output.mp4`,
      { stdio: 'inherit' }
    );
    try { fs.unlinkSync('output_silent.mp4'); } catch {}
  } else {
    fs.renameSync('output_silent.mp4', 'output.mp4');
  }
  console.log('✅ output.mp4 생성 완료 (14초 빠른 컷)');
}

function parseContent(scriptText, toolName, compareWith) {
  const sentences = (scriptText.match(/[^.!?。\n]+[.!?。]*/g) || [scriptText])
    .map(s => s.trim()).filter(s => s.length > 5);

  const n = sentences.length;

  // 후킹 문구: 첫 문장을 질문형으로
  const firstSentence = sentences[0] || `${toolName}을 소개합니다`;
  const hookText = firstSentence.endsWith('?') || firstSentence.endsWith('요?')
    ? firstSentence
    : `${toolName} 이거 알아요?`;

  // 퀵카드 4장 (핵심기능 / 이런분께 / 장점 / 시작방법)
  const bullets = n >= 5
    ? [
        sentences[1] || `${toolName}의 핵심 기능`,
        sentences[Math.floor(n * 0.4)] || '이런 분께 추천합니다',
        sentences[Math.floor(n * 0.6)] || '무료로 바로 시작 가능',
        sentences[Math.floor(n * 0.8)] || '링크는 바이오 참고',
      ]
    : [
        `${toolName}의 핵심 기능에 특화된 AI`,
        '시간 아끼고 싶은 분께 강추',
        '무료 플랜으로 바로 시작 가능',
        `링크는 바이오에서 확인하세요 🔗`,
      ];

  return { hookText, bullets };
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
  if (!result.s2) result.s2 = `${toolName}이 뭔지 몰랐다면 이미 손해`;
  if (!result.s3) result.s3 = `핵심 기능: 반복 작업을 AI가 자동으로 처리`;
  if (!result.s4) result.s4 = `장점: 무료로 바로 시작 가능, 설치 필요 없음`;
  if (!result.s5) result.s5 = `단점: 무료 플랜은 사용량 제한 있음`;
  if (!result.s6) result.s6 = `추천: 시간 아끼고 싶은 직장인 / 비추천: 고급 커스터마이징 필요한 분`;
  if (!result.s7) result.s7 = '지금 무료로 시작 가능 → 링크는 바이오 참고 🔗';
  return result;
}

function makeSlideHTML(slideNum, total, text, toolName, type) {
  const cfg = {
    title:   { accent: '#20B8CD', bg2: '#1a2a3a', icon: '🤖', label: '오늘의 AI 툴' },
    problem: { accent: '#f97316', bg2: '#2a1a0d', icon: '💡', label: '이런 문제 있으세요?' },
    feature: { accent: '#3b82f6', bg2: '#0d1a2a', icon: '⚡', label: '핵심 기능' },
    pros:    { accent: '#3fb950', bg2: '#0d2a14', icon: '✅', label: '장점' },
    cons:    { accent: '#f85149', bg2: '#2a0d0d', icon: '⚠️', label: '단점 (솔직하게)' },
    target:  { accent: '#a855f7', bg2: '#1a0d2a', icon: '🎯', label: '이런 분께 추천' },
    cta:     { accent: '#20B8CD', bg2: '#1a2a3a', icon: '🚀', label: '시작하기' },
  };
  const { accent, bg2, icon, label } = cfg[type] || cfg.title;

  // 진행 바 (상단)
  const progressPct = Math.round((slideNum / total) * 100);

  // 점 페이지네이션
  const dots = Array.from({ length: total }, (_, i) =>
    `<div class="dot${i + 1 === slideNum ? ' on' : ''}"></div>`
  ).join('');

  // 텍스트 포맷
  const formattedText = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/→/g, `<span style="color:${accent}">→</span>`)
    .replace(/✅/g, `<span style="color:#3fb950">✅</span>`)
    .replace(/❌/g, `<span style="color:#f85149">❌</span>`)
    .replace(/①|②|③/g, m => `<span style="color:${accent};font-weight:700">${m}</span>`)
    .replace(/•/g, `<span style="color:${accent}">•</span>`);

  // CTA 슬라이드 특별 레이아웃
  const isCTA = type === 'cta';
  const bodyContent = isCTA
    ? `<div class="cta-wrap">
        <div class="cta-title">${toolName}</div>
        <div class="cta-sub">${formattedText}</div>
        <div class="cta-btn">지금 무료로 시작 →</div>
      </div>`
    : `<div class="body">${formattedText}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;
  background:linear-gradient(145deg,#0d1117 0%,${bg2} 55%,#0d1117 100%);
  font-family:'Noto Sans KR','NanumGothic',sans-serif;
  display:flex;flex-direction:column;justify-content:center;
  align-items:flex-start;padding:88px 96px 80px;position:relative;overflow:hidden}

/* 배경 장식 */
.glow-tl{position:absolute;top:-160px;left:-160px;width:480px;height:480px;
  border-radius:50%;background:radial-gradient(circle,${accent}1a 0%,transparent 70%)}
.glow-br{position:absolute;bottom:-160px;right:-160px;width:480px;height:480px;
  border-radius:50%;background:radial-gradient(circle,${accent}12 0%,transparent 70%)}
.grid{position:absolute;inset:0;
  background-image:linear-gradient(${accent}08 1px,transparent 1px),
                   linear-gradient(90deg,${accent}08 1px,transparent 1px);
  background-size:80px 80px}
.corner-line-h{position:absolute;top:0;left:0;width:200px;height:3px;
  background:linear-gradient(90deg,${accent},transparent)}
.corner-line-v{position:absolute;top:0;left:0;width:3px;height:200px;
  background:linear-gradient(180deg,${accent},transparent)}

/* 상단 진행 바 */
.progress-track{position:absolute;top:0;left:0;right:0;height:6px;background:rgba(255,255,255,0.07)}
.progress-fill{height:100%;width:${progressPct}%;
  background:linear-gradient(90deg,${accent},${accent}88);
  box-shadow:0 0 10px ${accent}66}

/* NOVA 배지 */
.nova{position:absolute;top:44px;right:60px;border:2px solid ${accent};
  border-radius:40px;padding:10px 28px;color:${accent};font-size:26px;
  font-weight:900;background:${accent}18;letter-spacing:2px}

/* 슬라이드 번호 */
.slide-num{position:absolute;top:52px;left:96px;color:${accent};
  font-size:24px;font-weight:700;opacity:0.6}

/* 콘텐츠 */
.label{color:${accent};font-size:28px;font-weight:700;margin-bottom:16px;
  display:flex;align-items:center;gap:10px}
.bar{width:56px;height:4px;border-radius:2px;
  background:linear-gradient(90deg,${accent},${accent}44);margin-bottom:28px}
.tool-name{color:#e6edf3;font-size:52px;font-weight:900;margin-bottom:16px;
  line-height:1.15;word-break:keep-all}
.body{color:#c9d1d9;font-size:38px;font-weight:400;line-height:1.9;
  word-break:keep-all;max-width:900px}

/* CTA 특별 */
.cta-wrap{display:flex;flex-direction:column;align-items:center;
  width:100%;text-align:center;gap:32px}
.cta-title{color:${accent};font-size:64px;font-weight:900;word-break:keep-all}
.cta-sub{color:#c9d1d9;font-size:38px;line-height:1.8;word-break:keep-all}
.cta-btn{background:linear-gradient(135deg,${accent},${accent}88);
  border-radius:60px;padding:28px 72px;color:#fff;font-size:42px;font-weight:900;
  box-shadow:0 0 40px ${accent}44}

/* 하단 점 */
.dots{position:absolute;bottom:44px;left:50%;transform:translateX(-50%);
  display:flex;gap:14px;align-items:center}
.dot{width:10px;height:10px;border-radius:50%;background:#30363d}
.dot.on{width:28px;border-radius:6px;background:${accent};
  box-shadow:0 0 8px ${accent}88}
</style></head><body>
<div class="glow-tl"></div>
<div class="glow-br"></div>
<div class="grid"></div>
<div class="corner-line-h"></div>
<div class="corner-line-v"></div>
<div class="progress-track"><div class="progress-fill"></div></div>
<div class="nova">NOVA</div>
<div class="slide-num">${slideNum} / ${total}</div>
<div class="label"><span>${icon}</span>${label}</div>
<div class="bar"></div>
${type === 'title' ? `<div class="tool-name">${toolName}</div>` : ''}
${bodyContent}
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
  console.log(`  📦 IG 캐러셀 컨테이너: ${carData.id}`);

  // 3. 캐러셀 처리 완료 대기 (FINISHED 될 때까지 폴링)
  console.log('  ⏳ Instagram 캐러셀 처리 대기 중...');
  let carReady = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(
      `${base}/${carData.id}?fields=status_code&access_token=${token}`
    );
    const { status_code } = await statusRes.json();
    console.log(`  IG 캐러셀 상태: ${status_code} (${i + 1}/12)`);
    if (status_code === 'FINISHED') { carReady = true; break; }
    if (status_code === 'ERROR') throw new Error('IG 캐러셀 처리 오류');
  }
  if (!carReady) throw new Error('IG 캐러셀 처리 시간 초과 (1분) — 재시도 예정');

  // 4. 발행
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
  let igReady = false;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const statusRes = await fetch(
      `${base}/${containerId}?fields=status_code&access_token=${token}`
    );
    const { status_code } = await statusRes.json();
    console.log(`  IG 상태: ${status_code} (${i + 1}/18)`);
    if (status_code === 'FINISHED') { igReady = true; break; }
    if (status_code === 'ERROR') throw new Error('IG 영상 처리 오류');
  }
  if (!igReady) throw new Error('IG 영상 처리 시간 초과 (3분) — 재시도 예정');

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

// ── publish_log 헬퍼 ──────────────────────────────────────────────
function kstDate() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

async function getPublishLog(date, platform) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/publish_log?date=eq.${date}&platform=eq.${platform}&select=*`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return rows?.[0] || null;
}

async function upsertPublishLog(date, platform, status, { postId = null, errorMsg = null, content = null, retryCount = 0 } = {}) {
  await fetch(`${SUPABASE_URL}/rest/v1/publish_log`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      date,
      platform,
      status,
      post_id: postId,
      error_msg: errorMsg,
      content,
      retry_count: retryCount,
      updated_at: new Date().toISOString(),
    }),
  });
}

// ═══════════════════════════════════════════════════════════════════
// AI 파이프라인 (트렌드 수집 → 툴 선정 → 콘텐츠 생성)
// SCRIPT_TEXT 없을 때 자동 실행 — Vercel에서 옮겨온 로직
// ═══════════════════════════════════════════════════════════════════

function ft(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function filterKoreanOnly(text) {
  if (!text) return '';
  return text
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, '')
    .replace(/[\u3000-\u303F]/g, '')
    .replace(/[\u0600-\u06FF]/g, '')
    .replace(/[\u0400-\u04FF]/g, '')
    .replace(/[\u0900-\u097F]/g, '')
    .replace(/[\u0080-\u00FF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getContentContext() {
  const day = new Date(Date.now() + 9 * 3600000).getDay();
  const cats = {
    0: '이번 주 베스트 AI 툴 TOP3',
    1: '생산성 AI 툴 — 업무 효율 올리는 것',
    2: '글쓰기·번역 AI 툴',
    3: '이미지·영상 생성 AI 툴',
    4: '자동화·코딩 AI 툴',
    5: '무료로 쓸 수 있는 AI 툴',
    6: '이번 주 AI 뉴스 & 새 툴 총정리',
  };
  return { dayCategory: cats[day], fullContext: `[오늘 카테고리] ${cats[day]}` };
}

async function fetchTrendSources() {
  const kst = new Date(Date.now() + 9 * 3600000);
  for (const d of [kst.toISOString().slice(0, 10), new Date(kst - 86400000).toISOString().slice(0, 10)]) {
    try {
      const res = await ft(
        `${SUPABASE_URL}/rest/v1/trend_sources?date=eq.${d}&source=neq.groq_summary&select=source,title,description&order=score.desc&limit=20`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }, 8000
      );
      if (!res.ok) continue;
      const rows = await res.json();
      if (rows.length) return rows.map(r => `[${r.source}] ${r.title}: ${(r.description || '').slice(0, 80)}`);
    } catch { continue; }
  }
  return [];
}

async function fetchResearchResult() {
  const kst = new Date(Date.now() + 9 * 3600000);
  for (const d of [kst.toISOString().slice(0, 10), new Date(kst - 86400000).toISOString().slice(0, 10)]) {
    try {
      const res = await ft(
        `${SUPABASE_URL}/rest/v1/research_results?date=eq.${d}&select=tool_name,one_liner,target,price,compare_tool,reason_kr,tool_url&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }, 8000
      );
      if (!res.ok) continue;
      const rows = await res.json();
      if (rows.length) return rows[0];
    } catch { continue; }
  }
  return null;
}

async function fetchHNTrends() {
  const idsRes = await ft('https://hacker-news.firebaseio.com/v0/topstories.json', {}, 8000);
  if (!idsRes.ok) return [];
  const ids = await idsRes.json();
  const stories = await Promise.all(
    ids.slice(0, 20).map(id =>
      ft(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 4000).then(r => r.json()).catch(() => null)
    )
  );
  const kw = ['ai', 'llm', 'gpt', 'automation', 'agent', 'claude', 'openai', 'gemini', 'machine learning'];
  return stories.filter(s => s?.title && kw.some(k => s.title.toLowerCase().includes(k))).slice(0, 5).map(s => s.title);
}

async function fetchRedditTrends() {
  const results = [];
  for (const sub of ['artificial', 'ChatGPT', 'SideProject']) {
    try {
      const res = await ft(`https://www.reddit.com/r/${sub}/hot.json?limit=5`, { headers: { 'User-Agent': 'nova-pipeline/1.0' } }, 6000);
      if (!res.ok) continue;
      const data = await res.json();
      results.push(...data.data.children.map(p => p.data.title).filter(t => t.length < 120).slice(0, 2));
    } catch { continue; }
  }
  return results.slice(0, 6);
}

async function fetchProductHuntAI() {
  try {
    const res = await ft('https://www.producthunt.com/feed?category=artificial-intelligence', { headers: { 'User-Agent': 'nova-pipeline/1.0' } }, 8000);
    if (!res.ok) return [];
    const text = await res.text();
    return [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)]
      .map(m => (m[1] || m[2] || '').trim())
      .filter(t => t && t !== 'Product Hunt – The best new products, every day')
      .slice(0, 5);
  } catch { return []; }
}

async function fetchGoogleTrendsKR() {
  try {
    const res = await ft('https://trends.google.com/trending/rss?geo=KR', { headers: { 'User-Agent': 'nova-pipeline/1.0' } }, 8000);
    if (!res.ok) return [];
    const text = await res.text();
    return [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)]
      .map(m => (m[1] || m[2] || '').trim())
      .filter(t => t && t !== 'Daily Search Trends')
      .slice(0, 5);
  } catch { return []; }
}

async function fetchRecentTopics() {
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = await ft(
      `${SUPABASE_URL}/rest/v1/cache?topic=neq.__lock__&created_at=gte.${since}&select=topic,score&order=created_at.desc&limit=14`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }, 8000
    );
    if (!res.ok) return { recent: [], topScored: [] };
    const rows = await res.json();
    return {
      recent: rows.map(r => r.topic).filter(Boolean),
      topScored: rows.filter(r => r.score >= 80).map(r => r.topic).slice(0, 3),
    };
  } catch { return { recent: [], topScored: [] }; }
}

async function extractKeywords(hnTrends = [], ghTrends = [], redditTrends = [], phTrends = [], crawleeTrends = [], recentTopics = [], topScored = []) {
  const trim = (arr, n = 5) => arr.slice(0, n).map(s => String(s).slice(0, 80));
  const ctx = getContentContext();
  const context = [
    phTrends.length  ? `[Product Hunt AI 신제품]\n${trim(phTrends).join('\n')}` : '',
    hnTrends.length  ? `[HackerNews]\n${trim(hnTrends).join('\n')}` : '',
    redditTrends.length ? `[Reddit]\n${trim(redditTrends).join('\n')}` : '',
    crawleeTrends.length ? `[crawlee-agent 수집]\n${trim(crawleeTrends, 8).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const memorySection = recentTopics.length ? `\n\n⛔ 최근 7일 이미 소개한 툴 (중복 금지):\n${recentTopics.map(t => `• ${t}`).join('\n')}` : '';
  const learningSection = topScored.length ? `\n\n✅ 최근 반응 좋았던 주제:\n${topScored.map(t => `• ${t}`).join('\n')}` : '';

  const prompt = `아래는 오늘 글로벌에서 주목받는 새 AI 툴·서비스 목록입니다:\n${context}${memorySection}${learningSection}\n\n오늘 카테고리: ${ctx.dayCategory}\n\n위 데이터에서 오늘 소개할 AI 툴 1개를 선정해. 실제로 사용 가능하고 한국 사용자에게 유용한 것.\n\n반드시 아래 형식 그대로 반환 (다른 말 없이):\n툴이름|||한 줄 설명 (25자 이내)|||대상 (15자 이내)|||무료/유료/프리미엄|||비교할 대형 툴 1개 이름만\n\n예시:\nPerplexity AI|||AI가 출처 포함해서 검색해주는 도구|||리서치하는 사람|||무료|||ChatGPT`;

  const res = await ft(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) },
    15000
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function finalizeContent(keywords) {
  const parts = keywords.split('|||');
  const toolName    = parts[0]?.trim() || 'AI 툴';
  const toolDesc    = parts[1]?.trim() || '';
  const toolTarget  = parts[2]?.trim() || '';
  const toolPrice   = parts[3]?.trim() || '';
  const compareWith = parts[4]?.trim() || 'ChatGPT';
  const ctx = getContentContext();

  const systemMsg = '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. 오타 절대 금지. 한국어만. AI 티 없이 진짜 사람 말투.';
  const userMsg = `새 AI 툴: ${toolName} / 설명: ${toolDesc} / 대상: ${toolTarget} / 가격: ${toolPrice} / 비교 대상: ${compareWith}
오늘 카테고리: ${ctx.dayCategory}
금지어: "안녕하세요" "여러분" "오늘은" "확실히" "물론" "정말"

아래 구분자 그대로 작성:

===IG===
(인스타 캐러셀 7장. [S번호] 형식. 한국어만. 해시태그 없이.)
[S1] ${toolName} — [핵심 한 줄 설명, 20자 이내]
[S2] ${compareWith} 쓸 때 이런 불편 없으세요?\n• [불편1]\n• [불편2]\n• [불편3]
[S3] 실제 사용 예시\n입력: [예시]\n    ↓\n출력: [결과]
[S4] 사용법 3단계\n① [단계1]\n② [단계2]\n③ [단계3]
[S5] ${compareWith} vs ${toolName}\n속도: [비교]\n가격: [비교]\n정확도: [비교]
[S6] ✅ 추천: [이런 분]\n❌ 비추천: [이런 분]
[S7] 지금 무료로 시작 가능 → 링크는 바이오 참고 🔗

===YT===
(나레이션 60초. 말하듯 자연스럽게. 350~450자.
1. 후킹 — ${compareWith} 쓸 때 겪는 불편함
2. 소개 — ${toolName}이 뭘 하는지
3. 장점 — ${compareWith}보다 나은 점
4. 단점 — 솔직하게 1가지
5. 추천 대상 — 구체적으로
6. CTA — 구독+알림 1문장)`;

  async function callGroq() {
    const r = await ft('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }], max_tokens: 600, temperature: 0.8 }),
    }, 15000);
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    return (await r.json()).choices[0].message.content;
  }

  async function callClaude() {
    const r = await ft('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system: systemMsg, messages: [{ role: 'user', content: userMsg }] }),
    }, 20000);
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    return (await r.json()).content[0].text;
  }

  let raw;
  try { raw = await callGroq(); } catch { raw = await callClaude(); }

  const extract = (tag) => {
    const m = raw.match(new RegExp(`===${tag}===\\n([\\s\\S]*?)(?====|$)`));
    return m ? m[1].trim() : '';
  };
  return { igText: extract('IG'), ytText: extract('YT') };
}

const EMOTION_WORDS = ['충격', '반전', '실화', '경고', '주의', '놀라운', '무료', '비밀', '진짜', '드디어'];
const CTA_WORDS     = ['저장', '공유', '팔로우', '구독', '알림', '댓글', '링크', '지금', '시작'];
const TREND_WORDS   = ['ai', 'gpt', '자동화', '챗봇', '무료', '최신'];

function scoreContent(igText, keywords) {
  let score = 0;
  const lines = igText.split('\n').filter(Boolean);
  const first = lines[0] || '';
  const full = igText.toLowerCase();
  const toolName = (keywords.split('|||')[0] || '').toLowerCase().trim();
  if (/\d/.test(first))                                     score += 5;
  if (EMOTION_WORDS.some(w => first.includes(w)))          score += 5;
  if (first.length <= 30)                                   score += 5;
  if (/[?！!]/.test(first) || first.includes('이유'))      score += 5;
  if (toolName && full.includes(toolName))                  score += 5;
  if (first.length >= 10)                                   score += 10;
  if (lines.length >= 4)                                    score += 5;
  if (!lines.some(l => l.length > 80))                     score += 5;
  if (CTA_WORDS.some(w => full.includes(w)))               score += 5;
  if (igText.length >= 100 && igText.length <= 2200)       score += 10;
  if (/[\u{1F300}-\u{1FFFF}]/u.test(igText))               score += 5;
  if (TREND_WORDS.some(w => full.includes(w)))             score += 10;
  if (lines.length >= 5)                                    score += 10;
  if (!igText.includes('안녕하세요') && !igText.includes('여러분')) score += 5;
  return Math.min(score, 100);
}

async function saveToSupabaseCache(topic, content, qualityScore = 1) {
  try {
    await ft(`${SUPABASE_URL}/rest/v1/cache`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: `${btoa(encodeURIComponent(topic)).slice(0, 24)}_${Date.now()}`, topic, content: content.slice(0, 1000), score: qualityScore }),
    }, 8000);
  } catch { /* 저장 실패는 파이프라인 중단하지 않음 */ }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function run() {
  // ── 0. AI 파이프라인 (SCRIPT_TEXT 없을 때 자동 실행) ────────────
  let scriptTextRaw = (SCRIPT_TEXT || '').trim();
  let igSlidesInput = (SCRIPT_IG_SLIDES || '').trim();
  let titleInput    = SCRIPT_TITLE || '';
  let toolNameInput = SCRIPT_TOOL_NAME || '';
  let compareInput  = SCRIPT_COMPARE || '';
  let comboInput    = SCRIPT_COMBO || '';
  let toolUrlInput  = SCRIPT_TOOL_URL || '';

  if (!scriptTextRaw) {
    console.log('\n🤖 AI 파이프라인 시작 (트렌드 수집 → 툴 선정 → 콘텐츠 생성)');
    await tg('🔄 NOVA 파이프라인 시작');

    // 트렌드 병렬 수집
    const [hn, reddit, ph, googleTr, crawlee, research, memory] = await Promise.allSettled([
      fetchHNTrends(),
      fetchRedditTrends(),
      fetchProductHuntAI(),
      fetchGoogleTrendsKR(),
      fetchTrendSources(),
      fetchResearchResult(),
      fetchRecentTopics(),
    ]).then(r => r.map(x => x.status === 'fulfilled' ? x.value : (x.value?.recent !== undefined ? { recent: [], topScored: [] } : [])));

    console.log(`  HN:${hn?.length||0} Reddit:${reddit?.length||0} PH:${ph?.length||0} crawlee:${crawlee?.length||0} research:${!!research?.tool_name}`);

    // 툴 선정
    let keywords;
    if (research?.tool_name) {
      keywords = `${research.tool_name}|||${research.one_liner||''}|||${research.target||''}|||${research.price||''}|||${research.compare_tool||'ChatGPT'}`;
      console.log(`✅ research-agent 사용: ${research.tool_name}`);
    } else {
      try {
        keywords = await extractKeywords(hn||[], [], reddit||[], ph||[], crawlee||[], memory?.recent||[], memory?.topScored||[]);
        if (!keywords.includes('|||')) {
          keywords = `${ph?.[0] || hn?.[0] || 'Perplexity AI'}|||AI 검색 도구|||리서치하는 사람|||무료|||ChatGPT`;
        }
      } catch(e) {
        console.warn(`⚠️ Gemini 실패: ${e.message}`);
        keywords = 'Perplexity AI|||실시간 검색 + AI 답변 통합|||리서치하는 모든 사람|||무료|||ChatGPT';
      }
    }

    // 콘텐츠 생성
    let igText = '', ytText = '';
    try {
      const result = await finalizeContent(keywords);
      igText = filterKoreanOnly(result.igText) || '';
      ytText = filterKoreanOnly(result.ytText) || '';
    } catch(e) {
      console.warn(`⚠️ 콘텐츠 생성 실패: ${e.message}`);
    }

    // 변수 설정
    const parts = keywords.split('|||');
    toolNameInput = parts[0]?.trim() || 'AI 툴';
    compareInput  = parts[4]?.trim() || 'ChatGPT';
    titleInput    = `오늘의 AI 툴: ${toolNameInput}`;
    scriptTextRaw = ytText || `${toolNameInput} — AI 자동화 도구 소개`;
    igSlidesInput = igText || '';
    toolUrlInput  = research?.tool_url || '';

    // Supabase cache 저장
    const score = scoreContent(igText, keywords);
    await saveToSupabaseCache(toolNameInput, igText, score).catch(() => {});
    console.log(`✅ 툴 선정 완료: ${toolNameInput} (품질점수: ${score})`);
    await tg(`🚀 NOVA 콘텐츠 생성 완료\n📌 ${keywords.split('|||')[0]} — ${keywords.split('|||')[1] || ''}\n🎬 영상 생성 중...`);
  }

  // ── 기존 변수 (env 값 또는 AI 파이프라인 결과) ─────────────────
  const scriptText  = scriptTextRaw.slice(0, 2500);
  const title       = titleInput || 'NOVA AI';
  const tags        = (SCRIPT_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);
  const toolName    = toolNameInput || title.replace('오늘의 AI 툴: ', '').trim();
  const compareWith = compareInput || '';
  const combo       = comboInput || '';
  const toolUrl     = toolUrlInput || '';
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

  // ── 5. 플랫폼 발행 (순차: Instagram → YouTube) ──────────────
  // ⚠️ Facebook: 차단 해제 대기 중 — 비활성화 (재활성화 전 junho 확인 필요)
  console.log('\n📤 플랫폼 발행 중...');
  const today = kstDate();

  // 인스타 릴스 캡션
  const igHashtags = `#AI툴 #인공지능 #오늘의AI #새로운AI #AI추천 #${toolName.replace(/\s/g, '')} #Shorts`;
  const igCaption = `${title}\n\n${scriptText.slice(0, 300)}\n\n🔗 링크는 바이오 참고\n\n${igHashtags}`.slice(0, 2200);

  // 사람처럼 보이도록 발행 전 랜덤 딜레이 (30~90초)
  const humanDelay = Math.floor(Math.random() * 60000) + 30000;
  console.log(`⏳ 발행 전 대기 중 (${Math.round(humanDelay / 1000)}초)...`);
  await new Promise(r => setTimeout(r, humanDelay));

  // ── Instagram ─────────────────────────────────────────────
  let igStatus;
  const igLog = await getPublishLog(today, 'instagram');
  if (igLog?.status === 'success') {
    igStatus = '✅ (이미 발행됨, 스킵)';
    console.log('⏭️ Instagram 이미 발행됨 — 스킵');
  } else {
    const igRetryCount = (igLog?.retry_count || 0);
    // Instagram 하루 발행 횟수 제한 (1회 초과 시 차단 위험)
    if (igRetryCount >= 3) {
      igStatus = '⏸️ (재시도 한도 초과 — 내일 재시작)';
      await tg(`⚠️ Instagram 재시도 한도 초과 (${igRetryCount}회)\n오늘은 발행 중단. 내일 자동 재시작.`);
    } else {
      try {
        const igPostId = await withRetry('Instagram 릴스', () => postInstagramReel(videoUrl, igCaption), 1, 30000);
        igStatus = '✅';
        await upsertPublishLog(today, 'instagram', 'success', {
          postId: igPostId,
          content: { videoUrl, caption: igCaption },
          retryCount: igRetryCount,
        });
        await tg(`🎬 Instagram 릴스 발행 완료\n🔧 툴: ${toolName}`);
      } catch (e) {
        const errMsg = e.message || '';
        // 차단/스팸 감지 에러코드 — 즉시 중단 (재시도 금지)
        // IG 에러코드 정확히 매칭 (숫자 문자열 포함 방지)
        const errLower = errMsg.toLowerCase();
        const isBanned = errMsg.includes('"code":190') || errMsg.includes('"code":368') ||
                         errMsg.includes('"code":32') ||
                         errLower.includes('spam') || errLower.includes('blocked') ||
                         errLower.includes('restricted') || errLower.includes('action is blocked');
        const isRateLimited = errLower.includes('request limit reached') ||
                              errLower.includes('rate limit') ||
                              errMsg.includes('"code":4,') || errMsg.includes('"code":4}'); // IG 에러코드 4 = app rate limit
        igStatus = `❌ ${errMsg.slice(0, 60)}`;
        // 한도 초과는 오늘 재시도 금지 (rate_limited 상태로 저장)
        const logStatus = isRateLimited ? 'rate_limited' : 'failed';
        await upsertPublishLog(today, 'instagram', logStatus, {
          errorMsg: errMsg.slice(0, 200),
          content: { videoUrl, caption: igCaption },
          retryCount: igRetryCount + 1,
        });
        if (isRateLimited) {
          await tg(`⏸️ Instagram API 한도 초과 — 오늘 스킵\n내일 자동 재시작됩니다.\n에러: ${errMsg.slice(0, 80)}`);
          // throw 안 함 — YouTube는 계속 실행
        } else if (isBanned) {
          await tg(`🚨 Instagram 차단/제한 감지! junho 확인 필요.\n에러: ${errMsg.slice(0, 100)}`);
          // throw 안 함 — YouTube는 계속 실행
        } else {
          await tg(`⚠️ Instagram 실패\n${igStatus}`);
        }
      }
    }
  }

  // ── YouTube ───────────────────────────────────────────────
  let ytStatus;
  const ytLog = await getPublishLog(today, 'youtube');
  if (ytLog?.status === 'success') {
    ytStatus = '✅ (이미 발행됨, 스킵)';
    console.log('⏭️ YouTube 이미 발행됨 — 스킵');
  } else {
    const ytRetryCount = (ytLog?.retry_count || 0);
    const allTags = [...(tags.length ? tags : ['NOVA', 'AI', '툴소개']), 'Shorts', 'AI툴', '오늘의AI'];
    const ytDesc = `${scriptText.slice(0, 400)}\n\n🔗 ${toolUrl}\n\n#Shorts #AI툴 #오늘의AI`;
    try {
      const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
      const youtube = google.youtube({ version: 'v3', auth });
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
      await upsertPublishLog(today, 'youtube', 'success', {
        postId: res.data.id,
        content: { videoUrl, title: shortsTitle, description: ytDesc, tags: allTags },
        retryCount: ytRetryCount,
      });
      await tg(`▶️ YouTube 업로드 완료\n${ytUrl}`);
    } catch (e) {
      ytStatus = `❌ ${e.message?.slice(0, 60)}`;
      await upsertPublishLog(today, 'youtube', 'failed', {
        errorMsg: e.message?.slice(0, 200),
        content: { videoUrl, title: shortsTitle, description: ytDesc, tags: allTags },
        retryCount: ytRetryCount,
      });
      await tg(`⚠️ YouTube 실패\n${ytStatus}`);
    }
  }

  // ── Facebook ──────────────────────────────────────────────
  // 🔴 차단 해제 대기 중 — 비활성화
  // 재활성화 조건: Facebook Business Suite에서 제한 해제 확인 후 junho가 직접 주석 제거
  const fbStatus = '⏸️ 비활성화 (차단 해제 대기 중)';
  console.log('⏭️ Facebook 발행 비활성화 — 차단 해제 대기 중');

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
    `📘 Facebook: ${fbStatus}\n` +
    `⚠️ Facebook은 차단 해제 후 수동으로 재활성화 필요`
  );
  console.log('\n✅ 모든 발행 완료');
}

run().catch(async (err) => {
  console.error('❌ 영상 파이프라인 실패:', err.message);
  await tg(`❌ 영상 파이프라인 실패\n${err.message}`).catch(() => {});
  process.exit(1);
});
