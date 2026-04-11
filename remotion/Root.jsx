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
      calculateMetadata={({ props }) => ({
        durationInFrames: props.totalFrames || 900,
        fps: FPS,
        width: W,
        height: H,
      })}
      defaultProps={{
        totalFrames:       900,
        toolName:          'AI Tool',
        toolDesc:          'AI 툴을 소개합니다',
        bullets:           ['기능 1', '기능 2', '기능 3'],
        steps:             ['단계 1', '단계 2', '단계 3'],
        compareText:       'ChatGPT',
        screenshotDataUrl: null,
      }}
    />
  );
}
