// scripts/generate_video.js — NOVA 영상 파이프라인 v3
// 영상 생성 → Supabase Storage → Instagram 릴스 + Facebook 릴스 + YouTube

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  SCRIPT_TOOL_NAME, SCRIPT_COMPARE, SCRIPT_COMBO,
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

// ── 섹션 카드 SRT 생성 (우상단 오버레이용) ────────────────────────
function buildCardsSRT(toolName, compareWith, combo, duration) {
  const t1 = Math.max(8,  duration * 0.20);  // ~20% 지점: 소개 끝
  const t2 = Math.max(20, duration * 0.65);  // ~65% 지점: 비교 끝
  const fmt = (s) => {
    const h  = String(Math.floor(s / 3600)).padStart(2, '0');
    const m  = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sc = String(Math.floor(s % 60)).padStart(2, '0');
    const ms = String(Math.floor((s % 1) * 1000)).padStart(3, '0');
    return `${h}:${m}:${sc},${ms}`;
  };
  const entries = [
    `1\n${fmt(0)} --> ${fmt(t1)}\n🔧 ${toolName || 'AI 툴'}`,
    compareWith
      ? `2\n${fmt(t1)} --> ${fmt(t2)}\n${compareWith}`
      : null,
    combo
      ? `3\n${fmt(t2)} --> ${fmt(duration)}\n💡 ${combo}`
      : null,
  ].filter(Boolean);
  return entries.join('\n\n') + '\n';
}

