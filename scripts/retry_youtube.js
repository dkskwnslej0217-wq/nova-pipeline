// scripts/retry_youtube.js — YouTube 재업로드 (Supabase URL → YouTube)
import fs from 'fs';
import { google } from 'googleapis';

const {
  VIDEO_URL, VIDEO_TITLE, VIDEO_DESC, VIDEO_TAGS,
  RETRY_DATE,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
} = process.env;

async function tg(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg }),
  }).catch(() => {});
}

async function updateLog(date, status, postId, errorMsg) {
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
      platform: 'youtube',
      status,
      post_id: postId,
      error_msg: errorMsg,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function run() {
  if (!VIDEO_URL) throw new Error('VIDEO_URL 없음');

  console.log(`📥 Supabase에서 영상 다운로드: ${VIDEO_URL}`);
  const videoRes = await fetch(VIDEO_URL, { signal: AbortSignal.timeout(120000) });
  if (!videoRes.ok) throw new Error(`영상 다운로드 실패: ${videoRes.status}`);
  const buf = await videoRes.arrayBuffer();
  fs.writeFileSync('output.mp4', Buffer.from(buf));
  console.log(`✅ 영상 다운로드 완료 (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`);

  const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth });

  let tags = ['NOVA', 'AI', '툴소개', 'Shorts', 'AI툴', '오늘의AI'];
  try { if (VIDEO_TAGS) tags = JSON.parse(VIDEO_TAGS); } catch {}

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: (VIDEO_TITLE || 'NOVA AI').slice(0, 100),
        description: (VIDEO_DESC || '').slice(0, 5000),
        tags,
        categoryId: '28',
        defaultLanguage: 'ko',
      },
      status: { privacyStatus: 'public' },
    },
    media: { body: fs.createReadStream('output.mp4') },
  });

  const ytUrl = `https://youtu.be/${res.data.id}`;
  console.log(`✅ YouTube 재업로드 성공: ${ytUrl}`);
  await updateLog(RETRY_DATE, 'success', res.data.id, null);
  await tg(`▶️ YouTube 재업로드 성공\n${ytUrl}`);

  fs.unlinkSync('output.mp4');
}

run().catch(async (err) => {
  console.error('❌ YouTube 재업로드 실패:', err.message);
  await updateLog(RETRY_DATE, 'failed', null, err.message?.slice(0, 200));
  await tg(`❌ YouTube 재업로드 실패\n${err.message?.slice(0, 100)}`);
  process.exit(1);
});
