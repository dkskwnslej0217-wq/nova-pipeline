// remotion/NovaVideo.jsx — NOVA 영상 컴포지션 (5슬라이드 애니메이션)
import React from 'react';
import {
  AbsoluteFill, Sequence, Img,
  useCurrentFrame, useVideoConfig,
  interpolate, spring,
} from 'remotion';
import { C, FONT, PAD } from './theme.js';

// ── 애니메이션 헬퍼 ───────────────────────────────────────────────
function useFadeIn(delay = 0, dur = 15) {
  const frame = useCurrentFrame();
  return interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
}

function useSlideUp(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 80, stiffness: 220 } });
  return {
    opacity: interpolate(p, [0, 1], [0, 1]),
    transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`,
  };
}

function useScaleIn(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 100, stiffness: 260 } });
  return {
    opacity: interpolate(p, [0, 1], [0, 1]),
    transform: `scale(${interpolate(p, [0, 1], [0.88, 1])})`,
  };
}

// ── 진행 바 ───────────────────────────────────────────────────────
function ProgressBar({ currentSlide, totalSlides }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      height: 8, zIndex: 100,
      background: 'rgba(255,255,255,0.08)',
    }}>
      <div style={{
        height: '100%',
        width: `${((currentSlide + 1) / totalSlides) * 100}%`,
        background: `linear-gradient(90deg, ${C.cyan}, ${C.blue})`,
        boxShadow: `0 0 12px ${C.cyan}88`,
        transition: 'width 0.3s ease',
      }} />
      {/* 슬라이드 구분점 */}
      {Array.from({ length: totalSlides }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: `${((i + 1) / totalSlides) * 100}%`,
          transform: 'translate(-50%, -50%)',
          width: 14, height: 14, borderRadius: '50%',
          background: i < currentSlide + 1 ? C.cyan : 'rgba(255,255,255,0.15)',
          boxShadow: i < currentSlide + 1 ? `0 0 8px ${C.cyan}` : 'none',
        }} />
      ))}
    </div>
  );
}

// ── 플로팅 도트 (배경 파티클) ─────────────────────────────────────
function FloatingDots({ accentColor = C.cyan }) {
  const frame = useCurrentFrame();
  const DOTS = [
    { x: 0.12, y: 0.22, size: 6, speed: 0.4, phase: 0 },
    { x: 0.88, y: 0.35, size: 4, speed: 0.6, phase: 1.2 },
    { x: 0.25, y: 0.65, size: 8, speed: 0.3, phase: 2.5 },
    { x: 0.75, y: 0.72, size: 5, speed: 0.5, phase: 0.8 },
    { x: 0.55, y: 0.18, size: 4, speed: 0.7, phase: 3.1 },
    { x: 0.08, y: 0.82, size: 6, speed: 0.35, phase: 1.8 },
    { x: 0.92, y: 0.88, size: 5, speed: 0.55, phase: 4.0 },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
      {DOTS.map((d, i) => {
        const offsetY = Math.sin((frame * d.speed * 0.04) + d.phase) * 18;
        const opacity = interpolate(Math.sin((frame * d.speed * 0.06) + d.phase), [-1, 1], [0.15, 0.45]);
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${d.x * 100}%`,
            top: `calc(${d.y * 100}% + ${offsetY}px)`,
            width: d.size * 2,
            height: d.size * 2,
            borderRadius: '50%',
            background: accentColor,
            opacity,
            boxShadow: `0 0 ${d.size * 3}px ${accentColor}66`,
          }} />
        );
      })}
    </div>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────
function NovaBadge() {
  const style = useScaleIn(0);
  return (
    <div style={{
      position: 'absolute', top: 60, right: 60,
      background: `${C.cyan}22`,
      border: `2px solid ${C.cyan}`,
      borderRadius: 40, padding: '16px 36px',
      ...style,
    }}>
      <span style={{ color: C.cyan, fontSize: 38, fontWeight: 900, fontFamily: FONT }}>NOVA</span>
    </div>
  );
}

