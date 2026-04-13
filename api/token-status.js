// api/token-status.js — 토큰 상태 확인 (포스팅 없음, 토큰값 노출 없음)
export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  const results = [];

  // Instagram
  try {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) throw new Error('환경변수 없음');
    const r = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${token}`
    );
    const d = await r.json();
    if (d.error) throw new Error(`에러코드 ${d.error.code}`);
    results.push({ platform: 'Instagram', ok: true, msg: `@${d.username} 정상` });
  } catch (e) {
    results.push({ platform: 'Instagram', ok: false, msg: e.message });
  }

  // YouTube
  try {
    const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN)
      throw new Error('환경변수 누락');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(tokenData)}`);
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    // 스코프 확인
    const scopeRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${tokenData.access_token}`
    );
    const scopeData = await scopeRes.json();
    const scopes = scopeData.scope || '스코프 없음';

    const chData = await chRes.json();
    if (chData.error) throw new Error(`채널 API 오류: ${chData.error.code} — 현재 스코프: ${scopes}`);
    const title = chData.items?.[0]?.snippet?.title;
    if (!title) throw new Error(`채널 없음 — 스코프: ${scopes}`);
    results.push({ platform: 'YouTube', ok: true, msg: `"${title}" 정상 | 스코프: ${scopes}` });
  } catch (e) {
    results.push({ platform: 'YouTube', ok: false, msg: e.message });
  }

  // GitHub
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('환경변수 없음');
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'nova-pipeline' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} — 토큰 만료`);
    const d = await r.json();
    results.push({ platform: 'GitHub', ok: true, msg: `@${d.login} 정상` });
  } catch (e) {
    results.push({ platform: 'GitHub', ok: false, msg: e.message });
  }

  const allOk = results.every(r => r.ok);
  res.status(allOk ? 200 : 503).json({ ok: allOk, results });
}
