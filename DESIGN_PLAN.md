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

## Implementation status

| Control | Status |
| --- | --- |
| `translationScope` | Implemented (`scripts/install-translation-policy.py`) |
| `historyRequestEnhancementEnabled` | Implemented (`scripts/apply-customizations.py`) |
| `playerInjectionEnabled` | Implemented (`scripts/apply-customizations.py`) |
| `traktLocalizationEnabled` | Not implemented; no patch exists yet |

## Decisions that differ from the original wording

- Chinese-production detection uses Trakt's `language` / `country` fields. A production is Chinese when `language === "zh"` **or** `country` is one of CN/HK/TW/SG/MO. Country alone is therefore sufficient, not only a supporting signal, and MO is included.
- `translationScope` is independent from `translationEngine`. The engine only selects the machine-translation backend; setting it to "off" does not disable Trakt/backend media translations (use `translationScope: off` for that).

## Pipeline

`restore-eplayerx.sh` -> `apply-customizations.py` -> `install-translation-policy.py` -> `validate-source.py` -> build -> `publish.py`. Every stage fails loudly when an upstream anchor moves; validation and publish assertions raise errors and never rely on shell negation.

## Known trade-off

Upstream's own test suite assumes no EplayerX and no extra arguments, so it fails by design on the patched tree and is not used as a CI gate.
