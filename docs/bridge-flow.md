# TalkBridge 흐름

## 사용 방식

데모에서는 상단에서 상대방 언어를 고르거나 `자동 감지`를 선택합니다.

- `받은 메시지 번역`: 상대방 채팅을 복사해 붙여넣습니다. 언어를 감지해 한국어 번역을 보여주고, 감지된 언어를 다음 발신 번역에 기억합니다.
- `보낼 메시지 준비`: 한국어로 초안을 입력합니다. 입력 중에는 교정 결과와 상대방 언어 미리보기를 보여주고, 전송하면 교정 결과와 번역 결과를 대화에 추가합니다.

## API

```text
POST /api/demo/bridge-turn
```

요청은 `incomingMessage`, `myDraft` 중 하나 또는 둘 다를 포함할 수 있습니다.

```json
{
  "conversationId": "demo",
  "incomingMessage": "明日、何時に会える？",
  "myDraft": "저녁 7시에 어때?",
  "partnerLanguage": "auto",
  "myLanguage": "ko",
  "tone": "polite",
  "provider": "rules"
}
```

응답의 `incoming.translation`은 사용자가 볼 번역이고, `outgoing.correction`은 보내기 전 한국어 교정 결과, `outgoing.translation`은 상대방에게 전달할 문장입니다.

## 정확도 경계

규칙·사전만으로는 모든 자유 문장을 번역할 수 없습니다. 이 경우에도 UI가 성공처럼 꾸미지 않고 `fallback: true`와 provider를 표시합니다. 실제 서비스 단계에서는 로컬 번역 모델을 추가하거나 `CHATPOLISH_LIBRETRANSLATE_URL`을 별도 번역 어댑터로 설정할 수 있습니다.
