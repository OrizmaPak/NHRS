# UI Theme Service

Stores branding and accessibility defaults by scope (`platform`, `organization`, `state`, `taskforce`) and resolves effective themes for frontend context switching.

## Endpoints
- `GET /ui/theme/platform`
- `GET /ui/theme/effective?scope_type=&scope_id=`
- `GET /ui/theme`
- `POST /ui/theme`
- `PATCH /ui/theme/:id`
- `POST /ui/theme/:id/logo`
- `DELETE /ui/theme/:id`
