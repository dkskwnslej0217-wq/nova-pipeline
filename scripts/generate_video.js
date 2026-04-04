// scripts/generate_video.js
// TTS → Pexels 배경 → FFmpeg → YouTube 업로드 → Telegram 알림

import fs from 'fs';
import { execSync } from 'child_process';
import { google } from 'googleapis';

const {
  SCRIPT_TEXT, SCRIPT_TITLE, SCRIPT_TAGS,
  GOOGLE_TTS_KEY, PEXELS_API_KEY,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
} = process.env;

async function run() {
  // 1. Google TTS 직접 호출 → audio.mp3
  console.log('🎙️ TTS 생성 중...');
  const ttsRes = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: (SCRIPT_TEXT || '').slice(0, 2500) },
        voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 }
      })
    }
  );
  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`TTS 실패: ${ttsRes.status} — ${errText}`);
  }
  const ttsData = await ttsRes.json();
  const binary = Buffer.from(ttsData.audioContent, 'base64');
  fs.writeFileSync('audio.mp3', binary);
  console.log('✅ audio.mp3 저장 완료');

  // 2. Pexels → background.jpg
  console.log('🖼️ 배경 이미지 다운로드 중...');
  const pexelsRes = await fetch(
    'https://api.pexels.com/v1/search?query=technology+abstract+dark&per_page=1&orientation=landscape',
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  const pexelsData = await pexelsRes.json();
  if (!pexelsData.photos || pexelsData.photos.length === 0) throw new Error(`Pexels 결과 없음: ${JSON.stringify(pexelsData)}`);
  const imageUrl = pexelsData.photos[0].src.landscape;
  const imgRes = await fetch(imageUrl);
  const imgBuffer = await imgRes.arrayBuffer();
  fs.writeFileSync('background.jpg', Buffer.from(imgBuffer));
  console.log('✅ background.jpg 저장 완료');

  // 3. FFmpeg → output.mp4
  console.log('🎬 영상 합성 중...');
  execSync(
    'ffmpeg -y -loop 1 -i background.jpg -i audio.mp3 ' +
    '-c:v libx264 -tune stillimage -c:a aac -b:a 192k ' +
    '-pix_fmt yuv420p -vf scale=1920:1080 -shortest output.mp4'
  );
  console.log('✅ output.mp4 생성 완료');

  // 4. YouTube 업로드
  console.log('📤 YouTube 업로드 중...');
const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth });

  const uploadRes = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: SCRIPT_TITLE || 'NOVA 자동 영상',
        description: SCRIPT_TEXT?.slice(0, 500) || '',
        tags: SCRIPT_TAGS ? SCRIPT_TAGS.split(',') : ['NOVA', 'AI', '자동화'],
        categoryId: '28', // 과학기술
        defaultLanguage: 'ko'
      },
      status: {
        privacyStatus: 'public'
      }
    },
    media: {
      body: fs.createReadStream('output.mp4')
    }
  });

  const videoId = uploadRes.data.id;
  const videoUrl = `https://youtu.be/${videoId}`;
  console.log(`✅ 업로드 완료: ${videoUrl}`);

  // 5. Telegram 알림
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
