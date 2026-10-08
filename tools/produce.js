// 프로젝트 하나를 제작만 한다 (업로드 없음): 힉스필드 배경 → 렌더 → 미리보기
// 사용: node tools/produce.js <프로젝트 id>
// 결과는 프로젝트 파일의 images / imageWarnings / producedDeck 에 기록 → 확인 후 업로드
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));
const { produce } = require('../pipeline');

(async () => {
  const id = process.argv[2];
  const f = path.join(ROOT, 'data/projects', `${id}.json`);
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const deck = structuredClone(p.deck);
  const t = Date.now();
  const r = await produce(deck, id, m => console.log('-', m));
  const cur = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.assign(cur, { images: r.images, imageWarnings: r.failed, producedDeck: deck, producedAt: new Date().toISOString(), updated: new Date().toISOString() });
  fs.writeFileSync(f, JSON.stringify(cur, null, 2));
  console.log(`완료 ${Math.round((Date.now() - t) / 1000)}초`, r.failed.length ? `경고: ${r.failed.join(' / ')}` : '배경 전부 생성');
})().catch(e => { console.error('제작 실패:', e.message); process.exit(1); });
