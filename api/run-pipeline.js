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

// ─── 14b: 오늘의 AI 툴 선정 (Gemini) ────────────────────
async function extractKeywords(titles, hnTrends = [], ghTrends = [], redditTrends = [], igTop = [], googleTrends = [], phTrends = []) {
  const trim = (arr, n = 5) => arr.slice(0, n).map(s => String(s).slice(0, 80));
  const hnSection = hnTrends.length ? `[HackerNews]\n${trim(hnTrends).join('\n')}` : '';
  const phSection = phTrends.length ? `[Product Hunt AI 신제품]\n${trim(phTrends).join('\n')}` : '';
  const ghSection = ghTrends.length ? `[GitHub 트렌딩]\n${trim(ghTrends).join('\n')}` : '';
  const rdSection = redditTrends.length ? `[Reddit r/artificial]\n${trim(redditTrends).join('\n')}` : '';
  const context = [phSection, hnSection, ghSection, rdSection].filter(Boolean).join('\n\n');

  const ctx = getContentContext();
  const prompt = `아래는 오늘 글로벌에서 주목받는 새 AI 툴·서비스 목록입니다:\n${context}\n\n오늘 카테고리: ${ctx.dayCategory}\n\n위 데이터에서 오늘 소개할 AI 툴 1개를 선정해. 조건: 실제로 사용 가능한 도구, 한국 사용자에게 유용한 것, 가능하면 무료/프리미엄 플랜 있는 것.\n\n반드시 아래 형식 그대로 반환 (다른 말 없이):\n툴이름|||한 줄 설명 (30자 이내)|||누구에게 필요한지 (20자 이내)|||무료/유료/프리미엄\n\n예시:\nPerplexity AI|||실시간 검색 + AI 답변 통합 도구|||리서치하는 모든 사람|||무료`;
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

// ─── 14c: Groq 훅 초안 ───────────────────────────────────
async function generateHooks(keywords) {
  // keywords 형식: "툴이름|||설명|||대상|||무료/유료"
  const parts = keywords.split('|||');
  const toolName = parts[0]?.trim() || 'AI 툴';
  const toolDesc = parts[1]?.trim() || '';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. AI 티 없이 진짜 사람 말투. 한국어만.' },
        { role: 'user', content: `오늘 소개할 AI 툴: ${toolName} — ${toolDesc}\n\n이 툴을 소개하는 첫 줄 훅 3개. 각 25자 이내. 번호 없이. "이거 알아?" "이미 쓰는 사람은 알지" 식으로 궁금증 유발. 오타 없이.` }
      ],
      max_tokens: 100,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── 14d: 최종 완성 (1번 Groq 호출 → 3개 플랫폼 동시 생성) ──
async function finalizeContent(keywords, hooks) {
  // keywords 형식: "툴이름|||설명|||대상|||무료/유료"
  const parts = keywords.split('|||');
  const toolName   = parts[0]?.trim() || 'AI 툴';
  const toolDesc   = parts[1]?.trim() || '';
  const toolTarget = parts[2]?.trim() || '';
  const toolPrice  = parts[3]?.trim() || '';

  const systemMsg = '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. 오타 절대 금지. 한국어만. AI 티 없이 진짜 사람 말투.';
  const userMsg = `오늘 소개할 AI 툴: ${toolName}\n설명: ${toolDesc}\n대상: ${toolTarget}\n가격: ${toolPrice}\n훅 후보: ${hooks}\n금지: "안녕하세요" "여러분" "오늘은" "~요" "~습니다" "확실히" "물론"\n\n아래 구분자 그대로 4개 작성:\n\n===IG===\n🔧 [훅 20자 이내 — 툴 이름 또는 강렬한 첫 줄]\n\n• 이름: ${toolName}\n• [툴이 하는 것 한 줄]\n• [누구에게 필요한지 한 줄]\n• ${toolPrice}\n\n💡 [한 줄 평가 — "이미 쓰는 사람 있음" 식]\n(150자 이내, 해시태그 없이)\n\n===FB===\n(툴 소개 + 어떤 상황에 쓰면 좋은지 스토리 3~4줄 + "써봤어?" 댓글유도, 이모지 1~2개, 180자 이내)\n\n===YT===\n(나레이션: "오늘 소개할 AI는 ${toolName}이야." 로 시작 → 뭐 하는 툴인지 → 누가 쓰면 좋은지 → 무료/유료 → 마무리 한 줄 여운. 말하듯 자연스럽게, 150자 이내)\n\n===IMG===\n(English only, 12 words max: realistic photo scene matching this AI tool introduction. Person using laptop or phone, modern setting, natural lighting, no text, no robot. Example: "young Korean person using AI app on laptop in minimalist office")`;

  async function callGroq() {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
        max_tokens: 600,
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
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: systemMsg, messages: [{ role: 'user', content: userMsg }] }),
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
  // 영어 단어 포함 + 50자 이내인 경우만 유효한 이미지 프롬프트로 인정
  const imagePrompt = (imgRaw.length > 5 && imgRaw.length < 200 && /[a-zA-Z]/.test(imgRaw))
    ? imgRaw
    : '';
  return { igText: extract('IG'), fbText: extract('FB'), ytText: extract('YT'), imagePrompt };
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

  const startMs = Date.now();
  let igStatus = '❌', fbStatus = '❌', videoStatus = '❌';

  try {
    // 14a 트렌드 수집 (YouTube + HackerNews + GitHub 병렬)
    const [titles, hnTrends, ghTrends, redditTrends, igTop, googleTrends, phTrends] = await Promise.all([
      fetchTrending().catch(e => { tg(`⚠️ YouTube 수집 실패\n${e.message}`); return null; }),
      fetchHNTrends().catch(e => { tg(`⚠️ HN 수집 실패\n${e.message}`); return []; }),
      fetchGitHubTrends().catch(e => { tg(`⚠️ GitHub 수집 실패\n${e.message}`); return []; }),
      fetchRedditTrends().catch(e => { tg(`⚠️ Reddit 수집 실패 → 폴백\n${e.message}`); return []; }),
      fetchInstagramTop().catch(e => { tg(`⚠️ 인스타 분석 실패 (권한 확인 필요)\n${e.message}`); return []; }),
      fetchGoogleTrendsKR().catch(() => []),
      fetchProductHuntAI().catch(() => []),
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

    // 14b Gemini — 오늘의 AI 툴 선정
    let keywords;
    try {
      keywords = await extractKeywords(titles ?? [], hnTrends, ghTrends, redditTrends, igTop, googleTrends, phTrends);
      // 형식 검증: "툴이름|||설명|||대상|||가격" 형태인지 확인
      if (!keywords.includes('|||')) {
        // 폴백: phTrends 첫 번째 항목 사용
        const fallbackTool = phTrends[0] || hnTrends[0] || 'Perplexity AI';
        keywords = `${fallbackTool}|||AI 검색 및 리서치 도구|||리서치·공부하는 사람|||무료`;
      }
    } catch(e) {
      await tg(`⚠️ Gemini 실패 → 기본 툴 사용\n${e.message}`);
      keywords = 'Perplexity AI|||실시간 검색 + AI 답변 통합|||리서치하는 모든 사람|||무료';
    }

    // 텔레그램 채널 발행 (트렌드 다이제스트)
    const channelPost = formatChannelPost(hnTrends, redditTrends, ghTrends, googleTrends, phTrends, keywords);
    postChannel(channelPost); // 비동기, 실패해도 파이프라인 계속

    // 14c Groq
    const hooksRaw = await generateHooks(keywords);
    const hooks = filterKoreanOnly(hooksRaw);

    // 14d 콘텐츠 생성 (플랫폼별)
    const { igText, fbText, ytText, imagePrompt: groqImagePrompt } = await finalizeContent(keywords, hooks);
    const igFinal = filterKoreanOnly(igText);
    const fbFinal = filterKoreanOnly(fbText);
    const ytFinal = filterKoreanOnly(ytText);

    // 플랫폼별 콘텐츠
    const toolName = keywords.split('|||')[0]?.trim() || 'AI툴';

    // Supabase 저장
    await saveToSupabase(toolName, igFinal);
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
              title: `오늘의 AI 툴: ${toolName}`,
              tags: keywords.split('|||').slice(0, 2).map(k => k.trim()).join(', '),
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

    return res.status(200).json({ ok: true, topic, keywords });

  } catch(e) {
    await tg(`❌ NOVA 파이프라인 실패\n${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
