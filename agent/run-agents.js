// agent/run-agents.js — 클라이언트별 Vercel 파이프라인 트리거
// Claude Agent SDK 제거 → fetch() 직접 호출 (ANTHROPIC_API_KEY 불필요)

const SUPA_URL        = process.env.SUPABASE_URL;
const SUPA_KEY        = process.env.SUPABASE_SERVICE_KEY;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const TG_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT         = process.env.TELEGRAM_CHAT_ID;
const BASE_URL        = 'https://nova-pipeline-two.vercel.app';

async function tg(chat, msg) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: msg }),
  }).catch(() => {});
}

async function loadClients() {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/clients?active=eq.true&select=id,name,niche,tg_chat_id`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  return r.json();
}

async function runClientAgent(client) {
  console.log(`\n[Agent] 시작: ${client.name}`);
  const startMs = Date.now();

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 290000);
      const res = await fetch(
        `${BASE_URL}/api/run-client?client_id=${client.id}`,
        {
          method: 'POST',
          headers: {
            'x-pipeline-secret': PIPELINE_SECRET,
            'Content-Type': 'application/json',
          },
          signal: ctrl.signal,
        }
      );
      clearTimeout(timer);

      const data = await res.json().catch(() => ({}));
      const elapsed = Math.round((Date.now() - startMs) / 1000);

      if (data.ok) {
        console.log(`[Agent] 완료: ${client.name} (${elapsed}초) — ✅`);
        return { client: client.name, success: true, elapsed };
      }

      console.warn(`[Agent] 실패 (${attempt}/2): ${client.name} — ${data.error || res.status}`);
      if (attempt === 2) {
        await tg(client.tg_chat_id, `❌ 에이전트 실패 (${client.name})\n${data.error || '응답 오류'}`);
        return { client: client.name, success: false, error: data.error };
      }

    } catch (e) {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.error(`[Agent] 예외 (${attempt}/2): ${client.name} — ${e.message}`);
      if (attempt === 2) {
        await tg(client.tg_chat_id, `❌ 에이전트 예외 (${client.name})\n${e.message}`);
        return { client: client.name, success: false, error: e.message };
      }
    }
  }
}

async function main() {
  const clients = await loadClients();
  console.log(`[Agent] 활성 클라이언트 ${clients.length}명 병렬 처리 시작`);

  if (!clients.length) {
    console.log('[Agent] 클라이언트 없음. 종료.');
    return;
  }

  const results = await Promise.allSettled(clients.map(runClientAgent));

  const success = results.filter(r => r.value?.success).length;
  const fail = results.length - success;
  const summary = `🤖 Agent 파이프라인 완료\n✅ ${success}명 성공 | ❌ ${fail}명 실패\n총 ${clients.length}명`;

  await tg(TG_CHAT, summary);
  console.log(`\n${summary}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
