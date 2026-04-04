// api/platform.js — 플랫폼 레벨/예산 조회 + 관리자 업데이트
export const config = { runtime: 'edge' };

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

const LEVEL_CONFIG = [
  { level: 1, min_users: 0,   model: 'groq-70b',       tools: ['chat'],                          next_goal: 50  },
  { level: 2, min_users: 50,  model: 'claude-haiku',    tools: ['chat', 'voice'],                 next_goal: 200 },
  { level: 3, min_users: 200, model: 'claude-sonnet',   tools: ['chat', 'voice', 'image'],        next_goal: 500 },
  { level: 4, min_users: 500, model: 'claude-opus',     tools: ['chat', 'voice', 'image', 'video'], next_goal: null },
];

function calcLevel(user_count) {
  return [...LEVEL_CONFIG].reverse().find(l => user_count >= l.min_users) ?? LEVEL_CONFIG[0];
}

const headers = (extra = {}) => ({
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

export default async function handler(req) {
  // GET — 플랫폼 상태 공개 조회
  if (req.method === 'GET') {
    const res = await fetch(`${SUPA_URL}/rest/v1/platform_config?id=eq.1&select=*`, { headers: headers() });
    const data = await res.json();
    if (!data.length) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

    const cfg = data[0];
    const lv = calcLevel(cfg.user_count);
    const next = LEVEL_CONFIG.find(l => l.level === lv.level + 1) ?? null;

    return new Response(JSON.stringify({
      level: lv.level,
      model: lv.model,
      tools: lv.tools,
      user_count: cfg.user_count,
      next_goal: lv.next_goal,
      remaining: next ? Math.max(0, lv.next_goal - cfg.user_count) : 0,
      growth_fund: cfg.growth_fund,
      monthly_revenue: cfg.monthly_revenue,
    }), { headers: { 'content-type': 'application/json' } });
  }

  // POST — 관리자 전용: 수익/유저수 업데이트
  if (req.method === 'POST') {
    const secret = req.headers.get('x-pipeline-secret');
    if (secret !== PIPELINE_SECRET)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    let body;
    try { body = await req.json(); } catch { return new Response('bad request', { status: 400 }); }

    const { user_count, monthly_revenue, api_cost } = body;

    // 유저수 조회 (직접 전달 안 했으면 Supabase에서 카운트)
    let count = user_count;
    if (count === undefined) {
      const r = await fetch(`${SUPA_URL}/rest/v1/users?select=user_id`, {
        headers: { ...headers(), 'Prefer': 'count=exact', 'Range': '0-0' }
      });
      count = parseInt(r.headers.get('content-range')?.split('/')[1] ?? '0');
    }

    const lv = calcLevel(count);
    const rev = monthly_revenue ?? 0;
    const cost = api_cost ?? 0;
    const growth = Math.floor(rev * 0.2);

    // platform_config 업데이트
    await fetch(`${SUPA_URL}/rest/v1/platform_config?id=eq.1`, {
      method: 'PATCH',
      headers: headers({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify({
        user_count: count,
        level: lv.level,
        active_model: lv.model,
        unlocked_tools: lv.tools,
        next_unlock_goal: lv.next_goal,
        monthly_revenue: rev,
        api_cost: cost,
        growth_fund: growth,
        updated_at: new Date().toISOString(),
      }),
    });

    // 월별 스냅샷 저장
    const month = new Date().toISOString().slice(0, 7);
    await fetch(`${SUPA_URL}/rest/v1/platform_budget`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({
        month, revenue: rev, api_cost: cost,
        junho_profit: Math.floor(rev * 0.6),
        growth_fund: growth,
        user_count: count,
      }),
    });

    return new Response(JSON.stringify({ ok: true, level: lv.level, model: lv.model, user_count: count }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}
