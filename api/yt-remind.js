// api/yt-remind.js — YouTube refresh_token 갱신 리마인더
// GitHub Actions에서 6일마다 호출 → 토큰 상태 체크 → Telegram 알림
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') ?? '';
  if (secret !== (process.env.PIPELINE_SECRET ?? '')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;
  const YT_CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID;
  const YT_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
  const YT_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

  async function tg(msg) {
    if (!TG_TOKEN || !TG_CHAT) return;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'HTML' }),
    }).catch(() => {});
  }

  let ytOk = false;
  let ytMsg = '';
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: YT_CLIENT_ID,
        client_secret: YT_CLIENT_SECRET,
        refresh_token: YT_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await tokenRes.json();
    if (data.access_token) {
      ytOk = true;
      ytMsg = '✅ YouTube 토큰 정상';
    } else {
      ytMsg = `❌ ${data.error}: ${data.error_description || ''}`;
    }
  } catch (e) {
    ytMsg = `❌ 연결 오류: ${e.message}`;
  }

  if (!ytOk) {
    await tg(
      `🚨 <b>YouTube 토큰 갱신 필요</b>\n\n` +
      `${ytMsg}\n\n` +
      `<b>갱신 방법:</b>\n` +
      `1. OAuth Playground 접속 (developers.google.com/oauthplayground)\n` +
      `2. 톱니바퀴 → Use your own OAuth credentials 체크\n` +
      `3. Client ID / Secret 입력 (Vercel 환경변수 값)\n` +
      `4. youtube.upload 스코프 선택 → 승인\n` +
      `5. Exchange → refresh_token 복사\n` +
      `6. Vercel YOUTUBE_REFRESH_TOKEN 교체 → Redeploy\n\n` +
      `⏰ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
    );
    return new Response(JSON.stringify({ ok: false, msg: ytMsg }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true, msg: ytMsg }), { status: 200 });
}
