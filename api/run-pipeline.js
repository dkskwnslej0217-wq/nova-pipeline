// api/run-pipeline.js — Make.com 스케줄 트리거 엔드포인트
// Make.com → 매일 오전 8시 → 이 엔드포인트 호출 → 파이프라인 실행 → Telegram 결과 알림

export const config = { runtime: 'nodejs', maxDuration: 300 };

const YOUTUBE_KEY   = process.env.YOUTUBE_API_KEY;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const GROQ_KEY      = process.env.GROQ_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_SERVICE_KEY;
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const TG_CHAT       = process.env.TELEGRAM_CHAT_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const GITHUB_REPO     = process.env.GITHUB_REPO || 'dkskwnslej0217-wq/nova-pipeline';

// ─── 중국어/외계어 제거 필터 ──────────────────────────────
function filterKoreanOnly(text) {
  return text
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, '') // CJK 한자
    .replace(/[\u3000-\u303F]/g, '') // CJK 구두점
    .replace(/[\u0600-\u06FF\u0750-\u077F]/g, '') // 아랍어
    .replace(/[\u0400-\u04FF]/g, '') // 러시아어(키릴)
    .replace(/[\u0900-\u097F]/g, '') // 힌디어
    .replace(/[\u0080-\u00FF]/g, '') // 라틴 확장 특수문자
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Telegram 알림 ────────────────────────────────────────
async function tg(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
  } catch { /* 알림 실패는 무시 */ }
}

