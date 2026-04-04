export const config = { runtime: 'edge' };

// Make.com 또는 cron에서 호출 — ALERT_SECRET으로 보호
async function sendTelegram(token, chatId, text) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export default async function handler(req) {
  // 보안: Vercel Cron 헤더 또는 secret 쿼리 검증
  const url = new URL(req.url);
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const secret = url.searchParams.get('secret') ?? '';
  if (!isVercelCron && secret !== process.env.ALERT_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;
  const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` };

  const type = url.searchParams.get('type') || 'churn'; // churn | summary | new_user | debug

  try {

    // ─── 1. 이탈 감지 (3일 이상 전 가입 + 오늘 사용 0회) ───
    if (type === 'churn') {
      // 7일 이상 전 가입 + 총 채팅 0회 = 한 번도 AI를 쓰지 않은 유저
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `${SUPA_URL}/rest/v1/users?created_at=lt.${cutoff}&total_chat_count=eq.0&plan_type=neq.admin&select=nickname,plan_type,created_at&order=created_at.asc&limit=20`,
        { headers: h }
      );
      const users = await res.json();
      const atRisk = Array.isArray(users) ? users : [];

      if (atRisk.length === 0) {
        return new Response(JSON.stringify({ ok: true, message: '이탈 위험 유저 없음' }), {
          headers: { 'content-type': 'application/json' }
        });
      }

      const lines = atRisk.map(u => {
        const days = Math.floor((Date.now() - new Date(u.created_at)) / 86400000);
        const planEmoji = u.plan_type === 'pro' ? '💜' : u.plan_type === 'starter' ? '💙' : '⚪';
        return `${planEmoji} <b>${u.nickname || '익명'}</b> · 가입 ${days}일째 채팅 0회`;
      });

      const msg = `⚠️ <b>이탈 위험 유저 ${atRisk.length}명</b>\n\n${lines.join('\n')}\n\n<i>가입 7일+ 경과, AI 미사용</i>`;
      await sendTelegram(TG_TOKEN, TG_CHAT, msg);

      return new Response(JSON.stringify({ ok: true, alerted: atRisk.length }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ─── 2. 일일 요약 ────────────────────────────────────
    if (type === 'summary') {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [usersRes, chatsRes, newUsersRes] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/users?select=plan_type`, { headers: h }),
        fetch(`${SUPA_URL}/rest/v1/users?select=daily_count`, { headers: h }),
        fetch(`${SUPA_URL}/rest/v1/users?created_at=gt.${yesterday}&select=user_id`, { headers: h }),
      ]);

      const users     = await usersRes.json();
      const chats     = await chatsRes.json();
      const newUsers  = await newUsersRes.json();

      const planCounts = { free: 0, starter: 0, pro: 0 };
      for (const u of (Array.isArray(users) ? users : [])) {
        const p = u.plan_type || 'free';
        planCounts[p] = (planCounts[p] || 0) + 1;
      }
      const totalUsers    = planCounts.free + planCounts.starter + planCounts.pro;
      const totalChats    = (Array.isArray(chats) ? chats : []).reduce((s, u) => s + (u.daily_count || 0), 0);
      const monthlyRevenue = planCounts.starter * 4900 + planCounts.pro * 14900;

      const msg = `📊 <b>NOVA 일일 요약</b>\n\n` +
        `👥 총 유저: <b>${totalUsers}명</b> (+${Array.isArray(newUsers) ? newUsers.length : 0} 신규)\n` +
        `⚪ 무료: ${planCounts.free}명 · 💙 스타터: ${planCounts.starter}명 · 💜 프로: ${planCounts.pro}명\n` +
        `💬 오늘 채팅: <b>${totalChats}회</b>\n` +
        `💰 월 예상 수익: <b>₩${monthlyRevenue.toLocaleString('ko-KR')}</b>`;

      await sendTelegram(TG_TOKEN, TG_CHAT, msg);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }

    // ─── 3. 신규 유저 알림 (가입 시 즉시 호출) ───────────
    if (type === 'new_user') {
      const body = await req.json().catch(() => ({}));
      const { nickname, plan } = body;
      const msg = `🌟 <b>신규 유저 가입!</b>\n닉네임: ${nickname || '익명'}\n플랜: ${plan || 'free'}`;
      await sendTelegram(TG_TOKEN, TG_CHAT, msg);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }

    // ─── 4. 만료 캐시 정리 ───────────────────────────────────
    if (type === 'cleanup_cache') {
      const now = new Date().toISOString();
      await fetch(`${SUPA_URL}/rest/v1/cache?expires_at=lt.${now}`, {
        method: 'DELETE',
        headers: { ...h, 'Prefer': 'return=minimal' },
      });
      return new Response(JSON.stringify({ ok: true, message: '만료 캐시 정리 완료' }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ─── 5. 만료 세션 정리 ───────────────────────────────────
    if (type === 'cleanup_sessions') {
      const now = new Date().toISOString();
      const res = await fetch(`${SUPA_URL}/rest/v1/sessions?expires_at=lt.${now}`, {
        method: 'DELETE',
        headers: { ...h, 'Prefer': 'return=minimal' },
      });
      if (!res.ok) throw new Error(`session cleanup failed: ${res.status}`);
      return new Response(JSON.stringify({ ok: true, message: '만료 세션 정리 완료' }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    // ─── 5. 일일 한도 리셋 (매일 자정) ──────────────────────
    if (type === 'reset_daily') {
      const res = await fetch(`${SUPA_URL}/rest/v1/users?plan_type=neq.admin`, {
        method: 'PATCH',
        headers: { ...h, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ daily_count: 0 }),
      });
      if (!res.ok) throw new Error(`reset failed: ${res.status}`);
      return new Response(JSON.stringify({ ok: true, message: 'daily_count 리셋 완료' }), {
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: '알 수 없는 type' }), { status: 400 });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
