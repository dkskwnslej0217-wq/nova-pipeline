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
