// scripts/generate_video.js — NOVA 영상 파이프라인 v2
// 개선: 4개 클립 xfade 전환 + 키워드 매칭 + 자막 스타일 + 자동 길이 계산

import fs from 'fs';
import { execSync } from 'child_process';
import { google } from 'googleapis';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  GOOGLE_TTS_KEY, PEXELS_API_KEY,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
} = process.env;

// ── 한국어 키워드 → 영어 검색어 매핑 ─────────────────────────────
const KR_EN = {
  'AI자동화': 'artificial intelligence automation',
  'AI': 'artificial intelligence technology',
  '콘텐츠수익': 'content creator studio',
  '1인창업': 'startup entrepreneur office',
  'SNS마케팅': 'social media marketing',
  '재테크': 'investment finance money',
  '부동산': 'real estate city building',
  '건강': 'healthy lifestyle nature',
  '트렌드': 'trending modern lifestyle',
  '미래': 'futuristic technology',
};

// ── 오디오 길이 추출 (ffprobe) ────────────────────────────────────
function getAudioDuration(file) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
      { encoding: 'utf8' }
    ).trim();
    return Math.max(10, parseFloat(out) || 30);
  } catch {
    return 30;
  }
}

// ── SRT 자막 생성 ─────────────────────────────────────────────────
function generateSRT(text) {
  const sentences = text.match(/[^.!?。~\n]+[.!?。~]*/g) || [text];
  let srt = '';
  let time = 0;
  sentences.forEach((s, i) => {
    const clean = s.trim();
    if (!clean) return;
    const duration = Math.max(1.5, clean.length * 0.065);
    srt += `${i + 1}\n${formatTime(time)} --> ${formatTime(time + duration)}\n${clean}\n\n`;
    time += duration + 0.25;
  });
  return srt;
}

