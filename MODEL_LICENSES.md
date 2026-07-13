# Model Licenses

TalkBridge 애플리케이션 코드는 `LICENSE`의 MIT 조건을 따릅니다. 아래 모델 파일은 저장소에 커밋하지 않으며 Docker 이미지 빌드 과정에서 별도로 내려받습니다.

## NLLB-200 distilled 600M

- Original project: [Meta AI, No Language Left Behind](https://huggingface.co/facebook/nllb-200-distilled-600M)
- Runtime format: CTranslate2 INT8 conversion linked by the [OpenNMT tutorial](https://opennmt.net/CTranslate2/guides/transformers.html)
- License: [Creative Commons Attribution-NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/)
- Download checksum (SHA-256): `a1dede18a91665b4670fd1e18942317226f3a3a8a1f96fca7099551f065ce224`
- Purpose in TalkBridge: 비용 없는 비상업적 대회 데모 및 다국어 로컬 번역

상업 서비스로 전환할 때는 이 모델을 그대로 사용하지 말고 상업 이용이 허용된 모델 또는 정식 번역 서비스로 교체해야 합니다.

## Argos Translate

- Project: Argos Open Tech
- Package: `argostranslate`
- Purpose in TalkBridge: 프로덕션 이미지에 포함되지 않는 선택형 로컬 fallback

각 Argos 언어 모델 패키지의 메타데이터와 라이선스 조건도 배포 전에 함께 확인합니다.
