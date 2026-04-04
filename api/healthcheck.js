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

  // 전체 정상이면 간단 OK 알림 (하루 1번)
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
