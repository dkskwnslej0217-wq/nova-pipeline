// api/post-facebook.js — Facebook 페이지 자동 발행
export const config = { runtime: 'edge' };

const FB_TOKEN   = process.env.FACEBOOK_ACCESS_TOKEN;
const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;
const PEXELS_KEY = process.env.PEXELS_API_KEY;

async function getPexelsPhoto(query) {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
    { headers: { Authorization: PEXELS_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  if (!data.photos?.length) throw new Error('Pexels 사진 없음');
  const photo = data.photos[Math.floor(Math.random() * Math.min(5, data.photos.length))];
  return photo.src.large2x;
}

async function postToFacebook(text, imagePrompt) {
  const imageUrl = await getPexelsPhoto(imagePrompt);
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        caption: text.slice(0, 63206),
        access_token: FB_TOKEN,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook 게시 실패: ${res.status} ${err}`);
  }
  const { id: post_id } = await res.json();
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

  const { text, imagePrompt } = body;
  if (!text) {
    return new Response(JSON.stringify({ error: 'text 필요' }), { status: 400 });
  }

  try {
    const post_id = await postToFacebook(text, imagePrompt || text.slice(0, 60) + ', Korean SNS style, vibrant, minimal');
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
