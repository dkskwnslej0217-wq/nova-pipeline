// api/post-instagram.js — Instagram 자동 발행 (Pollinations.ai 이미지 포함)
export const config = { runtime: 'edge' };

const IG_TOKEN      = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const PEXELS_KEY    = process.env.PEXELS_API_KEY;

async function getPexelsPhoto(query) {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=square`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  if (!data.photos?.length) throw new Error('Pexels 사진 없음');
  const photo = data.photos[Math.floor(Math.random() * Math.min(5, data.photos.length))];
  return photo.src.large2x;
}

// Pollinations.ai — Pexels 실패 시 폴백 (무료, API 키 불필요)
function getPollinationsUrl(prompt) {
  const encoded = encodeURIComponent(prompt.slice(0, 200));
  return `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1080&nologo=true&model=sana`;
}

async function postToInstagram(text, imagePrompt, retry = 0, tokenOverride = null, accountOverride = null) {
  const token = tokenOverride || IG_TOKEN;
  const accountId = accountOverride || IG_ACCOUNT_ID;
  let imageUrl;
  try {
    imageUrl = await getPexelsPhoto(imagePrompt);
  } catch {
    imageUrl = getPollinationsUrl(imagePrompt);
  }
  const caption = text.slice(0, 2200);

  // 1단계: 미디어 컨테이너 생성 (이미지 필수)
  const createRes = await fetch(
    `https://graph.instagram.com/v21.0/${accountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: token,
      }),
    }
  );
  if (!createRes.ok) {
    const errText = await createRes.text();
    // 일시적 오류면 1회 재시도
    if (retry === 0 && errText.includes('"is_transient":true')) {
      await new Promise(r => setTimeout(r, 5000));
      return postToInstagram(text, imagePrompt, 1, token, accountId);
    }
    throw new Error(`Instagram 컨테이너 생성 실패: ${createRes.status} ${errText}`);
  }
  const { id: creation_id } = await createRes.json();

  // 이미지 처리 대기 (5초)
  await new Promise(r => setTimeout(r, 5000));

  // 2단계: 게시
  const publishRes = await fetch(
    `https://graph.instagram.com/v21.0/${accountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id,
        access_token: token,
      }),
    }
  );
  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw new Error(`Instagram 게시 실패: ${publishRes.status} ${err}`);
  }
  const { id: post_id } = await publishRes.json();
  return post_id;
}

export default async function handler(req) {
  const secret = req.headers.get('x-pipeline-secret');
  if (secret !== PIPELINE_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { text, imagePrompt, ig_token, ig_account_id } = body;
  if (!text) {
    return new Response(JSON.stringify({ error: 'text 필요' }), { status: 400 });
  }

  try {
    const post_id = await postToInstagram(
      text,
      imagePrompt || text.slice(0, 60) + ', Korean aesthetic, modern minimalist, 4k, no text',
      0,
      ig_token || null,
      ig_account_id || null
    );
    return new Response(JSON.stringify({ ok: true, post_id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
