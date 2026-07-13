# PlayMCP 제출 메모

기준 확인일: 2026-07-13

## 팀

- 팀 프로필: `시나브로`
- 팀장: `신창준`
- 팀원: `박명환`
- GitHub 공동 참여자: `yuruha0605` (`push` 권한)

## 개발자 콘솔 입력값

- MCP 이름: `TalkBridge`
- MCP 식별자: `talkbridge`
- 인증 방식: `인증 사용하지 않음`
- 대표 이미지: `public/talkbridge-mark.png` (600x600 PNG)

MCP 설명(500자 이내):

> TalkBridge는 언어가 다른 사람과의 대화를 이해에서 답장까지 이어주는 양방향 메시지 브리지입니다. 받은 문장은 자동 감지해 내 언어로 번역하고, 보낼 문장은 한국어 맞춤법과 말투를 교정한 뒤 상대 언어로 번역합니다. 대화 캡처는 좌측 상대방과 우측 내 말풍선을 복원해 여러 메시지를 한 번에 처리합니다. 이미지와 원문은 저장하지 않으며 오픈소스 로컬 OCR·번역 모델을 사용해 호출 비용이 없습니다.

대화 예시(각 40자 이내):

1. `이 일본어 메시지를 한국어로 번역해줘`
2. `상대는 영어야. 이 답장을 다듬어 번역해줘`
3. `이 대화 캡처를 좌우 말풍선대로 번역해줘`

## 비즈니스폼 초안

- PlayMCP 서비스명: `TalkBridge`
- 팀명: `시나브로`
- 팀장: `신창준`
- 팀원: `박명환`

서비스 소개 및 AGENTIC PLAYER 10 지원 사유(200자 이내):

> TalkBridge는 대화 캡처의 좌·우 발화자를 구분해 받은 말은 내 언어로, 보낼 답장은 맞춤법 교정 후 상대 언어로 바꾸는 양방향 대화 번역 MCP입니다. 로컬 OCR·번역 모델로 호출 비용 없이 언어 장벽을 낮춰 일상 대화를 자연스럽게 이어줍니다.

선택 항목:

- PlayMCP 전체 공개 상태: 심사 승인 후 `네`
- 본선 진출 시 Kakao Tools 추가 개발: `네, 참여 가능합니다.`
- 소속 구분·소속명: 사용자 확인값 입력
- 홈페이지 URL: 공개 GitHub 저장소 URL
- PlayMCP URL: 심사 승인 및 전체 공개 후 상세 페이지 URL

## 공식 서버 가이드 점검

- [x] MCP SDK 기반 Streamable HTTP `POST /mcp`
- [x] Stateless transport (`sessionIdGenerator: undefined`)
- [x] Tool 6개: 권장 범위 3~10개
- [x] Tool 이름은 영문·숫자·underscore만 사용
- [x] 모든 tool에 `name`, `description`, `inputSchema`, `annotations` 포함
- [x] 모든 annotations에 title과 4개 hint 값 지정
- [x] 영문 description에 `TalkBridge(톡브릿지)` 포함
- [x] 사용자용 text content는 원시 API JSON 대신 정제된 Markdown
- [x] 서버 및 tool 이름에 금지 문자열 없음
- [x] 요청 길이 제한, rate limit, timeout 적용
- [x] 원문·이미지 비저장 및 메타데이터 로그만 사용
- [x] 임의 영어↔한국어 문장이 `argos-local`, `externalApi: false`로 처리됨
- [x] 실제 대화 이미지에서 좌측 일본어·우측 한국어 말풍선 2개를 방향대로 복원
- [x] 모델 예열 후 임의 번역 처리 시간 58~78ms 확인
- [ ] 카카오클라우드 Endpoint에서 initialize, tools/list, tools/call 성공
- [ ] PlayMCP `정보 불러오기` 성공
- [ ] 임시 등록 후 도구함 AI 채팅 테스트
- [ ] `심사 요청` 완료
- [ ] 승인 후 공개 상태를 `전체 공개`로 변경

## 최종 제출 순서

1. PlayMCP in KC에서 Git 소스 빌드가 `Active`인지 확인합니다.
2. PlayMCP 개발자 콘솔에서 Endpoint 정보를 불러옵니다.
3. 먼저 `임시 등록`하고 도구함·AI 채팅에서 대표 예시를 검증합니다.
4. 문제가 없을 때 `심사 요청`합니다.
5. 승인 후 공개 상태를 `전체 공개`로 전환합니다.
6. 비즈니스폼을 제출한 뒤 공모전 페이지의 `Player 예선 참여`를 마지막으로 누릅니다.

예선 제출은 1회이며 수정이 어렵습니다. 사용자가 마지막 참여 버튼을 누르기 전 서비스명, 팀 정보, 공개 상태, PlayMCP URL을 다시 확인합니다.
