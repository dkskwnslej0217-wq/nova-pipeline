// api/weekly-report.js — 매주 월요일 자동 실행
export const config = { runtime: 'nodejs' };

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

async function tg(msg) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const secret = req.headers['x-pipeline-secret'];
  if (!isCron && secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [cacheRes, trendsRes] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/cache?created_at=gte.${weekAgo}`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'count=exact' },
      }),
      fetch(`${SUPA_URL}/rest/v1/trends?created_at=gte.${weekAgo}&select=source`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
      }),
    ]);

    const postCount  = parseInt(cacheRes.headers.get('content-range')?.split('/')[1] ?? '0');
    const trendsData = await trendsRes.json().catch(() => []);
    const hnCount    = trendsData.filter(t => t.source === 'hn').length;
    const ghCount    = trendsData.filter(t => t.source === 'github').length;
    const rdCount    = trendsData.filter(t => t.source === 'reddit').length;

    const report =
      `📊 NOVA 주간 리포트\n` +
      `📅 ${new Date().toISOString().slice(0, 10)} 기준\n\n` +
      `📝 이번 주 콘텐츠 발행: ${postCount}개\n` +
      `📡 트렌드 수집\n` +
      `  • HackerNews: ${hnCount}개\n` +
      `  • GitHub: ${ghCount}개\n` +
      `  • Reddit: ${rdCount}개\n\n` +
      `🤖 파이프라인 정상 운영 중`;

    // 30일 지난 트렌드 자동 삭제
    await fetch(`${SUPA_URL}/rest/v1/rpc/delete_old_trends`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});

    await tg(report);
    return res.status(200).json({ ok: true, postCount, hnCount, ghCount, rdCount });

  } catch (e) {
    await tg(`❌ 주간 리포트 실패\n${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
