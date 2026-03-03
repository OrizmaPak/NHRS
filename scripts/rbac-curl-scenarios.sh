#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"

echo "Scenario 1: citizen login and limited access"
echo "1) Login as citizen (NIN bootstrap or password login)"
echo "curl -X POST $BASE_URL/auth/login -H 'Content-Type: application/json' -d '{\"method\":\"nin\",\"nin\":\"90000000001\",\"password\":\"01011985\"}'"
echo "2) Check permission nin.profile.read"
echo "curl -X POST $BASE_URL/rbac/check -H 'Authorization: Bearer <CITIZEN_TOKEN>' -H 'Content-Type: application/json' -d '{\"permissionKey\":\"nin.profile.read\"}'"

echo
echo "Scenario 2: org_admin manages org roles"
echo "curl -X POST $BASE_URL/rbac/org/org-123/roles -H 'Authorization: Bearer <ORG_ADMIN_TOKEN>' -H 'Content-Type: application/json' -d '{\"name\":\"staff_custom\",\"permissions\":[{\"permissionKey\":\"nin.profile.read\",\"effect\":\"allow\"}]}'"

echo
echo "Scenario 3: staff allow + user deny override => denied"
echo "curl -X POST $BASE_URL/rbac/org/org-123/users/user-777/overrides -H 'Authorization: Bearer <ORG_ADMIN_TOKEN>' -H 'Content-Type: application/json' -d '{\"overrides\":[{\"permissionKey\":\"nin.profile.read\",\"effect\":\"deny\"}]}'"
echo "curl -X POST $BASE_URL/rbac/check -H 'Authorization: Bearer <STAFF_TOKEN>' -H 'X-ORG-ID: org-123' -H 'Content-Type: application/json' -d '{\"permissionKey\":\"nin.profile.read\",\"organizationId\":\"org-123\"}'"

echo
echo "Scenario 4: staff deny + user allow override => allowed"
echo "curl -X POST $BASE_URL/rbac/org/org-123/users/user-777/overrides -H 'Authorization: Bearer <ORG_ADMIN_TOKEN>' -H 'Content-Type: application/json' -d '{\"overrides\":[{\"permissionKey\":\"lab.results.write\",\"effect\":\"allow\"}]}'"
echo "curl -X POST $BASE_URL/rbac/check -H 'Authorization: Bearer <STAFF_TOKEN>' -H 'X-ORG-ID: org-123' -H 'Content-Type: application/json' -d '{\"permissionKey\":\"lab.results.write\",\"organizationId\":\"org-123\"}'"

echo
echo "Scenario 5: platform admin app-level management"
echo "curl -X POST $BASE_URL/rbac/app/permissions -H 'Authorization: Bearer <PLATFORM_ADMIN_TOKEN>' -H 'Content-Type: application/json' -d '{\"key\":\"records.encounter.create\",\"name\":\"Create encounter\",\"module\":\"records\",\"actions\":[\"create\"]}'"
