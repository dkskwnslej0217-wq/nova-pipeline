// api/debug.js — 파이프라인 환경변수 확인 + Telegram 즉시 테스트
// 사용: GET /api/debug?secret=<PIPELINE_SECRET>

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-pipeline-secret'];
  if (secret !== process.env.PIPELINE_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

  // 환경변수 존재 여부 (값은 노출 안 함)
  const envCheck = {
    TELEGRAM_BOT_TOKEN:   !!process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_TOKEN:       !!process.env.TELEGRAM_TOKEN,
    TELEGRAM_CHAT_ID:     !!TG_CHAT,
    TG_CHAT_VALUE:        TG_CHAT ? `${TG_CHAT.slice(0, 4)}...` : 'MISSING',
    GROQ_API_KEY:         !!process.env.GROQ_API_KEY,
    GEMINI_API_KEY:       !!process.env.GEMINI_API_KEY,
    SUPABASE_URL:         !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    PIPELINE_SECRET:      !!process.env.PIPELINE_SECRET,
    GITHUB_TOKEN:         !!process.env.GITHUB_TOKEN,
  };

  // Telegram 실제 전송 테스트
  let tgResult = 'skipped';
  if (TG_TOKEN && TG_CHAT) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 5000);
      const tgRes = await fetch(
        `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHAT, text: '🧪 NOVA debug test — Telegram 정상 작동 중' }),
          signal: ctrl.signal,
        }
      ).finally(() => clearTimeout(id));
      const body = await tgRes.json();
      tgResult = tgRes.ok ? 'ok' : `error ${tgRes.status}: ${JSON.stringify(body)}`;
    } catch (e) {
      tgResult = `exception: ${e.message}`;
    }
  } else {
    tgResult = `missing vars — TOKEN:${!!TG_TOKEN} CHAT:${!!TG_CHAT}`;
  }

  return res.status(200).json({ envCheck, tgResult, ts: new Date().toISOString() });
}
