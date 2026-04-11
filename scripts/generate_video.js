// scripts/generate_video.js — NOVA 영상 파이프라인 v5
// 슬라이드 스타일 (canvas + Puppeteer 스크린샷) → ffmpeg 슬라이드쇼 → Supabase → IG/FB/YT

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  SCRIPT_TOOL_NAME, SCRIPT_COMPARE, SCRIPT_COMBO, SCRIPT_TOOL_URL,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
} = process.env;

// ── 상수 ──────────────────────────────────────────────────────────
const W = 1080, H = 1920, PAD = 80;

// 다크 테마 팔레트
const C = {
  bg:       '#0d1117',
  card:     '#161b22',
  border:   '#30363d',
  cyan:     '#20B8CD',
  green:    '#3fb950',
  blue:     '#58a6ff',
  purple:   '#bc8cff',
  red:      '#f85149',
  textPri:  '#e6edf3',
  textSec:  '#8b949e',
  textMute: '#484f58',
};

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

// ── 폰트 등록 ─────────────────────────────────────────────────────
function setupFonts() {
  const candidates = [
    ['/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf', { family: 'KorFont', weight: 'bold' }],
    ['/usr/share/fonts/truetype/nanum/NanumGothic.ttf',     { family: 'KorFont' }],
    ['/usr/share/fonts/opentype/nanum/NanumGothicBold.ttf', { family: 'KorFont', weight: 'bold' }],
    ['/usr/share/fonts/opentype/nanum/NanumGothic.ttf',     { family: 'KorFont' }],
  ];
  let loaded = 0;
  for (const [fp, opts] of candidates) {
    if (fs.existsSync(fp)) {
      try { registerFont(fp, opts); loaded++; } catch {}
    }
  }
  const family = loaded > 0 ? 'KorFont' : 'sans-serif';
  console.log(loaded > 0 ? `✅ 폰트 등록 (${loaded}개): KorFont` : '⚠️ 폰트 없음 — sans-serif 사용');
  return family;
}

// ── Canvas 유틸 ────────────────────────────────────────────────────
function darkBg(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

function box(ctx, x, y, w, h, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

function circle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// 한국어 포함 텍스트 줄바꿈 (글자 단위)
function wrap(ctx, text, x, y, maxW, lineH) {
  let line = '', curY = y;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, curY);
      line = ch;
      curY += lineH;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, curY); curY += lineH; }
  return curY;
}

