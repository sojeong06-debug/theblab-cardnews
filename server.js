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
const { claudeBin } = require('./claude-cli');

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
const RUNNING = ['researching', 'planning', 'producing'];
// 실패·취소 시 돌아갈 단계: 분석 중이면 실패 화면, 기획 중이면 기획안(있으면) 또는 주제 선택
const fallback = (stage, p) => stage === 'researching' ? 'error' : p.deck ? 'plan' : 'topics';
function startJob(project, stage, work) {
  if (project.job && jobs.get(project.job)?.status === 'running') throw new Error('이미 진행 중인 작업이 있습니다');
  const id = crypto.randomUUID();
  const ctrl = new AbortController();
  const job = { id, status: 'running', log: [], started: Date.now(), ctrl };
  jobs.set(id, job);
  const prevStage = project.stage;
  project.stage = stage;
  project.job = id;
  project.error = null;
  save(project);
  const log = m => job.log.push({ t: Date.now(), m });
  work(log, ctrl.signal)
    .then(() => { job.status = 'done'; })
    .catch(e => {
      const cancelled = ctrl.signal.aborted;
      if (!cancelled) console.error(e);
      job.status = cancelled ? 'cancelled' : 'error';
      job.error = e.message;
      const p = load(project.id);
      p.stage = prevStage === 'researching' ? 'error' : prevStage;
      p.error = cancelled ? null : e.message;
      delete p.revising;
      save(p);
    });
  return job;
}
const jobJSON = j => j && { id: j.id, status: j.status, log: j.log, started: j.started, error: j.error };

// 서버가 꺼졌다 켜지면 진행 중이던 작업은 사라지므로, 멈춘 채 남은 프로젝트를 되돌린다
// (예전 방식의 "채팅 창 Claude 대기" 요청도 함께 정리)
for (const f of fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json'))) {
  const p = JSON.parse(fs.readFileSync(path.join(PROJECTS, f), 'utf8'));
  if (!RUNNING.includes(p.stage) && !p.request) continue;
  const was = RUNNING.includes(p.stage) ? p.stage : p.request.type === 'trends' ? 'researching' : 'planning';
  p.stage = was === 'producing' ? 'confirmed' : fallback(was, p);
  p.error = '서버가 다시 시작되어 작업이 중단됐습니다. 다시 눌러 주세요.';
  delete p.request; delete p.revising;
  save(p);
}
const REQUESTS = path.join(ROOT, 'data/requests');
if (fs.existsSync(REQUESTS)) fs.rmSync(REQUESTS, { recursive: true, force: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/out', express.static(path.join(ROOT, 'out')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => res.status(400).json({ error: e.message }));

app.get('/api/status', (req, res) => res.json({
  keys: {
    anthropic: !!process.env.ANTHROPIC_API_KEY || !!claudeBin(),
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
app.get('/api/jobs/:id', (req, res) => res.json(jobJSON(jobs.get(req.params.id)) || { status: 'unknown' }));

// 진행 중인 분석·기획 취소
app.post('/api/projects/:id/cancel', wrap(async (req, res) => {
  const p = load(req.params.id);
  const job = jobs.get(p.job);
  if (job?.status !== 'running') throw new Error('진행 중인 작업이 없습니다');
  if (p.stage === 'producing') throw new Error('제작·업로드는 중간에 취소할 수 없습니다');
  job.ctrl.abort();
  await new Promise(r => setTimeout(r, 300));
  res.json(load(p.id));
}));

// 기획 단계 미리보기: 실제 렌더와 같은 템플릿, 배경은 제작 전이면 기존 사진으로 대신
app.get('/api/projects/:id/preview/:n', wrap(async (req, res) => {
  const p = load(req.params.id);
  const deck = finalizeDeck(structuredClone(p.deck));
  const s = deck.slides[Number(req.params.n)];
  if (!s) throw new Error('없는 장입니다');
  if (!s.bg) Object.assign(s, { bg: 'assets/bg/sample-desk.webp', bgSize: 'auto 170%', bgPos: '40% 0', bgBlur: !['cover', 'scover', 'story', 'follow'].includes(s.type) });
  res.type('html').send(slideHTML(s, f => '/' + f.split(path.sep).join('/')));
}));

// 1. 트렌드 분석 → 주제 후보 10개
app.post('/api/projects', wrap(async (req, res) => {
  const id = `${todayKST()}-${crypto.randomBytes(2).toString('hex')}`;
  const p = save({ id, created: new Date().toISOString(), stage: 'researching' });
  const job = startJob(p, 'researching', async (log, signal) => {
    log('우리 계정 최근 게시물 반응 확인 중');
    const ctx = { today: todayKST(), recentPosts: await recentPosts(), history: readHistory().slice(-30).map(h => `${h.date} ${h.topic}`) };
    const t = await findTopics(ctx, log, signal);
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
  const job = startJob(p, 'planning', async (log, signal) => {
    const r = await planDeck(c, log, signal);
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
  // 수정 중에도 화면에 기존 기획안을 보여 주도록 요청 내용을 남겨 둔다
  p.revising = req.body.feedback.trim();
  const job = startJob(p, 'planning', async (log, signal) => {
    const r = await reviseDeck(p.deck, req.body.feedback, log, signal);
    const cur = load(p.id);
    delete cur.revising;
    Object.assign(cur, { stage: 'plan', deck: r.deck, review: r.review, confirmed: false });
    save(cur);
  });
  res.json({ project: load(p.id), job });
}));

// 2-2. 화면에서 직접 고친 문구 저장
app.put('/api/projects/:id/deck', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (!['plan', 'confirmed'].includes(p.stage)) throw new Error('지금은 기획안을 고칠 수 없습니다');
  Object.assign(p, { deck: req.body.deck, stage: 'plan', confirmed: false, error: null });
  res.json(save(p));
}));

// 3. 기획 컨펌
app.post('/api/projects/:id/confirm', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (p.stage !== 'plan') throw new Error('컨펌할 기획안이 없습니다');
  res.json(save(Object.assign(p, { stage: 'confirmed', confirmed: true, error: null })));
}));

// 4. 제작 → 인스타 업로드
app.post('/api/projects/:id/produce', wrap(async (req, res) => {
  const p = load(req.params.id);
  if (p.stage !== 'confirmed') throw new Error('기획 컨펌 후에 제작할 수 있습니다');
  if (!process.env.IG_TOKEN) throw new Error('.env 에 IG_TOKEN 이 없습니다');
  const job = startJob(p, 'producing', async log => {
    // 기획이 바뀌지 않았고 이미 만든 이미지가 있으면 그대로 올린다 (힉스필드 비용·다른 사진 방지)
    const strip = d => JSON.stringify(d.slides.map(({ type, title, bgPrompt, showProduct }) => ({ type, title, bgPrompt, showProduct }))) + d.caption;
    const reuse = p.producedDeck && p.images?.length && strip(p.producedDeck) === strip(p.deck)
      && fs.existsSync(path.join(ROOT, 'out', p.id, '01.jpg'));
    let deck = structuredClone(p.deck), cur;
    if (reuse) {
      log('이미 만든 이미지를 그대로 사용');
      deck = structuredClone(p.producedDeck);
    } else {
      const r = await produce(deck, p.id, log);
      cur = load(p.id);
      Object.assign(cur, { images: r.images, imageWarnings: r.failed, producedDeck: deck });
      save(cur);
    }
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
