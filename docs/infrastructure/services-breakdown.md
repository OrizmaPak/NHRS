# NHRS Services Breakdown
1. Core Platform
   - API Gateway: Single ingress for backend APIs, request routing, and edge policy enforcement.
   - Authentication & Identity:
     - auth-api: Public login and authentication entrypoint.
     - otp-service: OTP generation, verification, and expiry handling.
     - session-service: Session lifecycle, device session state, and session revocation.
     - token-service: Access/refresh token issuance, rotation, and revoke workflows.
     - nin-linking-service: NIN linking and identity assertion workflows.
     - identity-adapters (placeholder): External identity verification provider integrations.
   - RBAC Service: Role/permission models and access policy decisions.
   - User Profile Service: Citizen/provider profile data management.
2. Organization & Provider
   - Organization Service: Facility and organization lifecycle management.
   - Doctor Registry Service: Certified doctor records and credential status indexing.
3. Health Data & Repository
   - Health Records Service: Longitudinal patient health records repository.
   - Encounter Notes Service: Clinical encounter notes and related metadata.
   - Laboratory Service: Lab order, result, and status management.
   - Pharmacy Dispensing Service: Dispensing workflows and medication fulfillment data.
4. Emergency & Discovery
   - Emergency Requests Service: Emergency supply or support request workflows.
   - Catalog Service: Discovery catalogs for supply directories and service indexing.
5. Governance & Oversight
   - Audit Log Service: Immutable activity tracking and audit trail ingestion.
   - Taskforce/Compliance (future domain extension): Investigation and compliance operations.
   - Government Analytics/Public Health (future domain extension): Public health metrics and aggregate reporting.
6. Platform Support
   - Notification Service: SMS/email/push notification orchestration.
   - File & Document Service: Document uploads, file retrieval, and attachment lifecycle controls.
