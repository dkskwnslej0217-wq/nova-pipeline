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

// 토큰 만료일 (Unix timestamp) — Vercel 환경변수로 관리
const TOKEN_EXPIRES = {
  threads:   process.env.THREADS_TOKEN_EXPIRES_AT,
  instagram: process.env.INSTAGRAM_TOKEN_EXPIRES_AT,
  facebook:  process.env.FACEBOOK_TOKEN_EXPIRES_AT,
};

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

// ─── 인스타 상위 게시물 분석 ──────────────────────────────
async function fetchInstagramTop() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igId  = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!token || !igId) return [];
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${igId}/media?fields=caption,like_count&limit=20&access_token=${token}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || [])
    .filter(p => p.like_count > 0)
    .sort((a, b) => b.like_count - a.like_count)
    .slice(0, 5)
    .map(p => `좋아요${p.like_count}: ${(p.caption || '').split('\n')[0].slice(0, 50)}`);
}

// ─── Supabase 트렌드 누적 저장 ───────────────────────────
async function saveTrends(hnTrends, ghTrends, redditTrends) {
  const items = [
    ...hnTrends.map(t => ({ source: 'hn', title: t.slice(0, 200) })),
    ...ghTrends.map(t => ({ source: 'github', title: t.slice(0, 200) })),
    ...redditTrends.map(t => ({ source: 'reddit', title: t.slice(0, 200) })),
  ];
  if (!items.length) return;
  await fetch(`${SUPA_URL}/rest/v1/trends`, {
    method: 'POST',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  });
}

