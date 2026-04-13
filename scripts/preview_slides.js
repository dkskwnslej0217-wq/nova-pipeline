// scripts/preview_slides.js — 슬라이드 로컬 미리보기
// 실행: node scripts/preview_slides.js
// 결과: Desktop에 slide_1.html ~ slide_7.html 생성 → 브라우저에서 확인

import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 테스트용 슬라이드 내용 (여기 바꿔서 테스트) ──────────────
const TEST_TOOL = 'Perplexity AI';
const TEST_SLIDES_RAW = `[S1] Perplexity AI — 출처 포함 AI 검색 도구
[S2] ChatGPT 쓸 때 이런 불편 없으세요?
• 답변 출처가 없어서 사실인지 불안
• 최신 정보를 모르는 경우가 많음
• 검색창 따로 열어야 해서 번거로움
[S3] 실제 사용 예시
입력: "GPT-5 출시 언제야?"
    ↓ 5초 후
출력: 출처 3개 포함한 최신 답변
[S4] 사용법 3단계
① perplexity.ai 접속 후 무료 가입
② 궁금한 것 그냥 질문
③ 출처 클릭해서 원문 바로 확인
[S5] ChatGPT vs Perplexity AI
속도: 비슷 vs 약간 빠름
가격: 무료 있음 vs 무료 있음
정확도: 훈련 데이터 기준 vs 실시간 웹
추천 상황: 글쓰기·창작 vs 리서치·사실확인
[S6] ✅ 추천: 리서치, 공부, 사실 확인하는 분
❌ 비추천: 창작 글쓰기, 코딩 위주인 분
[S7] 지금 무료로 시작 가능 → 링크는 바이오 참고 🔗`;

// ── parseIGSlides ─────────────────────────────────────────────
function parseIGSlides(raw, toolName) {
  const result = {};
  for (let i = 1; i <= 7; i++) {
    const m = raw?.match(new RegExp(`\\[S${i}\\]\\s*([^\\[]*)`));
    result[`s${i}`] = m ? m[1].trim() : '';
  }
  if (!result.s1) result.s1 = `오늘의 AI 툴: ${toolName}`;
  if (!result.s2) result.s2 = `${toolName}이 뭔지 몰랐다면 이미 손해`;
  if (!result.s3) result.s3 = `핵심 기능: 반복 작업을 AI가 자동으로 처리`;
  if (!result.s4) result.s4 = `장점: 무료로 바로 시작 가능, 설치 필요 없음`;
  if (!result.s5) result.s5 = `단점: 무료 플랜은 사용량 제한 있음`;
  if (!result.s6) result.s6 = `추천: 시간 아끼고 싶은 직장인 / 비추천: 고급 커스터마이징 필요한 분`;
  if (!result.s7) result.s7 = '지금 무료로 시작 가능 → 링크는 바이오 참고 🔗';
  return result;
}