// ─── 14a: YouTube TOP10 ───────────────────────────────────
async function fetchTrending() {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&maxResults=10&key=${YOUTUBE_KEY}`
  );
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  const data = await res.json();
  return data.items.map(i => i.snippet.title);
}

// ─── 14b: Gemini 키워드 추출 ─────────────────────────────
async function extractKeywords(titles) {
  const prompt = `아래는 현재 한국 유튜브 급상승 영상 제목들입니다:\n${titles.join('\n')}\n\nSNS 콘텐츠(스레드/인스타/유튜브쇼츠)에 활용할 핵심 키워드 5개 추출. 단어만, 쉼표 구분.`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// ─── 14c: Groq 훅 초안 ───────────────────────────────────
async function generateHooks(keywords) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: '너는 30대 한국 1인 창업자야. 친구한테 카톡 보내듯이 써. 격식 없이, 짧게, 진짜 사람이 쓴 것처럼. 한국어만. 중국어/영어/아랍어 절대 금지.' },
        { role: 'user', content: `키워드: ${keywords}\n\n스레드 첫 줄 훅 3개. 40자 이내. 번호 붙여서. 친구한테 말하듯 자연스럽게.` }
      ],
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── 14d: 최종 완성 (Groq 우선 → 실패 시 Claude 폴백) ──────
async function finalizeContent(keywords, hooks) {
  const prompt = `너는 30대 한국 1인 창업자야. 한국어만 써. 중국어/영어/아랍어 절대 금지.\n\n키워드: ${keywords}\n\n훅 후보:\n${hooks}\n\n제일 자연스러운 훅 1개 골라서 스레드 글 완성해줘:\n첫줄: 훅 (친구한테 말하듯)\n본문: 3~4줄, 짧고 진짜 경험담처럼\n마지막: 공감 유도 or 질문 1줄\n\n절대 AI 같은 말투 금지. 진짜 사람이 쓴 것처럼.`;

  // 1차: Groq (무료)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices[0].message.content;
    }
  } catch { /* Groq 실패 → Claude 폴백 */ }

  // 2차: Claude Haiku (유료 폴백)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content[0].text;
}

// ─── Supabase 저장 ────────────────────────────────────────
async function saveToSupabase(topic, content) {
  try {
    await fetch(`${SUPA_URL}/rest/v1/cache`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hash: btoa(topic).slice(0, 32),
        topic,
        content: content.slice(0, 1000),
        score: 1,
      }),
    });
  } catch { /* 저장 실패는 파이프라인 중단하지 않음 */ }
}

// ─── 메인 핸들러 ──────────────────────────────────────────
export default async function handler(req) {
  // 보안: 시크릿 토큰 검증 (Make.com 웹훅에서 헤더로 전달)
  const secret = req.headers.get('x-pipeline-secret');
  if (secret !== PIPELINE_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // 매일 → daily_count 리셋 / 매월 1일 → monthly_count 추가 리셋
  const today = new Date();
  try {
    if (today.getDate() === 1) {
      // 월 1일: last_month_count 백업 + monthly_count 리셋 (원자적 RPC)
      await fetch(`${SUPA_URL}/rest/v1/rpc/reset_monthly_counts`, {
        method: 'POST',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await tg(`✅ 일/월 사용량 초기화 완료 (${today.toISOString().slice(0, 7)})`);
    } else {
      // 매일: daily_count가 0보다 큰 유저만 리셋 (전체 업데이트 방지)
      await fetch(`${SUPA_URL}/rest/v1/users?daily_count=gt.0`, {
        method: 'PATCH',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ daily_count: 0 }),
      });
      await tg(`✅ 일 사용량 초기화 완료 (${today.toISOString().slice(0, 10)})`);
    }
  } catch(e) {
    await tg(`⚠️ 사용량 초기화 실패\n${e.message}`);
  }

  // 플랫폼 유저수 동기화 (레벨 자동 갱신)
  try {
    await fetch('https://my-project-xi-sand-93.vercel.app/api/platform', {
      method: 'POST',
      headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch { /* 동기화 실패는 파이프라인 중단 안 함 */ }

  const startedAt = new Date().toISOString();
  await tg(`🚀 NOVA 파이프라인 시작 (${startedAt.slice(0, 16)})`);

  try {
    // 14a YouTube
    let titles;
    try {
      titles = await fetchTrending();
    } catch(e) {
      await tg(`⚠️ YouTube 수집 실패 → 기본 주제로 폴백\n${e.message}`);
      titles = null;
    }

    // 14b Gemini
    let keywords;
    try {
      keywords = await extractKeywords(titles ?? ['AI 자동화', '콘텐츠 수익화', '1인 창업']);
    } catch(e) {
      await tg(`⚠️ Gemini 실패 → 기본 키워드 사용\n${e.message}`);
      keywords = 'AI자동화, 콘텐츠수익, 1인창업, SNS마케팅';
    }

    // 14c Groq
    const hooksRaw = await generateHooks(keywords);
    const hooks = filterKoreanOnly(hooksRaw);

    // 14d Claude
    const finalRaw = await finalizeContent(keywords, hooks);
    const final = filterKoreanOnly(finalRaw);

    // Supabase 저장
    const topic = keywords.split(',')[0].trim();
    await saveToSupabase(topic, final);

    // 유저 수 체크 → 100명 도달 시 알림
    try {
      const userRes = await fetch(`${SUPA_URL}/rest/v1/users?select=count`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Prefer': 'count=exact' },
      });
      const count = parseInt(userRes.headers.get('content-range')?.split('/')[1] ?? '0');
      if (count >= 100) {
        await tg(`🎉 유저 100명 돌파! (현재 ${count}명)\n👉 토스페이먼츠 자동 결제 연동할 때입니다.`);
      }
    } catch { /* 체크 실패는 무시 */ }

    // GitHub Actions 영상 파이프라인 트리거
    try {
      const dispatchRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_type: 'create-video',
            client_payload: {
              text: final.slice(0, 2500),
              title: `NOVA AI — ${topic}`,
              tags: keywords.split(',').map(k => k.trim()).join(','),
            },
          }),
        }
      );
      if (dispatchRes.ok) {
        await tg(`🎬 영상 파이프라인 트리거 완료`);
      } else {
        await tg(`⚠️ 영상 트리거 실패: ${dispatchRes.status}`);
      }
    } catch(e) {
      await tg(`⚠️ 영상 트리거 오류: ${e.message}`);
    }

    // Threads 발행
    try {
      const threadsRes = await fetch('https://nova-pipeline-two.vercel.app/api/post-threads', {
        method: 'POST',
        headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: final.slice(0, 500) }),
      });
      const threadsData = await threadsRes.json();
      if (threadsData.ok) {
        await tg(`📱 Threads 발행 완료 (post_id: ${threadsData.post_id})`);
      } else {
        await tg(`⚠️ Threads 발행 실패: ${threadsData.error}`);
      }
    } catch(e) {
      await tg(`⚠️ Threads 발행 오류: ${e.message}`);
    }

    // 성공 알림
    await tg(`✅ NOVA 파이프라인 완료\n\n📌 키워드: ${keywords}\n\n${final.slice(0, 300)}...`);

    return new Response(JSON.stringify({ ok: true, topic, keywords }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch(e) {
    await tg(`❌ NOVA 파이프라인 실패\n${e.message}`);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