// ── 슬라이드 1: 후킹 (툴 스크린샷 배경) ──────────────────────────
async function slide1(FONT, toolName, toolDesc, screenshotBuf) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');

  // 배경: 스크린샷 or 다크 그라데이션
  if (screenshotBuf) {
    const img = await loadImage(screenshotBuf);
    ctx.drawImage(img, 0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1117');
    g.addColorStop(0.5, '#1a1f2e');
    g.addColorStop(1, '#0d1117');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // 다크 그라데이션 오버레이 (하단으로 갈수록 진해짐)
  const overlay = ctx.createLinearGradient(0, 0, 0, H);
  overlay.addColorStop(0,   'rgba(13,17,23,0.2)');
  overlay.addColorStop(0.3, 'rgba(13,17,23,0.3)');
  overlay.addColorStop(0.6, 'rgba(13,17,23,0.75)');
  overlay.addColorStop(0.8, 'rgba(13,17,23,0.92)');
  overlay.addColorStop(1,   'rgba(13,17,23,1.0)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, W, H);

  // NOVA 배지 (상단 우측)
  box(ctx, W - 240, 50, 190, 72, 36, C.cyan, 0.15);
  ctx.strokeStyle = C.cyan;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(W - 240, 50, 190, 72, 36);
  ctx.stroke();
  ctx.font = `bold 36px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  ctx.fillText('NOVA', W - 208, 97);

  // 하단 영역: 툴 이름 + 설명 + CTA
  const bottomY = H - 700;

  // 라벨
  ctx.font = `bold 38px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  ctx.fillText('오늘의 AI 툴', PAD, bottomY);

  // 툴 이름 (크고 굵게)
  ctx.font = `bold 100px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  const nameEndY = wrap(ctx, toolName, PAD, bottomY + 80, W - PAD * 2, 115);

  // 한 줄 구분선
  ctx.fillStyle = C.cyan;
  ctx.fillRect(PAD, nameEndY + 10, 120, 6);

  // 툴 설명
  ctx.font = `46px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  const desc = toolDesc.length > 45 ? toolDesc.slice(0, 45) + '…' : toolDesc;
  wrap(ctx, desc, PAD, nameEndY + 60, W - PAD * 2, 58);

  // CTA 버튼
  box(ctx, PAD, H - 180, W - PAD * 2, 120, 60, C.cyan);
  ctx.font = `bold 48px "${FONT}"`;
  ctx.fillStyle = '#0d1117';
  ctx.fillText('지금 확인하러 가기  →', PAD + 60, H - 108);

  return c;
}

// ── 슬라이드 2: 핵심 기능 3가지 ────────────────────────────────────
function slide2(FONT, toolName, bullets) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  darkBg(ctx);

  // 헤더
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  ctx.fillText('왜 써야 할까요?', PAD, 140);

  ctx.font = `bold 72px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  wrap(ctx, toolName, PAD, 200, W - PAD * 2, 84);

  ctx.font = `bold 52px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  ctx.fillText('핵심 차이점 3가지', PAD, 370);

  // 구분선
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, 400, W - PAD * 2, 2);

  const accent = [C.cyan, C.purple, C.green];
  const cardBg = ['rgba(32,184,205,0.08)', 'rgba(188,140,255,0.08)', 'rgba(63,185,80,0.08)'];

  bullets.slice(0, 3).forEach((bullet, i) => {
    const y = 440 + i * 460;
    box(ctx, PAD, y, W - PAD * 2, 410, 16, C.card);
    // 왼쪽 컬러 강조 바
    ctx.fillStyle = accent[i];
    ctx.beginPath();
    ctx.roundRect(PAD, y, 8, 410, [16, 0, 0, 16]);
    ctx.fill();
    // 번호 원
    circle(ctx, PAD + 90, y + 90, 58, accent[i] + '33');
    ctx.font = `bold 64px "${FONT}"`;
    ctx.fillStyle = accent[i];
    ctx.fillText(`${i + 1}`, PAD + 72, y + 112);
    // 텍스트
    ctx.font = `bold 44px "${FONT}"`;
    ctx.fillStyle = accent[i];
    ctx.fillText(`POINT ${i + 1}`, PAD + 170, y + 80);
    ctx.font = `42px "${FONT}"`;
    ctx.fillStyle = C.textPri;
    wrap(ctx, bullet, PAD + 50, y + 160, W - PAD * 2 - 80, 56);
  });

  return c;
}

