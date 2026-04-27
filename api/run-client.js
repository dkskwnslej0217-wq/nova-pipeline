// api/run-client.js — 멀티 클라이언트 파이프라인
// Make.com → /api/run-client?client_id=xxx → 클라이언트별 IG/FB 발행
export const config = { runtime: 'nodejs', maxDuration: 300 };

const GROQ_KEY      = process.env.GROQ_API_KEY;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPA_URL      = process.env.SUPABASE_URL;
const SUPA_KEY      = process.env.SUPABASE_SERVICE_KEY;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const PEXELS_KEY    = process.env.PEXELS_API_KEY;
const BASE_URL      = 'https://nova-pipeline-two.vercel.app';

// ─── Telegram ────────────────────────────────────────────
async function tg(chatId, msg) {
  if (!TG_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
  }).catch(() => {});
}

// ─── Supabase: 클라이언트 로드 ────────────────────────────
async function loadClient(clientId) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/clients?id=eq.${clientId}&active=eq.true&limit=1`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`클라이언트 없음: ${clientId}`);
  return rows[0];
}

async function updateClientStats(clientId) {
  await fetch(`${SUPA_URL}/rest/v1/clients?id=eq.${clientId}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_run_at: new Date().toISOString(), run_count: undefined }),
  }).catch(() => {});
  // run_count increment via RPC
  await fetch(`${SUPA_URL}/rest/v1/rpc/increment_client_run`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  }).catch(() => {});
}

// ─── 오늘의 주식 리서치 결과 로드 ────────────────────────
async function fetchStockResearch() {
  const kst = new Date(Date.now() + 9 * 3600000);
  for (const d of [kst.toISOString().slice(0, 10), new Date(kst - 86400000).toISOString().slice(0, 10)]) {
    try {
      const res = await fetch(
        `${SUPA_URL}/rest/v1/research_results?date=eq.${d}&type=eq.us_stock&select=tool_name,hook_kr,one_liner,features_kr,reason_kr,tool_url&limit=1`,
        { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
      );
      if (!res.ok) continue;
      const rows = await res.json();
      if (rows.length) return rows[0];
    } catch { continue; }
  }
  return null;
}

// ─── 트렌드 수집 (공유 소스 — API키 불필요) ───────────────
async function collectTrends() {
  const [hn, google, ph] = await Promise.all([
    fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
      .then(r => r.json()).then(ids =>
        Promise.all(ids.slice(0, 5).map(id =>
          fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
        ))
      ).then(items => items.filter(i => i?.title).map(i => i.title))
      .catch(() => []),
    fetch('https://trends.google.com/trending/rss?geo=KR', { headers: { 'User-Agent': 'nova-pipeline/1.0' } })
      .then(r => r.text()).then(text => {
        const m = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)];
        return m.map(x => (x[1]||x[2]||'').trim()).filter(t => t && t !== 'Daily Search Trends').slice(0, 5);
      }).catch(() => []),
    fetch('https://www.producthunt.com/feed?category=artificial-intelligence', { headers: { 'User-Agent': 'nova-pipeline/1.0' } })
      .then(r => r.text()).then(text => {
        const m = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)];
        return m.map(x => (x[1]||x[2]||'').trim()).filter(t => t && t !== 'Product Hunt – The best new products, every day').slice(0, 3);
      }).catch(() => []),
  ]);
  return { hn, google, ph };
}