function formatTime(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  const ms = String(Math.floor((sec % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

// ── Pexels 클립 1개 다운로드 ──────────────────────────────────────
const FALLBACK_QUERIES = ['technology city night', 'business success people', 'abstract futuristic', 'nature landscape'];

async function downloadClip(query, index, fallbackIndex = 0) {
  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${q}&per_page=8&orientation=landscape&min_duration=5`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();

  if (!data.videos?.length) {
    if (fallbackIndex < FALLBACK_QUERIES.length) {
      console.warn(`⚠️ "${query}" 결과 없음 → 폴백 검색`);
      return downloadClip(FALLBACK_QUERIES[fallbackIndex], index, fallbackIndex + 1);
    }
    throw new Error(`클립 없음: ${query}`);
  }

  // HD 파일 우선, 없으면 SD
  const video = data.videos[Math.floor(Math.random() * Math.min(5, data.videos.length))];
  const file = video.video_files.find(f => f.quality === 'hd' && f.width >= 1280)
    || video.video_files.find(f => f.quality === 'sd')
    || video.video_files[0];

  if (!file?.link) throw new Error(`영상 URL 없음: ${query}`);

  const dlRes = await fetch(file.link);
  if (!dlRes.ok) throw new Error(`다운로드 실패: ${dlRes.status}`);
  const buf = await dlRes.arrayBuffer();
  const path = `clip_${index}.mp4`;
  fs.writeFileSync(path, Buffer.from(buf));
  console.log(`  ✅ clip_${index}.mp4 — "${query}" (${file.width}x${file.height})`);
  return path;
}

// ── 메인 ──────────────────────────────────────────────────────────
async function run() {
  const scriptText = (SCRIPT_TEXT || 'NOVA AI 자동화 콘텐츠입니다.').slice(0, 2500);
  const tags = (SCRIPT_TAGS || '').split(',').map(t => t.trim()).filter(Boolean);

  // 영상 검색 키워드 4개 구성 (태그 기반 + 보편적 키워드)
  const tagQueries = tags.slice(0, 2).map(t => KR_EN[t] || t);
  const extraQueries = ['modern lifestyle people', 'city motion blur'];
  const videoQueries = [...tagQueries, ...extraQueries].slice(0, 4);
  console.log('🔑 영상 검색 키워드:', videoQueries);

  // ── 1. TTS ────────────────────────────────────────────────────
  console.log('\n🎙️ TTS 생성 중...');
  const ttsRes = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: scriptText },
        voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: 1.05 }
      })
    }
  );
  if (!ttsRes.ok) throw new Error(`TTS 실패: ${await ttsRes.text()}`);
  fs.writeFileSync('audio.wav', Buffer.from((await ttsRes.json()).audioContent, 'base64'));
  console.log('✅ audio.wav 저장 완료');

  const audioDuration = getAudioDuration('audio.wav');
  const clipDuration = Math.ceil(audioDuration / videoQueries.length) + 2; // 클립당 길이 (여유 +2초)
  console.log(`⏱️  오디오: ${audioDuration.toFixed(1)}초 / 클립당: ${clipDuration}초 × ${videoQueries.length}개`);

  // ── 2. 자막 ───────────────────────────────────────────────────
  fs.writeFileSync('subtitles.srt', generateSRT(scriptText));
  console.log('✅ subtitles.srt 저장 완료');

  // ── 3. Pexels 클립 다운로드 ──────────────────────────────────
  console.log('\n🎥 배경 영상 다운로드 중...');
  const clipPaths = [];
  for (let i = 0; i < videoQueries.length; i++) {
    try {
      const path = await downloadClip(videoQueries[i], i);
      clipPaths.push(path);
    } catch (e) {
      console.warn(`  ⚠️ clip_${i} 실패, 스킵: ${e.message}`);
    }
  }
  if (clipPaths.length === 0) throw new Error('다운로드된 클립 없음');
  console.log(`✅ ${clipPaths.length}개 클립 준비 완료`);

  // ── 4. FFmpeg 합성 ────────────────────────────────────────────
  console.log('\n🎬 영상 합성 중...');
  const FADE = 0.5; // 전환 길이(초)
  const n = clipPaths.length;
  const inputs = [...clipPaths, 'audio.wav'].map(p => `-i "${p}"`).join(' ');

  // 각 클립: 트리밍 + 스케일 + 크롭 (1920x1080)
  const trimParts = clipPaths.map((_, i) =>
    `[${i}:v]trim=duration=${clipDuration},setpts=PTS-STARTPTS,` +
    `scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080[v${i}]`
  );

  // xfade 체인
  let xfadeParts = [];
  let prev = 'v0';
  for (let i = 1; i < n; i++) {
    const offset = (i * (clipDuration - FADE)).toFixed(2);
    const next = i === n - 1 ? 'vjoined' : `xf${i}`;
    xfadeParts.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${next}]`);
    prev = next;
  }

  // 자막 스타일: 크고 선명하게, 반투명 배경박스
  const subStyle = [
    'FontName=NanumGothic',
    'FontSize=30',
    'Bold=1',
    'PrimaryColour=&H00FFFFFF',     // 흰색 글씨
    'OutlineColour=&H00000000',     // 검정 외곽선
    'BackColour=&HAA000000',        // 반투명 검정 배경
    'Outline=2',
    'Shadow=0',
    'BorderStyle=3',                // 배경박스 스타일
    'Alignment=2',                  // 하단 중앙
    'MarginV=60',
  ].join(',');

  // 단일 클립 vs 다중 클립
  let filterComplex;
  if (n === 1) {
    filterComplex = `${trimParts[0]};[v0]subtitles=subtitles.srt:force_style='${subStyle}'[vout]`;
  } else {
    const joined = `${trimParts.join(';')};${xfadeParts.join(';')}`;
    filterComplex = `${joined};[vjoined]subtitles=subtitles.srt:force_style='${subStyle}'[vout]`;
  }

  const ffmpegCmd = [
    'ffmpeg -y',
    inputs,
    `-filter_complex "${filterComplex}"`,
    `-map "[vout]" -map ${n}:a`,
    `-c:v libx264 -preset fast -crf 18`,
    `-c:a aac -b:a 192k`,
    `-shortest output.mp4`,
  ].join(' ');

  execSync(ffmpegCmd, { stdio: 'inherit' });
  console.log('✅ output.mp4 생성 완료');

  // ── 5. YouTube 업로드 ─────────────────────────────────────────
  console.log('\n📤 YouTube 업로드 중...');
  const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth });

  const uploadRes = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: SCRIPT_TITLE || 'NOVA AI',
        description: scriptText.slice(0, 500),
        tags: tags.length ? tags : ['NOVA', 'AI', '자동화'],
        categoryId: '28',
        defaultLanguage: 'ko',
      },
      status: { privacyStatus: 'public' },
    },
    media: { body: fs.createReadStream('output.mp4') },
  });

  const videoUrl = `https://youtu.be/${uploadRes.data.id}`;
  console.log(`✅ 업로드 완료: ${videoUrl}`);

  // 임시 파일 정리
  [...clipPaths, 'audio.wav', 'subtitles.srt', 'output.mp4'].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // ── 6. Telegram 알림 ──────────────────────────────────────────
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: `🎬 영상 업로드 완료\n제목: ${SCRIPT_TITLE || 'NOVA AI'}\n${videoUrl}`,
    }),
  });
  console.log('✅ Telegram 알림 전송 완료');
}

run().catch(async (err) => {
  console.error('❌ 실패:', err.message);
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: `❌ 영상 파이프라인 실패\n${err.message}`,
    }),
  }).catch(() => {});
  process.exit(1);
});