// ── 슬라이드 3: vs 비교 ────────────────────────────────────────────
function slide3(FONT, toolName, compareWith) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  darkBg(ctx);

  // 헤더
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  ctx.fillText('이미 있는 거 아닌가요?', PAD, 140);
  ctx.font = `bold 72px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  ctx.fillText('직접 비교해봤습니다', PAD, 230);

  // 구분선
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, 270, W - PAD * 2, 2);

  // ── 왼쪽 패널 (기존 툴) ──
  const lx = PAD, ly = 310, lw = 430, lh = 660;
  box(ctx, lx, ly, lw, lh, 16, C.card);
  // 상단 라벨바
  box(ctx, lx, ly, lw, 80, [16, 16, 0, 0], C.textMute + '33');
  ctx.font = `bold 36px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  ctx.fillText('기존', lx + 26, ly + 52);

  ctx.font = `bold 52px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  wrap(ctx, compareWith || 'ChatGPT', lx + 26, ly + 140, lw - 52, 62);

  ctx.font = `38px "${FONT}"`;
  ctx.fillStyle = C.red;
  ctx.fillText('✗  모든 분야 범용', lx + 26, ly + 440);
  ctx.fillText('✗  높은 비용', lx + 26, ly + 510);
  ctx.fillText('✗  학습 곡선 있음', lx + 26, ly + 580);

  // ── VS 배지 ──
  box(ctx, 470, 590, 140, 80, 40, C.red + 'cc');
  ctx.font = `bold 52px "${FONT}"`;
  ctx.fillStyle = '#fff';
  ctx.fillText('VS', 506, 644);

  // ── 오른쪽 패널 (신규 툴) ──
  const rx = 620, ry = 310, rw = 420, rh = 660;
  box(ctx, rx, ry, rw, rh, 16, C.card);
  // 상단 컬러 라벨바
  box(ctx, rx, ry, rw, 80, [16, 16, 0, 0], C.cyan + '44');
  ctx.font = `bold 36px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  ctx.fillText('신규', rx + 26, ry + 52);

  ctx.font = `bold 52px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  wrap(ctx, toolName, rx + 26, ry + 140, rw - 52, 62);

  ctx.font = `38px "${FONT}"`;
  ctx.fillStyle = C.green;
  ctx.fillText('✓  이 분야 특화', rx + 26, ry + 440);
  ctx.fillText('✓  무료 시작 가능', rx + 26, ry + 510);
  ctx.fillText('✓  즉시 결과 확인', rx + 26, ry + 580);

  // ── 결론 배너 ──
  box(ctx, PAD, 1030, W - PAD * 2, 200, 16, C.green + '22');
  ctx.strokeStyle = C.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(PAD, 1030, W - PAD * 2, 200, 16);
  ctx.stroke();
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.green;
  ctx.fillText('💡  결론', PAD + 30, 1100);
  ctx.font = `42px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  wrap(ctx, `이 작업엔 ${toolName}가 압도적`, PAD + 30, 1148, W - PAD * 2 - 60, 52);

  // 하단 보충 설명
  ctx.font = `38px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  wrap(ctx, `${compareWith || 'ChatGPT'}는 범용, ${toolName}는 전문화 — 목적에 맞게 쓰세요`, PAD, 1290, W - PAD * 2, 50);

  return c;
}

// ── 슬라이드 4: 이렇게 써요 ────────────────────────────────────────
function slide4(FONT, toolName, steps) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  darkBg(ctx);

  // 헤더
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  ctx.fillText('시작하는 법', PAD, 140);
  ctx.font = `bold 72px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  ctx.fillText('30초면 충분합니다', PAD, 230);
  ctx.font = `44px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  wrap(ctx, `${toolName} 시작 가이드`, PAD, 300, W - PAD * 2, 54);

  // 구분선
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, 375, W - PAD * 2, 2);

  const stepColors = [C.cyan, C.purple, C.green];

  steps.slice(0, 3).forEach((step, i) => {
    const y = 420 + i * 490;
    box(ctx, PAD, y, W - PAD * 2, 440, 16, C.card);

    // STEP 번호 원
    circle(ctx, PAD + 85, y + 90, 65, stepColors[i] + '33');
    ctx.font = `bold 68px "${FONT}"`;
    ctx.fillStyle = stepColors[i];
    ctx.fillText(`${i + 1}`, PAD + 61, y + 114);

    // STEP 라벨
    ctx.font = `bold 40px "${FONT}"`;
    ctx.fillStyle = stepColors[i];
    ctx.fillText(`STEP ${i + 1}`, PAD + 175, y + 75);

    // 단계 내용
    ctx.font = `44px "${FONT}"`;
    ctx.fillStyle = C.textPri;
    wrap(ctx, step, PAD + 50, y + 170, W - PAD * 2 - 80, 58);
  });

  return c;
}

// ── 슬라이드 5: 조합 팁 + CTA ─────────────────────────────────────
function slide5(FONT, toolName, combo) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  darkBg(ctx);

  // 헤더
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  ctx.fillText('프로 팁', PAD, 140);
  ctx.font = `bold 72px "${FONT}"`;
  ctx.fillStyle = C.textPri;
  ctx.fillText('이렇게 조합하면 끝납니다', PAD, 230);

  // 구분선
  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, 270, W - PAD * 2, 2);

  // 조합 카드
  box(ctx, PAD, 310, W - PAD * 2, 560, 20, C.card);
  ctx.strokeStyle = C.cyan + '66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(PAD, 310, W - PAD * 2, 560, 20);
  ctx.stroke();

  // 툴 이름 박스
  box(ctx, PAD + 40, 360, 540, 120, 12, C.cyan + '22');
  ctx.font = `bold 60px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  wrap(ctx, toolName, PAD + 70, 440, 500, 72);

  // + 기호
  ctx.font = `bold 90px "${FONT}"`;
  ctx.fillStyle = C.textMute;
  ctx.fillText('+', PAD + 50, 570);

  // 콤보 내용
  ctx.font = `bold 52px "${FONT}"`;
  ctx.fillStyle = C.green;
  wrap(ctx, combo || '기존 워크플로우 연결', PAD + 50, 630, W - PAD * 2 - 80, 64);

  // 효과 설명 박스
  box(ctx, PAD + 40, 800, W - PAD * 2 - 80, 120, 12, C.green + '22');
  ctx.font = `42px "${FONT}"`;
  ctx.fillStyle = C.green;
  ctx.fillText('→ 업무 시간이 눈에 띄게 줄어들어요', PAD + 70, 870);

  // 효과 설명 보충
  ctx.font = `42px "${FONT}"`;
  ctx.fillStyle = C.textSec;
  wrap(ctx, '이 조합이면 반복 작업 자동화 완성', PAD, 960, W - PAD * 2, 54);

  // 팔로우 CTA 버튼
  box(ctx, PAD, 1080, W - PAD * 2, 160, 80, C.cyan);
  ctx.font = `bold 50px "${FONT}"`;
  ctx.fillStyle = '#0d1117';
  ctx.fillText('팔로우하고 매일 받아보세요  →', PAD + 50, 1178);

  // NOVA 브랜드
  ctx.font = `bold 44px "${FONT}"`;
  ctx.fillStyle = C.cyan;
  ctx.fillText('NOVA', PAD, H - 160);
  ctx.font = `38px "${FONT}"`;
  ctx.fillStyle = C.textMute;
  ctx.fillText('매일 새로운 AI 툴', PAD + 125, H - 160);

  // 장식 원
  circle(ctx, W + 60, H - 100, 320, C.cyan + '18');

  return c;
}

