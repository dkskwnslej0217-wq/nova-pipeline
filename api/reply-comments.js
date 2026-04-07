// api/reply-comments.js — Threads/Instagram/Facebook 댓글 자동응답
// Webhook: GET 인증 + POST 댓글 처리 → Groq AI 답글 → 각 플랫폼 발행
export const config = { runtime: 'nodejs', maxDuration: 60 };

const GROQ_KEY            = process.env.GROQ_API_KEY;
const THREADS_TOKEN       = process.env.THREADS_ACCESS_TOKEN;
const THREADS_USER_ID     = process.env.THREADS_USER_ID;
const IG_TOKEN            = process.env.INSTAGRAM_ACCESS_TOKEN;
const FB_TOKEN            = process.env.FACEBOOK_ACCESS_TOKEN;
const VERIFY_TOKEN        = process.env.WEBHOOK_VERIFY_TOKEN || process.env.PIPELINE_SECRET;
const TG_TOKEN            = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT             = process.env.TELEGRAM_CHAT_ID;

// ─── AI 답글 생성 ─────────────────────────────────────────
async function generateReply(commentText) {
  const prompt = `당신은 NOVA SaaS의 친절한 운영자입니다.
아래 댓글에 자연스럽고 따뜻하게 한국어로 답글을 달아주세요.
- 1~2문장, 50자 이내
- AI 티 나는 표현 금지 (확실히, 물론, 안녕하세요! 등 금지)
- 이모지 1개 이하
- 질문엔 간단히 답하고, 관심엔 감사 표현

댓글: "${commentText.slice(0, 200)}"

답글:`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Groq 오류: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ─── Telegram 알림 ────────────────────────────────────────
async function notify(msg) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
  }).catch(() => {});
}

// ─── 플랫폼별 답글 발행 ───────────────────────────────────

async function replyThreads(commentId, replyText) {
  // 1단계: 답글 컨테이너 생성
  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text: replyText,
        reply_to_id: commentId,
        access_token: THREADS_TOKEN,
      }),
    }
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Threads 답글 컨테이너 실패: ${createRes.status} ${err}`);
  }
  const { id: creation_id } = await createRes.json();

  // 2단계: 게시
  const pubRes = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id, access_token: THREADS_TOKEN }),
    }
  );
  if (!pubRes.ok) {
    const err = await pubRes.text();
    throw new Error(`Threads 답글 게시 실패: ${pubRes.status} ${err}`);
  }
  const { id } = await pubRes.json();
  return id;
}

async function replyInstagram(commentId, replyText) {
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${commentId}/replies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: replyText,
        access_token: IG_TOKEN,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram 답글 실패: ${res.status} ${err}`);
  }
  const { id } = await res.json();
  return id;
}

async function replyFacebook(commentId, replyText) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/comments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: replyText,
        access_token: FB_TOKEN,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook 답글 실패: ${res.status} ${err}`);
  }
  const { id } = await res.json();
  return id;
}

// ─── 웹훅 이벤트 파싱 ─────────────────────────────────────

function extractComments(body, platform) {
  const comments = [];
  try {
    if (platform === 'threads' || platform === 'instagram') {
      // Graph API 공통 형식
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value;
          if (change.field === 'comments' && v?.id && v?.text) {
            comments.push({ id: v.id, text: v.text });
          }
        }
      }
    } else if (platform === 'facebook') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value;
          if (change.field === 'feed' && v?.item === 'comment' && v?.comment_id && v?.message) {
            comments.push({ id: v.comment_id, text: v.message });
          }
        }
      }
    }
  } catch {}
  return comments;
}

// ─── 메인 핸들러 ──────────────────────────────────────────

export default async function handler(req, res) {
  // 플랫폼 식별: ?platform=threads|instagram|facebook
  const url = new URL(req.url, `https://${req.headers.host}`);
  const platform = url.searchParams.get('platform') || 'threads';

  // ── GET: 웹훅 인증 ──
  if (req.method === 'GET') {
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'Forbidden' });
    }
    return;
  }

  // ── POST: 댓글 처리 ──
  if (req.method === 'POST') {
    // 즉시 200 반환 (플랫폼 타임아웃 방지)
    res.status(200).json({ ok: true });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return; }
    }
    if (!body) return;

    const comments = extractComments(body, platform);
    if (comments.length === 0) return;

    for (const { id: commentId, text } of comments) {
      try {
        const reply = await generateReply(text);

        let replyId;
        if (platform === 'threads') {
          replyId = await replyThreads(commentId, reply);
        } else if (platform === 'instagram') {
          replyId = await replyInstagram(commentId, reply);
        } else if (platform === 'facebook') {
          replyId = await replyFacebook(commentId, reply);
        }

        await notify(`💬 [${platform}] 댓글 자동답글\n원댓글: ${text.slice(0, 50)}\n답글: ${reply}`);
      } catch (e) {
        await notify(`⚠️ [${platform}] 댓글 답글 실패: ${e.message}`);
      }
    }
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
