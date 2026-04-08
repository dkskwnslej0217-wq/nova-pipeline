// api/clients.js — 클라이언트 등록/관리 CRUD
// GET  /api/clients          — 전체 목록 (관리자)
// POST /api/clients          — 신규 등록
// PATCH /api/clients?id=xxx  — 토큰 업데이트
// DELETE /api/clients?id=xxx — 비활성화
export const config = { runtime: 'nodejs', maxDuration: 30 };

const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_SERVICE_KEY;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

const headers = () => ({
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
});

export default async function handler(req, res) {
  // 관리자 인증
  const secret = req.headers['x-pipeline-secret'];
  if (secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { method } = req;
  const clientId = req.query?.id;

  // ── GET: 전체 클라이언트 목록 ──
  if (method === 'GET') {
    const r = await fetch(`${SUPA_URL}/rest/v1/clients?select=id,name,email,plan,active,niche,target,schedule_offset_min,run_count,last_run_at,created_at&order=created_at.desc`, {
      headers: headers(),
    });
    const data = await r.json();
    return res.status(200).json(data);
  }

  // ── POST: 신규 클라이언트 등록 ──
  if (method === 'POST') {
    const { name, email, plan, niche, target, ig_token, ig_account_id, fb_token, fb_page_id, tg_chat_id, schedule_offset_min } = req.body;
    if (!name) return res.status(400).json({ error: 'name 필요' });

    const r = await fetch(`${SUPA_URL}/rest/v1/clients`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        name, email, plan: plan || 'basic',
        niche: niche || 'AI부업 자동화',
        target: target || '월급 받는 직장인 20-40대',
        ig_token, ig_account_id,
        fb_token, fb_page_id,
        tg_chat_id,
        schedule_offset_min: schedule_offset_min || 0,
        active: true,
      }),
    });
    const data = await r.json();
    return res.status(201).json({ ok: true, client: data[0] });
  }

  // ── PATCH: 클라이언트 정보 업데이트 ──
  if (method === 'PATCH') {
    if (!clientId) return res.status(400).json({ error: 'id 필요' });
    const allowed = ['name', 'email', 'plan', 'active', 'niche', 'target',
      'ig_token', 'ig_account_id', 'ig_token_expires_at',
      'fb_token', 'fb_page_id', 'tg_chat_id', 'schedule_offset_min'];
    const update = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(update).length) return res.status(400).json({ error: '업데이트할 항목 없음' });

    const r = await fetch(`${SUPA_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(update),
    });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: 비활성화 ──
  if (method === 'DELETE') {
    if (!clientId) return res.status(400).json({ error: 'id 필요' });
    const r = await fetch(`${SUPA_URL}/rest/v1/clients?id=eq.${clientId}`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ active: false }),
    });
    if (!r.ok) return res.status(500).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
