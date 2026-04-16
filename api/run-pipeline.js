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
const TG_CHANNEL    = process.env.TELEGRAM_CHANNEL_ID; // 공개 채널 chat_id (예: @nova_ai_trends 또는 -100xxx)
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

// ─── Telegram 개인 알림 ───────────────────────────────────
async function tg(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
  } catch { /* 알림 실패는 무시 */ }
}

// ─── Telegram 채널 발행 ───────────────────────────────────
async function postChannel(msg) {
  if (!TG_CHANNEL || !TG_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHANNEL,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch { /* 채널 발행 실패는 파이프라인 중단 안 함 */ }
}

// ─── 채널용 트렌드 다이제스트 포맷 ──────────────────────
const AI_KW = ['ai', 'llm', 'gpt', 'claude', 'gemini', 'openai', 'agent', 'automation', '자동화', 'ml', 'model', 'chatgpt', 'copilot', 'robot', 'neural', '인공지능', 'langchain'];

function isAiRelated(text) {
  return AI_KW.some(k => text.toLowerCase().includes(k));
}

function shortenTitle(t) {
  const clean = t.replace(/Product Hunt.*every day/gi, '').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '...' : clean;
}

function formatChannelPost(hnTrends, redditTrends, ghTrends, googleTrends, phTrends, keywords) {
  const date = new Date(Date.now() + 9 * 3600000);
  const dateStr = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = days[date.getDay()];

  // HN: AI 관련만
  const hnFiltered = hnTrends.filter(t => isAiRelated(t)).slice(0, 3);
  // PH: 사이트 이름 필터 + 설명 있는 것만
  const phFiltered = phTrends.filter(t => t.length > 5 && !/product hunt/i.test(t)).slice(0, 3);
  // 구글: AI 관련 키워드만 (기아·정치 뉴스 제거)
  const gtFiltered = googleTrends.filter(t => isAiRelated(t)).slice(0, 3);
  // Reddit: AI 관련만
  const rdFiltered = redditTrends.filter(t => isAiRelated(t)).slice(0, 2);
  // GitHub: 그대로 (이미 AI 필터 적용됨)
  const ghFiltered = ghTrends.slice(0, 2);

  const sections = [
    hnFiltered.length  ? `🔥 <b>해외 AI 핫이슈 (HackerNews)</b>\n${hnFiltered.map(t => `• ${shortenTitle(t)}`).join('\n')}` : '',
    phFiltered.length  ? `🚀 <b>새로 나온 AI 툴 (Product Hunt)</b>\n${phFiltered.map(t => `• ${shortenTitle(t)}`).join('\n')}` : '',
    gtFiltered.length  ? `🇰🇷 <b>국내 AI 검색 트렌드</b>\n${gtFiltered.map(t => `• ${t}`).join('\n')}` : '',
    rdFiltered.length  ? `💬 <b>Reddit 반응</b>\n${rdFiltered.map(t => `• ${shortenTitle(t)}`).join('\n')}` : '',
    ghFiltered.length  ? `⭐ <b>주목받는 AI 프로젝트 (GitHub)</b>\n${ghFiltered.map(t => `• ${shortenTitle(t)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const kwLine = keywords.split(',').map(k => `#${k.trim().replace(/\s/g,'')}`).join(' ');

  return `🤖 <b>오늘의 AI 트렌드</b> — ${dateStr}(${dayStr})\n\n${sections || '오늘은 수집된 AI 트렌드가 없습니다.'}\n\n📌 <b>오늘 주목할 키워드</b>\n${kwLine}\n\n🔧 오늘 소개할 새 AI 툴이 YouTube·Instagram에 자동 발행됩니다\n<i>@nova_ai_kr · 매일 새로운 AI 툴 소개</i>`;
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
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`인스타 API ${res.status}: ${errText.slice(0, 100)}`);
  }
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

// ─── research-agent 결과 읽기 (오늘→어제 폴백) ──────────
async function fetchResearchResult() {
  const kst = new Date(Date.now() + 9 * 3600000);
  const today = kst.toISOString().slice(0, 10);
  const yesterday = new Date(kst - 86400000).toISOString().slice(0, 10);

  for (const date of [today, yesterday]) {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/research_results?date=eq.${date}&select=tool_name,one_liner,target,price,compare_tool,reason_kr&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    );
    if (!res.ok) continue;
    const rows = await res.json();
    if (rows.length) return rows[0];
  }
  return null;
}

// ─── Product Hunt AI 신제품 (API 키 불필요) ───────────────
async function fetchProductHuntAI() {
  const res = await fetch('https://www.producthunt.com/feed?category=artificial-intelligence', {
    headers: { 'User-Agent': 'nova-pipeline/1.0' },
  });
  if (!res.ok) throw new Error(`ProductHunt ${res.status}`);
  const text = await res.text();
  const titles = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)]
    .map(m => (m[1] || m[2] || '').trim())
    .filter(t => t && t !== 'Product Hunt – The best new products, every day');
  const descs = [...text.matchAll(/<summary[^>]*><!\[CDATA\[(.*?)\]\]><\/summary>|<content[^>]*>\s*&lt;p&gt;(.*?)&lt;\/p&gt;/g)]
    .map(m => (m[1] || m[2] || '').replace(/&amp;/g, '&').trim().slice(0, 60));
  return titles.slice(0, 5).map((t, i) => descs[i] ? `${t}: ${descs[i]}` : t);
}

