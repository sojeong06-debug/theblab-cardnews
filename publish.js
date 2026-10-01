// 인스타 캐러셀 게시
// CLI: node publish.js <deck.json> <이미지 공개 base URL> [--dry]
//   예) node publish.js decks/2026-10-01.json https://raw.githubusercontent.com/<owner>/<repo>/main/out/2026-10-01
//   → <base>/01.jpg ~ NN.jpg 를 캐러셀로 묶어 caption과 함께 게시. --dry 는 URL 접근만 확인
// 환경변수: IG_TOKEN (없으면 META_TOKEN), IG_USER_ID (기본 theblab_official)
const fs = require('fs');

const GRAPH = 'https://graph.facebook.com/v26.0';
const TOKEN = process.env.IG_TOKEN || process.env.META_TOKEN;
const IG_USER = process.env.IG_USER_ID || '17841412090330279';

async function call(path, params, method = 'POST') {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = method === 'GET'
    ? await fetch(`${GRAPH}/${path}?${body}`)
    : await fetch(`${GRAPH}/${path}`, { method, body });
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
}

// 컨테이너가 FINISHED 될 때까지 대기
async function waitReady(id) {
  for (let i = 0; i < 30; i++) {
    const { status_code } = await call(id, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`컨테이너 ${id} 상태 ${status_code}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`컨테이너 ${id} 대기 시간 초과`);
}

// 게시 후 permalink 반환 (dry 면 null)
async function publishDeck(deck, base, { dry = false } = {}) {
  if (!TOKEN) throw new Error('IG_TOKEN/META_TOKEN 환경변수가 없습니다');
  const urls = deck.slides.map((_, i) => `${base.replace(/\/$/, '')}/${String(i + 1).padStart(2, '0')}.jpg`);
  if (urls.length < 2 || urls.length > 10) throw new Error(`캐러셀은 2~10장이어야 합니다 (현재 ${urls.length})`);

  for (const u of urls) {
    const r = await fetch(u, { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.includes('jpeg')) throw new Error(`이미지 접근 실패: ${u} (${r.status} ${type})`);
  }
  console.log(`이미지 ${urls.length}장 접근 확인`);
  if (dry) return null;

  const children = [];
  for (const u of urls) {
    const { id } = await call(`${IG_USER}/media`, { image_url: u, is_carousel_item: 'true' });
    children.push(id);
  }
  for (const id of children) await waitReady(id);
  const { id: carousel } = await call(`${IG_USER}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: deck.caption });
  await waitReady(carousel);
  const { id: mediaId } = await call(`${IG_USER}/media_publish`, { creation_id: carousel });
  const { permalink } = await call(mediaId, { fields: 'permalink' }, 'GET');
  return permalink;
}

module.exports = { publishDeck };

if (require.main === module) {
  const [deckPath, base] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!deckPath || !base) { console.error('사용법: node publish.js <deck.json> <base URL> [--dry]'); process.exit(1); }
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  publishDeck(deck, base, { dry: process.argv.includes('--dry') })
    .then(p => p && console.log('게시 완료:', p))
    .catch(e => { console.error('실패:', e.message); process.exit(1); });
}
