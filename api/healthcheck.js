export const config = { runtime: 'edge' };

// 전체 API 헬스체크 — Vercel Cron 또는 수동 호출
// 문제 발견 시 Telegram 긴급 알림

const CHECKS = [
  {
    name: 'Supabase 연결',
    test: async (env) => {
      const res = await fetch(
        `${env.SUPA_URL}/rest/v1/users?limit=1&select=user_id`,
        { headers: { 'apikey': env.SUPA_KEY, 'Authorization': `Bearer ${env.SUPA_KEY}` } }
      );
      if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d)) throw new Error('응답 형식 오류');
      return `유저 테이블 접근 OK`;
    }
  },
  {
    name: 'Groq AI 연결',
    test: async (env) => {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${env.GROQ_KEY}` }
      });
      if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
      return 'Groq API OK';
    }
  },
  {
    name: '플랫폼 설정 조회',
    test: async (env) => {
      const res = await fetch(`${env.APP_URL}/api/platform`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`/api/platform HTTP ${res.status}`);
      const d = await res.json();
      if (!d.level && d.level !== 0) throw new Error('level 필드 없음');
      return `플랫폼 Lv${d.level} OK`;
    }
  },
  {
    name: '예산 API',
    test: async (env) => {
      const res = await fetch(`${env.APP_URL}/api/budget`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`/api/budget HTTP ${res.status}`);
      await res.json();
      return '/api/budget OK';
    }
  },
  {
    name: 'users API',
    test: async (env) => {
      const res = await fetch(`${env.APP_URL}/api/users`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`/api/users HTTP ${res.status}`);
      const d = await res.json();
      if (!Array.isArray(d)) throw new Error('배열 아님');
      return `유저 ${d.length}명 OK`;
    }
  },
];

export default async function handler(req) {
  const url = new URL(req.url);
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const secret = url.searchParams.get('secret') ?? '';
  if (!isVercelCron && secret !== process.env.ALERT_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const env = {
    SUPA_URL: process.env.SUPABASE_URL,
    SUPA_KEY: process.env.SUPABASE_SERVICE_KEY,
    GROQ_KEY: process.env.GROQ_API_KEY,
    APP_URL:  'https://my-project-xi-sand-93.vercel.app',
  };

  const TG_TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

  const results = [];
  const failures = [];

  for (const check of CHECKS) {
    try {
      const msg = await check.test(env);
      results.push({ name: check.name, ok: true, msg });
    } catch (e) {
      results.push({ name: check.name, ok: false, msg: e.message });
      failures.push({ name: check.name, error: e.message });
    }
  }

  // 실패 있으면 Telegram 긴급 알림
  if (failures.length > 0 && TG_TOKEN && TG_CHAT) {
    const lines = failures.map(f => `❌ <b>${f.name}</b>: ${f.error}`).join('\n');
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: `🚨 <b>NOVA 헬스체크 실패 ${failures.length}건</b>\n\n${lines}\n\n<i>자동 점검 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</i>`,
        parse_mode: 'HTML',
      }),
    }).catch(() => {});
  }

  // 전체 정상이면 간단 OK 알림 + 일일 요약 (하루 1번)
  if (failures.length === 0 && TG_TOKEN && TG_CHAT && url.searchParams.get('notify') === '1') {
    const lines = results.map(r => `✅ ${r.name}: ${r.msg}`).join('\n');
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: `✅ <b>NOVA 전체 정상</b>\n\n${lines}`,
        parse_mode: 'HTML',
      }),
    }).catch(() => {});

    // 일일 요약 (alert summary 통합)
    try {
      const SUPA_URL = process.env.SUPABASE_URL;
      const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
      const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` };
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [usersRes, newUsersRes] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/users?select=plan_type,daily_count`, { headers: h }),
        fetch(`${SUPA_URL}/rest/v1/users?created_at=gt.${yesterday}&select=user_id`, { headers: h }),
      ]);
      const users = await usersRes.json();
      const newUsers = await newUsersRes.json();
      const planCounts = { free: 0, starter: 0, pro: 0 };
      let totalChats = 0;
      for (const u of (Array.isArray(users) ? users : [])) {
        planCounts[u.plan_type || 'free'] = (planCounts[u.plan_type || 'free'] || 0) + 1;
        totalChats += u.daily_count || 0;
      }
      const totalUsers = planCounts.free + planCounts.starter + planCounts.pro;
      const monthlyRevenue = planCounts.starter * 4900 + planCounts.pro * 14900;
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT,
          text: `📊 <b>NOVA 일일 요약</b>\n\n👥 총 유저: <b>${totalUsers}명</b> (+${Array.isArray(newUsers) ? newUsers.length : 0} 신규)\n⚪ 무료: ${planCounts.free}명 · 💙 스타터: ${planCounts.starter}명 · 💜 프로: ${planCounts.pro}명\n💬 오늘 채팅: <b>${totalChats}회</b>\n💰 월 예상 수익: <b>₩${monthlyRevenue.toLocaleString('ko-KR')}</b>`,
          parse_mode: 'HTML',
        }),
      }).catch(() => {});
    } catch { /* 요약 실패는 무시 */ }
  }

  return new Response(JSON.stringify({
    ok: failures.length === 0,
    checked: results.length,
    failures: failures.length,
    results,
    timestamp: new Date().toISOString(),
  }), {
    status: failures.length === 0 ? 200 : 503,
    headers: { 'content-type': 'application/json' }
  });
}
