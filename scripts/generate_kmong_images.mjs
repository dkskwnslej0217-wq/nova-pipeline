// scripts/generate_kmong_images.mjs
// 크몽 서비스 등록용 이미지 자동 생성
// 실행: node scripts/generate_kmong_images.mjs

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUT_DIR = './kmong_assets';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// Pollinations.ai 이미지 다운로드
async function fetchImage(prompt, width, height) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&model=flux&enhance=true&seed=${Math.floor(Math.random()*9999)}`;
  console.log(`  이미지 생성 중: ${prompt.slice(0, 40)}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 생성 실패: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// SVG 텍스트 오버레이 생성
function makeSVGOverlay(width, height, lines) {
  const svgLines = lines.map(({ text, x, y, size, color, bold, align }) => {
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const weight = bold ? '700' : '400';
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-family="Arial, sans-serif" font-weight="${weight}" text-anchor="${anchor}">${text}</text>`;
  }).join('\n');

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${svgLines}
    </svg>
  `);
}

// ── 1. 대표 썸네일 (652x488 — 크몽 메인이미지 규격) ─────────────
async function makeThumbnail() {
  console.log('\n[1/4] 대표 썸네일 생성...');
  const bg = await fetchImage(
    'modern tech workspace with laptop glowing screens automation data flow, dark blue purple gradient, professional, no text, cinematic',
    652, 488
  );

  // 어두운 오버레이
  const overlay = Buffer.from(`
    <svg width="652" height="488" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0a0a2e;stop-opacity:0.75"/>
          <stop offset="100%" style="stop-color:#1a0533;stop-opacity:0.6"/>
        </linearGradient>
      </defs>
      <rect width="652" height="488" fill="url(#g)"/>
      <!-- 배지 -->
      <rect x="36" y="36" width="120" height="32" rx="16" fill="#6C63FF"/>
      <text x="96" y="58" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">AI 자동화</text>
      <!-- 메인 타이틀 -->
      <text x="36" y="180" font-size="38" fill="white" font-family="Arial" font-weight="800">SNS 자동 운영</text>
      <text x="36" y="228" font-size="38" fill="#A78BFA" font-family="Arial" font-weight="800">완전 세팅 가이드</text>
      <!-- 서브 -->
      <text x="36" y="275" font-size="17" fill="#CBD5E1" font-family="Arial">인스타 · 페북 · 유튜브 한 번에 자동화</text>
      <!-- 가격 -->
      <rect x="36" y="318" width="175" height="46" rx="8" fill="#6C63FF"/>
      <text x="124" y="349" font-size="20" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">&#8361;9,900~</text>
      <!-- 우측 아이콘 영역 -->
      <text x="560" y="250" font-size="80" text-anchor="middle">&#129302;</text>
    </svg>
  `);

  await sharp(bg)
    .resize(652, 488)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toFile(`${OUT_DIR}/01_thumbnail.jpg`);
  console.log('  ✅ 01_thumbnail.jpg (652x488)');
}

// ── 2. 서비스 소개 이미지 (800x600) ─────────────────────────────
async function makeIntro() {
  console.log('\n[2/4] 서비스 소개 이미지 생성...');
  const bg = await fetchImage(
    'clean white minimal infographic background, soft gradient, professional business, no text',
    800, 600
  );

  const overlay = Buffer.from(`
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="600" fill="white" opacity="0.88"/>
      <!-- 헤더 -->
      <rect width="800" height="80" fill="#6C63FF"/>
      <text x="400" y="50" font-size="26" fill="white" font-family="Arial" font-weight="800" text-anchor="middle">📦 서비스 구성</text>

      <!-- 항목 1 -->
      <rect x="40" y="110" width="340" height="160" rx="12" fill="#F3F0FF" stroke="#6C63FF" stroke-width="2"/>
      <text x="60" y="148" font-size="18" fill="#6C63FF" font-family="Arial" font-weight="700">✅ BASIC — 9,900원</text>
      <text x="60" y="178" font-size="14" fill="#334155" font-family="Arial">• SNS 자동화 세팅 가이드 PDF</text>
      <text x="60" y="200" font-size="14" fill="#334155" font-family="Arial">• Make.com 시나리오 파일</text>
      <text x="60" y="222" font-size="14" fill="#334155" font-family="Arial">• Vercel 배포 가이드</text>
      <text x="60" y="244" font-size="14" fill="#334155" font-family="Arial">• 평생 업데이트</text>

      <!-- 항목 2 -->
      <rect x="420" y="110" width="340" height="160" rx="12" fill="#FFF7ED" stroke="#F97316" stroke-width="2"/>
      <text x="440" y="148" font-size="18" fill="#F97316" font-family="Arial" font-weight="700">⭐ STANDARD — 29,900원</text>
      <text x="440" y="178" font-size="14" fill="#334155" font-family="Arial">• BASIC 전체 포함</text>
      <text x="440" y="200" font-size="14" fill="#334155" font-family="Arial">• 1:1 세팅 원격 지원 (1회)</text>
      <text x="440" y="222" font-size="14" fill="#334155" font-family="Arial">• 플랫폼별 콘텐츠 전략</text>
      <text x="440" y="244" font-size="14" fill="#334155" font-family="Arial">• 카카오톡 1주일 A/S</text>

      <!-- 항목 3 -->
      <rect x="40" y="300" width="720" height="120" rx="12" fill="#F0FDF4" stroke="#22C55E" stroke-width="2"/>
      <text x="60" y="338" font-size="18" fill="#16A34A" font-family="Arial" font-weight="700">🚀 PREMIUM — 99,000원</text>
      <text x="60" y="368" font-size="14" fill="#334155" font-family="Arial">• STANDARD 전체 포함  •  내 계정 직접 세팅 대행  •  한 달 운영 세팅 완료  •  30일 A/S 보장</text>

      <!-- 하단 -->
      <rect x="40" y="450" width="720" height="60" rx="12" fill="#1E293B"/>
      <text x="400" y="488" font-size="16" fill="#94A3B8" font-family="Arial" text-anchor="middle">📩 구매 전 문의 환영 · 당일 납품 · 수정 1회 무료</text>
    </svg>
  `);

  await sharp(bg)
    .resize(800, 600)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toFile(`${OUT_DIR}/02_service_intro.jpg`);
  console.log('  ✅ 02_service_intro.jpg');
}

// ── 3. 포트폴리오 — 파이프라인 흐름도 (800x500) ─────────────────
async function makePortfolio() {
  console.log('\n[3/4] 포트폴리오 이미지 생성...');

  const overlay = Buffer.from(`
    <svg width="800" height="500" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="500" fill="#0F172A"/>
      <!-- 타이틀 -->
      <text x="400" y="50" font-size="22" fill="white" font-family="Arial" font-weight="800" text-anchor="middle">🔄 자동화 파이프라인 흐름</text>

      <!-- 단계들 -->
      <!-- Step 1 -->
      <rect x="30" y="90" width="130" height="70" rx="10" fill="#6C63FF"/>
      <text x="95" y="125" font-size="13" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">📊 트렌드 수집</text>
      <text x="95" y="145" font-size="11" fill="#DDD6FE" font-family="Arial" text-anchor="middle">YouTube API</text>

      <!-- 화살표 -->
      <text x="175" y="130" font-size="24" fill="#6C63FF">→</text>

      <!-- Step 2 -->
      <rect x="205" y="90" width="130" height="70" rx="10" fill="#8B5CF6"/>
      <text x="270" y="125" font-size="13" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">🤖 AI 글 생성</text>
      <text x="270" y="145" font-size="11" fill="#DDD6FE" font-family="Arial" text-anchor="middle">Groq + Gemini</text>

      <text x="350" y="130" font-size="24" fill="#8B5CF6">→</text>

      <!-- Step 3 -->
      <rect x="380" y="90" width="130" height="70" rx="10" fill="#A855F7"/>
      <text x="445" y="125" font-size="13" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">🖼️ 이미지 생성</text>
      <text x="445" y="145" font-size="11" fill="#DDD6FE" font-family="Arial" text-anchor="middle">AI 자동 제작</text>

      <text x="525" y="130" font-size="24" fill="#A855F7">→</text>

      <!-- Step 4 -->
      <rect x="555" y="90" width="130" height="70" rx="10" fill="#EC4899"/>
      <text x="620" y="118" font-size="13" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">📱 자동 발행</text>
      <text x="620" y="138" font-size="11" fill="#FDE8EF" font-family="Arial" text-anchor="middle">인스타 · 페북</text>
      <text x="620" y="154" font-size="11" fill="#FDE8EF" font-family="Arial" text-anchor="middle">유튜브 동시</text>

      <!-- 결과 -->
      <rect x="100" y="240" width="600" height="100" rx="14" fill="#1E293B" stroke="#334155" stroke-width="1"/>
      <text x="400" y="278" font-size="16" fill="#94A3B8" font-family="Arial" text-anchor="middle">⏱️ 매일 오전 9시 자동 실행</text>
      <text x="400" y="308" font-size="20" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">사람 손 없이 365일 운영</text>

      <!-- 플랫폼 아이콘 -->
      <text x="200" y="420" font-size="40" text-anchor="middle">📸</text>
      <text x="200" y="460" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">Instagram</text>

      <text x="400" y="420" font-size="40" text-anchor="middle">📘</text>
      <text x="400" y="460" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">Facebook</text>

      <text x="600" y="420" font-size="40" text-anchor="middle">📺</text>
      <text x="600" y="460" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">YouTube</text>
    </svg>
  `);

  await sharp({ create: { width: 800, height: 500, channels: 4, background: '#0F172A' } })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toFile(`${OUT_DIR}/03_portfolio_flow.jpg`);
  console.log('  ✅ 03_portfolio_flow.jpg');
}

// ── 4. 후기/신뢰 이미지 (800x400) ────────────────────────────────
async function makeTrust() {
  console.log('\n[4/4] 신뢰 이미지 생성...');

  const overlay = Buffer.from(`
    <svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="400" fill="#0F172A"/>
      <text x="400" y="55" font-size="22" fill="white" font-family="Arial" font-weight="800" text-anchor="middle">💡 이런 분께 추천합니다</text>

      <!-- 카드들 -->
      <rect x="30" y="80" width="220" height="130" rx="12" fill="#1E293B"/>
      <text x="140" y="118" font-size="28" text-anchor="middle">😓</text>
      <text x="140" y="150" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">SNS 관리할 시간</text>
      <text x="140" y="170" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">없는 직장인</text>
      <text x="140" y="195" font-size="12" fill="#64748B" font-family="Arial" text-anchor="middle">퇴근 후 피곤한데</text>

      <rect x="290" y="80" width="220" height="130" rx="12" fill="#1E293B"/>
      <text x="400" y="118" font-size="28" text-anchor="middle">💸</text>
      <text x="400" y="150" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">월급 외 수익</text>
      <text x="400" y="170" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">원하는 분</text>
      <text x="400" y="195" font-size="12" fill="#64748B" font-family="Arial" text-anchor="middle">자면서도 올라가는 콘텐츠</text>

      <rect x="550" y="80" width="220" height="130" rx="12" fill="#1E293B"/>
      <text x="660" y="118" font-size="28" text-anchor="middle">🚀</text>
      <text x="660" y="150" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">브랜드 계정</text>
      <text x="660" y="170" font-size="14" fill="white" font-family="Arial" font-weight="700" text-anchor="middle">키우고 싶은 분</text>
      <text x="660" y="195" font-size="12" fill="#64748B" font-family="Arial" text-anchor="middle">소상공인 · 1인 브랜드</text>

      <!-- 하단 통계 -->
      <rect x="30" y="240" width="740" height="80" rx="12" fill="#6C63FF" opacity="0.15" stroke="#6C63FF" stroke-width="1"/>
      <text x="200" y="280" font-size="28" fill="#A78BFA" font-family="Arial" font-weight="800" text-anchor="middle">365일</text>
      <text x="200" y="305" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">자동 운영</text>
      <text x="400" y="280" font-size="28" fill="#A78BFA" font-family="Arial" font-weight="800" text-anchor="middle">3개 플랫폼</text>
      <text x="400" y="305" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">동시 발행</text>
      <text x="600" y="280" font-size="28" fill="#A78BFA" font-family="Arial" font-weight="800" text-anchor="middle">0원/월</text>
      <text x="600" y="305" font-size="13" fill="#94A3B8" font-family="Arial" text-anchor="middle">운영 비용</text>

      <!-- 하단 -->
      <text x="400" y="370" font-size="14" fill="#475569" font-family="Arial" text-anchor="middle">⭐ 구매 후 만족 못하시면 전액 환불 보장</text>
    </svg>
  `);

  await sharp({ create: { width: 800, height: 400, channels: 4, background: '#0F172A' } })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toFile(`${OUT_DIR}/04_trust.jpg`);
  console.log('  ✅ 04_trust.jpg');
}

// ── 실행 ──────────────────────────────────────────────────────────
async function run() {
  console.log('🎨 크몽 이미지 생성 시작...\n');
  await makeThumbnail();
  await makeIntro();
  await makePortfolio();
  await makeTrust();
  console.log(`\n✅ 완료! ${OUT_DIR}/ 폴더에 저장됨`);
  console.log('📁 파일 목록:');
  console.log('  01_thumbnail.jpg     → 크몽 대표 이미지');
  console.log('  02_service_intro.jpg → 서비스 구성 상세');
  console.log('  03_portfolio_flow.jpg → 포트폴리오 (파이프라인 흐름)');
  console.log('  04_trust.jpg         → 신뢰/추천 이미지');
}

run().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
