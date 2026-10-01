# 더비랩 카드뉴스 자동화

매일 **15:00 생성 → 18:00 theblab_official 게시** (GitHub Actions)

| 시각 (KST) | 워크플로 | 하는 일 |
|---|---|---|
| 15:00 | `generate.yml` | 웹 리서치로 기사 10개 순위 → 1위 주제 7장 카피 → 편집자 검수 → 힉스필드 배경 → 렌더 → **검토 이슈** 생성 |
| 18:00 | `publish.yml` | 검토 이슈가 열려 있고 `취소` 라벨이 없으면 인스타 캐러셀 게시 → 이슈에 링크 남기고 닫기 |

**게시를 막으려면** 18시 전에 그날 이슈를 닫거나 `취소` 라벨을 붙이면 됩니다.

## 최초 설정 (한 번만)
1. 이 폴더를 GitHub **공개(Public)** 저장소로 올리기 (이미지 주소를 인스타가 가져가야 해서 공개 필요)
2. 저장소 Settings → Secrets and variables → Actions 에 등록
   - `ANTHROPIC_API_KEY` — console.anthropic.com
   - `HF_API_KEY_ID`, `HF_API_KEY_SECRET` — console.higgsfield.ai (크레딧 충전 필요)
   - `IG_TOKEN` — 수집 서버 `/opt/theblab/.env` 의 `META_TOKEN` 값 (무기한 시스템 사용자 토큰)
3. Actions 탭 → `카드뉴스 생성` → Run workflow 로 첫 실행 확인

## 파일
- `research.js` 리서치·카피·검수 (Claude) / `images.js` 배경 생성 (힉스필드) / `render.js` 렌더 / `publish.js` 인스타 게시
- `prompts/brand.md` 브랜드 정보, `prompts/copy-rules.md` 카피 규칙 — **카피 품질은 이 두 파일을 고쳐서 조정**
- `assets/product/molip-pro.png` 를 넣으면 제품 장에 누끼가 들어감 (없으면 기존 이미지를 잘라 씀)
- 로컬 렌더 테스트: `node render.js decks/<날짜>.json && node contact.js out/<날짜>`
