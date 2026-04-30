// scripts/generate_slides.js — Puppeteer HTML → PNG → FFmpeg 슬라이드 영상 생성
import fs from 'fs';
import { execSync } from 'child_process';

const C = {
  bg: '#0d1117', card: '#161b22',
  cyan: '#20B8CD', blue: '#58a6ff', purple: '#bc8cff',
  green: '#3fb950',
  pri: '#e6edf3', sec: '#8b949e', mute: '#484f58',
};
const FONT = "'NanumGothic','Noto Sans CJK KR','맑은 고딕',sans-serif";

function baseCSS() {
  return `
    *{margin:0;padding:0;box-sizing:border-box;}
    body{width:1080px;height:1920px;overflow:hidden;background:${C.bg};
      font-family:${FONT};color:${C.pri};-webkit-font-smoothing:antialiased;}
    .slide{width:1080px;height:1920px;position:relative;overflow:hidden;}
    .badge{position:absolute;top:56px;right:56px;z-index:20;
      border:2px solid ${C.cyan};border-radius:40px;padding:14px 34px;
      color:${C.cyan};font-size:34px;font-weight:900;background:${C.cyan}22;letter-spacing:2px;}
    .pbar{position:absolute;top:0;left:0;right:0;height:8px;
      background:linear-gradient(90deg,${C.cyan},${C.blue});z-index:30;}
    .num{position:absolute;top:164px;left:80px;font-size:30px;font-weight:700;opacity:0.55;}
  `;
}

function dots(color = C.cyan) {
  const pts = [[110,345,9],[970,536,6],[238,1150,11],[864,1306,7],[648,268,6],[65,1536,8],[1015,1651,7],[486,1766,5]];
  return `<svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1"
    viewBox="0 0 1080 1920">${pts.map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.3"/>`).join('')}</svg>`;
}

// ── 슬라이드 1: HOOK ───────────────────────────────────────────────
function hookHTML({ toolName, hookText, bgImage }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseCSS()}
    .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
        opacity:0.22;filter:blur(14px);transform:scale(1.05);}
    .ov{position:absolute;inset:0;
        background:linear-gradient(to bottom,rgba(13,17,23,.45) 0%,rgba(13,17,23,.82) 55%,rgba(13,17,23,.98) 100%);}
    .cnt{position:absolute;inset:0;display:flex;flex-direction:column;
         align-items:center;justify-content:center;padding:80px;gap:0;}
    .hook{font-size:50px;font-weight:700;color:${C.sec};text-align:center;
          word-break:keep-all;line-height:1.5;margin-bottom:36px;}
    .tool{font-size:108px;font-weight:900;text-align:center;line-height:1.05;
          word-break:keep-all;margin-bottom:44px;
          background:linear-gradient(135deg,${C.cyan} 0%,${C.blue} 50%,${C.purple} 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
    .sub{font-size:42px;color:${C.mute};}
  </style></head><body><div class="slide">
    ${bgImage?`<img class="bg" src="${bgImage}">`:''}
    <div class="ov"></div>${dots(C.cyan)}
    <div class="cnt">
      <div class="hook">${hookText}</div>
      <div class="tool">${toolName}</div>
      <div class="sub">지금 바로 확인하세요 👇</div>
    </div>
    <div class="badge">NOVA</div><div class="pbar"></div>
  </div></body></html>`;
}

