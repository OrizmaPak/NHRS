# NHRS Trusted Gateway Context

## Headers
- `x-nhrs-context`
- `x-nhrs-context-signature`

## Payload (`x-nhrs-context`)
`x-nhrs-context` is Base64-encoded JSON:

```json
{
  "v": 1,
  "requestId": "uuid",
  "userId": "jwt-sub",
  "roles": ["org_admin"],
  "orgId": "org-123",
  "branchId": "branch-1",
  "permissionsChecked": ["encounters.create"],
  "membershipChecked": true,
  "issuedAt": "2026-03-05T00:00:00.000Z",
  "expiresAt": "2026-03-05T00:01:00.000Z"
}
```

## Signature (`x-nhrs-context-signature`)
- Algorithm: `HMAC-SHA256`
- Input: Base64 payload value from `x-nhrs-context`
- Secret: `NHRS_CONTEXT_HMAC_SECRET`
- Encoding: lowercase hex digest

## Gateway Behavior
- Gateway signs and forwards this context on proxied requests.
- Gateway still forwards `x-org-id` / `x-branch-id` for backward compatibility.

## Service Verification
Services verify:
1. Header presence (for enforced endpoints)
2. Signature validity
3. `expiresAt` not expired

Failure responses:
- Missing: `401 { "message": "MISSING_TRUST_CONTEXT" }`
- Invalid signature: `401 { "message": "INVALID_TRUST_CONTEXT" }`
- Expired: `401 { "message": "EXPIRED_TRUST_CONTEXT" }`

## Rollout Mode
- `NHRS_CONTEXT_ALLOW_LEGACY=true` enables JWT/header fallback when context is absent.
- Set to `false` to enforce signed context strictly on protected endpoints.
