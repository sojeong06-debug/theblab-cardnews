// API 키가 없을 때: 이 PC에 설치된 Claude Code(claude -p)를 서버가 직접 실행한다
// Claude 구독으로 동작하므로 추가 요금 없음. 처음 한 번 터미널에서 `claude` 실행 → /login 필요
// 실행 파일 위치: .env 의 CLAUDE_BIN → PATH 의 claude → Claude 데스크톱 앱에 들어 있는 claude.exe 순서로 찾는다
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function findClaude() {
  if (process.env.CLAUDE_BIN) return fs.existsSync(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const hit = execFileSync(cmd, ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).find(Boolean);
    if (hit) return hit.trim();
  } catch {}
  // 데스크톱 앱: %APPDATA%\Claude\claude-code\<버전>\<해시>\claude.exe — 가장 최근 것
  const base = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  if (!fs.existsSync(base)) return null;
  const found = [];
  for (const v of fs.readdirSync(base)) for (const h of fs.readdirSync(path.join(base, v)).filter(h => !h.includes('.'))) {
    const f = path.join(base, v, h, 'claude.exe');
    if (fs.existsSync(f)) found.push({ f, t: fs.statSync(f).mtimeMs });
  }
  return found.sort((a, b) => b.t - a.t)[0]?.f || null;
}

let bin;
const claudeBin = () => (bin === undefined ? (bin = findClaude()) : bin);

// 프로젝트 폴더의 CLAUDE.md·설정을 읽지 않도록 빈 폴더에서 실행
const WORKDIR = path.join(os.tmpdir(), 'theblab-cardnews-claude');
fs.mkdirSync(WORKDIR, { recursive: true });

const TIMEOUT = 20 * 60 * 1000;

// prompt 를 실행하고 결과 텍스트(또는 schema 를 주면 그 형식의 객체)를 돌려준다
// tools: ['WebSearch', 'WebFetch'] 처럼. 진행 중 검색어는 log 로 화면에 보낸다
function runClaude({ prompt, system, tools = [], schema, log = () => {}, signal }) {
  const exe = claudeBin();
  if (!exe) return Promise.reject(new Error('이 PC에서 Claude Code 를 찾지 못했습니다. Claude 데스크톱 앱을 설치하거나 .env 에 CLAUDE_BIN 경로를 적어 주세요.'));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--model', 'opus', '--strict-mcp-config',
    '--tools', tools.length ? tools.join(',') : ''];
  if (tools.length) args.push('--allowedTools', tools.join(','));
  if (system) args.push('--system-prompt', system);
  if (schema) args.push('--json-schema', JSON.stringify(schema));

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buf = '', err = '', result = null, settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(v); };
    const onAbort = () => { child.kill(); finish(reject, new Error('취소했습니다')); };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error('Claude 응답이 20분 넘게 없어 중단했습니다')); }, TIMEOUT);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') for (const b of ev.message?.content || []) {
          if (b.type === 'tool_use' && b.name === 'WebSearch' && b.input?.query) log(`검색: ${b.input.query}`);
          if (b.type === 'tool_use' && b.name === 'WebFetch' && b.input?.url) log(`읽는 중: ${b.input.url}`);
        }
        if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish(reject, new Error('Claude Code 실행 실패: ' + e.message)));
    child.on('close', code => {
      if (!result) return finish(reject, new Error(`Claude Code 가 결과 없이 끝났습니다 (코드 ${code}) ${err.slice(-300)}`));
      if (result.is_error) {
        const m = String(result.result || result.subtype || '');
        if (/not logged in|\/login/i.test(m)) return finish(reject, new Error('Claude Code 로그인이 필요합니다. 이 PC 터미널에서 claude 를 한 번 실행하고 /login 해 주세요.'));
        return finish(reject, new Error('Claude 오류: ' + m.slice(0, 300)));
      }
      if (schema) {
        if (result.structured_output == null) return finish(reject, new Error('Claude 가 정해진 형식으로 답하지 않았습니다'));
        return finish(resolve, result.structured_output);
      }
      finish(resolve, String(result.result || ''));
    });
    child.stdin.end(prompt);
  });
}

module.exports = { runClaude, claudeBin };