// ── 슬라이드 2: 실제 툴 스크린샷 ────────────────────────────────────
function screenshotHTML({ toolName, screenshotImage, featureText }) {
  const hasImg = !!screenshotImage;
  // 스크린샷: 1440x810 데스크톱 → 1000x563 표시 (16:9 비율 유지)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseCSS()}
    .frame{position:absolute;top:130px;left:40px;right:40px;border-radius:18px;
           overflow:hidden;border:1.5px solid ${C.cyan}44;
           box-shadow:0 0 60px ${C.cyan}22,0 28px 80px rgba(0,0,0,.7);}
    .bar{background:#1c2128;padding:16px 22px;display:flex;align-items:center;
         gap:10px;border-bottom:1px solid #30363d;}
    .dot{width:14px;height:14px;border-radius:50%;}
    .url{background:#21262d;border-radius:8px;flex:1;height:34px;border:1px solid #30363d;}
    .shot{width:1000px;height:563px;object-fit:cover;object-position:top center;display:block;}
    .noshot{width:1000px;height:400px;display:flex;align-items:center;justify-content:center;
            background:${C.card};color:${C.mute};font-size:40px;}
    .txt{position:absolute;bottom:70px;left:60px;right:60px;
         background:rgba(22,27,34,.95);border:1px solid ${C.cyan}44;
         border-left:8px solid ${C.cyan};border-radius:24px;padding:42px 50px;
         box-shadow:0 0 60px ${C.cyan}18;}
    .lbl{display:inline-flex;align-items:center;gap:10px;background:${C.cyan}22;
         border:2px solid ${C.cyan};border-radius:28px;padding:10px 24px;
         margin-bottom:22px;color:${C.cyan};font-size:28px;font-weight:700;}
    .ft{font-size:${hasImg?46:52}px;font-weight:800;line-height:1.5;word-break:keep-all;}
  </style></head><body><div class="slide">
    <div class="num" style="color:${C.cyan}">1 / 4</div>
    <div class="frame">
      <div class="bar">
        <div class="dot" style="background:#ff5f57"></div>
        <div class="dot" style="background:#febc2e"></div>
        <div class="dot" style="background:#28c840"></div>
        <div class="url"></div>
      </div>
      ${hasImg?`<img class="shot" src="${screenshotImage}">`:`<div class="noshot">${toolName}</div>`}
    </div>
    <div class="txt">
      <div class="lbl">⚡ 핵심 기능</div>
      <div class="ft">${featureText}</div>
    </div>
    <div class="badge">NOVA</div><div class="pbar"></div>
  </div></body></html>`;
}

// ── 슬라이드 3-5: 피처 카드 ──────────────────────────────────────────
const CARDS = [
  { color: C.purple, icon: '💡', label: '실제 사용 예시' },
  { color: C.green,  icon: '✅', label: '이런 분께 추천' },
  { color: C.blue,   icon: '🚀', label: '시작 방법' },
];

function cardHTML({ text, idx, bgImage }) {
  const { color, icon, label } = CARDS[idx % CARDS.length];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseCSS()}
    .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
        opacity:0.12;filter:blur(14px);transform:scale(1.05);}
    .ov{position:absolute;inset:0;background:rgba(13,17,23,.88);}
    .glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
          width:860px;height:860px;border-radius:50%;
          background:radial-gradient(circle,${color}14 0%,transparent 60%);}
    .wrap{position:absolute;top:50%;left:80px;right:80px;transform:translateY(-50%);}
    .lbl{display:inline-flex;align-items:center;gap:12px;background:${color}22;
         border:2px solid ${color};border-radius:30px;padding:12px 28px;
         margin-bottom:36px;color:${color};font-size:32px;font-weight:700;}
    .box{background:rgba(22,27,34,.92);border:1px solid ${color}44;
         border-left:8px solid ${color};border-radius:28px;padding:52px 56px;
         box-shadow:0 0 60px ${color}18;}
    .ct{font-size:56px;font-weight:800;line-height:1.55;word-break:keep-all;}
  </style></head><body><div class="slide">
    ${bgImage?`<img class="bg" src="${bgImage}">`:''}
    <div class="ov"></div><div class="glow"></div>${dots(color)}
    <div class="num" style="color:${color}">${idx+2} / 4</div>
    <div class="wrap">
      <div class="lbl"><span style="font-size:36px">${icon}</span>${label}</div>
      <div class="box"><div class="ct">${text}</div></div>
    </div>
    <div class="badge" style="border-color:${color};color:${color};background:${color}22;">NOVA</div>
    <div class="pbar" style="background:${color};"></div>
  </div></body></html>`;
}

// ── 슬라이드 6: CTA ──────────────────────────────────────────────────
function ctaHTML({ toolName, bgImage }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseCSS()}
    .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
        opacity:0.18;filter:blur(16px);transform:scale(1.05);}
    .ov{position:absolute;inset:0;
        background:linear-gradient(to bottom,rgba(13,17,23,.6),rgba(13,17,23,.97));}
    .cnt{position:absolute;inset:0;display:flex;flex-direction:column;
         align-items:center;justify-content:center;padding:80px;}
    .em{font-size:96px;margin-bottom:24px;}
    .ttl{font-size:78px;font-weight:900;text-align:center;line-height:1.2;
         word-break:keep-all;margin-bottom:52px;}
    .sub{color:${C.cyan};}
    .btn{background:linear-gradient(135deg,${C.cyan},${C.blue});border-radius:72px;
         padding:44px 96px;font-size:50px;font-weight:900;color:#fff;
         margin-bottom:48px;box-shadow:0 0 80px ${C.cyan}55;}
    .tags{color:${C.mute};font-size:34px;text-align:center;line-height:1.9;}
  </style></head><body><div class="slide">
    ${bgImage?`<img class="bg" src="${bgImage}">`:''}
    <div class="ov"></div>${dots(C.green)}
    <div class="cnt">
      <div class="em">🚀</div>
      <div class="ttl">${toolName}<br><span class="sub">지금 무료로 시작</span></div>
      <div class="btn">구독 + 알림 설정 🔔</div>
      <div class="tags">#NOVA #AI툴 #오늘의AI #인공지능</div>
    </div>
    <div class="badge">NOVA</div>
    <div class="pbar" style="background:${C.green};"></div>
  </div></body></html>`;
}

// ── 메인: 슬라이드 영상 생성 ─────────────────────────────────────────
export async function generateSlideVideo(props, outputPath) {
  const { toolName, hookText, bullets = [], featuresKr, scenarioKr,
          bgImage = '', screenshotImage = '', totalFrames = 450 } = props;

  const FPS = 30;
  const totalSec = totalFrames / FPS;

  // 슬라이드별 재생 시간 (초)
  const hookSec  = +(totalSec * 0.20).toFixed(1);
  const shotSec  = +(totalSec * 0.22).toFixed(1);
  const c1Sec    = +(totalSec * 0.15).toFixed(1);
  const c2Sec    = +(totalSec * 0.15).toFixed(1);
  const ctaSec   = Math.max(2.5, +(totalSec - hookSec - shotSec - c1Sec - c2Sec).toFixed(1));

  const cards = [
    featuresKr  || bullets[0] || '핵심 기능 특화 AI',
    scenarioKr  || bullets[1] || '실제 업무에 즉시 활용',
    bullets[2]  || '무료로 바로 시작 가능',
  ];

  const slides = [
    { html: hookHTML({ toolName, hookText: hookText || `${toolName} 이거 알아요?`, bgImage }), sec: hookSec },
    { html: screenshotHTML({ toolName, screenshotImage, featureText: cards[0] }), sec: shotSec },
    { html: cardHTML({ text: cards[1], idx: 0, bgImage }), sec: c1Sec },
    { html: cardHTML({ text: cards[2], idx: 1, bgImage }), sec: c2Sec },
    { html: ctaHTML({ toolName, bgImage }), sec: ctaSec },
  ];

  // 1) Puppeteer로 슬라이드별 PNG 생성
  const puppeteer = (await import('puppeteer')).default;
  const chromePaths = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const executablePath = chromePaths.find(p => fs.existsSync(p));
  const launchOpts = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (executablePath) launchOpts.executablePath = executablePath;

  const browser = await puppeteer.launch(launchOpts);
  const pngs = [];

  for (let i = 0; i < slides.length; i++) {
    const p = `/tmp/nova_slide_${i}.png`;
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.setContent(slides[i].html, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await new Promise(r => setTimeout(r, 400)); // 폰트 렌더 대기
    await page.screenshot({ path: p, type: 'png' });
    await page.close();
    pngs.push(p);
    console.log(`  🖼️  슬라이드 ${i + 1}/${slides.length} (${slides[i].sec}초)`);
  }
  await browser.close();

  // 2) 각 PNG → 짧은 mp4 클립
  const clips = [];
  for (let i = 0; i < slides.length; i++) {
    const c = `/tmp/nova_clip_${i}.mp4`;
    execSync(
      `ffmpeg -y -loop 1 -t ${slides[i].sec} -i "${pngs[i]}" ` +
      `-vf "scale=1080:1920:flags=lanczos,format=yuv420p" -r 30 -c:v libx264 -preset fast -crf 20 "${c}"`,
      { stdio: 'pipe' }
    );
    clips.push(c);
  }

  // 3) concat → output_silent.mp4
  const listFile = '/tmp/nova_concat.txt';
  fs.writeFileSync(listFile, clips.map(c => `file '${c}'`).join('\n'));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outputPath}"`,
    { stdio: 'pipe' }
  );

  // 정리
  [...pngs, ...clips, listFile].forEach(f => { try { fs.unlinkSync(f); } catch {} });
  console.log(`✅ 슬라이드 영상 생성 완료: ${outputPath}`);
}
