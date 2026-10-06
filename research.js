// Claude 단계 함수 — 사이트(server.js)와 자동 실행(generate.js)이 같이 쓴다
//   findTopics  : 시장 트렌드 리서치 → 주제 후보 10개 순위
//   planDeck    : 고른 주제로 근거 추가 조사 → 7장 기획 → 편집자 검수
//   reviseDeck  : 사용자 피드백 반영 → 편집자 검수
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');

const MODEL = 'claude-opus-5';
// 거절 시 서버가 다른 모델로 자동 재시도
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
let client;
const api = () => (client ??= new Anthropic());

const read = f => fs.readFileSync(path.join(__dirname, 'prompts', f), 'utf8');
const system = () => `당신은 더비랩 인스타그램 카드뉴스 에디터입니다.\n\n${read('brand.md')}\n\n${read('copy-rules.md')}`;
const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: 20, user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' } };

const Row = z.object({
  mark: z.string().describe('✕ / △ / ○ / 1 중 하나'),
  label: z.string(),
  note: z.string().nullable(),
  tone: z.enum(['bad', 'best', 'normal']),
});
const Slide = z.object({
  type: z.enum(['cover', 'punch', 'stat', 'rank', 'product', 'cta']),
  bgPrompt: z.string().describe('배경 사진 생성용 영어 프롬프트. 사실적 사진, 어두운 톤, 글자·로고 없음, 글자 놓일 자리 비우기'),
  title: z.string().describe('제목. 줄바꿈은 \\n, 형광 강조는 ==텍스트=='),
  highlight: z.string().nullable().describe('cover 전용: 초록색 두 번째 줄'),
  kicker: z.string().nullable().describe('stat 전용: 숫자 위 한 줄'),
  big: z.string().nullable().describe('stat 전용: 큰 숫자 (예: 75%, 1/3)'),
  body: z.string().nullable().describe('본문 3줄 이하'),
  sub: z.string().nullable().describe('product 전용: 제품명'),
  caption: z.string().nullable().describe('product 전용: 하단 문구'),
  src: z.string().nullable().describe('수치 출처 (매체 날짜)'),
  rows: z.array(Row).nullable().describe('rank 전용: 5줄'),
});
const Deck = z.object({
  topic: z.string(),
  caption: z.string().describe('인스타 캡션. 첫 줄 후킹, 출처, 해시태그 10개 내외'),
  slides: z.array(Slide),
});
const Candidate = z.object({
  topic: z.string().describe('카드뉴스 주제 한 줄 (예: 고등학생 75%가 폰을 옆에 두고 공부한다)'),
  hook: z.string().describe('표지 후킹 문구 예시'),
  headline: z.string().describe('근거 기사 제목'),
  source: z.string(),
  date: z.string(),
  url: z.string(),
  viral: z.number().int().describe('화제성 1~5'),
  product: z.number().int().describe('몰입의 방 연관도 1~5'),
  why: z.string(),
});
const Topics = z.object({ candidates: z.array(Candidate) });
const Review = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()),
  deck: Deck.describe('문제를 고친 최종 덱 (문제가 없으면 그대로)'),
});

const DECK_RULES = `덱은 정확히 7장, 순서는 고정:
1 cover (답을 숨긴 후킹, highlight에 초록 줄) → 2 punch (답 공개: "바로 ..." 형식, 출처 src) → 3 punch 또는 stat (왜 문제인지 근거 1)
→ 4 stat 또는 punch (근거 2, 3장과 다른 근거·다른 단어) → 5 rank (해결책 5줄: bad 2개, normal 2개, 마지막 best 1개 = 몰입의 방에 해당하는 방법, best의 note는 "더비랩 추천")
→ 6 product (sub는 "더비랩 몰입의 방 프로", 5장의 best에서 자연스럽게 이어지게) → 7 cta (저장 유도).
cover 제목은 2줄 이내, 한 줄 12자 안팎. stat의 big은 6자 이내. 해당 type이 아닌 필드는 null.`;

function textOf(msg) {
  if (msg.stop_reason === 'refusal') throw new Error('모델이 요청을 거절했습니다: ' + JSON.stringify(msg.stop_details));
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// 웹 검색 포함 자유 서술 (pause_turn 이어 받기)
async function searchWrite(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  let msg;
  for (let i = 0; i < 6; i++) {
    const stream = api().beta.messages.stream({
      model: MODEL, max_tokens: 64000, ...FALLBACK,
      thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
      system: system(), messages, tools: [WEB_SEARCH],
    });
    msg = await stream.finalMessage();
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content });
  }
  return textOf(msg);
}

async function structured(schema, prompt) {
  const res = await api().beta.messages.parse({
    model: MODEL, max_tokens: 16000, ...FALLBACK,
    thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: betaZodOutputFormat(schema) },
    system: system(), messages: [{ role: 'user', content: prompt }],
  });
  if (!res.parsed_output) throw new Error('결과를 해석하지 못했습니다: ' + textOf(res));
  return res.parsed_output;
}

