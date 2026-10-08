// 카드뉴스 스튜디오 — 트렌드 분석 → 주제 선택 → 기획 컨펌 → 제작·인스타 업로드
// 실행: node server.js  → http://localhost:4321
// 키는 같은 폴더 .env 에: ANTHROPIC_API_KEY, HF_API_KEY_ID, HF_API_KEY_SECRET, IG_TOKEN
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const ROOT = __dirname;
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

const { findTopics, planDeck, reviseDeck } = require('./research');
const { todayKST, recentPosts, readHistory, finalizeDeck, produce, upload } = require('./pipeline');
const { slideHTML } = require('./render');

const PORT = Number(process.env.PORT) || 4321;
const PROJECTS = path.join(ROOT, 'data/projects');
fs.mkdirSync(PROJECTS, { recursive: true });

// ── 프로젝트 저장 (data/projects/<id>.json) ──
// stage: researching → topics → planning → plan → confirmed → producing → published  (실패 시 error)
const file = id => path.join(PROJECTS, `${id.replace(/[^\w-]/g, '')}.json`);
const load = id => JSON.parse(fs.readFileSync(file(id), 'utf8'));
const save = p => { p.updated = new Date().toISOString(); fs.writeFileSync(file(p.id), JSON.stringify(p, null, 2)); return p; };

// ── 오래 걸리는 작업 (메모리에 진행 로그 보관, 화면이 폴링) ──
const jobs = new Map();
function startJob(project, stage, work) {
  if (project.job && jobs.get(project.job)?.status === 'running') throw new Error('이미 진행 중인 작업이 있습니다');
  const id = crypto.randomUUID();
  const job = { id, status: 'running', log: [], started: Date.now() };
  jobs.set(id, job);
  const prevStage = project.stage;
  project.stage = stage;
  project.job = id;
  project.error = null;
  save(project);
  const log = m => job.log.push({ t: Date.now(), m });
  work(log)
    .then(() => { job.status = 'done'; })
    .catch(e => {
      console.error(e);
      job.status = 'error';
      job.error = e.message;
      const p = load(project.id);
      p.stage = prevStage === 'researching' ? 'error' : prevStage;
      p.error = e.message;
      save(p);
    });
  return job;
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/out', express.static(path.join(ROOT, 'out')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(400).json({ error: e.message }));

app.get('/api/status', (req, res) => res.json({
  keys: {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    higgsfield: require('./images').hasKey(),
    instagram: !!process.env.IG_TOKEN,
  },
}));

app.get('/api/projects', (req, res) => {
  const list = fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PROJECTS, f), 'utf8')))
    .sort((a, b) => b.created.localeCompare(a.created))
    .map(p => ({ id: p.id, created: p.created, stage: p.stage, topic: p.deck?.topic || p.selected?.topic || (p.candidates ? `트렌드 주제 ${p.candidates.length}개` : null), permalink: p.permalink || null }));
  res.json(list);
});

app.get('/api/projects/:id', wrap((req, res) => res.json(load(req.params.id))));
app.get('/api/jobs/:id', (req, res) => res.json(jobs.get(req.params.id) || { status: 'unknown' }));

// 기획 단계 미리보기: 실제 렌더와 같은 템플릿, 배경은 제작 전이면 기존 사진으로 대신
app.get('/api/projects/:id/preview/:n', wrap(async (req, res) => {
  const p = load(req.params.id);
  const deck = finalizeDeck(structuredClone(p.deck));
  const s = deck.slides[Number(req.params.n)];
  if (!s) throw new Error('없는 장입니다');
  if (!s.bg) Object.assign(s, { bg: 'assets/bg/sample-desk.webp', bgSize: 'auto 170%', bgPos: '40% 0', bgBlur: !['cover', 'scover', 'story', 'follow'].includes(s.type) });
  res.type('html').send(slideHTML(s, f => '/' + f.split(path.sep).join('/')));
}));

// API 키 없이 쓰는 경우: 요청 파일만 남기면, 채팅 창의 Claude 가 data/requests 를 감시하다가
// 웹 리서치·기획을 해서 프로젝트 파일에 채우고 요청 파일을 지운다 (채팅 창이 켜져 있어야 함)
const REQUESTS = path.join(ROOT, 'data/requests');
fs.mkdirSync(REQUESTS, { recursive: true });
function askClaude(p, request) {
  p.request = { ...request, at: new Date().toISOString() };
  fs.writeFileSync(path.join(REQUESTS, `${p.id}.json`), JSON.stringify({ project: p.id, ...p.request }));
  return save(p);
}

