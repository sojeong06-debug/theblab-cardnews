// out/<덱>/NN.png 를 한 장으로 모아 보는 미리보기 → out/<덱>/contact.png
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const { pathToFileURL } = require('url');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const pngs = fs.readdirSync(dir).filter(f => /^\d+\.png$/.test(f)).sort();
  const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(4,270px);gap:12px;padding:12px">${pngs.map(f => `<img src="${pathToFileURL(path.join(dir, f)).href}" width=270>`).join('')}</body>`;
  const t = path.join(dir, 'contact.html');
  fs.writeFileSync(t, html);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--allow-file-access-from-files', '--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1140, height: 12 + Math.ceil(pngs.length / 4) * (337 + 12) });
  await p.goto(pathToFileURL(t).href, { waitUntil: 'load' });
  await p.screenshot({ path: path.join(dir, 'contact.png') });
  await b.close();
})();
