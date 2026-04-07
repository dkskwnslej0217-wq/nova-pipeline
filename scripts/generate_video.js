// scripts/generate_video.js
// TTS → Pexels 동영상 배경 → FFmpeg (자막 포함) → YouTube 업로드 → Telegram 알림

import fs from 'fs';
import { execSync } from 'child_process';
import { google } from 'googleapis';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  GOOGLE_TTS_KEY, PEXELS_API_KEY,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
} = process.env;

// 자막 파일 생성 (SRT 형식)
function generateSRT(text) {
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  let srt = '';
  let time = 0;
  sentences.forEach((sentence, i) => {
    const duration = Math.max(2, sentence.length * 0.07); // 글자당 0.07초
    const start = formatTime(time);
    const end = formatTime(time + duration);
    srt += `${i + 1}\n${start} --> ${end}\n${sentence.trim()}\n\n`;
    time += duration + 0.5;
  });
  return srt;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

async function run() {
  const scriptText = (SCRIPT_TEXT || 'NOVA AI 자동화 콘텐츠입니다.').slice(0, 2500);

  // 1. Google TTS → audio.wav
  console.log('🎙️ TTS 생성 중...');
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
  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`TTS 실패: ${ttsRes.status} — ${errText}`);
  }
  const ttsData = await ttsRes.json();
  fs.writeFileSync('audio.wav', Buffer.from(ttsData.audioContent, 'base64'));
  console.log('✅ audio.wav 저장 완료');

  // 2. 자막 파일 생성
  console.log('📝 자막 생성 중...');
  const srt = generateSRT(scriptText);
  fs.writeFileSync('subtitles.srt', srt);
  console.log('✅ subtitles.srt 저장 완료');

  // 3. Pexels 동영상 배경
  console.log('🎥 배경 영상 다운로드 중...');
  const keywords = ['technology', 'abstract', 'city', 'nature', 'business'];
  const query = keywords[Math.floor(Math.random() * keywords.length)];
  const pexelsRes = await fetch(
    `https://api.pexels.com/videos/search?query=${query}&per_page=5&orientation=landscape`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  const pexelsData = await pexelsRes.json();

  let bgCommand;
  if (pexelsData.videos && pexelsData.videos.length > 0) {
    // 동영상 배경 사용
    const video = pexelsData.videos[Math.floor(Math.random() * pexelsData.videos.length)];
    const videoFile = video.video_files.find(f => f.quality === 'hd' || f.quality === 'sd');
    const videoUrl = videoFile?.link;
    const vidRes = await fetch(videoUrl);
    const vidBuffer = await vidRes.arrayBuffer();
    fs.writeFileSync('background.mp4', Buffer.from(vidBuffer));
    console.log('✅ background.mp4 저장 완료');
    bgCommand = '-stream_loop -1 -i background.mp4';
  } else {
    // 폴백: Pexels 이미지
    const imgRes2 = await fetch(
      `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    const imgData = await imgRes2.json();
    const imgUrl = imgData.photos?.[0]?.src?.landscape;
    const imgRes = await fetch(imgUrl);
    fs.writeFileSync('background.jpg', Buffer.from(await imgRes.arrayBuffer()));
    console.log('✅ background.jpg 저장 완료 (폴백)');
    bgCommand = '-loop 1 -i background.jpg';
  }

  // 4. FFmpeg — 배경 + 음성 + 자막
  console.log('🎬 영상 합성 중...');
  const subtitleFilter = fs.existsSync('subtitles.srt')
    ? `subtitles=subtitles.srt:force_style='FontName=NanumGothic,FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2,Alignment=2'`
    : '';
  const vf = subtitleFilter
    ? `scale=1920:1080,${subtitleFilter}`
    : 'scale=1920:1080';

  execSync(
    `ffmpeg -y ${bgCommand} -i audio.wav ` +
    `-c:v libx264 -tune stillimage -c:a aac -b:a 192k ` +
    `-pix_fmt yuv420p -vf "${vf}" -shortest output.mp4`,
    { stdio: 'inherit' }
  );
  console.log('✅ output.mp4 생성 완료');

  // 5. YouTube 업로드
  console.log('📤 YouTube 업로드 중...');
  const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth });

  const uploadRes = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: SCRIPT_TITLE || 'NOVA 자동 영상',
        description: scriptText.slice(0, 500),
        tags: SCRIPT_TAGS ? SCRIPT_TAGS.split(',') : ['NOVA', 'AI', '자동화'],
        categoryId: '28',
        defaultLanguage: 'ko'
      },
      status: { privacyStatus: 'public' }
    },
    media: { body: fs.createReadStream('output.mp4') }
  });

  const videoId = uploadRes.data.id;
  const videoUrl = `https://youtu.be/${videoId}`;
  console.log(`✅ 업로드 완료: ${videoUrl}`);

  // 6. Telegram 알림
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: `🎬 영상 업로드 완료\n제목: ${SCRIPT_TITLE}\n${videoUrl}`
    })
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
      text: `❌ 영상 파이프라인 실패\n${err.message}`
    })
  });
  process.exit(1);
});
