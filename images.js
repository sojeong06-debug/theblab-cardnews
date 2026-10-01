// 힉스필드로 장마다 배경 사진 생성 → assets/bg/<덱이름>/NN.jpg
// 환경변수: HF_API_KEY_ID, HF_API_KEY_SECRET, HF_MODEL(기본 higgsfield-ai/soul/standard)
const fs = require('fs');
const path = require('path');

const API = 'https://api.higgsfield.ai';
const MODEL = process.env.HF_MODEL || 'higgsfield-ai/soul/standard';
const headers = () => ({
  Authorization: `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`,
  'Content-Type': 'application/json',
});

async function generateOne(prompt, outFile) {
  const r = await fetch(`${API}/${MODEL}`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ prompt, aspect_ratio: '4:5', resolution: '2K', num_images: 1 }),
  });
  const job = await r.json();
  if (!r.ok) throw new Error(`힉스필드 요청 실패 ${r.status}: ${JSON.stringify(job)}`);
  // 상태: queued → in_progress → completed | failed | nsfw | canceled
  for (let i = 0; i < 60; i++) {
    await new Promise(res => setTimeout(res, 8000));
    const st = await (await fetch(job.status_url, { headers: headers() })).json();
    if (st.status === 'completed') {
      const img = await fetch(st.images[0].url);
      fs.writeFileSync(outFile, Buffer.from(await img.arrayBuffer()));
      return;
    }
    if (['failed', 'nsfw', 'canceled'].includes(st.status)) throw new Error(`이미지 생성 ${st.status}: ${prompt.slice(0, 60)}`);
  }
  throw new Error('이미지 생성 대기 시간 초과');
}

// 실패한 장은 표지 배경을 흐리게 깔아 렌더가 멈추지 않게 한다 (실패 목록은 반환해 이슈에 표시)
async function generateBackgrounds(deck, name) {
  const dir = path.join(__dirname, 'assets', 'bg', name);
  fs.mkdirSync(dir, { recursive: true });
  const failed = [];
  await Promise.all(deck.slides.map(async (s, i) => {
    const rel = `assets/bg/${name}/${String(i + 1).padStart(2, '0')}.jpg`;
    try {
      await generateOne(s.bgPrompt, path.join(__dirname, rel));
      s.bg = rel;
    } catch (e) {
      failed.push(`${i + 1}장: ${e.message}`);
    }
  }));
  const fallback = deck.slides.find(s => s.bg)?.bg || 'assets/bg/sample-desk.webp';
  deck.slides.forEach(s => { if (!s.bg) { s.bg = fallback; s.bgBlur = true; } });
  return failed;
}

module.exports = { generateBackgrounds };
