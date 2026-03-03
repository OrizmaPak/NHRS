# NHRS Profile Service

Central profile read/write service for system user identity context.

## Responsibilities
- Profile CRUD for authenticated users (`/profile/me` endpoints).
- Authorized search/lookup endpoints for staff/admin.
- Merged profile view with NIN summary + RBAC role summary + optional membership summary.
- Internal ensure/sync endpoints for auth service.
- Audit emission for profile actions.
