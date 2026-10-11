// 힉스필드로 장마다 배경 사진 생성 → assets/bg/<덱이름>/NN.jpg
// 환경변수: HF_API_KEY(콘솔의 "Copy API key" 값 하나) 또는 HF_API_KEY_ID + HF_API_KEY_SECRET, HF_MODEL(기본 xai/grok-imagine-image-2.0)
const fs = require('fs');
const path = require('path');

const API = 'https://api.higgsfield.ai';
// 2026-10-08 모델 비교(tools/model-test.js): Soul 은 모델 같은 얼굴이라 AI 티가 남 → Grok 이 교실·교복·조명이 가장 자연스러움
const MODEL = process.env.HF_MODEL || 'xai/grok-imagine-image-2.0';
const BODY = {
  'xai/grok-imagine-image-2.0': p => ({ prompt: p, aspect_ratio: '3:4', resolution: '2k', quality: 'medium' }),
  'higgsfield-ai/soul/v2/standard': p => ({ prompt: p, aspect_ratio: '3:4', resolution: '1080p', batch_size: 1, enhance_prompt: false }),
};
// 모든 배경에 붙는 공통 스타일: 폰카 스냅·필름 그레인·평범한 얼굴, 사람은 한국 교복
const STYLE = ' Candid snapshot taken on a smartphone, natural imperfect lighting, slight film grain, unposed, ordinary everyday faces without makeup. Any students wear Korean school uniforms (navy blazer, white shirt, tie or ribbon, name tag). No text, no watermark, no logos.';
const withStyle = p => (p.includes('Korean school uniform') ? p : p + STYLE);
// 새 콘솔은 키 하나(ID:SECRET 이 합쳐진 값)를 준다. 예전 방식(ID·SECRET 따로)도 지원
const hfKey = () => {
  const k = process.env.HF_API_KEY || process.env.HF_API_KEY_ID;
  return process.env.HF_API_KEY_SECRET ? `${k}:${process.env.HF_API_KEY_SECRET}` : k;
};
const hasKey = () => !!(process.env.HF_API_KEY || process.env.HF_API_KEY_ID);
const headers = () => ({
  Authorization: `Key ${hfKey()}`,
  'Content-Type': 'application/json',
});

async function generateOne(prompt, outFile) {
  const r = await fetch(`${API}/${MODEL}`, {
    method: 'POST', headers: headers(),
    // 4:5 가 없어 3:4 로 받고 렌더에서 cover 로 잘라 쓴다
    body: JSON.stringify((BODY[MODEL] || BODY['xai/grok-imagine-image-2.0'])(withStyle(prompt))),
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
    if (!s.bgPrompt || s.type === 'follow') return; // 팔로우 장은 단색 배경
    const rel = `assets/bg/${name}/${String(i + 1).padStart(2, '0')}.jpg`;
    try {
      await generateOne(s.bgPrompt, path.join(__dirname, rel));
      s.bg = rel;
    } catch (e) {
      failed.push(`${i + 1}장: ${e.message}`);
    }
  }));
  const fallback = deck.slides.find(s => s.bg)?.bg || 'assets/bg/sample-desk.webp';
  deck.slides.forEach(s => { if (!s.bg && s.type !== 'follow') { s.bg = fallback; s.bgBlur = true; } });
  return failed;
}

module.exports = { generateBackgrounds, generateOne, hasKey };
