// remotion/NovaVideo.jsx — NOVA Shorts v2 (빠른 컷 구조)
// Hook(3s) → QuickCard x4(각 2s) → CTA(3s) = 총 14초
import React from 'react';
import {
  AbsoluteFill, Sequence,
  useCurrentFrame, useVideoConfig,
  interpolate, spring,
} from 'remotion';
import { C, FONT, W, H, PAD, FPS } from './theme.js';

// ── 타이밍 상수 ───────────────────────────────────────────────────
const HOOK_DUR  = 90;   // 3s
const CARD_DUR  = 60;   // 2s × 4장
const CTA_DUR   = 90;   // 3s
const TOTAL     = HOOK_DUR + CARD_DUR * 4 + CTA_DUR; // 420프레임 = 14s

// ── 애니메이션 헬퍼 ──────────────────────────────────────────────
function useFade(delay = 0, dur = 10) {
  const frame = useCurrentFrame();
  return interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
}

function useSlideRight(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 70, stiffness: 280 } });
  return {
    opacity: interpolate(p, [0, 1], [0, 1]),
    transform: `translateX(${interpolate(p, [0, 1], [120, 0])}px)`,
  };
}

function useZoomIn(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 60, stiffness: 300 } });
  return {
    opacity: interpolate(p, [0, 1], [0, 1]),
    transform: `scale(${interpolate(p, [0, 1], [0.6, 1])})`,
  };
}

function useSlideUp(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 80, stiffness: 220 } });
  return {
    opacity: interpolate(p, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(p, [0, 1], [50, 0])}px)`,
  };
}

// ── 배경 이미지 ──────────────────────────────────────────────────
function BgImage({ src }) {
  if (!src) return null;
  return (
    <AbsoluteFill style={{ zIndex: 0 }}>
      <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <AbsoluteFill style={{ background: 'rgba(13,17,23,0.75)' }} />
    </AbsoluteFill>
  );
}

// ── 진행 바 ──────────────────────────────────────────────────────
function ProgressBar() {
  const frame = useCurrentFrame();
  const pct = Math.min((frame / (TOTAL - 1)) * 100, 100);
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 8, zIndex: 100,
      background: 'rgba(255,255,255,0.08)',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: `linear-gradient(90deg, ${C.cyan}, ${C.blue})`,
        boxShadow: `0 0 14px ${C.cyan}88`,
      }} />
    </div>
  );
}

// ── 플로팅 도트 ──────────────────────────────────────────────────
function FloatingDots({ color = C.cyan }) {
  const frame = useCurrentFrame();
  const DOTS = [
    { x: 0.10, y: 0.18, r: 9,  sp: 0.40, ph: 0.0 },
    { x: 0.90, y: 0.28, r: 6,  sp: 0.55, ph: 1.3 },
    { x: 0.22, y: 0.60, r: 11, sp: 0.30, ph: 2.6 },
    { x: 0.80, y: 0.68, r: 7,  sp: 0.50, ph: 0.9 },
    { x: 0.60, y: 0.14, r: 6,  sp: 0.65, ph: 3.2 },
    { x: 0.06, y: 0.80, r: 8,  sp: 0.35, ph: 1.9 },
    { x: 0.94, y: 0.86, r: 7,  sp: 0.48, ph: 4.1 },
    { x: 0.45, y: 0.92, r: 5,  sp: 0.60, ph: 0.5 },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
      {DOTS.map((d, i) => {
        const oy = Math.sin(frame * d.sp * 0.04 + d.ph) * 22;
        const op = interpolate(Math.sin(frame * d.sp * 0.06 + d.ph), [-1, 1], [0.30, 0.65]);
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${d.x * 100}%`,
            top: `calc(${d.y * 100}% + ${oy}px)`,
            width: d.r * 2, height: d.r * 2, borderRadius: '50%',
            background: color, opacity: op,
            boxShadow: `0 0 ${d.r * 4}px ${color}88`,
          }} />
        );
      })}
    </div>
  );
}

// ── NOVA 배지 ────────────────────────────────────────────────────
function NovaBadge({ color = C.cyan }) {
  const s = useZoomIn(0);
  return (
    <div style={{
      position: 'absolute', top: 56, right: 56, zIndex: 10,
      background: `${color}22`, border: `2px solid ${color}`,
      borderRadius: 40, padding: '14px 34px', ...s,
    }}>
      <span style={{ color, fontSize: 36, fontWeight: 900, fontFamily: FONT }}>NOVA</span>
    </div>
  );
}