// ── 콘텐츠 파싱 ────────────────────────────────────────────────────
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

// ── 슬라이드 영상 생성 ─────────────────────────────────────────────
async function buildSlideVideo(toolName, scriptText, compareWith, combo, audioDuration, srtPath, toolUrl) {
  const FONT = setupFonts();
  const { toolDesc, bullets, steps, compareText, comboText } = parseContent(
    scriptText, toolName, compareWith, combo
  );

  // 슬라이드 1용 스크린샷 캡처
  console.log('\n📸 툴 스크린샷 캡처 중...');
  const screenshotBuf = await captureToolScreenshot(toolUrl);

  // 5개 슬라이드 PNG 생성
  console.log('\n🎨 슬라이드 PNG 생성 중...');
  const canvases = await Promise.all([
    slide1(FONT, toolName, toolDesc, screenshotBuf),
    Promise.resolve(slide2(FONT, toolName, bullets)),
    Promise.resolve(slide3(FONT, toolName, compareText)),
    Promise.resolve(slide4(FONT, toolName, steps)),
    Promise.resolve(slide5(FONT, toolName, comboText)),
  ]);

  const slidePaths = canvases.map((canvas, i) => {
    const p = `slide${i + 1}.png`;
    fs.writeFileSync(p, canvas.toBuffer('image/png'));
    console.log(`  ✅ slide${i + 1}.png`);
    return p;
  });

  // 각 슬라이드 지속 시간 (5등분)
  const total = Math.min(audioDuration, 60);
  const seg = total / 5;
  const fadeDur = 0.4;

  // ffmpeg 입력 (각 슬라이드를 해당 시간만큼 루프)
  const inputs = slidePaths
    .map(p => `-loop 1 -t ${seg.toFixed(3)} -i ${p}`)
    .join(' ');

  // filter_complex: scale → fps → xfade 체인 (자막 없음)
  const scales = slidePaths
    .map((_, i) => `[${i}:v]setsar=1,fps=30[s${i}]`)
    .join(';');

  let xfades = '';
  let prev = 's0';
  for (let i = 1; i < 5; i++) {
    const out = i === 4 ? 'vslides' : `x${i}`;
    const offset = (i * (seg - fadeDur)).toFixed(3);
    xfades += `;[${prev}][s${i}]xfade=transition=fade:duration=${fadeDur}:offset=${offset}[${out}]`;
    prev = out;
  }

  const filterComplex = scales + xfades;
  const totalDur = (5 * seg - 4 * fadeDur).toFixed(3);

  console.log('\n🎬 ffmpeg 슬라이드쇼 합성 중...');
  execSync(
    `ffmpeg -y ${inputs} -i audio.mp3 ` +
    `-filter_complex "${filterComplex}" ` +
    `-map "[vslides]" -map ${slidePaths.length}:a ` +
    `-c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k ` +
    `-t ${totalDur} output.mp4`,
    { stdio: 'inherit' }
  );
  console.log('✅ output.mp4 생성 완료 (슬라이드 스타일)');

  // 슬라이드 PNG 정리
  slidePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
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

  // ── 4. Supabase Storage 업로드 ────────────────────────────────
  console.log('\n☁️  Supabase 업로드 중...');
  const videoUrl = await withRetry('Supabase 업로드', () => uploadToSupabase('output.mp4'));

  // ── 5. 플랫폼 발행 (병렬) ─────────────────────────────────────
  console.log('\n📤 플랫폼 발행 중...');
  const caption = `${scriptText.slice(0, 2100)}\n\n#AI툴 #오늘의AI #새로운AI #AI추천 #인공지능`;

  const [igResult, fbResult, ytResult] = await Promise.allSettled([
    withRetry('Instagram 릴스', () => postInstagramReel(videoUrl, caption)),
    withRetry('Facebook 릴스',  () => postFacebookReel(videoUrl, caption)),
    (async () => {
      const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
      const youtube = google.youtube({ version: 'v3', auth });
      const allTags = [...(tags.length ? tags : ['NOVA', 'AI', '툴소개']), 'Shorts', 'AI툴', '오늘의AI'];
      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: shortsTitle,
            description: `${scriptText.slice(0, 450)}\n\n#Shorts #AI툴 #오늘의AI`,
            tags: allTags,
            categoryId: '28',
            defaultLanguage: 'ko',
          },
          status: { privacyStatus: 'public' },
        },
        media: { body: fs.createReadStream('output.mp4') },
      });
      const url = `https://youtu.be/${res.data.id}`;
      console.log(`✅ YouTube Shorts 업로드: ${url}`);
      return url;
    })(),
  ]);

  const igStatus = igResult.status === 'fulfilled' ? '✅' : `❌ ${igResult.reason?.message?.slice(0, 60)}`;
  const fbStatus = fbResult.status === 'fulfilled' ? '✅' : `❌ ${fbResult.reason?.message?.slice(0, 60)}`;
  const ytStatus = ytResult.status === 'fulfilled' ? `✅ ${ytResult.value}` : `❌ ${ytResult.reason?.message?.slice(0, 60)}`;

  // ── 6. 임시 파일 정리 ─────────────────────────────────────────
  ['audio.mp3', 'tts_script.txt', 'run_tts.py', 'subtitles.srt', 'output.mp4'].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // ── 7. Telegram 결과 ──────────────────────────────────────────
  await tg(
    `🎬 NOVA 영상 발행 완료\n` +
    `🔧 툴: ${toolName}\n` +
    `📸 Instagram: ${igStatus}\n` +
    `📘 Facebook: ${fbStatus}\n` +
    `▶️  YouTube Shorts: ${ytStatus}`
  );
  console.log('\n✅ 모든 발행 완료');
}

run().catch(async (err) => {
  console.error('❌ 영상 파이프라인 실패:', err.message);
  await tg(`❌ 영상 파이프라인 실패\n${err.message}`).catch(() => {});
  process.exit(1);
});
