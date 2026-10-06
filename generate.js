// 15시 자동 생성 단계 (GitHub Actions): 리서치 → 1위 주제 기획 → 제작 → 검토 이슈 본문 작성
// 사이트에서 직접 고르고 올릴 때는 server.js 를 쓴다
// 환경변수: ANTHROPIC_API_KEY, HF_API_KEY_ID, HF_API_KEY_SECRET, IG_TOKEN, GITHUB_REPOSITORY
const fs = require('fs');
const path = require('path');
const { research } = require('./research');
const { ROOT, todayKST, recentPosts, readHistory, produce } = require('./pipeline');

const today = todayKST();
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), JSON.stringify(v, null, 2)); };

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
### 후보 주제 10개
| 순위 | 주제 | 근거 | 화제성 | 연관도 |
|---|---|---|---|---|
${candidates.map((c, i) => `| ${i + 1} | ${c.topic} | [${c.headline}](${c.url}) ${c.source} ${c.date} | ${c.viral} | ${c.product} |`).join('\n')}
`;
}

(async () => {
  console.log(`[${today}] 리서치 시작`);
  const result = await research(
    { today, recentPosts: await recentPosts(), history: readHistory().slice(-30).map(h => `${h.date} ${h.topic}`) },
    m => console.log('  -', m),
  );
  const { failed } = await produce(result.deck, today, m => console.log('  -', m));
  writeJSON(`data/research/${today}.json`, { candidates: result.candidates, review: result.review, draft: result.draft, notes: result.notes, failed });
  fs.writeFileSync(path.join(ROOT, 'data/issue.md'), issueBody({ deck: result.deck, candidates: result.candidates, review: result.review, failed }));
  writeJSON('data/pending.json', { date: today, topic: result.deck.topic });
  console.log(`[${today}] 생성 완료: ${result.deck.topic}`);
})().catch(e => { console.error('생성 실패:', e); process.exit(1); });
