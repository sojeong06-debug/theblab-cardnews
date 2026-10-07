// 벤치마크 게시물의 장별 이미지를 한 장으로 모아 보기 → data/benchmark/sheets/<shortcode>.png
// 사용: node tools/sheet.js DZeL15kkucd DKbYUoxyVOM ...   (permalink 의 shortcode)
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');
const { browserPath } = require('../render');

const B = path.join(__dirname, '..', 'data/benchmark');
const posts = JSON.parse(fs.readFileSync(path.join(B, 'posts.json'), 'utf8'));
fs.mkdirSync(path.join(B, 'sheets'), { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: browserPath(), args: ['--allow-file-access-from-files', '--no-sandbox'] });
  const page = await b.newPage();
  for (const code of process.argv.slice(2)) {
    const p = posts.find(x => x.permalink.includes(code));
    if (!p) { console.log(code, '없음'); continue; }
    const imgs = fs.readdirSync(path.join(B, 'img')).filter(f => f.startsWith(p.id + '_')).sort();
    const html = `<body style="margin:0;background:#222;color:#fff;font:14px sans-serif;padding:10px">
      <div style="margin-bottom:8px">${p.like_count}♥ ${imgs.length}장 ${code}</div>
      <div style="display:grid;grid-template-columns:repeat(5,300px);gap:8px">${imgs.map(f => `<img src="${pathToFileURL(path.join(B, 'img', f)).href}" style="width:300px">`).join('')}</div></body>`;
    const t = path.join(B, 'sheets', code + '.html');
    fs.writeFileSync(t, html);
    await page.setViewport({ width: 1560, height: 400 });
    await page.goto(pathToFileURL(t).href, { waitUntil: 'load' });
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 1560, height: h + 20 });
    await page.screenshot({ path: t.replace('.html', '.png') });
    const dims = await page.evaluate(() => [...document.images].map(i => i.naturalWidth + 'x' + i.naturalHeight));
    console.log(code, p.like_count, [...new Set(dims)].join(','));
  }
  await b.close();
})();
