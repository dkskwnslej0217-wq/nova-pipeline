// scripts/generate_video.js — NOVA 영상 파이프라인 v3
// 영상 생성 → Supabase Storage → Instagram 릴스 + Facebook 릴스 + YouTube

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  GOOGLE_TTS_KEY, PEXELS_API_KEY,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID,
  FACEBOOK_ACCESS_TOKEN, FACEBOOK_PAGE_ID,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
} = process.env;

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

// ── 오디오 길이 추출 ────────────────────────────────────────────────
function getAudioDuration(file) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
      { encoding: 'utf8' }
    ).trim();
    return Math.max(10, parseFloat(out) || 30);
  } catch { return 30; }
}

// ── SRT 자막 생성 ──────────────────────────────────────────────────
function generateSRT(text) {
  const sentences = text.match(/[^.!?。~\n]+[.!?。~]*/g) || [text];
  let srt = '', time = 0;
  sentences.forEach((s, i) => {
    const clean = s.trim();
    if (!clean) return;
    const duration = Math.max(1.5, clean.length * 0.065);
    srt += `${i + 1}\n${fmtTime(time)} --> ${fmtTime(time + duration)}\n${clean}\n\n`;
    time += duration + 0.25;
  });
  return srt;
}
function fmtTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  const ms = String(Math.floor((sec % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

// ── 키워드 → 영어 매핑 ─────────────────────────────────────────────
const KR_EN = {
  'AI자동화': 'artificial intelligence automation technology',
  'AI': 'artificial intelligence futuristic',
  '콘텐츠수익': 'content creator studio laptop',
  '1인창업': 'startup entrepreneur success',
  'SNS마케팅': 'social media marketing digital',
  '재테크': 'investment finance growth',
  '부동산': 'real estate city modern building',
  '건강': 'healthy lifestyle wellness',
  '트렌드': 'trending modern urban lifestyle',
  '미래': 'futuristic technology city',
};

// ── Pexels 클립 다운로드 ───────────────────────────────────────────
const FALLBACK_QUERIES = ['technology city night', 'business success people', 'abstract futuristic', 'nature landscape'];

async function downloadClip(query, index, fallbackIdx = 0) {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape&min_duration=5`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();

  if (!data.videos?.length) {
    if (fallbackIdx < FALLBACK_QUERIES.length)
      return downloadClip(FALLBACK_QUERIES[fallbackIdx], index, fallbackIdx + 1);
    throw new Error(`클립 없음: ${query}`);
  }
  const video = data.videos[Math.floor(Math.random() * Math.min(5, data.videos.length))];
  const file = video.video_files.find(f => f.quality === 'hd' && f.width >= 1280)
    || video.video_files.find(f => f.quality === 'sd')
    || video.video_files[0];
  if (!file?.link) throw new Error(`영상 URL 없음: ${query}`);

  const dlRes = await fetch(file.link, { signal: AbortSignal.timeout(60000) });
  if (!dlRes.ok) throw new Error(`다운로드 실패: ${dlRes.status}`);
  const buf = await dlRes.arrayBuffer();
  fs.writeFileSync(`clip_${index}.mp4`, Buffer.from(buf));
  console.log(`  ✅ clip_${index}.mp4 — "${query}" (${file.width}x${file.height})`);
  return `clip_${index}.mp4`;
}

// ── Supabase Storage 업로드 ────────────────────────────────────────
async function uploadToSupabase(filePath) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 버킷 없으면 생성 (이미 있으면 무시)
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

  // 1단계: 컨테이너 생성
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

  // 2단계: 처리 대기 (최대 3분)
  console.log('  ⏳ Instagram 영상 처리 대기 중...');
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 10000)); // 10초 대기
    const statusRes = await fetch(
      `${base}/${containerId}?fields=status_code&access_token=${token}`
    );
    const { status_code } = await statusRes.json();
    console.log(`  IG 상태: ${status_code}`);
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR') throw new Error('IG 영상 처리 오류');
  }

  // 3단계: 게시
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

  // 1단계: 업로드 세션 시작
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

  // 2단계: 영상 바이너리 업로드
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

  // 3단계: 게시
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
  const title = SCRIPT_TITLE || 'NOVA AI';
  const tags = (SCRIPT_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);

  // 영상 검색 키워드
  const tagQueries = tags.slice(0, 2).map(t => KR_EN[t] || t);
  const videoQueries = [...tagQueries, 'modern lifestyle people', 'city motion blur'].slice(0, 4);
  console.log('🔑 영상 검색 키워드:', videoQueries);

  // ── 1. TTS ────────────────────────────────────────────────────
  console.log('\n🎙️ TTS 생성 중...');
  const ttsRes = await withRetry('TTS', () => fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: scriptText },
        voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: 1.0 },
      }),
    }
  ));
  if (!ttsRes.ok) throw new Error(`TTS 실패: ${await ttsRes.text()}`);
  fs.writeFileSync('audio.wav', Buffer.from((await ttsRes.json()).audioContent, 'base64'));
  console.log('✅ audio.wav 저장');

  const audioDuration = getAudioDuration('audio.wav');
  const clipDuration = Math.ceil(audioDuration / videoQueries.length) + 2;
  console.log(`⏱️  오디오 ${audioDuration.toFixed(1)}초 / 클립당 ${clipDuration}초 × ${videoQueries.length}개`);

  // ── 2. 자막 ───────────────────────────────────────────────────
  const srtPath = path.resolve('subtitles.srt');
  fs.writeFileSync(srtPath, generateSRT(scriptText));
  console.log('✅ subtitles.srt 저장');

  // ── 3. 클립 다운로드 ──────────────────────────────────────────
  console.log('\n🎥 배경 영상 다운로드 중...');
  const clipPaths = [];
  for (let i = 0; i < videoQueries.length; i++) {
    try { clipPaths.push(await withRetry(`clip_${i}`, () => downloadClip(videoQueries[i], i))); }
    catch (e) { console.warn(`  ⚠️ clip_${i} 스킵: ${e.message}`); }
  }
  if (clipPaths.length === 0) throw new Error('다운로드된 클립 없음');

  // ── 4. FFmpeg 합성 ────────────────────────────────────────────
  console.log('\n🎬 영상 합성 중...');
  const FADE = 0.5;
  const n = clipPaths.length;
  const inputs = [...clipPaths, 'audio.wav'].map(p => `-i "${p}"`).join(' ');
  const trimParts = clipPaths.map((_, i) =>
    `[${i}:v]trim=duration=${clipDuration},setpts=PTS-STARTPTS,` +
    `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30[v${i}]`
  );

  let xfadeParts = [], prev = 'v0';
  for (let i = 1; i < n; i++) {
    const offset = (i * (clipDuration - FADE)).toFixed(2);
    const next = i === n - 1 ? 'vjoined' : `xf${i}`;
    xfadeParts.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${next}]`);
    prev = next;
  }

  const subStyle = [
    'FontName=NanumGothic', 'FontSize=28', 'Bold=1',
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
    'BackColour=&HAA000000', 'Outline=2', 'Shadow=0',
    'BorderStyle=3', 'Alignment=2', 'MarginV=60',
  ].join(',');
  const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  let filterComplex;
  if (n === 1) {
    filterComplex = `${trimParts[0]};[v0]subtitles=${srtEscaped}:force_style='${subStyle}'[vout]`;
  } else {
    filterComplex = `${trimParts.join(';')};${xfadeParts.join(';')};[vjoined]subtitles=${srtEscaped}:force_style='${subStyle}'[vout]`;
  }

  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[vout]" -map ${n}:a -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k -shortest output.mp4`,
    { stdio: 'inherit' }
  );
  console.log('✅ output.mp4 생성 완료');

  // ── 5. Supabase Storage 업로드 ────────────────────────────────
  console.log('\n☁️  Supabase 업로드 중...');
  const videoUrl = await withRetry('Supabase 업로드', () => uploadToSupabase('output.mp4'));

  // ── 6. Instagram 릴스 + Facebook 릴스 + YouTube (병렬) ────────
  console.log('\n📤 플랫폼 발행 중...');
  const caption = scriptText.slice(0, 2200);

  const [igResult, fbResult, ytResult] = await Promise.allSettled([
    withRetry('Instagram 릴스', () => postInstagramReel(videoUrl, caption)),
    withRetry('Facebook 릴스', () => postFacebookReel(videoUrl, caption)),
    (async () => {
      const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
      const youtube = google.youtube({ version: 'v3', auth });
      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description: scriptText.slice(0, 500),
            tags: tags.length ? tags : ['NOVA', 'AI', '자동화'],
            categoryId: '28',
            defaultLanguage: 'ko',
          },
          status: { privacyStatus: 'public' },
        },
        media: { body: fs.createReadStream('output.mp4') },
      });
      const url = `https://youtu.be/${res.data.id}`;
      console.log(`✅ YouTube 업로드: ${url}`);
      return url;
    })(),
  ]);

  const igStatus = igResult.status === 'fulfilled' ? '✅' : `❌ ${igResult.reason?.message?.slice(0, 60)}`;
  const fbStatus = fbResult.status === 'fulfilled' ? '✅' : `❌ ${fbResult.reason?.message?.slice(0, 60)}`;
  const ytStatus = ytResult.status === 'fulfilled' ? `✅ ${ytResult.value}` : `❌ ${ytResult.reason?.message?.slice(0, 60)}`;

  // ── 7. 임시 파일 정리 ─────────────────────────────────────────
  [...clipPaths, 'audio.wav', 'subtitles.srt', 'output.mp4'].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // ── 8. Telegram 결과 ──────────────────────────────────────────
  await tg(
    `🎬 NOVA 영상 발행 완료\n` +
    `📸 Instagram 릴스: ${igStatus}\n` +
    `📘 Facebook 릴스: ${fbStatus}\n` +
    `▶️  YouTube: ${ytStatus}`
  );
  console.log('\n✅ 모든 발행 완료');
}

run().catch(async (err) => {
  console.error('❌ 영상 파이프라인 실패:', err.message);
  await tg(`❌ 영상 파이프라인 실패\n${err.message}`).catch(() => {});
  process.exit(1);
});