// ─── 14a-2: Reddit AI 트렌드 ─────────────────────────────
async function fetchRedditTrends() {
  const subs = ['artificial', 'ChatGPT', 'SideProject'];
  const results = [];
  for (const sub of subs) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/hot.json?limit=5`,
        { headers: { 'User-Agent': 'nova-pipeline/1.0' } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data.data.children
        .map(p => p.data.title)
        .filter(t => t.length < 120);
      results.push(...posts.slice(0, 2));
    } catch { continue; }
  }
  return results.slice(0, 6);
}

// ─── 14a-3: HackerNews AI 트렌드 ─────────────────────────
async function fetchHNTrends() {
  const idsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!idsRes.ok) throw new Error(`HN ${idsRes.status}`);
  const ids = await idsRes.json();

  const stories = await Promise.all(
    ids.slice(0, 30).map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()).catch(() => null)
    )
  );

  const aiKeywords = ['ai', 'llm', 'gpt', 'automation', 'agent', 'claude', 'openai', 'gemini', 'workflow', 'machine learning'];
  return stories
    .filter(s => s?.title && aiKeywords.some(k => s.title.toLowerCase().includes(k)))
    .slice(0, 5)
    .map(s => s.title);
}

// ─── 14a-3: GitHub AI 트렌딩 레포 ────────────────────────
async function fetchGitHubTrends() {
  const res = await fetch(
    'https://api.github.com/search/repositories?q=topic:artificial-intelligence+topic:automation&sort=stars&order=desc&per_page=5',
    { headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `Bearer ${GITHUB_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(r => `${r.name}: ${r.description || ''}`).slice(0, 5);
}

// ─── 14b: Gemini 키워드 추출 ─────────────────────────────
async function extractKeywords(titles, hnTrends = [], ghTrends = [], redditTrends = [], igTop = []) {
  const ytSection = titles?.length ? `[한국 유튜브 인기]\n${titles.join('\n')}` : '';
  const hnSection = hnTrends.length ? `[HackerNews AI 트렌드]\n${hnTrends.join('\n')}` : '';
  const ghSection = ghTrends.length ? `[GitHub AI 인기 레포]\n${ghTrends.join('\n')}` : '';
  const rdSection = redditTrends.length ? `[Reddit AI 커뮤니티 반응]\n${redditTrends.join('\n')}` : '';
  const igSection = igTop.length ? `[내 인스타 반응 좋은 글 패턴]\n${igTop.join('\n')}` : '';
  const context = [ytSection, hnSection, ghSection, rdSection, igSection].filter(Boolean).join('\n\n');

  const prompt = `아래는 오늘의 글로벌/한국 AI·자동화 트렌드입니다:\n${context}\n\n"AI 부업 자동화" 분야 한국 직장인 타겟 SNS 콘텐츠에 활용할 핵심 키워드 5개 추출. 반드시 AI자동화/부업/월급외수익/직장인/시간절약 중심으로. 단어만, 쉼표 구분.`;
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

// ─── 키워드 → 영어 이미지 프롬프트 ──────────────────────────
const KR_EN_IMG = {
  'AI자동화':   'artificial intelligence automation technology futuristic',
  '콘텐츠수익': 'content creator earning money laptop studio',
  '1인창업':   'solo entrepreneur startup office minimal',
  'SNS마케팅':  'social media marketing digital phone screen',
  '재테크':    'investment finance wealth modern city',
  '부업':      'side hustle income freelance work',
  '직장인':    'professional office worker Korean modern',
  '시간절약':  'time saving efficiency productivity',
  '월급외수익': 'passive income side income money growth',
  '트렌드':    'trending modern technology lifestyle',
  '미래':      'futuristic technology abstract',
};

function buildImagePromptFromKeywords(keywords) {
  const tags = keywords.split(',').map(k => k.trim());
  const en = tags.map(t => KR_EN_IMG[t] || t).filter(Boolean);
  return en.slice(0, 2).join(', ') + ', Korean aesthetic, modern minimalist, high quality, 4k, no text, no watermark';
}

// ─── 콘텐츠 타입 랜덤 선택 ────────────────────────────────
function getContentType() {
  const types = [
    { name: '공감형', hook: '많은 사람이 겪는 상황을 콕 집어서 시작. "나만 그런 거 아니었구나" 느낌.', body: '구체적인 상황 묘사. 감정 솔직하게. 억지 긍정 없이.' },
    { name: '정보형', hook: '몰랐으면 손해볼 뻔한 정보. 제목처럼 명확하게.', body: '핵심 정보 2~3가지. 짧고 실용적으로. 리스트 말고 문장으로.' },
    { name: '스토리형', hook: '실제로 있었던 일처럼 시작. "지난주에..." "어제..." 식으로.', body: '상황 → 문제 → 깨달음 흐름. 결말은 열린 질문으로.' },
    { name: '도발형', hook: '흔한 믿음을 정면으로 반박. "사실 이건 틀렸어" 식으로.', body: '왜 틀렸는지 근거 1~2개. 내 경험 또는 데이터로.' },
  ];
  return types[Math.floor(Math.random() * types.length)];
}

// ─── 플랫폼별 프롬프트 ────────────────────────────────────
function getPlatformPrompts(keywords, hooks, type) {
  const base = `
너는 "AI 부업 자동화" 분야 한국 SNS 전문가야.
타겟: 월급 받는 직장인, 부업 원하는 20~40대.
주제: AI 자동화로 시간 아끼고 돈 버는 실용적인 팁.

맞춤법 완벽. 오타 절대 금지. 한국어만.
절대 금지: "안녕하세요" "여러분" "오늘은" "~요" "~습니다" "확실히" "물론" "당연히" "함께해요"
AI 티 나는 표현 금지. 진짜 직장인이 쓴 것처럼.
키워드: ${keywords}
훅 후보: ${hooks}
콘텐츠 타입: ${type.name} — ${type.hook}`;

  return {
    instagram: `${base}

Instagram 캡션 작성 (저장율·공유율 극대화):

형식 예시:
⚡ [스크롤 멈추는 훅 — 숫자나 반전 포함, 20자 이내]

→ [핵심 팁 한 줄]
→ [핵심 팁 한 줄]
→ [핵심 팁 한 줄]

💾 [저장각 한 줄 — "이거 모르면 손해" 류]

규칙:
- 이모지 줄마다 1개씩 (총 4~6개)
- 줄바꿈 꼭 넣기 (빽빽하면 안 읽음)
- 해시태그 없이
- 총 150자 이내
- "→" 앞에 줄바꿈 필수`,

    facebook: `${base}

Facebook 게시글 작성:
- 첫 줄: "나도 처음엔 몰랐는데" 식의 공감 훅
- 본문: AI로 실제로 시간/돈 절약한 사례 스토리 3~4줄
- 마지막: "너도 해봤어?" 식의 댓글 유도 질문
- 이모지 1~2개
- 총 180자 이내`,

    youtube: `${base}

YouTube Shorts 나레이션 작성:
- 첫 문장: "직장 다니면서 이걸로 월 N만원 벌었어" 식의 도입
- 본문: AI 자동화 팁 3~4문장, 말하듯 자연스럽게
- 마무리: 여운 있는 한 줄 (구독 유도 없이)
- 총 150자 이내
- 오타, 비문 절대 금지`,
  };
}

// ─── 14c: Groq 훅 초안 ───────────────────────────────────
async function generateHooks(keywords) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. 오타 없음. AI 티 절대 금지. 진짜 사람 말투. 한국어만.' },
        { role: 'user', content: `키워드: ${keywords}\n\n첫 줄 훅 3개. 각 25자 이내. 번호 없이. 스크롤 멈추게 되는 문장으로. 오타 없이.` }
      ],
      max_tokens: 300,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── 14d: 최종 완성 (Groq 우선 → 실패 시 Claude 폴백) ──────
async function finalizeContent(keywords, hooks) {
  const type = getContentType();
  const prompts = getPlatformPrompts(keywords, hooks, type);

  // Instagram/Facebook/YouTube 각각 생성
  async function generate(prompt) {
    // 1차: Groq
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.8,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices[0].message.content;
      }
    } catch { /* 폴백 */ }

    // 2차: Claude
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}`);
    const data = await res.json();
    return data.content[0].text;
  }

  const [igText, fbText, ytText] = await Promise.all([
    generate(prompts.instagram),
    generate(prompts.facebook),
    generate(prompts.youtube),
  ]);

  return { igText, fbText, ytText };
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
        hash: `${btoa(encodeURIComponent(topic)).slice(0, 24)}_${Date.now()}`,
        topic,
        content: content.slice(0, 1000),
        score: 1,
      }),
    });
  } catch { /* 저장 실패는 파이프라인 중단하지 않음 */ }
}

// ─── 메인 핸들러 ──────────────────────────────────────────
export default async function handler(req, res) {
  // 보안: 시크릿 토큰 검증 (Make.com 웹훅 or Vercel Cron)
  const secret = req.headers['x-pipeline-secret'];
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
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

  // 토큰 만료 7일 전 경고
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  for (const [platform, expiresAt] of Object.entries(TOKEN_EXPIRES)) {
    if (!expiresAt) continue;
    const exp = parseInt(expiresAt) * 1000;
    const daysLeft = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 7) {
      await tg(`⚠️ ${platform.toUpperCase()} 토큰 만료 ${daysLeft}일 전! 지금 갱신하세요.`);
    }
  }

  const startedAt = new Date().toISOString();
  await tg(`🚀 NOVA 파이프라인 시작 (${startedAt.slice(0, 16)})`);

  try {
    // 14a 트렌드 수집 (YouTube + HackerNews + GitHub 병렬)
    const [titles, hnTrends, ghTrends, redditTrends, igTop] = await Promise.all([
      fetchTrending().catch(e => { tg(`⚠️ YouTube 수집 실패\n${e.message}`); return null; }),
      fetchHNTrends().catch(e => { tg(`⚠️ HN 수집 실패\n${e.message}`); return []; }),
      fetchGitHubTrends().catch(e => { tg(`⚠️ GitHub 수집 실패\n${e.message}`); return []; }),
      fetchRedditTrends().catch(e => { tg(`⚠️ Reddit 수집 실패 → 폴백\n${e.message}`); return []; }),
      fetchInstagramTop().catch(e => { tg(`⚠️ 인스타 분석 실패 (권한 확인 필요)\n${e.message}`); return []; }),
    ]);
    const trendSummary = [
      hnTrends.length     ? `🔥 HN:\n${hnTrends.slice(0,3).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      redditTrends.length ? `💬 Reddit:\n${redditTrends.slice(0,2).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      ghTrends.length     ? `⭐ GitHub:\n${ghTrends.slice(0,2).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      igTop.length        ? `📊 내 인스타 반응 상위:\n${igTop.slice(0,3).map(t => `• ${t}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    await tg(`📡 트렌드 수집 완료\n\n${trendSummary}`);
    saveTrends(hnTrends, ghTrends, redditTrends).catch(e => tg(`⚠️ 트렌드 저장 실패\n${e.message}`));

    // 14b Gemini
    let keywords;
    try {
      keywords = await extractKeywords(titles ?? ['AI 자동화', '콘텐츠 수익화', '1인 창업'], hnTrends, ghTrends, redditTrends, igTop);
    } catch(e) {
      await tg(`⚠️ Gemini 실패 → 기본 키워드 사용\n${e.message}`);
      keywords = 'AI자동화, 콘텐츠수익, 1인창업, SNS마케팅';
    }

    // 14c Groq
    const hooksRaw = await generateHooks(keywords);
    const hooks = filterKoreanOnly(hooksRaw);

    // 14d 콘텐츠 생성 (플랫폼별)
    const { igText, fbText, ytText } = await finalizeContent(keywords, hooks);
    const igFinal = filterKoreanOnly(igText);
    const fbFinal = filterKoreanOnly(fbText);
    const ytFinal = filterKoreanOnly(ytText);

    // Supabase 저장
    const topic = keywords.split(',')[0].trim();
    await saveToSupabase(topic, igFinal);

    // 플랫폼별 콘텐츠
    const fixedTags = '#AI부업 #직장인부업 #자동화 #월급외수익 #AI자동화 #부업추천 #재테크 #디지털노마드';
    const keywordTags = keywords.split(',').map(k => `#${k.trim().replace(/\s/g, '')}`).join(' ');
    const hashtagList = `${keywordTags} ${fixedTags}`;
    const igContent = `${igFinal}\n\n${hashtagList}`.slice(0, 2200);  // Instagram: 본문 + 해시태그
    const fbContent = fbFinal;                                          // Facebook: 본문만
    const threadsContent = igFinal.slice(0, 500);                       // Threads: 500자 제한

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
              text: ytFinal.slice(0, 2500),
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

    // Threads 발행 — 차단 중 비활성화
    // try {
    //   const threadsRes = await fetch('https://nova-pipeline-two.vercel.app/api/post-threads', {
    //     method: 'POST',
    //     headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ text: final.slice(0, 500) }),
    //   });
    //   const threadsData = await threadsRes.json();
    //   if (threadsData.ok) {
    //     await tg(`📱 Threads 발행 완료 (post_id: ${threadsData.post_id})`);
    //   } else {
    //     await tg(`⚠️ Threads 발행 실패: ${threadsData.error}`);
    //   }
    // } catch(e) {
    //   await tg(`⚠️ Threads 발행 오류: ${e.message}`);
    // }

    // Instagram 발행
    const imagePrompt = buildImagePromptFromKeywords(keywords);
    try {
      const igRes = await fetch('https://nova-pipeline-two.vercel.app/api/post-instagram', {
        method: 'POST',
        headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: igContent, imagePrompt }),
      });
      const igData = await igRes.json();
      if (igData.ok) {
        await tg(`📸 Instagram 발행 완료 (post_id: ${igData.post_id})`);
      } else {
        await tg(`⚠️ Instagram 발행 실패: ${igData.error}`);
      }
    } catch(e) {
      await tg(`⚠️ Instagram 발행 오류: ${e.message}`);
    }

    // Facebook 발행
    try {
      const fbRes = await fetch('https://nova-pipeline-two.vercel.app/api/post-facebook', {
        method: 'POST',
        headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fbContent, imagePrompt }),
      });
      const fbData = await fbRes.json();
      if (fbData.ok) {
        await tg(`📘 Facebook 발행 완료 (post_id: ${fbData.post_id})`);
      } else {
        await tg(`⚠️ Facebook 발행 실패: ${fbData.error}`);
      }
    } catch(e) {
      await tg(`⚠️ Facebook 발행 오류: ${e.message}`);
    }

    // 성공 알림
    await tg(`✅ NOVA 파이프라인 완료\n\n📌 키워드: ${keywords}\n\n${igFinal.slice(0, 300)}...`);

    return res.status(200).json({ ok: true, topic, keywords });

  } catch(e) {
    await tg(`❌ NOVA 파이프라인 실패\n${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
