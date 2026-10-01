// 15시 생성 단계: 리서치 → 카피 → 배경 생성 → 렌더 → 검토용 이슈 본문 작성
// 사용: node generate.js            (오늘 날짜 덱)
//       node generate.js --no-images (힉스필드 없이 기존 배경으로 렌더 — 로컬 테스트용)
// 환경변수: ANTHROPIC_API_KEY, HF_API_KEY_ID, HF_API_KEY_SECRET, IG_TOKEN, GITHUB_REPOSITORY(이슈 본문 이미지 주소용)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { research } = require('./research');
const { generateBackgrounds } = require('./images');
const { render } = require('./render');

const ROOT = __dirname;
const IG_USER = process.env.IG_USER_ID || '17841412090330279';
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), JSON.stringify(v, null, 2)); };

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

function issueBody({ deck, candidates, review, failed }) {
  const repo = process.env.GITHUB_REPOSITORY;
  const raw = repo ? `https://raw.githubusercontent.com/${repo}/main/out/${today}` : `out/${today}`;
  const titles = deck.slides.map((s, i) => `${i + 1}. ${[s.kicker, s.big, s.title, s.highlight].filter(Boolean).join(' ').replace(/==/g, '**').replace(/\n/g, ' ')}`).join('\n');
  return `## ${deck.topic}

**오늘 18:00에 자동 게시됩니다.** 올리지 않으려면 이 이슈를 닫거나 \`취소\` 라벨을 붙이세요.

![미리보기](${raw}/contact.png)

### 제목 흐름
${titles}

### 캡션
\`\`\`
${deck.caption}
\`\`\`

### 편집자 검수
${review.pass ? '통과' : '수정 후 반영'}${review.issues.length ? '\n' + review.issues.map(x => '- ' + x).join('\n') : ''}
${failed.length ? `\n### ⚠ 배경 생성 실패 (기존 배경으로 대체)\n${failed.map(x => '- ' + x).join('\n')}\n` : ''}
### 후보 기사 10개
| 순위 | 기사 | 화제성 | 연관도 | 이유 |
|---|---|---|---|---|
${candidates.map(c => `| ${c.rank} | [${c.headline}](${c.url}) ${c.source} ${c.date} | ${c.viral} | ${c.product} | ${c.why.replace(/\|/g, '/')} |`).join('\n')}
`;
}

(async () => {
  const noImages = process.argv.includes('--no-images');
  const history = readJSON('data/history.json', []);
  console.log(`[${today}] 리서치 시작`);
  const result = await research({ today, recentPosts: await recentPosts(), history: history.slice(-30).map(h => `${h.date} ${h.topic}`) });
  const deck = result.deck;

  // 렌더러가 쓰지 않는 null 필드 정리 + 제품 이미지
  for (const s of deck.slides) for (const k of Object.keys(s)) if (s[k] === null) delete s[k];
  for (const r of deck.slides.find(s => s.type === 'rank')?.rows || []) if (r.tone === 'normal') delete r.tone;
  const product = deck.slides.find(s => s.type === 'product');
  if (fs.existsSync(path.join(ROOT, 'assets/product/molip-pro.png'))) product.product = 'assets/product/molip-pro.png';
  else product.productCrop = { src: 'assets/ref-product-slide.webp', x: 210, y: 450, w: 690, h: 640 };

  let failed = [];
  if (noImages) deck.slides.forEach(s => Object.assign(s, { bg: 'assets/bg/sample-desk.webp', bgSize: 'auto 170%', bgPos: '40% 0', bgBlur: s.type !== 'cover' }));
  else failed = await generateBackgrounds(deck, today);
  // 사진 위 글자 가독성: 표지 외에는 배경을 살짝 흐리게
  deck.slides.forEach(s => { if (s.type !== 'cover' && s.type !== 'product' && !noImages) s.bgBlur = false; });

  writeJSON(`decks/${today}.json`, deck);
  writeJSON(`data/research/${today}.json`, { candidates: result.candidates, review: result.review, draft: result.draft, notes: result.notes, failed });
  await render(path.join(ROOT, `decks/${today}.json`));
  execFileSync(process.execPath, [path.join(ROOT, 'contact.js'), path.join(ROOT, 'out', today)], { stdio: 'inherit' });

  fs.writeFileSync(path.join(ROOT, 'data/issue.md'), issueBody({ deck, candidates: result.candidates, review: result.review, failed }));
  writeJSON('data/pending.json', { date: today, topic: deck.topic });
  console.log(`[${today}] 생성 완료: ${deck.topic}`);
})().catch(e => { console.error('생성 실패:', e); process.exit(1); });
