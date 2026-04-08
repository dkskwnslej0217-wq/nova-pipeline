// agent/run-agents.js — Claude Agent SDK 병렬 클라이언트 처리
// GitHub Actions에서 실행 (Node.js 24, npm install 후)
// 역할: 모든 활성 클라이언트를 병렬로 처리, 실패 시 자동 재시도

import { query } from '@anthropic-ai/claude-agent-sdk';

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

// ─── Supabase에서 활성 클라이언트 로드 ───────────────────
async function loadClients() {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/clients?active=eq.true&select=id,name,niche,tg_chat_id`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  return r.json();
}

// ─── 단일 클라이언트 Agent 실행 ───────────────────────────
async function runClientAgent(client) {
  console.log(`\n[Agent] 시작: ${client.name}`);
  const startMs = Date.now();

  try {
    let result = '';
    for await (const msg of query({
      prompt: `
당신은 NOVA AI 파이프라인 에이전트입니다.
클라이언트: ${client.name} (주제: ${client.niche})
client_id: ${client.id}

아래 curl 명령어를 실행하여 파이프라인을 트리거하세요:
curl -s -X POST "${BASE_URL}/api/run-client?client_id=${client.id}" \\
  -H "x-pipeline-secret: ${PIPELINE_SECRET}" \\
  -H "Content-Type: application/json" \\
  --max-time 280

응답 JSON을 확인하세요:
- ok: true → 성공
- ok: false → 에러 메시지 출력 후 1회 재시도

재시도도 실패하면 "FAILED: [에러내용]" 출력.
성공하면 "SUCCESS: igStatus fbStatus" 출력.
      `,
      options: {
        allowedTools: ['Bash'],
        permissionMode: 'acceptEdits',
        model: 'claude-haiku-4-5-20251001', // 비용 최소화
      },
    })) {
      if (msg.type === 'result') result = msg.result ?? '';
      else if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text') process.stdout.write(block.text);
        }
      }
    }

    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const success = result.includes('SUCCESS') || result.includes('ok":true');
    console.log(`\n[Agent] 완료: ${client.name} (${elapsed}초) — ${success ? '✅' : '❌'}`);
    return { client: client.name, success, elapsed };

  } catch (e) {
    console.error(`[Agent] 실패: ${client.name} — ${e.message}`);
    await tg(client.tg_chat_id, `❌ 에이전트 실패 (${client.name})\n${e.message}`);
    return { client: client.name, success: false, error: e.message };
  }
}

// ─── 메인 ────────────────────────────────────────────────
async function main() {
  const clients = await loadClients();
  console.log(`[Agent] 활성 클라이언트 ${clients.length}명 병렬 처리 시작`);

  if (!clients.length) {
    console.log('[Agent] 클라이언트 없음. 종료.');
    return;
  }

  // 모든 클라이언트 병렬 실행
  const results = await Promise.allSettled(clients.map(runClientAgent));

  // 요약 리포트
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
