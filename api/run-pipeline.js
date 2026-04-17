// api/run-pipeline.js — Vercel Cron / Make.com 트리거
// 역할: 락 체크 → GitHub Actions dispatch → 202 응답 (5초 내 완료)
// 모든 AI 처리(트렌드수집/콘텐츠생성/발행)는 GitHub Actions에서 수행

export const config = { runtime: 'nodejs' };

const SUPA_URL         = process.env.SUPABASE_URL;
const SUPA_KEY         = process.env.SUPABASE_SERVICE_KEY;
const TG_TOKEN         = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT          = process.env.TELEGRAM_CHAT_ID;
const PIPELINE_SECRET  = process.env.PIPELINE_SECRET;
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const GITHUB_REPO      = process.env.GITHUB_REPO || 'dkskwnslej0217-wq/nova-pipeline';

const TOKEN_EXPIRES = {
  threads:   process.env.THREADS_TOKEN_EXPIRES_AT,
  instagram: process.env.INSTAGRAM_TOKEN_EXPIRES_AT,
  facebook:  process.env.FACEBOOK_TOKEN_EXPIRES_AT,
};

function ft(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function tg(msg) {
  try {
    await ft(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    }, 5000);
  } catch { /* 알림 실패는 파이프라인 중단하지 않음 */ }
}

export default async function handler(req, res) {
  // 1. 보안 체크
  const secret = req.headers['x-pipeline-secret'];
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== PIPELINE_SECRET) {
    if (!PIPELINE_SECRET) await tg('🚨 PIPELINE_SECRET 환경변수 미설정 — Vercel Settings 확인 필요');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. 중복 실행 방지 락 (KST 시간대 단위)
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const lockKey = `lock_${kstNow.toISOString().slice(0, 13).replace('T', '_')}KST`;
  let lockInserted;
  try {
    const lockRes = await ft(`${SUPA_URL}/rest/v1/cache`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify({ hash: lockKey, topic: '__lock__', content: 'running', score: 0 }),
    }, 4000);
    lockInserted = await lockRes.json();
  } catch(e) {
    console.error('락 체크 실패:', e.message);
    await tg(`🚨 파이프라인 중단 — Supabase 락 체크 실패\n${e.message}`);
    return res.status(503).json({ ok: false, error: '락 체크 실패' });
  }
  if (!Array.isArray(lockInserted) || lockInserted.length === 0) {
    console.log(`⏭️ 스킵 — ${lockKey} 이미 실행됨`);
    return res.status(200).json({ ok: false, skipped: true, reason: '이 시간대 이미 실행됨' });
  }

  // 3. 일일 카운트 리셋 (논블로킹 — 실패해도 파이프라인 계속)
  const today = new Date();
  if (today.getDate() === 1) {
    ft(`${SUPA_URL}/rest/v1/rpc/reset_monthly_counts`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, 2000).catch(e => tg(`⚠️ 월별 리셋 실패\n${e.message}`));
  } else {
    ft(`${SUPA_URL}/rest/v1/users?daily_count=gt.0`, {
      method: 'PATCH',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ daily_count: 0 }),
    }, 2000).catch(e => tg(`⚠️ 일별 리셋 실패\n${e.message}`));
  }

  // 4. 토큰 만료 경고 (논블로킹)
  const now = Date.now();
  for (const [platform, expiresAt] of Object.entries(TOKEN_EXPIRES)) {
    if (!expiresAt) continue;
    const exp = parseInt(expiresAt, 10) * 1000;
    if (isNaN(exp)) continue;
    const daysLeft = Math.floor((exp - now) / 86400000);
    if (daysLeft <= 0) tg(`🚨 ${platform.toUpperCase()} 토큰 만료됨! 즉시 갱신하세요.`).catch(() => {});
    else if (daysLeft <= 7) tg(`⚠️ ${platform.toUpperCase()} 토큰 만료 ${daysLeft}일 전!`).catch(() => {});
  }

  // 5. GitHub Actions dispatch — 트렌드수집/AI/발행 전부 여기서 처리
  try {
    const dispatchRes = await ft(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_type: 'create-video', client_payload: { lock: lockKey } }),
      }, 8000
    );
    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text().catch(() => '');
      throw new Error(`GitHub dispatch ${dispatchRes.status}: ${errText.slice(0, 100)}`);
    }
    console.log(`✅ GitHub Actions 트리거 완료 (${lockKey})`);
  } catch(e) {
    await tg(`🚨 GitHub Actions 트리거 실패\n${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }

  // 6. 시작 알림 + 응답
  await tg(`🔄 NOVA 파이프라인 시작\n⏳ GitHub Actions에서 AI 처리 중...`);
  return res.status(202).json({ ok: true, lock: lockKey });
}
