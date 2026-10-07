// 해시태그 인기 게시물에서 좋아요 N 이상 캐러셀(카드뉴스) 수집 + 장별 이미지 저장
// 사용: node tools/benchmark-tags.js 공부자극 수험생 ... [--min 10000] [--pages 20]
// 주의: 인스타 API는 7일에 해시태그 30개까지 조회 가능.
//       children(장별 이미지)을 같이 받으려면 limit 5 로 넘겨야 함 (크게 잡으면 "데이터가 너무 크다"로 거절)
//       top_media 순서는 호출마다 달라지므로 한 번 넘기면서 바로 걸러 담는다
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));
const T = process.env.IG_TOKEN, U = process.env.IG_USER_ID || '17841412090330279';
const OUT = path.join(ROOT, 'data/benchmark');
const G = 'https://graph.facebook.com/v26.0';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const MIN = opt('--min', 10000), PAGES = opt('--pages', 20);
const tags = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const withToken = u => u.replace(/&access_token=[^&]+/, '') + '&access_token=' + T;
const get = async u => { const j = await (await fetch(withToken(u))).json(); if (j.error) throw new Error(j.error.message); return j; };

(async () => {
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const file = path.join(OUT, 'posts.json');
  const posts = new Map((fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []).map(p => [p.id, p]));
  for (const tag of tags) {
    let seen = 0, hit = 0;
    try {
      const { data } = await get(`${G}/ig_hashtag_search?user_id=${U}&q=${encodeURIComponent(tag)}`);
      let url = `${G}/${data[0].id}/top_media?user_id=${U}&limit=5&fields=id,media_type,like_count,comments_count,permalink,caption,timestamp,children{media_url,media_type}`;
      for (let page = 0; url && page < PAGES; page++) {
        let r;
        try { r = await get(url); } catch { break; }
        for (const x of r.data) {
          seen++;
          if (x.media_type !== 'CAROUSEL_ALBUM' || (x.like_count || 0) < MIN) continue;
          hit++;
          const old = posts.get(x.id);
          posts.set(x.id, { ...old, ...x, children: x.children || old?.children, tags: [...new Set([...(old?.tags || []), tag])] });
        }
        url = r.paging?.next || null;
      }
      console.log(`#${tag}: ${seen}개 확인, 좋아요 ${MIN}+ 캐러셀 ${hit}개`);
    } catch (e) { console.log(`#${tag}: 실패 — ${e.message.slice(0, 80)}`); }
  }
  // 장별 이미지 저장 (분석용)
  for (const p of posts.values()) {
    const kids = (p.children?.data || []).filter(c => c.media_type === 'IMAGE' && c.media_url);
    p.slides = kids.length;
    for (const [i, c] of kids.entries()) {
      const f = path.join(OUT, 'img', `${p.id}_${String(i + 1).padStart(2, '0')}.jpg`);
      if (fs.existsSync(f)) continue;
      try { fs.writeFileSync(f, Buffer.from(await (await fetch(c.media_url)).arrayBuffer())); } catch {}
    }
  }
  const list = [...posts.values()].sort((a, b) => b.like_count - a.like_count);
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  console.log(`누적 ${list.length}개 (이미지 있는 것 ${list.filter(p => p.slides).length}개)`);
  for (const p of list) console.log(`${p.like_count}♥ ${p.slides}장 ${p.permalink} [${p.tags.join(',')}] ${(p.caption || '').replace(/\s+/g, ' ').slice(0, 50)}`);
})();