// ─── 구글 트렌드 KR (API 키 불필요) ──────────────────────
async function fetchGoogleTrendsKR() {
  const res = await fetch('https://trends.google.com/trending/rss?geo=KR', {
    headers: { 'User-Agent': 'nova-pipeline/1.0' },
  });
  if (!res.ok) throw new Error(`Google Trends ${res.status}`);
  const text = await res.text();
  const matches = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)];
  return matches
    .map(m => (m[1] || m[2] || '').trim())
    .filter(t => t && t !== 'Daily Search Trends')
    .slice(0, 5);
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

// ─── 메모리: 최근 발행 주제 조회 ────────────────────────────
async function fetchRecentTopics() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
    const res = await fetch(
      `${SUPA_URL}/rest/v1/cache?topic=neq.__lock__&created_at=gte.${since}&select=topic,score&order=created_at.desc&limit=14`,
      { headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` } }
    );
    if (!res.ok) return { recent: [], topScored: [] };
    const rows = await res.json();
    const recent   = rows.map(r => r.topic).filter(Boolean);
    const topScored = rows.filter(r => r.score >= 80).map(r => r.topic).slice(0, 3);
    return { recent, topScored };
  } catch { return { recent: [], topScored: [] }; }
}

// ─── 14b: 오늘의 AI 툴 선정 (Gemini) ────────────────────
async function extractKeywords(titles, hnTrends = [], ghTrends = [], redditTrends = [], igTop = [], googleTrends = [], phTrends = [], recentTopics = [], topScored = [], crawleeTrends = []) {
  const trim = (arr, n = 5) => arr.slice(0, n).map(s => String(s).slice(0, 80));
  const hnSection = hnTrends.length ? `[HackerNews]\n${trim(hnTrends).join('\n')}` : '';
  const phSection = phTrends.length ? `[Product Hunt AI 신제품]\n${trim(phTrends).join('\n')}` : '';
  const ghSection = ghTrends.length ? `[GitHub 트렌딩]\n${trim(ghTrends).join('\n')}` : '';
  const rdSection = redditTrends.length ? `[Reddit r/artificial]\n${trim(redditTrends).join('\n')}` : '';
  const crawleeSection = crawleeTrends.length ? `[crawlee-agent 수집]\n${trim(crawleeTrends, 8).join('\n')}` : '';
  const context = [phSection, hnSection, ghSection, rdSection, crawleeSection].filter(Boolean).join('\n\n');

  const ctx = getContentContext();
  const memorySection = recentTopics.length
    ? `\n\n⛔ 최근 7일 이미 소개한 툴 (중복 금지):\n${recentTopics.map(t => `• ${t}`).join('\n')}`
    : '';
  const learningSection = topScored.length
    ? `\n\n✅ 최근 반응 좋았던 주제 유형 (이런 방향으로 선정):\n${topScored.map(t => `• ${t}`).join('\n')}`
    : '';
  const prompt = `아래는 오늘 글로벌에서 주목받는 새 AI 툴·서비스 목록입니다:\n${context}${memorySection}${learningSection}\n\n오늘 카테고리: ${ctx.dayCategory}\n\n위 데이터에서 오늘 소개할 AI 툴 1개를 선정해. 실제로 사용 가능하고 한국 사용자에게 유용한 것.\n\n반드시 아래 형식 그대로 반환 (다른 말 없이):\n툴이름|||한 줄 설명 (25자 이내)|||대상 (15자 이내)|||무료/유료/프리미엄|||비교할 대형 툴 1개 이름만 (ChatGPT/Notion/Canva/Figma/Google/YouTube 중 가장 비슷한 것)\n\n예시:\nPerplexity AI|||AI가 출처 포함해서 검색해주는 도구|||리서치하는 사람|||무료|||ChatGPT`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_KEY}`,
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

// ─── 콘텐츠 컨텍스트 (요일별 AI 툴 카테고리) ─────────────
function getContentContext() {
  const kst = new Date(Date.now() + 9 * 3600000);
  const day  = kst.getDay();

  const dayCategories = {
    0: '이번 주 베스트 AI 툴 TOP3',
    1: '생산성 AI 툴 — 업무 효율 올리는 것',
    2: '글쓰기·번역 AI 툴',
    3: '이미지·영상 생성 AI 툴',
    4: '자동화·코딩 AI 툴',
    5: '무료로 쓸 수 있는 AI 툴',
    6: '이번 주 AI 뉴스 & 새 툴 총정리',
  };

  return {
    dayCategory: dayCategories[day],
    fullContext:  `[오늘 카테고리] ${dayCategories[day]}`,
  };
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
  const ctx = getContentContext();
  const base = `
너는 "AI 부업 자동화" 분야 한국 SNS 전문가야.
타겟: 월급 받는 직장인, 부업 원하는 20~40대.
${ctx.fullContext}
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

// ─── 14b-2: Gemini 툴 상세 분석 (슬라이드 퀄리티 향상용) ─────
async function analyzeToolDetails(toolName, compareWith) {
  const prompt = `AI 툴 "${toolName}"에 대해 아래 형식으로 정확하게 답해줘. 모르면 추측하지 말고 빈칸.

기능1: [가장 핵심 기능, 20자 이내]
기능2: [두 번째 기능, 20자 이내]
기능3: [세 번째 기능, 20자 이내]
가격: [무료 플랜 유무 + 유료 플랜 가격 요약, 25자]
${compareWith}와차이: [핵심 차이 1가지, 25자]
단점: [솔직한 단점 1가지, 20자]
추천대상: [이런 사람에게 딱, 20자]
사용예시입력: [실제 입력 예시, 25자]
사용예시출력: [기대 결과 예시, 25자]
공식URL: [https://로 시작하는 정확한 URL, 모르면 빈칸]`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!res.ok) return '';
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch { return ''; }
}

// ─── 14c: Groq 훅 초안 ───────────────────────────────────
async function generateHooks(keywords) {
  // keywords 형식: "툴이름|||설명|||대상|||무료/유료|||비교툴"
  const parts = keywords.split('|||');
  const toolName   = parts[0]?.trim() || 'AI 툴';
  const compareWith = parts[4]?.trim() || 'ChatGPT';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. AI 티 없이 진짜 사람 말투. 한국어만.' },
        { role: 'user', content: `새 AI 툴: ${toolName} / 비교 대상: ${compareWith}\n\n비교 소개 훅 3개. 각 25자 이내. 번호 없이.\n"${compareWith} 쓰는 사람 이거 알아?" / "${compareWith}보다 이게 나은 이유" 식으로. 오타 없이.` }
      ],
      max_tokens: 100,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── 14d: 최종 완성 (1번 Groq 호출 → 3개 플랫폼 동시 생성) ──
async function finalizeContent(keywords, hooks, toolDetails = '') {
  // keywords 형식: "툴이름|||설명|||대상|||무료/유료|||비교툴"
  const parts = keywords.split('|||');
  const toolName    = parts[0]?.trim() || 'AI 툴';
  const toolDesc    = parts[1]?.trim() || '';
  const toolTarget  = parts[2]?.trim() || '';
  const toolPrice   = parts[3]?.trim() || '';
  const compareWith = parts[4]?.trim() || 'ChatGPT';

  const detailsSection = toolDetails
    ? `\n\n[${toolName} 실제 정보 — 이 내용 기반으로 슬라이드 작성]\n${toolDetails}`
    : '';

  const systemMsg = '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. 오타 절대 금지. 한국어만. AI 티 없이 진짜 사람 말투.';
  const userMsg = `새 AI 툴: ${toolName} / 설명: ${toolDesc} / 대상: ${toolTarget} / 가격: ${toolPrice} / 비교 대상: ${compareWith}${detailsSection}
금지어: "안녕하세요" "여러분" "오늘은" "확실히" "물론" "정말"

아래 구분자 그대로 작성:

===IG===
(인스타 캐러셀 7장. [S번호] 형식. 한국어만. 해시태그 없이. 줄바꿈은 \n으로.)
[S1] ${toolName} — [핵심 한 줄 설명, 20자 이내]
[S2] ${compareWith} 쓸 때 이런 불편 없으세요?\n• [불편1, 20자]\n• [불편2, 20자]\n• [불편3, 20자]
[S3] 실제 사용 예시\n입력: [예시 입력 25자]\n    ↓ 30초 후\n출력: [결과물 예시 25자]
[S4] 사용법 3단계\n① [단계1, 20자]\n② [단계2, 20자]\n③ [단계3, 20자]
[S5] ${compareWith} vs ${toolName}\n속도: [비교 한 줄]\n가격: [비교 한 줄]\n정확도: [비교 한 줄]\n추천 상황: [비교 한 줄]
[S6] ✅ 추천: [이런 분, 30자]\n❌ 비추천: [이런 분, 30자]
[S7] 지금 무료로 시작 가능 → 링크는 바이오 참고 🔗

===FB===
(${toolName} 소개 게시글. ${compareWith}랑 뭐가 다른지 + 어떤 상황에 쓰면 좋은지 + 공식 링크 포함 + "써봤어?" 댓글유도. 이모지 2개, 200자 이내.)

===YT===
(나레이션 60초. 말하듯 자연스럽게. 350~450자.
1. 후킹 — ${compareWith} 쓸 때 겪는 구체적 불편함. 공감 유도.
2. 소개 — ${toolName}이 정확히 뭘 하는지. 기능 1개 콕 집어서 예시 포함.
3. 장점 — ${compareWith}보다 나은 점. 이유 + 구체적 사용 상황.
4. 단점 — 솔직하게. ${toolName}이 부족한 점 1가지. 숨기지 말것.
5. 추천 대상 — "이런 분한테 딱이에요" 구체적으로.
6. CTA — 구독 + 알림 설정. 1문장.)

===IMG===
(English only, 12 words max: realistic photo, person using laptop/phone, modern setting, natural light, no text)

===COMPARE===
(딱 1줄: vs ${compareWith} ✅ ${toolName} 장점 ❌ ${toolName} 단점, 30자 이내)

===COMBO===
(딱 1줄: ${toolName}은 [상황]에, ${compareWith}은 [상황]에, 25자 이내)`;

  async function callGroq() {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
        max_tokens: parseInt(process.env.GROQ_MAX_TOKENS || '600'),
        temperature: 0.8,
      }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    return (await r.json()).choices[0].message.content;
  }

  async function callClaude() {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system: systemMsg, messages: [{ role: 'user', content: userMsg }] }),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    return (await r.json()).content[0].text;
  }

  let raw;
  try { raw = await callGroq(); } catch { raw = await callClaude(); }

  const extract = (tag) => {
    const m = raw.match(new RegExp(`===${tag}===\\n([\\s\\S]*?)(?====|$)`));
    return m ? m[1].trim() : '';  // 태그 없으면 빈 문자열 (전체 raw 반환 금지)
  };

  const imgRaw = extract('IMG').replace(/['"]/g, '').trim();
  const imagePrompt = (imgRaw.length > 5 && imgRaw.length < 200 && /[a-zA-Z]/.test(imgRaw))
    ? imgRaw : '';
  return {
    igText: extract('IG'),
    fbText: extract('FB'),
    ytText: extract('YT'),
    imagePrompt,
    compareText: extract('COMPARE'),
    comboText:   extract('COMBO'),
  };
}


// ─── 콘텐츠 품질 채점 (규칙 기반, AI 호출 없음) ──────────
const EMOTION_WORDS = ['충격', '반전', '실화', '경고', '주의', '놀라운', '무료', '비밀', '진짜', '드디어', '한방에', '완전'];
const TREND_WORDS   = ['ai', 'gpt', '자동화', '챗봇', '무료', '신기술', '트렌드', '핫한', '요즘', '최신'];
const CTA_WORDS     = ['저장', '공유', '팔로우', '구독', '알림', '댓글', '링크', '클릭', '지금', '시작'];

function scoreContent(igText, keywords) {
  let score = 0;
  const lines = igText.split('\n').filter(Boolean);
  const firstLine = lines[0] || '';
  const full = igText.toLowerCase();

  // ── 제목 (25점) ──────────────────────────────────────────
  if (/\d/.test(firstLine))                                    score += 5; // 숫자 포함
  if (EMOTION_WORDS.some(w => firstLine.includes(w)))         score += 5; // 감정단어
  if (firstLine.length <= 30)                                  score += 5; // 간결함 (한국어 기준 30자)
  if (/[?！!]/.test(firstLine) || firstLine.includes('이유')) score += 5; // 궁금증 유발
  const toolName = (keywords.split('|||')[0] || '').toLowerCase().trim();
  if (toolName && full.includes(toolName))                     score += 5; // 키워드 포함

  // ── 본문 구조 (25점) ─────────────────────────────────────
  if (firstLine.length >= 10)                                  score += 10; // 첫 문장 존재
  if (lines.length >= 4)                                       score += 5;  // 기승전결 구조
  const longLines = lines.filter(l => l.length > 80).length;
  if (longLines === 0)                                         score += 5;  // 문단 짧게
  if (CTA_WORDS.some(w => full.includes(w)))                  score += 5;  // CTA 포함

  // ── 플랫폼 최적화 (25점) ─────────────────────────────────
  const hashCount = (igText.match(/#\S+/g) || []).length;
  if (hashCount >= 5 && hashCount <= 15)                       score += 10; // 해시태그 적정량
  if (igText.length >= 100 && igText.length <= 2200)          score += 10; // 길이 적정
  if (/[\u{1F300}-\u{1FFFF}]/u.test(igText))                  score += 5;  // 이모지 있음

  // ── 차별화 (25점) ────────────────────────────────────────
  if (TREND_WORDS.some(w => full.includes(w)))                score += 10; // 트렌드 키워드
  if (lines.length >= 5)                                       score += 10; // 충분한 내용
  if (!igText.includes('안녕하세요') && !igText.includes('여러분')) score += 5; // AI 티 없음

  return Math.min(score, 100);
}

// 약점 자동 보완 (70~89점 구간)
function patchContent(igText, score) {
  let patched = igText;

  // 이모지 없으면 추가
  if (!/[\u{1F300}-\u{1FFFF}]/u.test(patched)) {
    patched = '✅ ' + patched;
  }
  // CTA 없으면 추가
  const hasCTA = CTA_WORDS.some(w => patched.toLowerCase().includes(w));
  if (!hasCTA) {
    patched += '\n\n💡 저장해두면 나중에 유용해요!';
  }
  // 첫 줄이 너무 길면 자르기
  const lines = patched.split('\n');
  if (lines[0] && lines[0].length > 40) {
    lines[0] = lines[0].slice(0, 37) + '...';
    patched = lines.join('\n');
  }

  return patched;
}

// ─── Supabase 저장 ────────────────────────────────────────
async function saveToSupabase(topic, content, qualityScore = 1) {
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
        score: qualityScore,
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
    if (!PIPELINE_SECRET) {
      await tg(`🚨 파이프라인 401 — PIPELINE_SECRET 환경변수 미설정\nVercel 대시보드 → Settings → Environment Variables → PIPELINE_SECRET 추가 필요`);
    } else {
      await tg(`🚨 파이프라인 401 — 시크릿 불일치\nMake.com의 x-pipeline-secret 헤더 값과 Vercel PIPELINE_SECRET 확인 필요`);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 중복 실행 방지: 시간대별 원자적 락 ──────────────────
  // KST 기준 시간대 키 (1시간 단위) → 같은 시간대 중복 실행 원천 차단
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const lockKey = `lock_${kstNow.toISOString().slice(0, 13).replace('T', '_')}KST`;
  // ignore-duplicates: 이미 같은 hash 있으면 INSERT 무시 → 빈 배열 반환 (원자적)
  let lockInserted;
  try {
    const lockRes = await fetch(`${SUPA_URL}/rest/v1/cache`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify({ hash: lockKey, topic: '__lock__', content: 'running', score: 0 }),
    });
    lockInserted = await lockRes.json();
  } catch(e) {
    // Supabase 접근 불가 → 안전하게 중단 (계속 진행 금지)
    console.error('락 체크 실패 — 파이프라인 중단:', e.message);
    await tg(`🚨 파이프라인 중단 — Supabase 락 체크 실패\n${e.message}`);
    return res.status(503).json({ ok: false, error: '락 체크 실패 — 재시도 금지' });
  }
  if (!Array.isArray(lockInserted) || lockInserted.length === 0) {
    console.log(`⏭️ 파이프라인 스킵 — ${lockKey} 이미 실행됨`);
    return res.status(200).json({ ok: false, skipped: true, reason: '이 시간대 이미 실행됨' });
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
    } else {
      // 매일: daily_count가 0보다 큰 유저만 리셋 (전체 업데이트 방지)
      await fetch(`${SUPA_URL}/rest/v1/users?daily_count=gt.0`, {
        method: 'PATCH',
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ daily_count: 0 }),
      });
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

  // 토큰 만료 경고
  const now = Date.now();
  for (const [platform, expiresAt] of Object.entries(TOKEN_EXPIRES)) {
    if (!expiresAt) continue;
    const exp = parseInt(expiresAt, 10) * 1000;
    if (isNaN(exp)) {
      await tg(`⚠️ ${platform.toUpperCase()} 토큰 만료일 형식 오류 (환경변수 확인 필요)`);
      continue;
    }
    const daysLeft = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 0) {
      await tg(`🚨 ${platform.toUpperCase()} 토큰 만료됨! 즉시 갱신하세요.`);
    } else if (daysLeft <= 7) {
      await tg(`⚠️ ${platform.toUpperCase()} 토큰 만료 ${daysLeft}일 전! 지금 갱신하세요.`);
    }
  }

  // Make.com 재시도 방지: 락 통과 직후 즉시 202 응답 (타임아웃 전에)
  // Vercel 서버리스는 응답 후에도 함수 계속 실행됨 (최대 300초)
  res.status(202).json({ ok: true, started: true, lock: lockKey });

  const startMs = Date.now();
  let igStatus = '❌', fbStatus = '❌', videoStatus = '❌';

  try {
    // 14a 트렌드 수집 + 메모리 조회 (병렬)
    const [titles, hnTrends, ghTrends, redditTrends, igTop, googleTrends, phTrends, memory, researchResult] = await Promise.all([
      fetchTrending().catch(e => { tg(`⚠️ YouTube 수집 실패\n${e.message}`); return null; }),
      fetchHNTrends().catch(e => { tg(`⚠️ HN 수집 실패\n${e.message}`); return []; }),
      fetchGitHubTrends().catch(e => { tg(`⚠️ GitHub 수집 실패\n${e.message}`); return []; }),
      fetchRedditTrends().catch(e => { tg(`⚠️ Reddit 수집 실패 → 폴백\n${e.message}`); return []; }),
      fetchInstagramTop().catch(e => { tg(`⚠️ 인스타 분석 실패 (권한 확인 필요)\n${e.message}`); return []; }),
      fetchGoogleTrendsKR().catch(() => []),
      fetchProductHuntAI().catch(() => []),
      fetchRecentTopics().catch(() => ({ recent: [], topScored: [] })),
      fetchResearchResult().catch(() => null),
    ]);
    const trendSummary = [
      hnTrends.length     ? `🔥 HN:\n${hnTrends.slice(0,3).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      redditTrends.length ? `💬 Reddit:\n${redditTrends.slice(0,2).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      ghTrends.length     ? `⭐ GitHub:\n${ghTrends.slice(0,2).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
      igTop.length        ? `📊 내 인스타 반응 상위:\n${igTop.slice(0,3).map(t => `• ${t}`).join('\n')}` : '',
      googleTrends.length ? `🇰🇷 구글 트렌드:\n${googleTrends.slice(0,3).map(t => `• ${t}`).join('\n')}` : '',
      phTrends.length     ? `🚀 PH AI:\n${phTrends.slice(0,3).map(t => `• ${t.slice(0,60)}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    saveTrends(hnTrends, ghTrends, redditTrends).catch(e => tg(`⚠️ 트렌드 저장 실패\n${e.message}`));

    // 14b 툴 선정 — research-agent 결과 우선, 없으면 Gemini
    let keywords;
    if (researchResult) {
      // research-agent가 이미 분석한 결과 사용 (Gemini 호출 없음)
      keywords = `${researchResult.tool_name}|||${researchResult.one_liner}|||${researchResult.target}|||${researchResult.price}|||${researchResult.compare_tool}`;
      console.log(`✅ research-agent 결과 사용: ${researchResult.tool_name}`);
    } else {
      // 폴백: 기존 Gemini 툴 선정
      try {
        keywords = await extractKeywords(titles ?? [], hnTrends, ghTrends, redditTrends, igTop, googleTrends, phTrends, memory.recent, memory.topScored);
        if (!keywords.includes('|||')) {
          const fallbackTool = phTrends[0] || hnTrends[0] || 'Perplexity AI';
          keywords = `${fallbackTool}|||AI 검색 및 리서치 도구|||리서치·공부하는 사람|||무료`;
        }
      } catch(e) {
        await tg(`⚠️ Gemini 실패 → 기본 툴 사용\n${e.message}`);
        keywords = 'Perplexity AI|||실시간 검색 + AI 답변 통합|||리서치하는 모든 사람|||무료';
      }
    }

    // 텔레그램 채널 발행 (트렌드 다이제스트)
    const channelPost = formatChannelPost(hnTrends, redditTrends, ghTrends, googleTrends, phTrends, keywords);
    postChannel(channelPost); // 비동기, 실패해도 파이프라인 계속

    // 14b-2 Gemini 툴 상세 분석 (슬라이드용 실제 정보 수집)
    const toolNameForAnalysis = keywords.split('|||')[0]?.trim() || 'AI 툴';
    const compareForAnalysis  = keywords.split('|||')[4]?.trim() || 'ChatGPT';
    let toolDetails = await analyzeToolDetails(toolNameForAnalysis, compareForAnalysis);
    // research-agent의 reason_kr 주입 (있으면 슬라이드 콘텐츠에 활용)
    if (researchResult?.reason_kr) {
      toolDetails += `\n한국인에게 유용한 이유: ${researchResult.reason_kr}`;
    }
    // 공식 URL: research-agent 결과 우선, 없으면 Gemini 추출값 사용
    const urlMatch = toolDetails.match(/공식URL:\s*(https?:\/\/[^\s]+)/);
    const officialUrl = researchResult?.tool_url || urlMatch?.[1] || '';

    // 14c Groq
    const hooksRaw = await generateHooks(keywords);
    const hooks = filterKoreanOnly(hooksRaw);

    // 14d 콘텐츠 생성 (플랫폼별)
    const { igText, fbText, ytText, imagePrompt: groqImagePrompt, compareText, comboText } = await finalizeContent(keywords, hooks, toolDetails);
    const igRaw  = filterKoreanOnly(igText);
    const fbFinal = filterKoreanOnly(fbText);
    const ytFinal = filterKoreanOnly(ytText);

    // ── 품질 채점 ───────────────────────────────────────────
    const toolName = keywords.split('|||')[0]?.trim() || 'AI툴';
    let igFinal = igRaw;
    const qualityScore = scoreContent(igRaw, keywords);

    if (qualityScore >= 90) {
      // 즉시 발행
    } else if (qualityScore >= 70) {
      // 약점 자동 보완
      igFinal = patchContent(igRaw, qualityScore);
    } else {
      // 품질 낮음 — 텔레그램 알림 + 그래도 발행 (Groq 호출 한도로 재생성 불가)
      await tg(`⚠️ 품질 낮음 (${qualityScore}점) — 수동 확인 권장\n📌 ${toolName}`);
    }

    // Supabase 저장 (실제 품질점수 기록)
    await saveToSupabase(toolName, igFinal, qualityScore);
    const fixedTags = '#AI툴 #인공지능 #새로운AI #AI추천 #생산성앱 #무료AI #AI소개 #테크';
    const keywordTags = `#${toolName.replace(/\s/g, '')} #오늘의AI`;
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

    // GitHub Actions 영상 파이프라인 트리거 — 오늘 이미 발행됐으면 스킵
    const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    let alreadyPublished = false;
    try {
      const logRes = await fetch(
        `${SUPA_URL}/rest/v1/publish_log?date=eq.${todayKst}&platform=eq.instagram&status=eq.success&select=id`,
        { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
      );
      const logData = await logRes.json();
      if (Array.isArray(logData) && logData.length > 0) {
        alreadyPublished = true;
        videoStatus = '✅ (오늘 이미 발행됨, 스킵)';
      }
    } catch { /* 체크 실패 시 그냥 트리거 */ }

    if (alreadyPublished) {
      await tg(`⏭️ 오늘 Instagram 이미 발행됨 — 영상 파이프라인 스킵`);
    } else
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
              title: `오늘의 AI 툴: ${toolName}`,
              tags: keywords.split('|||').slice(0, 2).map(k => k.trim()).join(', '),
              tool_name:    toolName,
              compare_with: keywords.split('|||')[4]?.trim() || '',
              combo_tip:    comboText || '',
              tool_url:     officialUrl || `https://www.${toolName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}.ai`,
              ig_slides:    igFinal || igText || '',
            },
          }),
        }
      );
      if (dispatchRes.ok) {
        videoStatus = '✅';
      } else {
        tg(`⚠️ 영상 트리거 실패: ${dispatchRes.status}`);
      }
    } catch(e) {
      tg(`⚠️ 영상 트리거 오류: ${e.message}`);
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

    // Instagram / Facebook / YouTube — GitHub Actions에서 영상으로 발행
    // (사진 발행 제거, 영상 파이프라인이 모든 플랫폼 담당)

    // 시작 알림 (영상 완료 알림은 GitHub Actions에서 전송)
    const kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 16);
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    const gtPreview = googleTrends.slice(0, 2).join(', ');
    await tg(
      `🚀 NOVA 콘텐츠 생성 완료 (${kst} KST)\n` +
      `📌 ${keywords}\n` +
      (gtPreview ? `🇰🇷 ${gtPreview}\n` : '') +
      `🎬 영상 생성 중... (완료 시 별도 알림)\n` +
      `⏱️ ${elapsed}초`
    );

    // 응답은 이미 위에서 보냄 (202) — 여기서 추가 응답 없음

  } catch(e) {
    // 응답은 이미 보낸 후라 HTTP 응답 불가 → 텔레그램으로만 알림
    await tg(`❌ NOVA 파이프라인 실패\n${e.message}`);
    console.error('파이프라인 오류:', e.message);
  }
}
