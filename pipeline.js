// 제작·게시 공통 단계 — server.js(사이트)와 generate.js(15시 자동)가 같이 쓴다
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateBackgrounds, hasKey: hasHiggsfield } = require('./images');
const { render } = require('./render');
const { publishDeck } = require('./publish');

const ROOT = __dirname;
const IG_USER = process.env.IG_USER_ID || '17841412090330279';
const REPO = process.env.GITHUB_REPOSITORY || 'sojeong06-debug/theblab-cardnews';
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// 우리 계정 최근 30개 게시물 반응 — 어떤 소재가 터지는지 리서치에 참고로 넘긴다
async function recentPosts() {
  const token = process.env.IG_TOKEN;
  if (!token) return '(조회 안 됨)';
  const u = `https://graph.facebook.com/v26.0/${IG_USER}/media?fields=caption,media_type,timestamp,like_count,comments_count&limit=30&access_token=${token}`;
  const j = await (await fetch(u)).json();
  if (j.error) return `(조회 실패: ${j.error.message})`;
  return j.data
    .sort((a, b) => b.like_count - a.like_count)
    .map(m => `- ${m.timestamp.slice(0, 10)} ${m.media_type} ♥${m.like_count} 💬${m.comments_count} ${(m.caption || '').replace(/\s+/g, ' ').slice(0, 60)}`)
    .join('\n');
}

function readHistory() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/history.json'), 'utf8')); } catch { return []; }
}
function addHistory(entry) {
  const h = readHistory();
  h.push(entry);
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data/history.json'), JSON.stringify(h, null, 2));
}

// 렌더러가 쓰지 않는 null 필드 정리 + 제품 이미지 지정
function finalizeDeck(deck) {
  for (const s of deck.slides) for (const k of Object.keys(s)) if (s[k] === null) delete s[k];
  for (const r of deck.slides.find(s => s.type === 'rank')?.rows || []) if (r.tone === 'normal') delete r.tone;
  // 제품 이미지가 들어가는 장: 옛 product 장 + 스토리형에서 showProduct 인 장
  for (const s of deck.slides.filter(s => s.type === 'product' || s.showProduct)) {
    if (fs.existsSync(path.join(ROOT, 'assets/product/molip-pro.png'))) s.product = 'assets/product/molip-pro.png';
    else s.productCrop = { src: 'assets/ref-product-slide.webp', x: 210, y: 450, w: 690, h: 640 };
  }
  return deck;
}

// 배경 생성 → 렌더 → 미리보기 한 장. 힉스필드 키가 없으면 기존 사진으로 대체
async function produce(deck, name, log = () => {}) {
  finalizeDeck(deck);
  let failed = [];
  if (hasHiggsfield()) {
    log('힉스필드로 배경 사진 7장 생성 중 (2~5분)');
    failed = await generateBackgrounds(deck, name);
    deck.slides.forEach(s => { if (s.type === 'product') s.bgBlur = true; });
  } else {
    failed = ['힉스필드 키가 없어 기존 사진으로 대체했습니다'];
    deck.slides.forEach(s => Object.assign(s, { bg: 'assets/bg/sample-desk.webp', bgSize: 'auto 170%', bgPos: '40% 0', bgBlur: !['cover', 'scover', 'story', 'follow'].includes(s.type) }));
  }
  const deckFile = path.join(ROOT, `decks/${name}.json`);
  fs.mkdirSync(path.dirname(deckFile), { recursive: true });
  fs.writeFileSync(deckFile, JSON.stringify(deck, null, 2));
  log('카드뉴스 이미지 렌더링 중');
  await render(deckFile);
  execFileSync(process.execPath, [path.join(ROOT, 'contact.js'), path.join(ROOT, 'out', name)]);
  return { failed, images: deck.slides.map((_, i) => `out/${name}/${String(i + 1).padStart(2, '0')}.png`) };
}

// 인스타는 공개 JPEG 주소만 받으므로 이미지를 공개 저장소에 올려 raw 주소를 만든다
function pushImages(name) {
  git('add', `out/${name}`, `decks/${name}.json`, ...(fs.existsSync(path.join(ROOT, 'assets/bg', name)) ? [`assets/bg/${name}`] : []));
  try { git('commit', '-m', `카드뉴스 이미지 ${name}`); } catch { /* 변경 없음 */ }
  git('push', 'origin', 'HEAD:main');
  return `https://raw.githubusercontent.com/${REPO}/main/out/${name}`;
}

// raw.githubusercontent 는 푸시 직후 잠깐 404 일 수 있어 몇 번 재시도
async function upload(deck, name, log = () => {}) {
  log('이미지를 공개 저장소에 올리는 중');
  const base = pushImages(name);
  for (let i = 0; ; i++) {
    try {
      log('인스타그램에 게시 중');
      const permalink = await publishDeck(deck, base);
      addHistory({ date: todayKST(), topic: deck.topic, permalink });
      return permalink;
    } catch (e) {
      if (i >= 4 || !/이미지 접근 실패/.test(e.message)) throw e;
      log('이미지 주소 반영 대기 중');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

module.exports = { ROOT, todayKST, recentPosts, readHistory, addHistory, finalizeDeck, produce, upload };