function SlideWrap({ children, accentColor }) {
  const opacity = useFadeIn(0, 12);
  return (
    <AbsoluteFill style={{ background: C.bg, opacity, fontFamily: FONT }}>
      <FloatingDots accentColor={accentColor || C.cyan} />
      {children}
    </AbsoluteFill>
  );
}

function Badge({ label, color }) {
  const style = useScaleIn(5);
  return (
    <div style={{
      display: 'inline-block',
      background: `${color}22`,
      border: `2px solid ${color}`,
      borderRadius: 20, padding: '12px 32px',
      marginBottom: 48, ...style,
    }}>
      <span style={{ color, fontSize: 36, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

// ── 슬라이드 1: 후킹 — 툴 스크린샷 배경 ──────────────────────────
export function Slide1({ toolName, toolDesc, screenshotDataUrl }) {
  const bgOpacity  = useFadeIn(0, 20);
  const textStyle  = useSlideUp(12);
  const ctaStyle   = useSlideUp(28);

  return (
    <AbsoluteFill>
      {screenshotDataUrl ? (
        <Img
          src={screenshotDataUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: bgOpacity }}
        />
      ) : (
        <AbsoluteFill style={{
          background: `linear-gradient(160deg, #0d1117 0%, #1a1f2e 50%, #0d1117 100%)`,
          opacity: bgOpacity,
        }} />
      )}

      {/* 다크 그라데이션 오버레이 */}
      <AbsoluteFill style={{
        background: `linear-gradient(180deg,
          rgba(13,17,23,0.15) 0%,
          rgba(13,17,23,0.35) 35%,
          rgba(13,17,23,0.80) 60%,
          rgba(13,17,23,0.97) 85%,
          rgba(13,17,23,1.00) 100%)`,
      }} />

      <NovaBadge />

      {/* 하단 콘텐츠 */}
      <div style={{
        position: 'absolute', bottom: 180, left: PAD, right: PAD,
        ...textStyle,
      }}>
        <div style={{ color: C.cyan, fontSize: 40, fontWeight: 700, marginBottom: 24 }}>
          오늘의 AI 툴
        </div>
        <div style={{
          color: C.textPri, fontSize: 92, fontWeight: 900, lineHeight: 1.1,
          marginBottom: 28, wordBreak: 'keep-all',
        }}>
          {toolName}
        </div>
        <div style={{
          color: C.textSec, fontSize: 44, lineHeight: 1.55,
          marginBottom: 64, wordBreak: 'keep-all',
        }}>
          {toolDesc}
        </div>

        <div style={{ ...ctaStyle, display: 'inline-block' }}>
          <div style={{
            background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`,
            borderRadius: 60, padding: '30px 72px',
            color: '#fff', fontSize: 44, fontWeight: 900,
          }}>
            지금 바로 확인 →
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 슬라이드 2: 핵심 기능 3가지 ──────────────────────────────────
export function Slide2({ toolName, bullets }) {
  const ICONS   = ['⚡', '🎯', '🚀'];
  const ACCENTS = [C.cyan, C.purple, C.green];

  return (
    <SlideWrap accentColor={C.cyan}>
      <NovaBadge />
      <div style={{ position: 'absolute', top: 180, left: PAD, right: PAD }}>
        <Badge label="핵심 기능" color={C.cyan} />

        <div style={{ ...useSlideUp(10), color: C.cyan, fontSize: 72, fontWeight: 900, marginBottom: 52, wordBreak: 'keep-all' }}>
          {toolName}
        </div>

        {bullets.slice(0, 3).map((b, i) => (
          <FeatureCard key={i} text={b} icon={ICONS[i]} accent={ACCENTS[i]} delay={10 + i * 8} />
        ))}
      </div>
    </SlideWrap>
  );
}

function FeatureCard({ text, icon, accent, delay }) {
  const style = useSlideUp(delay);
  return (
    <div style={{
      ...style,
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `6px solid ${accent}`,
      borderRadius: 24, padding: '38px 44px',
      marginBottom: 32, display: 'flex', alignItems: 'center', gap: 32,
    }}>
      <span style={{ fontSize: 54, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: C.textPri, fontSize: 46, lineHeight: 1.5, wordBreak: 'keep-all' }}>{text}</span>
    </div>
  );
}

// ── 슬라이드 3: vs 비교 ───────────────────────────────────────────
export function Slide3({ toolName, compareText }) {
  const vsStyle     = useSlideUp(10);
  const bannerStyle = useSlideUp(24);

  return (
    <SlideWrap accentColor={C.red}>
      <NovaBadge />
      <div style={{ position: 'absolute', top: 180, left: PAD, right: PAD }}>
        <Badge label="비교 분석" color={C.red} />

        {/* VS 카드 */}
        <div style={{ ...vsStyle, display: 'flex', alignItems: 'stretch', gap: 28, marginBottom: 48 }}>
          {/* 기존 툴 */}
          <div style={{
            flex: 1, background: C.card, border: `2px solid ${C.border}`,
            borderRadius: 28, padding: '44px 32px', textAlign: 'center',
          }}>
            <div style={{ color: C.textMute, fontSize: 32, marginBottom: 16 }}>기존</div>
            <div style={{ color: C.textSec, fontSize: 56, fontWeight: 700, wordBreak: 'keep-all', lineHeight: 1.2 }}>
              {compareText}
            </div>
            <div style={{ marginTop: 36, color: C.textMute, fontSize: 38, lineHeight: 2 }}>
              ✗ 범용 도구<br />✗ 학습 필요<br />✗ 비용 발생
            </div>
          </div>

          {/* VS 배지 */}
          <div style={{
            display: 'flex', alignItems: 'center', flexShrink: 0,
            color: C.red, fontSize: 52, fontWeight: 900,
          }}>VS</div>

          {/* 신규 툴 */}
          <div style={{
            flex: 1, background: C.card, border: `2px solid ${C.cyan}`,
            borderRadius: 28, padding: '44px 32px', textAlign: 'center',
          }}>
            <div style={{ color: C.cyan, fontSize: 32, marginBottom: 16 }}>추천</div>
            <div style={{ color: C.cyan, fontSize: 56, fontWeight: 900, wordBreak: 'keep-all', lineHeight: 1.2 }}>
              {toolName}
            </div>
            <div style={{ marginTop: 36, color: C.green, fontSize: 38, lineHeight: 2 }}>
              ✓ 전문 특화<br />✓ 즉시 시작<br />✓ 무료 플랜
            </div>
          </div>
        </div>

        {/* 결론 배너 */}
        <div style={{
          ...bannerStyle,
          background: `${C.green}18`,
          border: `2px solid ${C.green}`,
          borderRadius: 24, padding: '40px 44px', textAlign: 'center',
        }}>
          <div style={{ color: C.green, fontSize: 46, fontWeight: 800, marginBottom: 16 }}>
            🏆 목적에 맞는 AI 툴이 2~5배 효율적
          </div>
          <div style={{ color: C.textSec, fontSize: 40, wordBreak: 'keep-all' }}>
            이 작업엔 {toolName}가 압도적입니다
          </div>
        </div>
      </div>
    </SlideWrap>
  );
}

// ── 슬라이드 4: 시작 3단계 ───────────────────────────────────────
export function Slide4({ toolName, steps }) {
  const COLORS = [C.cyan, C.purple, C.green];

  return (
    <SlideWrap accentColor={C.purple}>
      <NovaBadge />
      <div style={{ position: 'absolute', top: 180, left: PAD, right: PAD }}>
        <Badge label="시작 3단계" color={C.purple} />

        <div style={{ ...useSlideUp(10), color: C.purple, fontSize: 72, fontWeight: 900, marginBottom: 52, wordBreak: 'keep-all' }}>
          {toolName}
        </div>

        {steps.slice(0, 3).map((step, i) => (
          <StepCard key={i} num={i + 1} text={step} color={COLORS[i]} delay={10 + i * 8} />
        ))}
      </div>
    </SlideWrap>
  );
}

function StepCard({ num, text, color, delay }) {
  const style = useSlideUp(delay);
  return (
    <div style={{ ...style, display: 'flex', alignItems: 'flex-start', gap: 28, marginBottom: 36 }}>
      <div style={{
        width: 76, height: 76, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${color}, ${C.blue})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 40, fontWeight: 900,
      }}>{num}</div>
      <div style={{
        flex: 1, background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 20, padding: '28px 36px',
        color: C.textPri, fontSize: 44, lineHeight: 1.55, wordBreak: 'keep-all',
      }}>{text}</div>
    </div>
  );
}

// ── 슬라이드 5: CTA ───────────────────────────────────────────────
export function Slide5({ toolName }) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleStyle = useSlideUp(5);
  const subStyle   = useSlideUp(18);
  const btnStyle   = useSlideUp(30);

  // 버튼 펄스 효과
  const pulse = interpolate(Math.sin((frame / fps) * Math.PI * 1.5), [-1, 1], [0.97, 1.03]);

  return (
    <SlideWrap accentColor={C.green}>
      {/* 배경 광원 */}
      <div style={{
        position: 'absolute', top: -220, right: -220,
        width: 660, height: 660, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.cyan}28 0%, transparent 70%)`,
      }} />
      <div style={{
        position: 'absolute', bottom: -220, left: -220,
        width: 560, height: 560, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.purple}28 0%, transparent 70%)`,
      }} />

      <NovaBadge />

      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: PAD,
      }}>
        <div style={{ ...titleStyle, textAlign: 'center', marginBottom: 44 }}>
          <div style={{ fontSize: 88, marginBottom: 24 }}>🚀</div>
          <div style={{ color: C.textPri, fontSize: 76, fontWeight: 900, lineHeight: 1.2, wordBreak: 'keep-all' }}>
            {toolName}<br />
            <span style={{ color: C.cyan }}>지금 무료로 시작</span>
          </div>
        </div>

        <div style={{
          ...subStyle, color: C.textSec, fontSize: 44, textAlign: 'center',
          lineHeight: 1.7, marginBottom: 80, wordBreak: 'keep-all',
        }}>
          구독 누르고 매일 새로운<br />AI 툴 정보 받아보기 📩
        </div>

        <div style={{
          ...btnStyle,
          transform: `${btnStyle.transform} scale(${pulse})`,
          background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`,
          borderRadius: 60, padding: '40px 88px',
          color: '#fff', fontSize: 50, fontWeight: 900,
          boxShadow: `0 0 80px ${C.cyan}55`,
        }}>
          구독 + 알림 설정 🔔
        </div>

        <div style={{ marginTop: 64, color: C.textMute, fontSize: 38, textAlign: 'center' }}>
          #NOVA #AI툴 #오늘의AI #인공지능
        </div>
      </div>
    </SlideWrap>
  );
}

// ── 메인 컴포지션 ─────────────────────────────────────────────────
export function NovaVideo({ toolName, toolDesc, bullets, steps, compareText, screenshotDataUrl }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const seg = Math.floor(durationInFrames / 5);
  const currentSlide = Math.min(Math.floor(frame / seg), 4);

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      <Sequence from={0}           durationInFrames={seg}>
        <Slide1 toolName={toolName} toolDesc={toolDesc} screenshotDataUrl={screenshotDataUrl} />
      </Sequence>
      <Sequence from={seg}         durationInFrames={seg}>
        <Slide2 toolName={toolName} bullets={bullets} />
      </Sequence>
      <Sequence from={seg * 2}     durationInFrames={seg}>
        <Slide3 toolName={toolName} compareText={compareText} />
      </Sequence>
      <Sequence from={seg * 3}     durationInFrames={seg}>
        <Slide4 toolName={toolName} steps={steps} />
      </Sequence>
      <Sequence from={seg * 4}     durationInFrames={durationInFrames - seg * 4}>
        <Slide5 toolName={toolName} />
      </Sequence>
      {/* 항상 최상위에 진행 바 표시 */}
      <ProgressBar currentSlide={currentSlide} totalSlides={5} />
    </AbsoluteFill>
  );
}
