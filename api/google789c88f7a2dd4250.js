export const config = { runtime: "edge" };
export default function handler(req) {
  return new Response("google-site-verification: google789c88f7a2dd4250", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
