/**
 * /api/log — 중앙 이벤트 로거
 * Claude가 생성한 결과물을 받아서 Make.com으로 전달
 * Make.com이 Supabase + 구글시트 동시 저장 처리
 *
 * 호출 예시:
 * POST /api/log
 * { "type": "content", "platform": "threads", "title": "...", "body": "..." }
 */
export const config = { runtime: 'edge' };

const ALLOWED_TYPES = ['content', 'subscriber', 'payment', 'upload', 'error', 'feedback'];

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 내부 호출 검증 — LOG_SECRET 헤더 확인
  const secret = req.headers.get('x-log-secret') ?? '';
  if (!process.env.LOG_SECRET || secret !== process.env.LOG_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: '잘못된 요청' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { type, ...data } = body;

  if (!type || !ALLOWED_TYPES.includes(type)) {
    return new Response(JSON.stringify({ error: `type은 ${ALLOWED_TYPES.join('|')} 중 하나여야 합니다.` }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const payload = {
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Make.com으로 전달 — Make.com이 Supabase + 구글시트 처리
  const makeRes = await fetch(process.env.MAKE_SHEETS_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!makeRes.ok) {
    return new Response(JSON.stringify({ error: 'Make.com 전달 실패' }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ ok: true, type, timestamp: payload.timestamp }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
