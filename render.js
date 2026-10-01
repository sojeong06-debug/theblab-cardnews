// deck.json → 1080×1350 PNG 카드뉴스 렌더러
// 사용법: node render.js decks/예시.json   → out/<덱이름>/01.png ...
// 문구에서 ==텍스트== 는 형광 초록 강조, 줄바꿈은 \n
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

// 로컬은 Edge, GitHub Actions 는 CHROME_PATH=/usr/bin/google-chrome
const EDGE = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 1080, H = 1350;
const ROOT = __dirname;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = s => esc(s).replace(/==(.+?)==/gs, '<em>$1</em>').replace(/\n/g, '<br>');
const { pathToFileURL } = require('url');
const url = p => pathToFileURL(path.resolve(ROOT, p)).href;

const CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(ellipse at 30% 20%,#3a2c1c 0%,#14100c 55%,#050505 100%)}
body{font-family:Pretendard,sans-serif;color:#fff;position:relative;letter-spacing:-0.02em;word-break:keep-all}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.shade{position:absolute;inset:0}
em{font-style:normal;color:#5CF23D}
.shadow{text-shadow:0 2px 18px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.4)}

/* 표지 */
.cover .shade{background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%)}
.cover .box{position:absolute;left:98px;right:80px;bottom:240px}
.cover .logo{font-size:34px;font-weight:800;letter-spacing:.01em;margin-bottom:6px}
.cover .t1{font-size:96px;font-weight:900;line-height:1.18}
.cover .t2{font-size:96px;font-weight:900;line-height:1.18;color:#5CF23D}
.cover .shade{background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.75) 100%)}

/* 제품 */
.product .shade{background:rgba(0,0,0,.58)}
.product .top{position:absolute;top:130px;left:60px;right:60px;text-align:center}
.product .t1{font-size:84px;font-weight:800;line-height:1.22}
.product .sub{font-size:44px;font-weight:700;margin-top:14px}
.product .prod{position:absolute;left:50%;top:470px;transform:translateX(-50%);width:700px;height:620px;
  display:flex;align-items:center;justify-content:center}
.product .prod img{max-width:100%;max-height:100%;filter:drop-shadow(0 20px 40px rgba(0,0,0,.5))}
.product .ph{width:100%;height:100%;border:4px dashed rgba(255,255,255,.5);border-radius:24px;
  display:flex;align-items:center;justify-content:center;font-size:36px;opacity:.7}
.product .cap{position:absolute;bottom:110px;left:60px;right:60px;text-align:center;font-size:50px;font-weight:800;line-height:1.35}