// 1. 트렌드 분석 → 주제 후보 10개
app.post('/api/projects', wrap(async (req, res) => {
  const id = `${todayKST()}-${crypto.randomBytes(2).toString('hex')}`;
  const p = save({ id, created: new Date().toISOString(), stage: 'researching' });
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ project: askClaude(p, { type: 'trends' }) });
  const job = startJob(p, 'researching', async log => {
    log('우리 계정 최근 게시물 반응 확인 중');
    const ctx = { today: todayKST(), recentPosts: await recentPosts(), history: readHistory().slice(-30).map(h => `${h.date} ${h.topic}`) };
    const t = await findTopics(ctx, log);
    const cur = load(id);
    Object.assign(cur, { stage: 'topics', notes: t.notes, candidates: t.candidates });
    save(cur);
  });
  res.json({ project: load(id), job });
}));

// 2. 주제 선택 → 7장 기획
app.post('/api/projects/:id/plan', wrap(async (req, res) => {
  const p = load(req.params.id);
  const c = p.candidates?.[req.body.index];
  if (!c) throw new Error('주제를 선택해 주세요');
  p.selected = c;
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ project: askClaude(p, { type: 'plan' }) });
  const job = startJob(p, 'planning', async log => {
    const r = await planDeck(c, log);
    const cur = load(p.id);
    Object.assign(cur, { stage: 'plan', planNotes: r.notes, deck: r.deck, review: r.review, confirmed: false });
    save(cur);
  });
  res.json({ project: load(p.id), job });
}));

// 2-1. 피드백으로 다시 기획
app.post('/api/projects/:id/revise', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (!p.deck) throw new Error('기획안이 없습니다');
  if (!req.body.feedback?.trim()) throw new Error('수정 요청을 적어 주세요');
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ project: askClaude(p, { type: 'revise', feedback: req.body.feedback }) });
  const job = startJob(p, 'planning', async log => {
    const r = await reviseDeck(p.deck, req.body.feedback, log);
    const cur = load(p.id);
    Object.assign(cur, { stage: 'plan', deck: r.deck, review: r.review, confirmed: false });
    save(cur);
  });
  res.json({ project: load(p.id), job });
}));

// 2-2. 화면에서 직접 고친 문구 저장
app.put('/api/projects/:id/deck', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (!['plan', 'confirmed'].includes(p.stage)) throw new Error('지금은 기획안을 고칠 수 없습니다');
  Object.assign(p, { deck: req.body.deck, stage: 'plan', confirmed: false });
  res.json(save(p));
}));

// 3. 기획 컨펌
app.post('/api/projects/:id/confirm', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (p.stage !== 'plan') throw new Error('컨펌할 기획안이 없습니다');
  res.json(save(Object.assign(p, { stage: 'confirmed', confirmed: true })));
}));

// 4. 제작 → 인스타 업로드
app.post('/api/projects/:id/produce', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (p.stage !== 'confirmed') throw new Error('기획 컨펌 후에 제작할 수 있습니다');
  if (!process.env.IG_TOKEN) throw new Error('.env 에 IG_TOKEN 이 없습니다');
  const job = startJob(p, 'producing', async log => {
    const deck = structuredClone(p.deck);
    const r = await produce(deck, p.id, log);
    let cur = load(p.id);
    Object.assign(cur, { images: r.images, imageWarnings: r.failed });
    save(cur);
    const permalink = await upload(deck, p.id, log);
    cur = load(p.id);
    Object.assign(cur, { stage: 'published', permalink, publishedAt: new Date().toISOString() });
    save(cur);
    log('게시 완료');
  });
  res.json({ project: load(p.id), job });
}));

app.listen(PORT, () => console.log(`${new Date().toISOString()} 카드뉴스 스튜디오: http://localhost:${PORT}`))
  .on('error', e => {
    // 시작 프로그램·바로가기로 두 번 켜져도 이미 켜진 서버를 그대로 쓴다
    if (e.code === 'EADDRINUSE') { console.log(`${new Date().toISOString()} 이미 실행 중 — 종료`); process.exit(0); }
    throw e;
  });
