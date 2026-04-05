// pipeline.js — 멀티모델 파이프라인
// 14a YouTube TOP10 → 14b Gemini 키워드 → 14c Groq 훅 → 14d Claude 최종완성

import https from 'https';
import fs from 'fs';

// .env 로드
try {
  const env = fs.readFileSync('.env', 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
} catch { /* .env 없으면 환경변수 그대로 사용 */ }

const YOUTUBE_KEY   = process.env.YOUTUBE_API_KEY;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const GROQ_KEY      = process.env.GROQ_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ─── HTTP 헬퍼 ────────────────────────────────────────────
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── 14a: YouTube TOP10 수집 ─────────────────────────────
async function fetchYouTubeTrending() {
  const path = `/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=KR&maxResults=10&key=${YOUTUBE_KEY}`;
  const res = await httpRequest({ hostname: 'www.googleapis.com', path, method: 'GET' });
  if (res.status !== 200) throw new Error(`YouTube ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.items.map(i => i.snippet.title);
}

// ─── 14b: Gemini 키워드 추출 ─────────────────────────────
async function extractKeywords(titles) {
  const prompt = `아래는 현재 한국 유튜브 급상승 영상 제목들입니다:\n${titles.join('\n')}\n\nSNS 콘텐츠(스레드/인스타/유튜브쇼츠)에 활용할 핵심 키워드 5개 추출. 단어만, 쉼표 구분.`;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  const res = await httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Gemini ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.candidates[0].content.parts[0].text.trim();
}

// ─── 14c: Groq 훅 초안 3개 ───────────────────────────────
async function generateHooks(keywords) {
  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `키워드: ${keywords}\n\n이 키워드 기반 스레드 첫 줄 훅 3개. 각 40자 이내. 번호 붙여서. 강렬하게.` }],
    max_tokens: 400
  });
  const res = await httpRequest({
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Groq ${res.status}`);
  return res.body.choices[0].message.content;
}

// ─── 14d: Claude 최종 완성 ───────────────────────────────
async function finalizeContent(keywords, hooks) {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `키워드: ${keywords}\n\n훅 후보:\n${hooks}\n\n가장 강한 훅 1개 골라서 스레드 콘텐츠 완성:\n[훅 - 1줄]\n[본문 - 3~5줄, 짧고 강하게]\n[마무리 - 행동 유도 1줄]\n\n한국어, 소상공인/1인 창업자 타겟, 실용적이고 친근한 톤.`
    }]
  });
  const res = await httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (res.status !== 200) throw new Error(`Claude ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.content[0].text;
}

// ─── 메인 ────────────────────────────────────────────────
async function runPipeline() {
  console.log('=== 14a: YouTube TOP10 수집 ===');
  let titles;
  try {
    titles = await fetchYouTubeTrending();
    console.log(titles.slice(0, 3).join('\n') + '\n...');
  } catch(e) {
    console.log(`YouTube 실패 → 기본 주제로 폴백\n(${e.message})`);
    titles = null;
  }

  console.log('\n=== 14b: Gemini 키워드 추출 ===');
  let keywords;
  try {
    keywords = await extractKeywords(
      titles ?? ['AI 자동화 수익', '1인 창업 성공', '콘텐츠로 돈 버는 법']
    );
    console.log(keywords);
  } catch(e) {
    console.log(`Gemini 실패 → Groq 폴백\n(${e.message})`);
    keywords = 'AI자동화, 콘텐츠수익, 1인창업, 자동화도구, SNS마케팅';
  }

  console.log('\n=== 14c: Groq 훅 초안 3개 ===');
  const hooks = await generateHooks(keywords);
  console.log(hooks);

  console.log('\n=== 14d: Claude 최종 완성 ===');
  const final = await finalizeContent(keywords, hooks);
  console.log(final);

  // output/staging/ 저장
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const topic = keywords.split(',')[0].trim();
  const filename = `output/staging/${date}_Threads_${topic}.md`;
  const content = `---\nplatform: threads\ntopic: ${topic}\nscore: 0\nstatus: staging\ncreated: ${new Date().toISOString().slice(0, 10)}\n---\n\n${final}`;
  if (!fs.existsSync('output/staging')) fs.mkdirSync('output/staging', { recursive: true });
  fs.writeFileSync(filename, content, 'utf8');

  console.log(`\n✅ 저장: ${filename}`);
  console.log('✅ 파이프라인 완료');
}

runPipeline().catch(e => console.error('파이프라인 오류:', e));