/* 정보(본문) */
.info .shade{background:rgba(0,0,0,.62)}
.info .wrap{position:absolute;inset:150px 90px 150px;display:flex;flex-direction:column;justify-content:center}
.info .num{font-size:40px;font-weight:800;color:#5CF23D;margin-bottom:20px}
.info .t1{font-size:74px;font-weight:800;line-height:1.25;margin-bottom:44px}
.info .body{font-size:44px;font-weight:600;line-height:1.55;opacity:.95}

.bg.blur{filter:blur(22px) brightness(.55);transform:scale(1.15)}

/* 큰 숫자 */
.stat .shade{background:rgba(0,0,0,.45)}
.stat .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
.stat .kicker{font-size:46px;font-weight:700;opacity:.9;margin-bottom:10px}
.stat .big{font-size:340px;font-weight:900;line-height:1;color:#5CF23D;letter-spacing:-0.05em}
.stat .t1{font-size:80px;font-weight:800;line-height:1.22;margin-top:30px}
.stat .src{position:absolute;bottom:90px;left:90px;font-size:28px;opacity:.6}

/* 한 줄 강한 문장 */
.punch .shade{background:rgba(0,0,0,.45)}
.punch .wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px}
.punch .t1{font-size:104px;font-weight:900;line-height:1.2}
.punch .body{font-size:46px;font-weight:600;line-height:1.5;margin-top:44px;opacity:.9}
.punch .src{position:absolute;bottom:90px;left:90px;font-size:28px;opacity:.6}

/* 순위표 */
.rank .shade{background:rgba(0,0,0,.5)}
.rank .wrap{position:absolute;inset:110px 80px 100px;display:flex;flex-direction:column}
.rank .t1{font-size:78px;font-weight:900;line-height:1.2;margin-bottom:50px}
.rank .row{display:flex;align-items:center;gap:30px;padding:26px 36px;margin-bottom:18px;border-radius:24px;
  background:rgba(255,255,255,.08);font-size:52px;font-weight:800}
.rank .row .mark{width:80px;text-align:center;font-size:56px}
.rank .row .lbl{flex:1}
.rank .row .note{font-size:34px;font-weight:600;opacity:.7}
.rank .row.best{background:#5CF23D;color:#0b0b0b}
.rank .row.best .note{opacity:.85}
.rank .row.bad .lbl{text-decoration:line-through;text-decoration-thickness:5px;opacity:.75}

/* 마지막 CTA */
.cta .shade{background:rgba(0,0,0,.62)}
.cta .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px}
.cta .t1{font-size:76px;font-weight:800;line-height:1.25}
.cta .body{font-size:44px;font-weight:600;line-height:1.5;margin-top:36px}
.cta .logo{position:absolute;bottom:120px;left:0;right:0;text-align:center;font-size:40px;font-weight:800;letter-spacing:.02em}
`;

function slideHTML(s) {
  const bgStyle = s.bg ? `background-image:url('${url(s.bg)}');${s.bgSize ? `background-size:${s.bgSize};` : ''}${s.bgPos ? `background-position:${s.bgPos};` : ''}` : '';
  const bg = s.bg ? `<div class="bg${s.bgBlur ? ' blur' : ''}" style="${bgStyle}"></div>` : '';
  const src = s.src ? `<div class="src">${esc(s.src)}</div>` : '';
  let inner = '';
  if (s.type === 'stat') {
    inner = `<div class="wrap shadow">${s.kicker ? `<div class="kicker">${rich(s.kicker)}</div>` : ''}
      <div class="big">${esc(s.big)}</div><div class="t1">${rich(s.title)}</div></div>${src}`;
  } else if (s.type === 'punch') {
    inner = `<div class="wrap shadow"><div class="t1">${rich(s.title)}</div>${s.body ? `<div class="body">${rich(s.body)}</div>` : ''}</div>${src}`;
  } else if (s.type === 'rank') {
    inner = `<div class="wrap"><div class="t1 shadow">${rich(s.title)}</div>${s.rows.map(r =>
      `<div class="row ${r.tone || ''}"><div class="mark">${esc(r.mark)}</div><div class="lbl">${esc(r.label)}</div>${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div>`).join('')}</div>`;
  } else if (s.type === 'cover') {
    inner = `<div class="box shadow"><div class="logo">THE BLAB</div>
      <div class="t1">${rich(s.title)}</div><div class="t2">${rich(s.highlight)}</div></div>`;
  } else if (s.type === 'product') {
    // productCrop: 누끼가 없을 때 기존 이미지의 제품 영역을 잘라 카드로 넣는다 {src,x,y,w,h}
    const c = s.productCrop;
    const prod = s.product && fs.existsSync(path.resolve(ROOT, s.product))
      ? `<img src="${url(s.product)}">`
      : c ? `<div style="width:${c.w}px;height:${c.h}px;border-radius:32px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.6);
          background:url('${url(c.src)}') -${c.x}px -${c.y}px / 1080px 1350px no-repeat"></div>`
      : `<div class="ph">제품 누끼 PNG 자리</div>`;
    inner = `<div class="top shadow"><div class="t1">${rich(s.title)}</div>${s.sub ? `<div class="sub">${rich(s.sub)}</div>` : ''}</div>
      <div class="prod">${prod}</div><div class="cap shadow">${rich(s.caption)}</div>`;
  } else if (s.type === 'info') {
    inner = `<div class="wrap shadow">${s.num ? `<div class="num">${esc(s.num)}</div>` : ''}
      <div class="t1">${rich(s.title)}</div><div class="body">${rich(s.body)}</div></div>`;
  } else if (s.type === 'cta') {
    inner = `<div class="wrap shadow"><div class="t1">${rich(s.title)}</div>${s.body ? `<div class="body">${rich(s.body)}</div>` : ''}</div>
      <div class="logo shadow">THE BLAB</div>`;
  } else throw new Error('알 수 없는 슬라이드 type: ' + s.type);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
    <body class="${s.type}">${bg}<div class="shade"></div>${inner}</body></html>`;
}

async function render(deckPath) {
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  const name = path.basename(deckPath, '.json');
  const outDir = path.join(ROOT, 'out', name);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const files = [];
  for (const [i, s] of deck.slides.entries()) {
    const htmlFile = path.join(outDir, `${String(i + 1).padStart(2, '0')}.html`);
    fs.writeFileSync(htmlFile, slideHTML(s));
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const png = htmlFile.replace(/\.html$/, '.png');
    await page.screenshot({ path: png });
    // 인스타 게시 API는 JPEG만 받는다
    await page.screenshot({ path: png.replace(/\.png$/, '.jpg'), type: 'jpeg', quality: 92 });
    files.push(png);
  }
  await browser.close();
  return files;
}

module.exports = { render, slideHTML };
if (require.main === module) {
  render(process.argv[2] || 'decks/sample.json').then(f => console.log(f.join('\n'))).catch(e => { console.error(e); process.exit(1); });
}
