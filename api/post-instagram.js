// api/post-instagram.js — Instagram 자동 발행 (Pollinations.ai 이미지 포함)
export const config = { runtime: 'edge' };

const IG_TOKEN      = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const PIPELINE_SECRET = process.env.PIPELINE_SECRET;

function buildImageUrl(text) {
  const prompt = encodeURIComponent(
    text.slice(0, 60) +
    ', Korean aesthetic, modern minimalist, high quality, cinematic lighting, 4k, no text, no watermark'
  );
  return `https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&nologo=true&model=flux&enhance=true`;
}

async function postToInstagram(text, retry = 0) {
  const imageUrl = buildImageUrl(text);
  const caption = text.slice(0, 2200);

  // 1단계: 미디어 컨테이너 생성 (이미지 필수)
  const createRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: IG_TOKEN,
      }),
    }
  );
  if (!createRes.ok) {
    const errText = await createRes.text();
    // 일시적 오류면 1회 재시도
    if (retry === 0 && errText.includes('"is_transient":true')) {
      await new Promise(r => setTimeout(r, 5000));
      return postToInstagram(text, 1);
    }
    throw new Error(`Instagram 컨테이너 생성 실패: ${createRes.status} ${errText}`);
  }
  const { id: creation_id } = await createRes.json();

  // 이미지 처리 대기 (5초)
  await new Promise(r => setTimeout(r, 5000));

  // 2단계: 게시
  const publishRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id,
        access_token: IG_TOKEN,
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

  const { text } = body;
  if (!text) {
    return new Response(JSON.stringify({ error: 'text 필드 필요' }), { status: 400 });
  }

  try {
    const post_id = await postToInstagram(text);
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
