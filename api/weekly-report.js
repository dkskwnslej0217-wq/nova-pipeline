// api/weekly-report.js — 주간 성과 리포트 자동 생성
// Vercel Cron: 매주 월요일 09:00 KST (00:00 UTC)
export const config = { runtime: 'nodejs', maxDuration: 120 };

const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_SERVICE_KEY;
const GROQ_KEY      = process.env.GROQ_API_KEY;
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT       = process.env.TELEGRAM_CHAT_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const IG_TOKEN      = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

async function tg(chatId, msg) {
  if (!TG_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg }),
  }).catch(() => {});
}

async function getIGInsights(token, accountId) {
  try {
    const r = await fetch(
      `https://graph.instagram.com/v21.0/${accountId}/media?fields=id,timestamp,like_count,comments_count&limit=10&access_token=${token}`
    );
    if (!r.ok) return null;
    const { data } = await r.json();
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const posts = data.filter(p => new Date(p.timestamp).getTime() > weekAgo);
    if (!posts.length) return null;
    const totalLikes = posts.reduce((s, p) => s + (p.like_count || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments_count || 0), 0);
    return { postCount: posts.length, totalLikes, totalComments, avgLikes: Math.round(totalLikes / posts.length) };
  } catch { return null; }
}

async function generateReport(name, niche, stats) {
  const statsText = stats
    ? `게시 ${stats.postCount}개, 좋아요 ${stats.totalLikes}개, 댓글 ${stats.totalComments}개, 평균 ${stats.avgLikes}개`
    : '인사이트 데이터 없음';
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user', content: `클라이언트: ${name}\n주제: ${niche}\n성과: ${statsText}\n\n3줄 이내 주간 리포트. 잘된 점 + 다음주 팁 1개. 진짜 사람처럼.` }],
        max_tokens: 150,
      }),
    });
    if (!r.ok) return statsText;
    return (await r.json()).choices[0].message.content;
  } catch { return statsText; }
}

export default async function handler(req, res) {
  const secret = req.headers['x-pipeline-secret'];
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const kst = new Date(Date.now() + 9 * 3600000);
  const weekStr = `${kst.getMonth()+1}/${kst.getDate()-6}~${kst.getMonth()+1}/${kst.getDate()}`;

  // 관리자 본인 리포트
  const myStats = await getIGInsights(IG_TOKEN, IG_ACCOUNT_ID);
  const myReport = await generateReport('NOVA', 'AI부업 자동화', myStats);

  let summary = `📊 주간 리포트 (${weekStr})\n\n🏠 내 계정\n${myReport}`;
  if (myStats) {
    summary += `\n\n📈 게시 ${myStats.postCount} | 좋아요 ${myStats.totalLikes} (평균 ${myStats.avgLikes}) | 댓글 ${myStats.totalComments}`;
  }

  // 클라이언트 리포트
  const cr = await fetch(
    `${SUPA_URL}/rest/v1/clients?active=eq.true&select=id,name,niche,ig_token,ig_account_id,tg_chat_id,run_count`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  const clients = await cr.json().catch(() => []);

  if (clients.length) {
    summary += `\n\n👥 클라이언트 ${clients.length}명`;
    for (const c of clients) {
      const stats = c.ig_token && c.ig_account_id ? await getIGInsights(c.ig_token, c.ig_account_id) : null;
      const report = await generateReport(c.name, c.niche, stats);
      if (c.tg_chat_id) {
        const msg = `📊 ${c.name} 주간 리포트\n\n${report}` +
          (stats ? `\n\n📈 좋아요 ${stats.totalLikes} | 댓글 ${stats.totalComments} | 게시 ${stats.postCount}개` : '');
        await tg(c.tg_chat_id, msg);
      }
      summary += `\n• ${c.name}: 좋아요 ${stats?.totalLikes ?? '-'} | 실행 ${c.run_count}회`;
    }
  }

  await tg(TG_CHAT, summary);
  return res.status(200).json({ ok: true, clients: clients.length });
}
