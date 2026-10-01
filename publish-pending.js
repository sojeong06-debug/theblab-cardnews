// 18시 게시 단계: data/pending.json 의 덱을 검토 이슈 상태에 따라 게시하거나 건너뛴다
// - 이슈가 닫혔거나 '취소' 라벨이 있으면 게시하지 않음
// - 게시하면 이슈에 링크 댓글 + 닫기, data/history.json 에 기록, pending 삭제
// 환경변수: IG_TOKEN, GITHUB_TOKEN, GITHUB_REPOSITORY
const fs = require('fs');
const path = require('path');
const { publishDeck } = require('./publish');

const ROOT = __dirname;
const REPO = process.env.GITHUB_REPOSITORY;
const gh = async (p, opts = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`GitHub ${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

(async () => {
  const pendingFile = path.join(ROOT, 'data/pending.json');
  if (!fs.existsSync(pendingFile)) { console.log('대기 중인 카드뉴스 없음'); return; }
  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  const issue = pending.issue ? await gh(`issues/${pending.issue}`) : null;
  const done = () => fs.rmSync(pendingFile);

  if (!issue) throw new Error('검토 이슈 번호가 pending.json 에 없습니다 — 생성 단계의 이슈 생성이 실패했는지 확인');
  const cancelled = issue.state === 'closed' || issue.labels.some(l => l.name === '취소');
  if (cancelled) {
    console.log(`#${issue.number} 취소됨 — 게시하지 않음`);
    if (issue.state === 'open') await gh(`issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: '취소 라벨 확인 — 게시하지 않았습니다.' }) });
    done();
    return;
  }

  const deck = JSON.parse(fs.readFileSync(path.join(ROOT, `decks/${pending.date}.json`), 'utf8'));
  const base = `https://raw.githubusercontent.com/${REPO}/main/out/${pending.date}`;
  const permalink = await publishDeck(deck, base);
  console.log('게시 완료:', permalink);

  await gh(`issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ 게시 완료: ${permalink}` }) });
  await gh(`issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', labels: ['게시완료'] }) });
  const histFile = path.join(ROOT, 'data/history.json');
  const history = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];
  history.push({ date: pending.date, topic: deck.topic, permalink });
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2));
  done();
})().catch(e => { console.error('게시 실패:', e.message); process.exit(1); });