// ── 슬라이드 1: 후킹 ─────────────────────────────────────────────
function HookSlide({ toolName, hookText, bgImage = '' }) {
  const frame  = useCurrentFrame();
  const bgOp   = useFade(0, 15);
  const q      = useZoomIn(5);
  const name   = useSlideUp(18);
  const sub    = useFade(28, 12);
  const pulse  = 1 + Math.sin(frame * 0.12) * 0.012;

  return (
    <AbsoluteFill style={{ background: bgImage ? 'transparent' : C.bg, fontFamily: FONT }}>
      {/* 배경 광원 */}
      <div style={{
        position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)',
        width: 900, height: 900, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.cyan}20 0%, transparent 65%)`,
        opacity: bgOp,
      }} />
      <div style={{
        position: 'absolute', bottom: -200, right: -200,
        width: 600, height: 600, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.purple}18 0%, transparent 65%)`,
      }} />

      <FloatingDots color={C.cyan} />
      <ProgressBar />
      <NovaBadge />

      {/* 콘텐츠 */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 5,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: `0 ${PAD}px`,
      }}>
        {/* 후킹 질문 */}
        <div style={{
          ...q,
          color: C.textSec, fontSize: 52, fontWeight: 700,
          textAlign: 'center', marginBottom: 40,
          wordBreak: 'keep-all', lineHeight: 1.5,
        }}>
          {hookText}
        </div>

        {/* 툴 이름 — 임팩트 */}
        <div style={{
          ...name,
          transform: `${name.transform} scale(${pulse})`,
          textAlign: 'center', marginBottom: 48,
        }}>
          <div style={{
            fontSize: 110, fontWeight: 900, lineHeight: 1.1,
            background: `linear-gradient(135deg, ${C.cyan} 0%, ${C.blue} 50%, ${C.purple} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            wordBreak: 'keep-all',
          }}>
            {toolName}
          </div>
        </div>

        {/* 서브 문구 */}
        <div style={{
          opacity: sub,
          color: C.textMute, fontSize: 42, textAlign: 'center',
          wordBreak: 'keep-all',
        }}>
          지금 바로 확인하세요 👇
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 퀵카드 ───────────────────────────────────────────────────────
const CARD_COLORS  = [C.cyan, C.purple, C.green, C.blue];
const CARD_ICONS   = ['⚡', '💡', '✅', '🚀'];
const CARD_LABELS  = ['핵심 기능', '실제 사용 예시', '장점', '시작 방법'];

function QuickCardSlide({ text, idx, bgImage = '' }) {
  const color  = CARD_COLORS[idx % 4];
  const icon   = CARD_ICONS[idx % 4];
  const label  = CARD_LABELS[idx % 4];
  const bgOp   = useFade(0, 8);
  const card   = useSlideRight(5);
  const num    = useZoomIn(0);

  return (
    <AbsoluteFill style={{ background: bgImage ? 'transparent' : C.bg, opacity: bgOp, fontFamily: FONT }}>
      {/* 배경 */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 800, height: 800, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}12 0%, transparent 60%)`,
      }} />

      <FloatingDots color={color} />
      <ProgressBar />
      <NovaBadge color={color} />

      {/* 번호 */}
      <div style={{
        position: 'absolute', top: 160, left: PAD, zIndex: 10, ...num,
        color: color, fontSize: 32, fontWeight: 700, opacity: 0.6,
      }}>
        {idx + 1} / 4
      </div>

      {/* 카드 */}
      <div style={{
        position: 'absolute', zIndex: 10,
        top: '50%', left: PAD, right: PAD,
        transform: `translateY(-50%) ${card.transform}`,
        opacity: card.opacity,
      }}>
        {/* 레이블 */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 12,
          background: `${color}22`, border: `2px solid ${color}`,
          borderRadius: 30, padding: '12px 28px', marginBottom: 36,
        }}>
          <span style={{ fontSize: 36 }}>{icon}</span>
          <span style={{ color, fontSize: 32, fontWeight: 700 }}>{label}</span>
        </div>

        {/* 메인 텍스트 */}
        <div style={{
          background: 'rgba(22,27,34,0.92)',
          border: `1px solid ${color}44`,
          borderLeft: `8px solid ${color}`,
          borderRadius: 28, padding: '52px 56px',
          boxShadow: `0 0 60px ${color}18`,
        }}>
          <div style={{
            color: C.textPri, fontSize: 54, fontWeight: 800,
            lineHeight: 1.55, wordBreak: 'keep-all',
          }}>
            {text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── CTA 슬라이드 ─────────────────────────────────────────────────
function CTASlide({ toolName, bgImage = '' }) {
  const frame  = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgOp   = useFade(0, 12);
  const title  = useSlideUp(5);
  const btn    = useSlideUp(20);
  const hash   = useFade(32, 10);
  const pulse  = 1 + Math.sin(frame * 0.14) * 0.025;

  return (
    <AbsoluteFill style={{ background: bgImage ? 'transparent' : C.bg, opacity: bgOp, fontFamily: FONT }}>
      <div style={{
        position: 'absolute', top: -180, right: -180,
        width: 660, height: 660, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.cyan}22 0%, transparent 65%)`,
      }} />
      <div style={{
        position: 'absolute', bottom: -180, left: -180,
        width: 560, height: 560, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.purple}18 0%, transparent 65%)`,
      }} />

      <FloatingDots color={C.green} />
      <ProgressBar />
      <NovaBadge />

      <div style={{
        position: 'absolute', inset: 0, zIndex: 5,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: `0 ${PAD}px`,
      }}>
        {/* 타이틀 */}
        <div style={{ ...title, textAlign: 'center', marginBottom: 56 }}>
          <div style={{ fontSize: 90, marginBottom: 20 }}>🚀</div>
          <div style={{
            color: C.textPri, fontSize: 72, fontWeight: 900,
            lineHeight: 1.2, wordBreak: 'keep-all',
          }}>
            {toolName}<br />
            <span style={{ color: C.cyan }}>지금 무료로 시작</span>
          </div>
        </div>

        {/* 구독 버튼 */}
        <div style={{
          ...btn,
          transform: `${btn.transform} scale(${pulse})`,
          background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`,
          borderRadius: 72, padding: '44px 96px',
          color: '#fff', fontSize: 52, fontWeight: 900,
          boxShadow: `0 0 80px ${C.cyan}55`,
          marginBottom: 56,
        }}>
          구독 + 알림 설정 🔔
        </div>

        {/* 해시태그 */}
        <div style={{
          opacity: hash,
          color: C.textMute, fontSize: 36, textAlign: 'center',
        }}>
          #NOVA #AI툴 #오늘의AI #인공지능
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 메인 컴포지션 ────────────────────────────────────────────────
export function NovaVideo({ toolName, hookText, bullets, featuresKr, scenarioKr, bgImage = '' }) {
  const cards = (bullets || []).slice(0, 4);
  // research-agent 데이터 우선 반영
  if (featuresKr) cards[0] = featuresKr.replace(/\//g, '  /  ');
  if (scenarioKr) cards[1] = scenarioKr;
  // 부족하면 기본값 채우기
  while (cards.length < 4) {
    cards.push(['핵심 작업에 특화된 AI', '무료로 바로 시작 가능', '결과물 즉시 활용', '링크는 바이오 참고'][cards.length]);
  }

  let from = 0;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      <BgImage src={bgImage} />

      {/* Hook */}
      <Sequence from={from} durationInFrames={HOOK_DUR}>
        <HookSlide toolName={toolName} hookText={hookText || `${toolName} 이거 알아요?`} bgImage={bgImage} />
      </Sequence>

      {/* QuickCards */}
      {cards.map((text, i) => {
        from = HOOK_DUR + i * CARD_DUR;
        return (
          <Sequence key={i} from={HOOK_DUR + i * CARD_DUR} durationInFrames={CARD_DUR}>
            <QuickCardSlide text={text} idx={i} bgImage={bgImage} />
          </Sequence>
        );
      })}

      {/* CTA */}
      <Sequence from={HOOK_DUR + CARD_DUR * 4} durationInFrames={CTA_DUR}>
        <CTASlide toolName={toolName} bgImage={bgImage} />
      </Sequence>
    </AbsoluteFill>
  );
}
