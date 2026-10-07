# iOS fixtures (written by openlandscape3d-ios InteropTests.testWriteFixturesForWeb)

- `*.openplan3d.json` — exports from the iOS app (producer "ios").
- `*.expected.json` — what iOS computed for them: plants {id, plantId, status, x, y, groupId}, groups {id, kind,
  instanceIds}, areas {id, kind} (each sorted by id) and design checks {ruleId, subjectIds (sorted)} in contract order.
- `roundtrip-<web fixture>.*` — the web's fixtures after an import + export on iOS (web-only data must survive).
- `payload.txt` — a transfer-link payload (`openlandscape3d://import/v1/<payload>`) of ios-corner-lot.
- Catalog: the shipped catalog ol-plants@0.1 (227 plants, identical to openlandscape3d-www/catalog/data);
  every expected file records it as `"catalog": "shipped"`.

Regenerate with `openlandscape3d-ios/scripts/verify-web-interop.sh`. Do not edit by hand.