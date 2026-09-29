# Trakt Enhance — feature-control design plan

## Goal
Add an optional Chinese-production-only translation mode without breaking existing translation behavior, and expose switches for currently implicit enhancement features.

## Proposed controls
- `translationScope`: `all` (current behavior), `chinese_only`, `off`
- `historyRequestEnhancementEnabled`: controls history request limit expansion
- `playerInjectionEnabled`: controls TMDB provider/player injection
- `traktLocalizationEnabled`: master switch for Trakt text localization/transformation where technically separable

## Chinese-production detection
Prefer metadata already available on the media object. Treat `original_language === "zh"` as Chinese. Where production-country metadata is available, include CN/HK/TW/SG as supporting signals. Do not infer from whether the returned English title contains Chinese characters.

## Compatibility
Existing `translationEngine` remains the engine selector. Existing `characterTranslationEnabled` remains independent. Existing player-specific order switches remain independent. Default values preserve current behavior.

## Safety
Do not modify upstream generated artifacts directly. Apply source-level patches before the existing build. Fail the workflow if required controls or EplayerX are missing.