const TYPES = ['cover', 'punch', null, null, 'rank', 'product', 'cta'];
function validate(deck) {
  if (deck.slides.length !== 7) throw new Error(`덱이 7장이 아닙니다 (${deck.slides.length})`);
  deck.slides.forEach((s, i) => {
    if (TYPES[i] && s.type !== TYPES[i]) throw new Error(`${i + 1}장 type이 ${TYPES[i]}가 아닙니다 (${s.type})`);
  });
}

// 편집자 검수 — copy-rules.md 자가 점검을 별도 호출로 한 번 더
async function review(deck) {
  const titles = deck.slides.map((s, i) => `${i + 1}. ${[s.kicker, s.big, s.title, s.highlight].filter(Boolean).join(' ').replace(/==/g, '').replace(/\n/g, ' ')}`).join('\n');
  const r = await structured(Review, `처음 보는 고등학생 입장에서 이 카드뉴스를 검수하세요. 카피 규칙의 금지 항목과 자가 점검을 하나씩 확인하고,
특히 "제목만 이어 읽기"에서 맥락이 끊기거나 이해가 안 가는 곳, 앞 장에 없던 말을 받아치는 곳, 표지에서 답이 드러나는 곳을 찾으세요.
문제가 있으면 issues에 적고 고친 덱을 돌려주세요. 구조(7장, type 순서)는 바꾸지 마세요.

제목 흐름:
${titles}

덱 전체:
${JSON.stringify(deck, null, 2)}`);
  validate(r.deck);
  return r;
}

async function findTopics({ today, recentPosts = '(조회 안 됨)', history = [] }, log = () => {}) {
  log('웹에서 최근 기사·트렌드를 찾는 중');
  const notes = await searchWrite(`오늘은 ${today} (한국 시간)입니다.

최근 2주 안의 한국 기사·연구·SNS 트렌드 중 중고생 수험생이 관심 가질 만한 것(공부법, 시험·수능 일정, 스마트폰·숏폼, 수면, 집중력, 교육 정책, 요즘 인스타에서 유행하는 공부 콘텐츠 형식 등)을 웹 검색으로 충분히 찾으세요.
그중 카드뉴스 주제가 될 만한 10개를 골라 "인스타에서 잘 터질 가능성(화제성·공감·시의성)"과 "몰입의 방과의 자연스러운 연관도"로 순위를 매기세요.

우리 계정 최근 게시물 반응 (참고):
${recentPosts}

최근에 이미 다룬 주제 (반복 금지):
${history.length ? history.map(h => '- ' + h).join('\n') : '- 없음'}

각 후보마다 주제 한 줄, 표지 후킹 예시, 근거 기사 제목·매체·날짜·URL, 화제성(1~5), 연관도(1~5), 이유를 적으세요.`);
  log('주제 후보 10개 정리 중');
  const { candidates } = await structured(Topics, `아래 리서치 메모의 후보를 순위대로 정리하세요. 정확히 10개, 1위가 맨 앞.\n\n${notes}`);
  return { notes, candidates };
}

async function planDeck(candidate, log = () => {}) {
  log('고른 주제의 근거 자료를 추가로 조사하는 중');
  const notes = await searchWrite(`카드뉴스 주제: ${candidate.topic}
근거 기사: ${candidate.headline} (${candidate.source} ${candidate.date}) ${candidate.url}

이 주제로 7장 카드뉴스를 만들기 위해, 근거가 되는 수치·연구·기사를 웹 검색으로 2~4개 더 확인하세요.
각 근거마다 정확한 수치, 매체, 날짜를 적고, 출처가 불확실한 수치는 쓰지 마세요.`);
  log('7장 기획 작성 중');
  const draft = await structured(Deck, `아래 조사 메모로 "${candidate.topic}" 카드뉴스 덱을 만드세요.\n\n${DECK_RULES}\n\n조사 메모:\n${notes}`);
  validate(draft);
  log('편집자 검수 중');
  const r = await review(draft);
  return { notes, draft, deck: r.deck, review: { pass: r.pass, issues: r.issues } };
}

async function reviseDeck(deck, feedback, log = () => {}) {
  log('피드백 반영 중');
  const revised = await structured(Deck, `아래 카드뉴스 덱을 사용자 피드백대로 고치세요. 피드백이 언급하지 않은 장은 그대로 두세요.\n\n${DECK_RULES}\n\n피드백:\n${feedback}\n\n현재 덱:\n${JSON.stringify(deck, null, 2)}`);
  validate(revised);
  log('편집자 검수 중');
  const r = await review(revised);
  return { deck: r.deck, review: { pass: r.pass, issues: r.issues } };
}

// 15시 자동 실행용: 1위 주제로 바로 기획
async function research(ctx, log) {
  const t = await findTopics(ctx, log);
  const p = await planDeck(t.candidates[0], log);
  return { notes: t.notes + '\n\n' + p.notes, candidates: t.candidates, draft: p.draft, review: p.review, deck: p.deck };
}

module.exports = { findTopics, planDeck, reviseDeck, research };
