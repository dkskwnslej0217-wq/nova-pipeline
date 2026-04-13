// 멀티모델 파이프라인 테스트 (Node.js)
const https = require('https');
const fs = require('fs');

// .env 로드
const env = fs.readFileSync('.env', 'utf8');
env.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k.trim()] = v.join('=').trim();
});

const GROQ_KEY = process.env.GROQ_API_KEY;

function groq(prompt, maxTokens = 400) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens
    });
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(parsed.error.message);
          else resolve(parsed.choices[0].message.content);
        } catch(e) { reject(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runPipeline() {
  console.log('=== 1단계: 키워드 추출 (Groq) ===');
  const keywords = await groq(
    '2026년 한국 SNS에서 인기있는 AI 자동화 관련 키워드 5개만. 단어만, 쉼표 구분. 예: AI글쓰기, 자동화수익, 챗봇창업'
  );
  console.log(keywords);

  console.log('\n=== 2단계: 훅 초안 3개 생성 (Groq) ===');
  const hooks = await groq(
    `키워드: ${keywords}\n\n이 키워드 기반 스레드 첫 줄 훅 3개. 각 40자 이내. 번호 붙여서. 강렬하게.`
  );
  console.log(hooks);

  console.log('\n=== 3단계: 최종 콘텐츠 완성 (Groq 시뮬레이션 → 실제는 Claude) ===');
  const final = await groq(`
훅 후보:
${hooks}

가장 강한 훅 1개 골라서 스레드 콘텐츠 완성:
[훅 - 1줄]
[본문 - 3~5줄, 짧고 강하게]
[마무리 - 행동 유도 1줄]
  `, 600);
  console.log(final);

  // output/staging/ 에 저장
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const filename = `output/staging/${date}_Threads_AI자동화_테스트.md`;
  const content = `---
platform: threads
topic: AI자동화
score: 0
status: staging
created: ${new Date().toISOString().slice(0,10)}
---

${final}`;

  if (!fs.existsSync('output/staging')) fs.mkdirSync('output/staging', {recursive:true});
  fs.writeFileSync(filename, content, 'utf8');
  console.log(`\n✅ 저장완료: ${filename}`);
  console.log('\n✅ 파이프라인 테스트 완료 — Groq 정상 작동');
}

runPipeline().catch(e => console.error('오류:', e));
