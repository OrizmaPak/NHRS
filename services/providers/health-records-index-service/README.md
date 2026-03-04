# health-records-index-service

NHRS timeline metadata index service.

## Endpoints
- `GET /health`
- `GET /records/me`
- `GET /records/:nin`
- `POST /records/me/symptoms`
- `POST /records/:nin/entries`
- `PATCH /records/entries/:entryId`
- `POST /records/entries/:entryId/hide`

## Rules Enforced
- Provider writes are editable for 24 hours only.
- Citizen can hide entries globally or by org/role targeting.
- Provider reads emit `RECORD_ACCESSED` notification events.
- Contributing institutions are derived only from timeline entries.
