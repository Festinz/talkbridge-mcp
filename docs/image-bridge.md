# 대화 이미지 브리지

TalkBridge 데모는 채팅 캡처나 촬영 이미지를 로컬 Tesseract.js로 읽습니다.

1. OCR line을 y좌표로 정렬합니다.
2. 화면 중심을 기준으로 왼쪽은 `incoming`, 오른쪽은 `outgoing`으로 분류합니다.
3. 가까운 line을 한 말풍선으로 묶습니다.
4. 수신 말풍선은 내 언어로 번역합니다.
5. 발신 말풍선은 한국어를 교정한 뒤 상대 언어로 번역합니다.

```powershell
curl.exe -X POST http://127.0.0.1:3010/api/demo/image-bridge `
  -F "image=@conversation.png" `
  -F "myLanguage=ko" `
  -F "partnerLanguage=auto"
```

## PlayMCP 도구 경계

예선 MCP tool은 base64 이미지를 직접 OCR하지 않습니다. OCR cold start가 공식 p99 3초 제한을 넘길 수 있기 때문입니다.

`translate_chat_transcript`는 MCP 호스트 또는 Widget이 추출한 다음 배열을 빠르게 처리합니다.

```json
{
  "messages": [
    { "id": "left-1", "side": "incoming", "text": "明日、何時に会える？" },
    { "id": "right-1", "side": "outgoing", "text": "저녁 7시에 어때?" }
  ],
  "myLanguage": "ko"
}
```

브라우저 데모의 `/api/demo/image-bridge`는 OCR 후 같은 side·message 모델로 결과를 렌더링합니다. 본선에서는 Widget이 이미지 입력과 OCR 수정 화면을 담당하고 MCP tool에는 정제된 발화 배열을 전달합니다.

## 제한과 개인정보

- PNG, JPEG, WebP만 허용
- 최대 8 MiB
- 기본 OCR 언어: 한국어, 일본어, 영어, 중국어 간체, 스페인어
- 이미지와 OCR 원문은 응답 후 저장하지 않음
- 로그는 언어 목록, byte 수, 메시지 수, latency만 기록
