# NHRS Event Envelope and Outbox Contract

## Standard Event Envelope

```json
{
  "eventId": "uuid",
  "eventType": "RECORD_ACCESSED",
  "sourceService": "health-records-index-service",
  "aggregateType": "record_entry",
  "aggregateId": "entry-123",
  "payload": {},
  "createdAt": "2026-03-05T00:00:00.000Z",
  "trace": {
    "requestId": "req-1",
    "userId": "user-1",
    "orgId": "org-1",
    "branchId": "branch-1"
  }
}
```

## Outbox Storage (`outbox_events`)
- `_id` / `eventId`
- `eventType`
- `sourceService`
- `aggregateType`
- `aggregateId`
- `payload`
- `trace`
- `createdAt`
- `destination` (`audit` or `notification`)
- `status` (`pending|delivered|failed`)
- `attempts`
- `lastAttemptAt`
- `deliveredAt`
- `lastError`
- `lockedUntil`

## Delivery Rules
- Business write happens first, then event is enqueued into outbox.
- Worker polls pending rows and delivers to destination service.
- Retry with bounded attempts (`OUTBOX_MAX_ATTEMPTS`, default `20`).
- Failed downstream dependencies do not block core writes.

## Idempotency
- `notification-service` tracks processed `eventId` in-memory + Mongo TTL collection.
- `audit-log-service` de-duplicates repeated `eventId` in queueing path and has unique index.

## Initial Outbox-Enabled Services
- `health-records-index-service`
- `emergency-inventory-service`
- `case-service`
- `doctor-registry-service`
- `clinical-encounter-service`
- `laboratory-result-service`
- `pharmacy-dispense-service`
- `membership-service`
