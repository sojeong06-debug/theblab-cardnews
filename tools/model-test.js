// 같은 장면을 힉스필드 이미지 모델 여러 개로 뽑아 비교 → data/model-test/<모델>_<n>.png + sheet.png
// 사용: node tools/model-test.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));
const KEY = (process.env.HF_API_KEY || process.env.HF_API_KEY_ID).trim();
const H = { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' };
const OUT = path.join(ROOT, 'data/model-test');
fs.mkdirSync(OUT, { recursive: true });

// AI 티 줄이기: 폰카 스냅, 필름 그레인, 평범한 얼굴, 한국 교복
const SCENES = [
  'Candid snapshot taken on an old smartphone at night, a Korean high school girl in a navy school uniform blazer with white shirt and red ribbon tie, studying at a cluttered wooden desk under a warm desk lamp, seen from behind over her shoulder, messy ponytail, textbooks and pencil case, dim room, slight motion blur, film grain, slightly underexposed, ordinary everyday look, no makeup, realistic imperfect lighting',
  'Candid documentary photo in a Korean high school classroom, a male student in a navy school uniform blazer and white shirt with name tag secretly looking at a smartphone under his desk during class, classmates in the same uniform writing notes, fluorescent ceiling light, slightly grainy, shot from a few desks behind, natural and unposed, ordinary faces',
];
const MODELS = [
  { id: 'soul2', path: 'higgsfield-ai/soul/v2/standard', body: p => ({ prompt: p, aspect_ratio: '3:4', resolution: '1080p', batch_size: 1, enhance_prompt: false }) },
  { id: 'grok', path: 'xai/grok-imagine-image-2.0', body: p => ({ prompt: p, aspect_ratio: '3:4', resolution: '1k', quality: 'medium' }) },
  { id: 'qwen', path: 'alibaba/qwen-image-3/text-to-image', body: p => ({ prompt: p, aspect_ratio: '3:4', resolution: '1k', negative_prompt: 'glossy, airbrushed skin, perfect model face, studio lighting, CGI, illustration, text, watermark' }) },
  { id: 'zimage', path: 'z-image/turbo', body: p => ({ prompt: p.slice(0, 790), aspect_ratio: '3:4', resolution: '1k' }) },
];

async function gen(m, prompt, file) {
  const r = await fetch(`https://api.higgsfield.ai/${m.path}`, { method: 'POST', headers: H, body: JSON.stringify(m.body(prompt)) });
  const job = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(job).slice(0, 120)}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(res => setTimeout(res, 6000));
    const st = await (await fetch(job.status_url, { headers: H })).json();
    if (st.status === 'completed') {
      const u = st.images?.[0]?.url;
      fs.writeFileSync(file, Buffer.from(await (await fetch(u)).arrayBuffer()));
      return;
    }
    if (['failed', 'nsfw', 'canceled'].includes(st.status)) throw new Error(st.status);
  }
  throw new Error('timeout');
}

(async () => {
  await Promise.all(MODELS.flatMap(m => SCENES.map(async (s, i) => {
    const f = path.join(OUT, `${m.id}_${i + 1}.png`);
    try { await gen(m, s, f); console.log('ok', m.id, i + 1); } catch (e) { console.log('실패', m.id, i + 1, e.message); }
  })));
})();
