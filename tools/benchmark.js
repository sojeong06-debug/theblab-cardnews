// 벤치마크 수집: 다른 비즈니스 계정의 공개 게시물 중 좋아요 N 이상 캐러셀(카드뉴스)을 모은다
// 사용: node tools/benchmark.js 계정1 계정2 ... [--min 10000]
// 결과: data/benchmark/posts.json (+ 이미지 data/benchmark/img/<id>_<n>.jpg)
// 인스타 Graph API business_discovery — 우리 토큰(IG_TOKEN)으로 공개 정보만 조회
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));
const TOKEN = process.env.IG_TOKEN;
const IG_USER = process.env.IG_USER_ID || '17841412090330279';
const OUT = path.join(ROOT, 'data/benchmark');

const args = process.argv.slice(2);
const minIdx = args.indexOf('--min');
const MIN = minIdx >= 0 ? Number(args[minIdx + 1]) : 10000;
const handles = args.filter((a, i) => !a.startsWith('--') && i !== minIdx + 1);

async function discover(username, after) {
  const media = `media.limit(50)${after ? `.after(${after})` : ''}{id,caption,like_count,comments_count,media_type,media_url,permalink,timestamp,children{media_url,media_type}}`;
  const fields = `business_discovery.username(${username}){username,name,followers_count,media_count,${media}}`;
  const u = `https://graph.facebook.com/v26.0/${IG_USER}?fields=${encodeURIComponent(fields)}&access_token=${TOKEN}`;
  const j = await (await fetch(u)).json();
  if (j.error) throw new Error(j.error.message);
  return j.business_discovery;
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const prev = fs.existsSync(path.join(OUT, 'posts.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'posts.json'), 'utf8')) : [];
  const posts = new Map(prev.map(p => [p.id, p]));
  for (const h of handles) {
    try {
      let bd = await discover(h), pages = 0, hit = 0, total = 0;
      const acct = { username: bd.username, followers: bd.followers_count };
      while (bd && pages < 4) {
        for (const m of bd.media?.data || []) {
          total++;
          if (m.media_type !== 'CAROUSEL_ALBUM' || (m.like_count ?? 0) < MIN) continue;
          hit++;
          posts.set(m.id, { ...m, account: acct.username, followers: acct.followers, slides: (m.children?.data || []).length });
        }
        const next = bd.media?.paging?.cursors?.after;
        if (!next || !bd.media?.paging?.next) break;
        bd = await discover(h, next); pages++;
      }
      console.log(`${h}: 팔로워 ${acct.followers} / 게시물 ${total}개 중 좋아요 ${MIN}+ 캐러셀 ${hit}개`);
    } catch (e) {
      console.log(`${h}: 실패 — ${e.message.slice(0, 80)}`);
    }
  }
  const list = [...posts.values()].sort((a, b) => b.like_count - a.like_count);
  fs.writeFileSync(path.join(OUT, 'posts.json'), JSON.stringify(list, null, 2));
  console.log(`누적 ${list.length}개 저장`);
})();