// ─── 콘텐츠 생성 ─────────────────────────────────────────
function filterKorean(text) {
  return text
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF]/g, '')
    .replace(/[\u0600-\u06FF]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function buildStockContent(stock) {
  const igText = [
    `⚡ ${stock.hook_kr || '오늘 미국주식 주목'}`,
    ``,
    `→ ${stock.one_liner || ''}`,
    `→ ${stock.features_kr || ''}`,
    `→ ${stock.reason_kr || ''}`,
    ``,
    `💾 매일 미국주식 뉴스 팔로우 필수`,
  ].join('\n');
  const fbText = `${stock.hook_kr || ''}\n\n${stock.one_liner || ''}\n${stock.features_kr || ''}\n\n📈 미국주식 투자자라면 팔로우하고 매일 확인하세요`;
  const ytText = stock.one_liner || '';
  return { igText, fbText, ytText };
}

async function generateContent(niche, target, trends) {
  const ctx = [
    trends.hn.length ? `[HN] ${trends.hn.slice(0,3).map(t=>t.slice(0,60)).join(' / ')}` : '',
    trends.google.length ? `[구글KR] ${trends.google.join(' / ')}` : '',
    trends.ph.length ? `[PH AI] ${trends.ph.join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  const systemMsg = '한국 SNS 콘텐츠 전문가. 맞춤법 완벽. AI 티 절대 금지. 한국어만.';
  const userMsg = `주제: ${niche}\n타겟: ${target}\n트렌드:\n${ctx}\n\n금지: "안녕하세요" "여러분" "오늘은" "~요" "~습니다"\n\n아래 구분자 그대로 작성:\n\n===IG===\n⚡ [훅 20자 이내]\n\n→ [팁]\n→ [팁]\n→ [팁]\n\n💾 [저장각 한 줄]\n(150자 이내, 해시태그 없이)\n\n===FB===\n(공감 훅 + 스토리 3~4줄 + 댓글유도, 180자 이내)\n\n===YT===\n(나레이션 150자 이내)`;

  let raw;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
        max_tokens: 600, temperature: 0.8,
      }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    raw = (await r.json()).choices[0].message.content;
  } catch {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: systemMsg, messages: [{ role: 'user', content: userMsg }] }),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    raw = (await r.json()).content[0].text;
  }

  const extract = tag => {
    const m = raw.match(new RegExp(`===${tag}===\\n([\\s\\S]*?)(?====|$)`));
    return m ? filterKorean(m[1].trim()) : filterKorean(raw);
  };
  return { igText: extract('IG'), fbText: extract('FB'), ytText: extract('YT') };
}

// ─── 이미지 프롬프트 ──────────────────────────────────────
function buildImagePrompt(niche) {
  const map = {
    'AI부업': 'AI automation laptop money Korean office worker modern',
    '재테크': 'investment finance wealth growth Korean professional',
    '직장인': 'Korean office worker professional city modern',
    '창업': 'startup entrepreneur minimal Korean modern office',
  };
  const key = Object.keys(map).find(k => niche.includes(k)) || '';
  return map[key] || `${niche} Korean aesthetic modern minimalist high quality`;
}

// ─── 메인 핸들러 ──────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.headers['x-pipeline-secret'];
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (!isCron && secret !== PIPELINE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const clientId = req.query?.client_id || req.body?.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id 필요' });

  let client;
  try {
    client = await loadClient(clientId);
  } catch (e) {
    return res.status(404).json({ error: e.message });
  }

  const { tg_chat_id, ig_token, ig_account_id, fb_token, fb_page_id, niche, target } = client;
  const startMs = Date.now();
  let igStatus = '❌', fbStatus = '❌';

  try {
    // 주식 리서치 결과 우선 로드 (Instagram용)
    const stockResearch = await fetchStockResearch();

    // 트렌드 수집 (주식 데이터 없을 때만 Groq 생성용)
    const trends = stockResearch ? { hn: [], google: [], ph: [] } : await collectTrends();

    // 콘텐츠 생성 (주식 데이터 있으면 우선 사용)
    const { igText, fbText } = stockResearch
      ? buildStockContent(stockResearch)
      : await generateContent(niche, target, trends);
    const imagePrompt = buildImagePrompt(niche);

    const fixedTags = '#AI부업 #직장인부업 #자동화 #월급외수익 #AI자동화';
    const igContent = `${igText}\n\n${fixedTags}`.slice(0, 2200);

    // 병렬 발행
    const [igRes, fbRes] = await Promise.allSettled([
      ig_token && ig_account_id
        ? fetch(`${BASE_URL}/api/post-instagram`, {
            method: 'POST',
            headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: igContent, imagePrompt, ig_token, ig_account_id }),
          }).then(r => r.json())
        : Promise.reject(new Error('IG 토큰 없음')),
      fb_token && fb_page_id
        ? fetch(`${BASE_URL}/api/post-facebook`, {
            method: 'POST',
            headers: { 'x-pipeline-secret': PIPELINE_SECRET, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: fbText, imagePrompt, fb_token, fb_page_id }),
          }).then(r => r.json())
        : Promise.reject(new Error('FB 토큰 없음')),
    ]);

    if (igRes.status === 'fulfilled' && igRes.value?.ok) igStatus = '✅';
    else tg(tg_chat_id, `⚠️ IG 발행 실패: ${igRes.reason?.message || igRes.value?.error}`);

    if (fbRes.status === 'fulfilled' && fbRes.value?.ok) fbStatus = '✅';
    else tg(tg_chat_id, `⚠️ FB 발행 실패: ${fbRes.reason?.message || fbRes.value?.error}`);

    // 통계 업데이트
    updateClientStats(clientId);

    // 완료 요약
    const kst = new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 16);
    const elapsed = Math.round((Date.now() - startMs) / 1000);
    await tg(tg_chat_id,
      `✅ NOVA 완료 (${kst} KST)\n` +
      `📌 ${niche}\n` +
      `🇰🇷 ${(trends.google.slice(0,2).join(', ') || '-')}\n` +
      `📸 IG ${igStatus} | 📘 FB ${fbStatus}\n` +
      `⏱️ ${elapsed}초`
    );

    return res.status(200).json({ ok: true, client: client.name, igStatus, fbStatus });

  } catch (e) {
    tg(tg_chat_id, `❌ NOVA 실패 (${client.name})\n${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
