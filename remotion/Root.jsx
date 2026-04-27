// remotion/Root.jsx — Remotion 컴포지션 등록
import React from 'react';
import { Composition } from 'remotion';
import { NovaVideo } from './NovaVideo.jsx';
import { FPS, W, H } from './theme.js';

export function RemotionRoot() {
  return (
    <Composition
      id="NovaVideo"
      component={NovaVideo}
      durationInFrames={420}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        toolName:  'AI Tool',
        hookText:  'AI Tool 이거 알아요?',
        bullets:   ['핵심 기능 1', '이런 분께 추천', '무료로 시작 가능', '링크는 바이오 참고'],
        bgImage:   '',
      }}
    />
  );
}
