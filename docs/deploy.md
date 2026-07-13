# 카카오클라우드 배포

공모전 예선은 PlayMCP in KC에서 제공하는 무상 서버를 사용합니다.

## 배포 구조

```mermaid
flowchart LR
  A[PlayMCP] -->|Streamable HTTP| B[TalkBridge Node server]
  B --> C[Rule correction]
  B --> D[Argos Python worker]
  B --> E[Tesseract OCR demo route]
```

프로덕션 `Dockerfile`은 Node 서버, Tesseract.js, Argos Translate Python 환경과 번역 모델을 하나의 이미지에 포함합니다. 별도 OpenAI 키, 유료 번역 API, 외부 데이터베이스가 필요하지 않습니다.

## PlayMCP in KC

1. https://playmcp.kakaocloud.io/my-mcp 에 로그인합니다.
2. `새 MCP 서버 등록`에서 `Git 소스 빌드`를 선택합니다.
3. 서버 이름은 `TalkBridge`, 설명은 제출 문서의 콘솔 설명을 사용합니다.
4. 공개 Git URL과 `main` 브랜치를 입력합니다.
5. Dockerfile 경로는 `Dockerfile`, PAT는 비워둡니다.
6. `등록하기` 후 Status가 `Active`가 될 때까지 기다립니다.
7. 상세 화면의 Endpoint URL을 복사합니다.

이미지는 Argos 모델을 빌드 중 내려받으므로 첫 빌드가 수 분 이상 걸릴 수 있습니다.

서버 시작 시 영어·일본어 양방향 모델을 백그라운드에서 예열합니다. Windows 로컬 검증에서는 예열 후 fixture에 없는 영어→한국어가 58ms, 한국어→영어가 78ms에 처리됐습니다. 배포 환경에서는 공개 Endpoint에서 다시 측정합니다.

중국어와 스페인어도 임의 문장으로 `argos-local`, `externalApi: false`를 확인했습니다. 최초 모델 로딩은 로컬 CPU에서 약 6~9초가 걸렸고, 예열 후 새 문장은 중국어 279ms·스페인어 188ms였습니다. 첫 호출 지연을 줄이려면 운영 트래픽에 맞춰 예열 언어를 확장하되 컨테이너 메모리 사용량을 함께 확인합니다.

## 공개 Endpoint 확인

```powershell
Invoke-RestMethod https://YOUR-ENDPOINT/healthz
Invoke-RestMethod https://YOUR-ENDPOINT/readyz
```

MCP 확인 항목:

- initialize protocol version이 공식 허용 범위에 있는지 확인
- tools/list에 6개 tool이 노출되는지 확인
- `detect_chat_language`가 로컬에서 즉시 응답하는지 확인
- `bridge_chat_turn`이 받은 말과 답장을 한 응답에서 반환하는지 확인
- `translate_chat_transcript`가 좌·우 side를 유지하는지 확인
- 자유 문장 provider가 `argos-local`이고 `externalApi: false`인지 확인
- 평균 응답 100ms 목표, p99 3,000ms 제한을 대표 입력으로 측정

## Local Docker

```powershell
docker build -t talkbridge-mcp .
docker run --rm -p 3010:3000 talkbridge-mcp
```

번역 모델 쌍 변경:

```text
CHATPOLISH_ARGOS_MODEL_PAIRS=en-ko,ko-en,en-ja,ja-en,en-zh,zh-en,en-es,es-en
```

모델 목록 변경은 이미지 재빌드가 필요합니다. 기본 제출 언어는 한국어와 일본어·영어·중국어·스페인어입니다.

## 운영 원칙

- 서버 로그에 메시지, OCR 원문, 이미지 데이터를 남기지 않습니다.
- `/healthz`는 프로세스 상태, `/readyz`는 번역 provider 상태를 반환합니다.
- rate limit과 입력 크기 제한을 유지합니다.
- 번역 실패는 원문을 성공 번역처럼 표시하지 않고 `fallback: true`로 반환합니다.
- 등록 후 먼저 임시 등록·도구함 테스트를 거친 다음 심사를 요청합니다.
