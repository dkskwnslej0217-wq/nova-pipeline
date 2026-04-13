/**
 * api/kmong-monitor.js
 * 크몽 계정 모니터링 — 새 메시지/주문/서비스 승인반려 → 텔레그램 알림
 *
 * 환경변수:
 *   KMONG_COOKIE_STRING  — kmong_cookies.json 의 쿠키 전체 ('; '로 연결된 문자열)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY — 이전 상태 저장
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   PIPELINE_SECRET — 수동 호출 시 ?secret= 인증
 */

export const config = { runtime: 'nodejs', maxDuration: 30 };

const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;
const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SECRET    = process.env.PIPELINE_SECRET;

// ── 텔레그램 ──────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: `[크몽] ${text}`, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('텔레그램 전송 실패:', e.message);
  }
}

// ── Supabase kv ────────────────────────────────────────────
const supaHeaders = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

async function kvGet(key) {
  const res = await fetch(`${SUPA_URL}/rest/v1/kmong_state?key=eq.${key}&select=value`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

async function kvSet(key, value) {
  await fetch(`${SUPA_URL}/rest/v1/kmong_state`, {
    method: 'POST',
    headers: { ...supaHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

// ── 크몽 토큰 갱신 ────────────────────────────────────────
async function refreshToken(cookieString) {
  const res = await fetch('https://kid.kmong.com/api/authentication/v1/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://kmong.com/',
      'Origin': 'https://kmong.com',
    },
  });
  if (res.status >= 400) throw new Error(`토큰 갱신 실패: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const newMatch = setCookie.match(/x-kmong-authorization=([^;]+)/);
  if (newMatch) return newMatch[1];
  // Set-Cookie에 없으면 기존 쿠키에서 추출 (202 응답 등)
  const existingMatch = cookieString.match(/x-kmong-authorization=([^;]+)/);
  if (existingMatch) return existingMatch[1];
  throw new Error('토큰 추출 실패 (Set-Cookie & 기존 쿠키 모두 없음)');
}

// ── 크몽 API 호출 ─────────────────────────────────────────
async function kmongFetch(path, accessToken, cookieString) {
  const url = path.startsWith('http') ? path : `https://kmong.com${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://kmong.com/',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`API 오류: ${res.status} ${path}`);
  return res.json();
}

// ── 메인 핸들러 ───────────────────────────────────────────
export default async function handler(req) {
  // 인증
  const url = new URL(req.url);
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const secret = url.searchParams.get('secret') ?? '';
  if (!isVercelCron && secret !== SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 쿠키 로드: Supabase 우선, 없으면 env 폴백
  let cookieString = await kvGet('cookie_string') || process.env.KMONG_COOKIE_STRING;
  if (!cookieString) {
    return new Response(JSON.stringify({ error: 'KMONG_COOKIE_STRING not set (Supabase & env 모두 없음)' }), { status: 500 });
  }

  try {
    // 1. 토큰 갱신
    const accessToken = await refreshToken(cookieString);
    const updatedCookies = cookieString.replace(
      /x-kmong-authorization=[^;]*/g,
      `x-kmong-authorization=${accessToken}`
    );

    // 갱신된 쿠키를 Supabase에 저장 (다음 실행 때 사용)
    await kvSet('cookie_string', updatedCookies);
    cookieString = updatedCookies;

    // 2. 병렬로 API 조회
    const [alarms, proposalsData, kmongNotifs] = await Promise.all([
      kmongFetch('/api/user/v2/unread-alarms', accessToken, updatedCookies),
      kmongFetch(
        '/api/custom-project/v1/seller/proposals?page=1&filter=ALL&meetingStatus=ALL&isNotRespond=false',
        accessToken, updatedCookies
      ).catch(() => ({ unrepliedMeetings: 0, totalCount: 0 })),
      kmongFetch('/api/v5/user/notifications?type=KMONG&page=1', accessToken, updatedCookies)
        .catch(() => ({ notifications: [] })),
    ]);

    const current = {
      inboxes:          alarms.inboxes || 0,
      orders:           alarms.order_count || 0,
      kmong:            alarms.kmong_count || 0,
      unrepliedProposals: proposalsData.unrepliedMeetings || 0,
      totalProposals:   proposalsData.totalCount || 0,
    };

    // 3. 이전 상태 로드
    const prevRaw = await kvGet('alarms');
    const prev = prevRaw ? JSON.parse(prevRaw) : { inboxes: 0, orders: 0, kmong: 0, unrepliedProposals: 0 };

    const msgs = [];

    if (current.inboxes > (prev.inboxes || 0)) {
      msgs.push(`💬 새 쪽지 ${current.inboxes - (prev.inboxes||0)}개 도착`);
    }
    if (current.unrepliedProposals > (prev.unrepliedProposals || 0)) {
      msgs.push(`📩 새 견적 요청 ${current.unrepliedProposals - (prev.unrepliedProposals||0)}개\n   → kmong.com/seller/proposals 확인`);
    }
    if (current.orders > (prev.orders || 0)) {
      msgs.push(`🛒 새 주문 ${current.orders - (prev.orders||0)}개`);
    }

    // 크몽 알림 중 새 GIG_REJECTED / GIG_APPROVED 찾기
    const newKmongNotifs = (kmongNotifs.notifications || []).filter(n =>
      n.theme === 'NOTIFICATION' && n.is_unread
    );
    for (const n of newKmongNotifs) {
      if (n.type === 'GIG_REJECTED') {
        msgs.push(`❌ 서비스 비승인: PID ${n.PID}\n   "${n.message}"`);
      } else if (n.type === 'GIG_APPROVED') {
        msgs.push(`✅ 서비스 승인: PID ${n.PID}`);
      }
    }

    // 4. 알림 전송
    if (msgs.length > 0) {
      await sendTelegram(msgs.join('\n\n'));
    }

    // 5. 상태 저장
    await kvSet('alarms', JSON.stringify(current));
    await kvSet('last_check', new Date().toISOString());

    const result = {
      ok: true,
      current,
      prev,
      notified: msgs.length > 0,
      messages: msgs,
    };
    console.log('[kmong-monitor]', JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[kmong-monitor] 오류:', e.message);
    await sendTelegram(`⚠️ 크몽 모니터 오류: ${e.message}`);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
