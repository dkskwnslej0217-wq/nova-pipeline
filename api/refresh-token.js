// api/refresh-token.js — Meta IG/FB 토큰 자동 갱신 (매월 15일 크론)
export const config = { runtime: 'nodejs', maxDuration: 30 };

const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

const IG_TOKEN     = process.env.INSTAGRAM_ACCESS_TOKEN;
const FB_TOKEN     = process.env.FACEBOOK_ACCESS_TOKEN;
const FB_APP_ID    = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET= process.env.FACEBOOK_APP_SECRET;

async function tg(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
  } catch { /* 무시 */ }
}

// Instagram 장기 토큰 갱신 (60일 → 다시 60일)
async function refreshInstagramToken() {
  if (!IG_TOKEN) throw new Error('INSTAGRAM_ACCESS_TOKEN 없음');
  const res = await fetch(
    `https://graph.instagram.com/v21.0/refresh_access_token?grant_type=ig_refresh_token&access_token=${IG_TOKEN}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`IG 갱신 실패: ${res.status} ${err}`);
  }
  const data = await res.json();
  // 새 토큰 + 만료 시간 반환
  return {
    token: data.access_token,
    expiresIn: data.expires_in, // 초 단위 (약 5,183,944 = 60일)
  };
}

// Facebook 장기 토큰 갱신
async function refreshFacebookToken() {
  if (!FB_TOKEN || !FB_APP_ID || !FB_APP_SECRET) {
    throw new Error('FB 환경변수 누락 (FACEBOOK_ACCESS_TOKEN / FACEBOOK_APP_ID / FACEBOOK_APP_SECRET)');
  }
  const res = await fetch(
    `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${FB_TOKEN}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB 갱신 실패: ${res.status} ${err}`);
  }
  const data = await res.json();
  return {
    token: data.access_token,
    expiresIn: data.expires_in,
  };
}

export default async function handler(req, res) {
  const secret = req.headers['x-pipeline-secret'];
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = {};

  // Instagram 갱신
  try {
    const ig = await refreshInstagramToken();
    results.instagram = { ok: true, expiresIn: ig.expiresIn };
    // 새 토큰이 현재와 같으면 환경변수 업데이트 불필요
    // (Vercel은 API로 env 업데이트 가능하지만 재배포 필요 → 텔레그램 알림으로 수동 확인)
    await tg(`✅ Instagram 토큰 갱신 완료\n만료까지 ${Math.floor(ig.expiresIn / 86400)}일 남음\n⚠️ Vercel 환경변수 INSTAGRAM_ACCESS_TOKEN 업데이트 필요 시 확인`);
  } catch(e) {
    results.instagram = { ok: false, error: e.message };
    await tg(`❌ Instagram 토큰 갱신 실패\n${e.message}`);
  }

  // Facebook 갱신
  try {
    const fb = await refreshFacebookToken();
    results.facebook = { ok: true, expiresIn: fb.expiresIn };
    await tg(`✅ Facebook 토큰 갱신 완료\n만료까지 ${Math.floor(fb.expiresIn / 86400)}일 남음`);
  } catch(e) {
    results.facebook = { ok: false, error: e.message };
    await tg(`❌ Facebook 토큰 갱신 실패\n${e.message}\n※ FB_APP_ID, FB_APP_SECRET 환경변수 확인 필요`);
  }

  return res.status(200).json({ ok: true, results });
}