// ── makeSlideHTML (generate_video.js 동일) ────────────────────
function makeSlideHTML(slideNum, total, text, toolName, type) {
  const cfg = {
    title:   { accent: '#20B8CD', icon: '🤖', label: '오늘의 AI 툴' },
    problem: { accent: '#f97316', icon: '💡', label: '이런 문제 있으세요?' },
    feature: { accent: '#3b82f6', icon: '⚡', label: '핵심 기능' },
    pros:    { accent: '#3fb950', icon: '✅', label: '장점' },
    cons:    { accent: '#f85149', icon: '⚠️', label: '단점 (솔직하게)' },
    target:  { accent: '#a855f7', icon: '🎯', label: '이런 분께 추천' },
    cta:     { accent: '#20B8CD', icon: '🚀', label: '시작하기' },
  };
  const { accent, icon, label } = cfg[type] || cfg.title;
  const dots = Array.from({ length: total }, (_, i) =>
    `<div class="dot${i + 1 === slideNum ? ' on' : ''}"></div>`
  ).join('');

  const formattedText = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/→/g, `<span style="color:${accent}">→</span>`)
    .replace(/✅/g, `<span style="color:#3fb950">✅</span>`)
    .replace(/❌/g, `<span style="color:#f85149">❌</span>`)
    .replace(/①|②|③/g, m => `<span style="color:${accent};font-weight:700">${m}</span>`)
    .replace(/•/g, `<span style="color:${accent}">•</span>`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>슬라이드 ${slideNum}/${total} — ${toolName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;background:#0d1117;
  font-family:'Noto Sans KR','NanumGothic',sans-serif;
  display:flex;flex-direction:column;justify-content:center;
  align-items:flex-start;padding:80px 90px;position:relative;overflow:hidden}
.glow{position:absolute;top:-180px;right:-180px;width:540px;height:540px;
  border-radius:50%;background:radial-gradient(circle,${accent}25 0%,transparent 70%)}
.nova{position:absolute;top:48px;right:60px;border:2px solid ${accent};
  border-radius:40px;padding:12px 28px;color:${accent};font-size:28px;
  font-weight:900;background:${accent}18;letter-spacing:2px}
.label{color:${accent};font-size:30px;font-weight:700;margin-bottom:18px;
  display:flex;align-items:center;gap:12px}
.bar{width:64px;height:5px;border-radius:3px;background:${accent};margin-bottom:32px}
.title{color:#e6edf3;font-size:56px;font-weight:900;margin-bottom:20px;line-height:1.2}
.body{color:#c9d1d9;font-size:38px;font-weight:400;line-height:1.9;word-break:keep-all;max-width:900px}
.dots{position:absolute;bottom:48px;left:50%;transform:translateX(-50%);
  display:flex;gap:12px}
.dot{width:12px;height:12px;border-radius:50%;background:#30363d}
.dot.on{background:${accent}}
/* 미리보기 전용: 슬라이드 번호 표시 */
.nav{position:fixed;bottom:16px;right:16px;background:#161b22;
  border:1px solid #30363d;border-radius:8px;padding:8px 16px;
  color:#8b949e;font-size:14px;font-family:monospace}
</style></head><body>
<div class="glow"></div>
<div class="nova">NOVA</div>
<div class="label"><span>${icon}</span>${label}</div>
<div class="bar"></div>
${type === 'title' ? `<div class="title">${toolName}</div>` : ''}
<div class="body">${formattedText}</div>
<div class="dots">${dots}</div>
<div class="nav">슬라이드 ${slideNum} / ${total}</div>
</body></html>`;
}

// ── 메인 ─────────────────────────────────────────────────────
const slides = parseIGSlides(TEST_SLIDES_RAW, TEST_TOOL);
const types  = ['title', 'problem', 'feature', 'pros', 'cons', 'target', 'cta'];
const keys   = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

const desktop = path.join(os.homedir(), 'Desktop');
const outDir  = path.join(desktop, 'nova_preview');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

// 인덱스 페이지 (전체 슬라이드 한눈에)
const indexLinks = keys.map((k, i) =>
  `<li><a href="slide_${i + 1}.html" target="_blank">슬라이드 ${i + 1} — ${types[i]}</a></li>`
).join('\n');

const indexHTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>NOVA 슬라이드 미리보기 — ${TEST_TOOL}</title>
<style>
body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:40px;max-width:600px;margin:0 auto}
h1{margin-bottom:8px;color:#20B8CD}p{color:#8b949e;margin-bottom:24px}
ul{list-style:none;padding:0}
li{margin-bottom:12px}
a{display:block;padding:16px 24px;background:#161b22;border:1px solid #30363d;
  border-radius:8px;color:#58a6ff;text-decoration:none;font-size:16px}
a:hover{border-color:#20B8CD;background:#20B8CD18}
.tool{background:#20B8CD18;border:1px solid #20B8CD;border-radius:8px;
  padding:16px 24px;margin-bottom:24px;color:#20B8CD;font-weight:700;font-size:18px}
</style></head><body>
<h1>NOVA 슬라이드 미리보기</h1>
<div class="tool">🤖 ${TEST_TOOL}</div>
<p>각 슬라이드를 클릭해서 확인하세요. 실제 인스타그램 업로드 전에 내용을 검토할 수 있어요.</p>
<ul>${indexLinks}</ul>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'index.html'), indexHTML, 'utf-8');

for (let i = 0; i < 7; i++) {
  const html = makeSlideHTML(i + 1, 7, slides[keys[i]] || '', TEST_TOOL, types[i]);
  fs.writeFileSync(path.join(outDir, `slide_${i + 1}.html`), html, 'utf-8');
}

console.log(`\n✅ 미리보기 생성 완료!`);
console.log(`📁 폴더: ${outDir}`);
console.log(`🌐 열기: ${path.join(outDir, 'index.html')}\n`);

// Windows에서 자동으로 브라우저 열기
try {
  const { execSync } = await import('child_process');
  execSync(`start "" "${path.join(outDir, 'index.html')}"`);
} catch { /* 수동으로 열어도 됨 */ }
