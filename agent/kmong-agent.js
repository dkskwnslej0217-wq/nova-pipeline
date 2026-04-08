// agent/kmong-agent.js — 크몽 주문/메시지 자동 확인
// Claude Agent SDK + Playwright MCP
// 역할: 크몽 로그인 → 새 주문/메시지 확인 → AI 자동 응답 → TG 알림

import { query } from '@anthropic-ai/claude-agent-sdk';

const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT     = process.env.TELEGRAM_CHAT_ID;
const KMONG_EMAIL = process.env.KMONG_EMAIL;
const KMONG_PW    = process.env.KMONG_PASSWORD;

async function tg(msg) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
  }).catch(() => {});
}

async function main() {
  if (!KMONG_EMAIL || !KMONG_PW) {
    console.log('[Kmong] KMONG_EMAIL / KMONG_PASSWORD 환경변수 없음. 스킵.');
    return;
  }

  console.log('[Kmong] 크몽 자동 에이전트 시작...');
  let agentResult = '';

  for await (const msg of query({
    prompt: `
당신은 크몽(kmong.com) 자동화 에이전트입니다.
Playwright로 브라우저를 열고 아래 작업을 순서대로 수행하세요.

## 로그인
1. https://www.kmong.com 접속
2. 로그인 버튼 클릭
3. 이메일: ${KMONG_EMAIL}
4. 비밀번호: ${KMONG_PW}
5. 로그인 완료 확인

## 주문 확인
6. 판매 관리 → 주문 목록 이동
7. "새 주문" 또는 "진행 중" 상태의 주문 목록 파악
8. 새 주문이 있으면 목록을 텍스트로 출력 (주문번호, 서비스명, 요청사항)

## 메시지 확인
9. 메시지함 이동
10. 읽지 않은 메시지 목록 확인
11. 새 메시지가 있으면 내용 출력

## 결과 출력
마지막에 아래 형식으로 요약 출력:
KMONG_RESULT:
- 새 주문: N건 [주문번호 목록]
- 새 메시지: N건 [발신자 목록]
- 긴급 처리 필요: YES/NO
    `,
    options: {
      permissionMode: 'acceptEdits',
      model: 'claude-sonnet-4-6',
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['@playwright/mcp@latest', '--headless'],
        },
      },
    },
  })) {
    if (msg.type === 'result') {
      agentResult = msg.result ?? '';
    } else if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
      }
    }
  }

  // 결과 파싱 & TG 알림
  if (agentResult.includes('KMONG_RESULT:')) {
    const section = agentResult.split('KMONG_RESULT:')[1].trim();
    const hasNewOrders = !section.includes('새 주문: 0건');
    const hasNewMessages = !section.includes('새 메시지: 0건');
    const urgent = section.includes('긴급 처리 필요: YES');

    if (hasNewOrders || hasNewMessages || urgent) {
      await tg(`🛒 크몽 알림\n\n${section}\n\n👉 kmong.com 확인 필요`);
    } else {
      console.log('[Kmong] 새 주문/메시지 없음');
    }
  } else {
    await tg(`⚠️ 크몽 에이전트 결과 파싱 실패\n${agentResult.slice(0, 200)}`);
  }

  console.log('[Kmong] 완료');
}

main().catch(e => {
  console.error('Kmong 에이전트 오류:', e.message);
  tg(`❌ 크몽 에이전트 오류\n${e.message}`);
});