// ── NOVA 캐릭터 (번들 고정 이미지 우선, 없으면 Pexels 폴백) ─────────
async function generateCharacterImage() {
  const bundled = path.join(path.dirname(new URL(import.meta.url).pathname), 'nova_character.png');
  if (fs.existsSync(bundled)) {
    fs.copyFileSync(bundled, 'character.png');
    console.log('✅ 번들 캐릭터 사용 (nova_B)');
    return true;
  }
  console.warn('⚠️ nova_character.png 없음 — Pexels 폴백 사용');
  return false;
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
  const shortsTitle = `${title} #Shorts`.slice(0, 100);

  // ── 0. 캐릭터 이미지 생성 (Pollinations) ─────────────────────
  console.log('\n🎨 캐릭터 이미지 생성 중...');
  const hasCharacter = await generateCharacterImage();

  // ── 1. TTS (edge-tts — 자연스러운 한국어 목소리) ──────────────
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
    # 4단어씩 묶어서 SRT 생성
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
    print(f"✅ 자막 {len(lines)}개 생성 (음성 싱크)")

asyncio.run(main())
`);
  execSync('python3 run_tts.py', { stdio: 'inherit' });
  console.log('✅ audio.mp3 + subtitles.srt 저장 (HyunsuNeural 남자 목소리)');

  const audioDuration = getAudioDuration('audio.mp3');
  console.log(`⏱️  오디오 ${audioDuration.toFixed(1)}초`);

  // ── 2. 자막 (edge-tts SubMaker 생성, 없으면 추정 fallback) ──────
  const srtPath = path.resolve('subtitles.srt');
  if (!fs.existsSync(srtPath) || fs.statSync(srtPath).size < 10) {
    fs.writeFileSync(srtPath, generateSRT(scriptText));
    console.log('⚠️ subtitles.srt fallback (추정 타이밍)');
  } else {
    console.log('✅ subtitles.srt 사용 (edge-tts 정확 싱크)');
  }
  const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  // ── 3. 카드 SRT 생성 (툴 비교 섹션 오버레이) ──────────────────
  const toolName    = SCRIPT_TOOL_NAME || title.replace('오늘의 AI 툴: ', '').trim();
  const compareWith = SCRIPT_COMPARE   || '';
  const combo       = SCRIPT_COMBO     || '';

  const cardsSrt = buildCardsSRT(toolName, compareWith, combo, audioDuration);
  fs.writeFileSync('cards.srt', cardsSrt);
  const cardsEscaped = path.resolve('cards.srt').replace(/\\/g, '/').replace(/:/g, '\\:');
  console.log(`✅ cards.srt 생성 (${cardsSrt.split('\n\n').length}개 카드)`);

  // 자막 스타일 — 하단 나레이션 (캐릭터 아래)
  const subStyle = [
    'FontName=NanumGothic', 'FontSize=15', 'Bold=1',
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
    'BackColour=&H88000000', 'Outline=2', 'Shadow=0',
    'BorderStyle=3', 'Alignment=2', 'MarginV=50',
  ].join(',');

  // 카드 스타일 — 우상단 섹션 카드
  const cardStyle = [
    'FontName=NanumGothic', 'FontSize=24', 'Bold=1',
    'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H001a1a2e',
    'BackColour=&HBB1a1a2e', 'Outline=2', 'Shadow=0',
    'BorderStyle=3', 'Alignment=9', 'MarginR=25', 'MarginV=70',
  ].join(',');

  // ── 4. 영상 합성 (다크 배경 + 캐릭터 좌측 크게 + 카드 우상단) ──
  console.log('\n🎬 영상 합성 중 (다크 배경 + 캐릭터 좌측 + 카드 오버레이)...');

  const videoDuration = Math.min(audioDuration, 60);

  if (hasCharacter) {
    const filterParts = [
      // 캐릭터: 좌측 중앙, 520px 너비, 2.5초 주기 8px 상하 움직임
      `[1:v]scale=520:-1[char]`,
      `[0:v][char]overlay=x=30:y=(H-h)/2+8*sin(6.28318*t/2.5):eval=frame[vchar]`,
      // 섹션 카드 (우상단, 시간대별)
      `[vchar]subtitles=${cardsEscaped}:force_style='${cardStyle}'[vcards]`,
      // 나레이션 자막 (하단 중앙)
      `[vcards]subtitles=${srtEscaped}:force_style='${subStyle}'[vout]`,
    ];

    execSync(
      `ffmpeg -y ` +
      `-f lavfi -i color=c=0x111827:size=1080x1920:rate=30 ` +
      `-loop 1 -i character.png ` +
      `-i audio.mp3 ` +
      `-filter_complex "${filterParts.join(';')}" ` +
      `-map "[vout]" -map 2:a ` +
      `-c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k ` +
      `-t ${videoDuration} output.mp4`,
      { stdio: 'inherit' }
    );
  } else {
    // 캐릭터 없을 시 텍스트만
    execSync(
      `ffmpeg -y ` +
      `-f lavfi -i color=c=0x111827:size=1080x1920:rate=30 ` +
      `-i audio.mp3 ` +
      `-filter_complex "[0:v]subtitles=${srtEscaped}:force_style='${subStyle}'[vout]" ` +
      `-map "[vout]" -map 1:a ` +
      `-c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k ` +
      `-t ${videoDuration} output.mp4`,
      { stdio: 'inherit' }
    );
  }
  console.log('✅ output.mp4 생성 완료 (9:16 세로형)');

  // ── 5. Supabase Storage 업로드 ────────────────────────────────
  console.log('\n☁️  Supabase 업로드 중...');
  const videoUrl = await withRetry('Supabase 업로드', () => uploadToSupabase('output.mp4'));

  // ── 6. Instagram 릴스 + Facebook 릴스 + YouTube Shorts (병렬) ─
  console.log('\n📤 플랫폼 발행 중...');
  const caption = `${scriptText.slice(0, 2100)}\n\n#Shorts #AI툴 #오늘의AI #새로운AI #AI추천`;

  const [igResult, fbResult, ytResult] = await Promise.allSettled([
    withRetry('Instagram 릴스', () => postInstagramReel(videoUrl, caption)),
    withRetry('Facebook 릴스', () => postFacebookReel(videoUrl, caption)),
    (async () => {
      const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
      const youtube = google.youtube({ version: 'v3', auth });
      const allTags = [...(tags.length ? tags : ['NOVA', 'AI', '툴소개']), 'Shorts', 'AI툴', '오늘의AI', '인공지능'];
      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: shortsTitle,
            description: `${scriptText.slice(0, 450)}\n\n#Shorts #AI부업 #직장인자동화`,
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

  // ── 7. 임시 파일 정리 ─────────────────────────────────────────
  ['character.png', 'audio.mp3', 'tts_script.txt', 'run_tts.py', 'subtitles.srt', 'cards.srt', 'output.mp4'].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });

  // ── 8. Telegram 결과 ──────────────────────────────────────────
  await tg(
    `🎬 NOVA 영상 발행 완료\n` +
    `🎨 캐릭터: ${hasCharacter ? '✅' : '⚠️ 폴백'}\n` +
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
