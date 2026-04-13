// api/retry-publish.js — 실패한 플랫폼 자동 재시도
// Vercel cron이 2시간마다 호출 → 오늘 실패한 플랫폼만 재시도
export const config = { runtime: 'nodejs', maxDuration: 120 };

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY;
const IG_TOKEN  = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ID     = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const FB_TOKEN  = process.env.FACEBOOK_ACCESS_TOKEN;
const FB_PAGE   = process.env.FACEBOOK_PAGE_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'dkskwnslej0217-wq/nova-pipeline';
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;

function kstDate() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

async function tg(msg) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
  }).catch(() => {});
}

async function getFailedToday(date) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/publish_log?date=eq.${date}&status=eq.failed&select=*`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  return res.json();
}

async function updateLog(date, platform, status, { postId = null, errorMsg = null, retryCount = 0 } = {}) {
  await fetch(`${SUPA_URL}/rest/v1/publish_log`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      date,
      platform,
      status,
      post_id: postId,
      error_msg: errorMsg,
      retry_count: retryCount,
      updated_at: new Date().toISOString(),
    }),
  });
}

// ── Instagram 캐러셀 재시도 ──────────────────────────────────────
async function retryInstagram(content, retryCount) {
  const { imageUrls, caption } = content;
  const base = `https://graph.instagram.com/v21.0`;

  const containerIds = [];
  for (const url of imageUrls) {
    const res = await fetch(`${base}/${IG_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: IG_TOKEN }),
    });
    const data = await res.json();
    if (!data.id) throw new Error(`IG 컨테이너 실패: ${JSON.stringify(data)}`);
    containerIds.push(data.id);
  }

  const carRes = await fetch(`${base}/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: containerIds.join(','),
      caption: caption.slice(0, 2200),
      access_token: IG_TOKEN,
    }),
  });
  const carData = await carRes.json();
  if (!carData.id) throw new Error(`IG 캐러셀 실패: ${JSON.stringify(carData)}`);

  const pubRes = await fetch(`${base}/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: carData.id, access_token: IG_TOKEN }),
  });
  const pubData = await pubRes.json();
  if (!pubData.id) throw new Error(`IG 발행 실패: ${JSON.stringify(pubData)}`);
  return pubData.id;
}

// ── Facebook 릴스 재시도 ─────────────────────────────────────────
async function retryFacebook(content, retryCount) {
  const { videoUrl, caption } = content;
  const base = `https://graph.facebook.com/v21.0`;

  const startRes = await fetch(`${base}/${FB_PAGE}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_phase: 'start', access_token: FB_TOKEN }),
  });
  const { video_id, upload_url } = await startRes.json();
  if (!video_id) throw new Error('FB 업로드 시작 실패');

  // Supabase에서 영상 바이트 가져와서 업로드
  const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
  if (!videoRes.ok) throw new Error(`영상 다운로드 실패: ${videoRes.status}`);
  const videoBuffer = await videoRes.arrayBuffer();

  const uploadRes = await fetch(upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${FB_TOKEN}`,
      'Content-Type': 'video/mp4',
      offset: '0',
      file_size: String(videoBuffer.byteLength),
    },
    body: videoBuffer,
    signal: AbortSignal.timeout(120000),
  });
  if (!uploadRes.ok) throw new Error(`FB 영상 업로드 실패: ${uploadRes.status}`);

  const finishRes = await fetch(`${base}/${FB_PAGE}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'finish',
      video_id,
      video_state: 'PUBLISHED',
      description: caption.slice(0, 2200),
      access_token: FB_TOKEN,
    }),
  });
  const finishData = await finishRes.json();
  if (!finishData.success && !finishData.id) throw new Error(`FB 릴스 게시 실패: ${JSON.stringify(finishData)}`);
  return video_id;
}

// ── YouTube 재시도 → GitHub Actions 디스패치 ────────────────────
async function retryYouTube(content, date) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'retry-youtube',
        client_payload: {
          video_url: content.videoUrl,
          title: content.title,
          description: content.description,
          tags: content.tags,
          date,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`GitHub dispatch 실패: ${res.status}`);
  return 'dispatched';
}

// ── 메인 핸들러 ──────────────────────────────────────────────────
export default async function handler() {
  const today = kstDate();
  const failed = await getFailedToday(today);

  if (!Array.isArray(failed) || failed.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: '재시도 대상 없음' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = {};

  for (const log of failed) {
    const { platform, content, retry_count } = log;

    // 최대 3회 재시도 초과 시 스킵
    if (retry_count >= 3) {
      results[platform] = 'max_retries_exceeded';
      continue;
    }

    try {
      let postId;
      if (platform === 'instagram') {
        postId = await retryInstagram(content, retry_count);
        await updateLog(today, platform, 'success', { postId, retryCount: retry_count + 1 });
        await tg(`✅ instagram 자동 재시도 성공 (${retry_count + 1}번째 시도)`);
      } else if (platform === 'facebook') {
        // 🔴 Facebook 차단 해제 대기 중 — 재시도 비활성화
        results[platform] = 'disabled (차단 해제 대기)';
        continue;
      } else if (platform === 'youtube') {
        // GitHub Actions에 dispatch → 완료는 retry_youtube.js가 직접 DB 업데이트
        await retryYouTube(content, today);
        await updateLog(today, platform, 'pending', { retryCount: retry_count + 1 });
        await tg(`▶️ youtube 재업로드 시작됨 (GitHub Actions 실행 중...)`);
      }
      results[platform] = 'dispatched_or_success';
    } catch (e) {
      const errMsg = e.message || '';
      // 차단/토큰 만료 감지 — 재시도해도 소용없음, 즉시 중단
      const isBanned = errMsg.includes('190') || errMsg.includes('368') ||
                       errMsg.includes('32') || errMsg.includes('spam') ||
                       errMsg.includes('blocked') || errMsg.includes('restricted');
      await updateLog(today, platform, 'failed', {
        errorMsg: errMsg.slice(0, 200),
        retryCount: retry_count + 1,
      });
      results[platform] = `failed: ${errMsg.slice(0, 60)}`;

      if (isBanned) {
        await tg(`🚨 ${platform} 차단/토큰 만료 감지!\n재시도 중단. junho 수동 확인 필요.\n에러: ${errMsg.slice(0, 100)}`);
      } else if (retry_count + 1 >= 3) {
        await tg(`❌ ${platform} 3회 재시도 모두 실패 — 수동 확인 필요\n오류: ${errMsg.slice(0, 100)}`);
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, date: today, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
