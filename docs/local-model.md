# Local Model Plan

## Why

규칙 엔진만으로는 정해진 패턴을 벗어난 자유 문장을 안정적으로 고치기 어렵습니다. 로컬 모델을 붙이면 사용자가 길고 애매하게 말해도 교정 후보를 만들 수 있습니다.

예:

```text
상사한테 너무 딱딱하지 않게 보내고 싶은데, 이거 자연스럽게 고쳐줘:
오늘 회의자료 확인부탁드립니다 혹시 수정사항 있으면 말해주세요
```

규칙 엔진은 띄어쓰기와 일부 말투만 고칩니다. 로컬 모델은 문장 전체의 흐름을 보고 더 자연스러운 후보를 만들 수 있습니다.

## Recommended Flow

```mermaid
flowchart LR
  A["사용자 자연어 요청"] --> B["의도 분류"]
  B --> C["규칙 엔진"]
  C --> D{"provider"}
  D -->|"rules"| G["응답"]
  D -->|"local-gec"| E["로컬 GEC 모델"]
  D -->|"hybrid"| E
  E --> F["규칙 후처리"]
  F --> G
```

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-local-gec.txt
$env:CHATPOLISH_PROVIDER="hybrid"
npm run dev
```

## Model

- Default: `Soyoung97/gec_kr`
- Environment override: `CHATPOLISH_GEC_MODEL`
- Python override: `CHATPOLISH_PYTHON`
- Timeout: `CHATPOLISH_GEC_TIMEOUT_MS`

## Tradeoffs

- 장점: 외부 API 비용 없음, 개인정보가 외부 API로 나가지 않음, 자유 입력 대응 범위 증가
- 단점: 첫 실행 모델 다운로드 필요, CPU에서는 느릴 수 있음, 모델 품질은 OpenAI급 범용 LLM보다 좁을 수 있음

## Demo Policy

제출 데모에서는 `rules`를 기본값으로 두고, 로컬 모델을 설치한 환경에서는 `hybrid`를 켜서 보여줍니다. 로컬 모델이 실패하면 자동으로 규칙 엔진으로 fallback합니다.
