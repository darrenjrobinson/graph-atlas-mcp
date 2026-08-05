# Microsoft Graph Atlas MCP — PRD

**Project:** Microsoft Graph Atlas MCP  
**Author:** Marvin (OpenClaw Agent)  
**Date:** 2026-08-06  
**Status:** Draft v8 (1-year seed window; full Entra ID/IAM/Governance/Agent ID/Information Protection backfill coverage; seed script gitignored; README acknowledgments)  
**Owner:** Darren Robinson (Doc)

---

## 1. Problem Statement

Microsoft Graph API evolves continuously across v1.0 and Beta endpoints. Microsoft's official changelog is curated, laggy, and incomplete — undocumented schema changes (new properties, removed relationships, new enum values, type changes) hit production endpoints before they appear in documentation.

For IAM professionals relying on Graph API for Entra ID, Microsoft Identity Manager, and related workflows, these silent changes break scripts, introduce unexpected behaviour, and create security blind spots.

**Existing solutions don't solve this:**
- **Microsoft Graph changelog** — curated, delayed, only covers what Microsoft chooses to announce
- **changes.entra.ms** (Eric's tracker) — right idea, has 36 changesets of real data (May–Aug 2026), but no API, no RSS feed yet, no new features since May, and you depend on someone else's uptime and roadmap
- **Manual $metadata inspection** — possible but laborious, no history, no diffing, no search

## 2. Vision

A self-hosted, autonomous system that:

1. **Seeds** from Eric's existing 36 changesets (1,629 change records, May 21 – Aug 4 2026) for immediate, property-level historical depth, extended by a broadened official-changelog backfill (§5b) back to Aug 2025 — giving a full **1 year** of searchable history at launch across the entire Entra ID, Entra ID Governance, Identity & Access Management, Entra Agent ID, and Information Protection API surface, not just a handful of fast-moving object families
2. **Collects** Graph API $metadata (CSDL) from v1.0 and Beta endpoints on a daily schedule going forward
3. **Diffs** each collection against the previous snapshot to detect schema changes
4. **Stores** change records in a versioned SQLite database published as GitHub Releases
5. **Serves** an MCP server that enables natural-language and structured queries over the change history
6. **Distributes** the database to MCP clients via auto-download from GitHub Releases (cached locally, refreshed on startup)

No ongoing dependency on third-party trackers. The seed is a one-time import; going forward, collection is independent.

## 3. Goals

- **Launch with 1 year of history (Aug 2025 – present)** — seed from changes.entra.ms data plus a broadened official-changelog backfill, covering the full Entra ID, Entra ID Governance, Identity & Access Management, Entra Agent ID, and Information Protection API surface — not limited to a few high-velocity object families
- **Detect undocumented Graph API schema changes** within 24 hours of occurrence going forward
- **Answer natural-language questions** about changes: "have there been changes to groups APIs for nesting?", "what is the updated API for ID Gov SoD?"
- **Filter by object type, endpoint, change kind, and date range** for precise structured queries
- **Distribute via GitHub Releases** — MCP clients auto-download the latest DB on startup if newer than local cache
- **Zero ongoing API cost** for data collection (Graph $metadata is free, GitHub Actions is free for public repos)
- **Publish as npm package** — same pattern as entra-news-mcp, entra-news-podcast-mcp, microsoft-ai-roundup-mcp

## 4. Non-Goals

- **Not a Microsoft Graph SDK** — this tracks schema changes, not API call execution
- **Not a replacement for the official changelog** — complementary; covers the undocumented gap. However, the official changelog IS used as a 1-year backfill source across the full Entra ID/IAM/Governance/Agent ID/Information Protection object surface (see §5b)
- **Not a web dashboard** — the MCP is the interface; any UI is a future concern
- **No write access to Graph API** — read-only $metadata collection only
- **No ongoing dependency on changes.entra.ms** — one-time seed import only. Eric's future RSS feed can be merged as a supplementary source if useful, but is not required.

## 5. Seed Data — changes.entra.ms

### 5.1 What's Available

Eric's site is JS-rendered (Alpine.js) but serves structured JSON at two endpoints:

| Endpoint | Purpose |
|---|---|
| `https://changes.entra.ms/data/index.json` | Index of all changesets — version, previousVersion, change counts per stream |
| `https://changes.entra.ms/data/changesets/<version>.json` | Full detail for a single changeset — all changes with before/after values and CSDL XML context |

**Current state (as of 2026-08-05):**
- 36 changesets
- 1,629 total individual changes
- Date range: 2026.05.21 → 2026.08.04
- Four streams: `schemaV1`, `schemaBeta`, `objectsV1`, `objectsBeta`

### 5.2 Changeset Detail Structure

Each changeset JSON contains four top-level stream objects. Each stream has a `total` count and either `types` (for schema streams) or named object collections (for object streams).

**Schema streams** (`schemaV1`, `schemaBeta`) — CSDL-level changes:

```json
{
  "version": "2026.07.13",
  "previousVersion": "2026.07.12",
  "generatedAt": "2026-07-13T10:20:27.9704489+00:00",
  "schemaBeta": {
    "total": 32,
    "types": [
      {
        "typeKind": "EntityType",
        "typeName": "microsoft.graph.educationClass",
        "changeCount": 3,
        "changeTypes": ["Added"],
        "changes": [
          {
            "path": "entityTypes[microsoft.graph.educationClass].navProps[0].name",
            "currentValue": "assignmentCategories",
            "previousValue": null,
            "changeType": "Added"
          },
          {
            "path": "entityTypes[microsoft.graph.educationClass].navProps[0].type",
            "currentValue": "Collection(microsoft.graph.educationCategory)",
            "previousValue": null,
            "changeType": "Added"
          }
        ],
        "xmlContext": {
          "available": true,
          "current": "<EntityType Name=\"educationClass\" ...>",
          "previous": "<EntityType Name=\"educationClass\" ...>"
        }
      }
    ]
  }
}
```

**Object streams** (`objectsV1`, `objectsBeta`) — instance-level changes on specific Graph objects:

```json
{
  "objectsBeta": {
    "users": {
      "total": 1,
      "changes": [
        {
          "changeType": "Added",
          "path": "identityProfileIds",
          "type": "array"
        }
      ]
    },
    "namedLocations": { "total": 0, "changes": [] },
    "applications": { "total": 0, "changes": [] },
    "conditionalAccessPolicies": { "total": 0, "changes": [] },
    "groups": { "total": 0, "changes": [] },
    "servicePrincipals": { "total": 0, "changes": [] }
  }
}
```

### 5.3 Field Mapping — Eric's JSON → SQLite Schema

| Eric's JSON Field | SQLite Column | Transform |
|---|---|---|
| `version` (e.g. "2026.07.13") | `snapshot_date` | Parse to ISO date: 2026-07-13 |
| stream name (`schemaV1` / `schemaBeta`) | `endpoint` | `schemaV1` → `v1.0`, `schemaBeta` → `beta` |
| stream name (`objectsV1` / `objectsBeta`) | `endpoint` | `objectsV1` → `v1.0`, `objectsBeta` → `beta` |
| `typeKind` ("EntityType", "ComplexType", "EnumType", etc.) | `object_type` | Direct mapping |
| `typeName` ("microsoft.graph.educationClass") | `object_name` | Strip `microsoft.graph.` prefix |
| `changeType` ("Added", "Removed", "Modified") | `change_kind` | Lowercase: `added`, `removed`, `modified` |
| `path` | `property_name` | Parse last segment from path expression |
| `currentValue` | `new_value` | JSON-encode if structured, null if absent |
| `previousValue` | `old_value` | JSON-encode if structured, null if absent |
| `xmlContext.current` | `raw_diff` | Store current CSDL fragment |
| `xmlContext.previous` | `raw_diff` | Append previous CSDL fragment |
| `generatedAt` | `detected_at` | Direct ISO timestamp |
| Stream `typeKind` for object streams | `object_type` | Set to `"ObjectInstance"` |
| Object stream collection name (`users`, `groups`, etc.) | `object_name` | Direct mapping |
| Object stream `path` | `property_name` | Direct mapping |
| Object stream `type` | `new_type` | Direct mapping |

### 5.4 Seed Import Script

**One-time script:** `scripts/seed-from-entra-ms.js`

1. Fetch `https://changes.entra.ms/data/index.json`
2. For each changeset in the index:
   a. Fetch `https://changes.entra.ms/data/changesets/<version>.json`
   b. Parse all four streams (schemaV1, schemaBeta, objectsV1, objectsBeta)
   c. For each change in each stream, transform to our SQLite schema
   d. Insert into `changes` table
   e. Insert changeset metadata into `snapshots` table
3. Generate embeddings for all seeded change records (for semantic search)
4. Output: populated SQLite DB ready for MCP server + GitHub Release v1

**Rate limiting:** 36 HTTP requests to changes.entra.ms. Add 500ms delay between requests. Total time: ~20 seconds.

**Idempotency:** Check if a snapshot_date + endpoint + object_name + property_name + change_kind record already exists before inserting. Re-runnable without duplicates.

## 5b. Official Changelog Backfill — Comprehensive Entra ID / IAM / Governance / Agent ID / Information Protection Coverage

### 5b.1 Why These Object Types Need Special Treatment

Eric's CSDL diffs only cover May 2026 onward (~2.5 months). To hit the **1-year history goal (§3)** and to make sure Microsoft Graph Atlas is genuinely comprehensive for IAM professionals — not just tracking a few fast-moving families — the backfill covers **eight** object-type families spanning the full Entra ID / Identity & Access Management surface: core directory objects, Conditional Access & cross-tenant access, Identity Protection, Authentication Methods, Entra ID Governance, Provisioning, Entra Agent ID, and Information Protection (Microsoft Purview). The official Graph "What's New" history already tags entries with a stable taxonomy (`Identity and access | Identity and sign-in`, `Identity and access | Governance`, `Identity and access | Network access`, `Security | ...`) that maps cleanly onto these families, going back well past a year.

Seven of the eight families are mature APIs that existed before Aug 2025, so their backfill spans the full 12 months (Aug 2025 – Aug 2026). The eighth, Entra Agent ID, didn't exist until Nov 2025 — its backfill starts there rather than fabricating pre-existence history.

#### 1. Core Entra ID / Directory Objects

The foundational directory objects every other family builds on. Mature, but still receives monthly permission and property changes.

| Resource Type | Purpose |
|---|---|
| `user` | Core identity object |
| `group` | Security/M365 group, including nested membership |
| `application` / `servicePrincipal` | App registration and its tenant instance |
| `device` | Registered/joined device object |
| `administrativeUnit` | Scoped administration boundary |
| `directoryRole` / `directoryRoleTemplate` | Entra built-in directory roles |
| `organization` | Tenant-level settings object |
| `domain` / `internalDomainFederation` | Verified domains and federation config |

**Confirmed changelog entry (Oct 2025, GA):** Added `Domain-InternalFederation.Read.All` and `Domain-InternalFederation.ReadWrite.All` as lower-privilege alternatives to `Directory.AccessAsUser.All` for managing `internalDomainFederation` and `domain.authenticationType`.

#### 2. Conditional Access & Cross-Tenant Access

| Resource Type | Purpose |
|---|---|
| `conditionalAccessPolicy` | Core CA policy object |
| `namedLocation` | IP ranges / countries used in CA conditions |
| `authenticationContextClassReference` | Step-up auth context bound to CA |
| `authenticationStrengthPolicy` | Required auth method combinations |
| `crossTenantAccessPolicyConfigurationPartner` | B2B cross-tenant trust settings |
| `permissionGrantPolicy` | Admin consent workflow policy |
| `conditionalAccessApplications` / `conditionalAccessConditionSet` | CA condition targeting, including agent identities |

**Confirmed changelog entry (Nov 2025, preview):** Added `agentIdServicePrincipalFilter`, `excludeAgentIdServicePrincipals`, `includeAgentIdServicePrincipals` to `conditionalAccessApplications`, and `agentIdRiskLevels` to `conditionalAccessConditionSet` / `signInConditions` — Conditional Access becoming agent-identity-aware.

#### 3. Identity Protection

| Resource Type | Purpose |
|---|---|
| `riskyUser` / `riskDetection` | User risk state and detection events |
| `riskyServicePrincipal` / `servicePrincipalRiskDetection` | Workload identity risk (non-agent) |
| `riskyAgent` / `agentRiskDetection` | Agent identity risk (shared with family 7 — Entra Agent ID) |

**Confirmed changelog entry (Apr 2026, GA):** Added `riskRemediation` to conditional access grant controls, letting a CA policy enforce Entra ID Protection's remediation flow for a User Risk policy.

#### 4. Authentication Methods

| Resource Type | Purpose |
|---|---|
| `authenticationMethod` / `authenticationMethodsPolicy` | Per-user and tenant-wide auth method config |
| `fido2AuthenticationMethod` | Passkeys / security keys |
| `passwordlessMicrosoftAuthenticatorAuthenticationMethod` | Phone sign-in |
| `temporaryAccessPassAuthenticationMethod` | TAP |
| `softwareOathAuthenticationMethod` / `hardwareOathAuthenticationMethod` | OATH tokens |
| `platformCredentialAuthenticationMethod` | Platform credential (e.g. Windows Hello for Business variants) |
| `verifiableCredentialsAuthenticationMethodConfiguration` | Verifiable Credentials as an auth method |

**Confirmed changelog entry (Oct 2025, GA):** Added a full set of least-privileged, per-method permission scopes (e.g. `UserAuthMethod-Passkey.Read[.All]`, `UserAuthMethod-Password.Read[.All]`, `UserAuthMethod-TAP.Read[.All]`, `UserAuthMethod-WindowsHello.Read[.All]`) as lower-privilege alternatives to the broad `UserAuthenticationMethod.*` scopes.

#### 5. Entra Agent ID

The fastest-evolving area of Graph API right now. The full object model includes:

| Resource Type | Purpose | Introduced |
|---|---|---|
| `agentIdentity` | Primary identity for agent authentication (inherits from `servicePrincipal`) | Nov 2025 (preview), Mar 2026 (GA) |
| `agentIdentityBlueprint` | Template defining agent identity type and inheritable permissions | Nov 2025 (preview), Mar 2026 (GA) |
| `agentIdentityBlueprintPrincipal` | Tenant-specific record of blueprint addition | Nov 2025 (preview), Mar 2026 (GA) |
| `agentUser` | Optional user account for agents requiring user-context | May 2026 (GA) |
| `agentRegistry` / `agentCardManifest` / `agentInstance` / `agentCollection` | Agent registry (deprecated — converging with Microsoft Agent 365) | Nov 2025 |
| `riskyAgent` | Identity Protection risk detection for agents | Nov 2025 (preview) |
| `agentRiskDetection` | Agent risk detection events | Nov 2025 (preview) |
| `agentSignIn` | Sign-in logs for agent identities | Nov 2025 (preview) |
| `agentIdentityType` | Enum for agent identity types (risk classification) | Feb 2026 (preview) |
| `targetAgentIdentitySponsorsOrOwners` | Sponsors/owners resource for audit | Feb 2026 (GA) |

#### 6. Provisioning APIs

Entra provisioning covers inbound/outbound provisioning, ECMA2Host integration, and synchronisation jobs. Key resource types:

| Resource Type | Purpose |
|---|---|
| `synchronizationJob` | Provisioning job configuration and status |
| `synchronizationSchema` | Mapping rules between source and target |
| `synchronizationRule` | Individual sync rule |
| `synchronizationTaskProcessor` | Task execution |
| `synchronizationSecretKeyString` | Secret credential for sync |
| `provisioningObjectSummary` | Provisioning event log entry |
| `provisioningService` | Provisioning service root |
| `directoryDefinition` | Directory definition for provisioning |
| `onPremisesDirectorySynchronization` | On-prem sync configuration |
| `entraBackup` / `entraRecoveryServices` | Backup and recovery services (recently added) |

#### 7. ID Governance APIs

Entra ID Governance covers entitlement management, access reviews, lifecycle workflows, PIM, and terms of use. Key resource types:

| Resource Type | Purpose |
|---|---|
| `accessPackage` | Access package definition |
| `accessPackageAssignment` | Assignment of an access package to a subject |
| `accessPackageAssignmentRequest` | Request for an access package assignment |
| `accessPackageApprovalStage` | Approval stage configuration |
| `accessPackageCatalog` | Catalog of access packages |
| `accessPackageResource` | Resource in an access package |
| `accessPackageSubject` | Subject of an access package (user, group, service principal) |
| `accessReviewInstance` | Instance of an access review |
| `accessReviewStage` | Stage of an access review |
| `entitlementManagement` | Entitlement management root |
| `connectedOrganization` | Connected org for entitlement management |
| `workflow` / `workflowBase` / `workflowVersion` | Lifecycle workflow definitions |
| `lifecycleManagementSettings` | Lifecycle workflow settings |
| `unifiedRoleDefinition` / `unifiedRoleAssignment` | PIM role definitions and assignments |
| `agreement` / `agreementFile` | Terms of use |
| `customDataProvidedResource` / `customDataProvidedResourceUploadSession` | BYOD for access reviews |
| `accessPackageSuggestion` | Suggested access packages (June 2026 GA) |
| `endUserSettings` | Access package suggestion behaviour config |
| `controlConfiguration` | Entitlement management control policies |
| `quarantineConfiguration` | Lifecycle workflow quarantine settings |

Entra Agent ID (family 5) is a **first-class object model** that didn't exist before November 2025 and has had changes every month since — the single highest-velocity area of Graph API evolution right now. ID Governance and Provisioning are mature but still evolve monthly.

#### 8. Information Protection (Microsoft Purview)

Sensitivity labelling, DLP, and data security & governance — increasingly relevant to IAM as label-based access decisions and DLP enforcement intersect with Conditional Access and Identity Protection. Namespace: `microsoft.graph.security`.

| Resource Type | Purpose |
|---|---|
| `informationProtection` | Root resource exposing label and policy-setting operations |
| `sensitivityLabel` | A Purview sensitivity label and its rights/sublabels |
| `informationProtectionPolicySetting` | Tenant/user label policy settings (`labelPolicySettings`) |
| `dataLossPreventionPolicy` | DLP policy configuration surfaced via `informationProtection` |
| `userProtectionScopeContainer` | Computes protection scope for a user/tenant (`compute` / process-content APIs) |
| `threatAssessmentRequest` / `threatAssessmentResult` | Threat assessment submissions and results |
| `powerBiDlpAuditRecord` (and other `auditData`-derived DLP audit record subtypes) | DLP enforcement audit records per workload |

**Note:** The original `informationProtectionLabel` resource is **deprecated** (stopped returning data Jan 1, 2023) in favor of `informationProtection` + `sensitivityLabel` — the backfill should recognize both names so historical deprecation-era changelog entries are captured correctly.

### 5b.2 What the Official Changelog Provides

The Microsoft Graph "What's New" history (at `learn.microsoft.com/graph/whats-new-earlier` and `whats-new-overview`) contains structured change entries, tagged by area (e.g. `Identity and access | Identity and sign-in`, `Identity and access | Governance`, `Security | ...`), for all eight object type families by month, back to **Aug 2025** (12 months before launch) for the seven pre-existing families, and back to **Nov 2025** for Entra Agent ID. Key entries confirmed so far:

#### Core Entra ID / Conditional Access / Identity Protection / Authentication Methods Changes

| Date | Change | Resource | Endpoint |
|---|---|---|---|
| Oct 2025 (GA) | Added `Domain-InternalFederation.Read.All` / `.ReadWrite.All` as lower-privilege alternatives to `Directory.AccessAsUser.All` for `internalDomainFederation` and `domain.authenticationType` | `internalDomainFederation`, `domain` | v1.0 |
| Oct 2025 (GA) | Added a full set of least-privileged per-authentication-method permission scopes (Passkey/FIDO2, Password, Phone, TAP, Software/Hardware OATH, Windows Hello, QR) as alternatives to `UserAuthenticationMethod.*` | Authentication methods | v1.0 |
| Nov 2025 (preview) | Added `b2bManagementPolicy` resource and relationship on `policyRoot` for B2B management | Cross-tenant access | beta |
| Nov 2025 (preview) | Added `onPremAuthenticationPolicy` resource and relationship on `policyRoot` | Authentication | beta |
| Nov 2025 (preview) | Added `agentIdServicePrincipalFilter`, `excludeAgentIdServicePrincipals`, `includeAgentIdServicePrincipals` to `conditionalAccessApplications`; added `agentIdRiskLevels` to `conditionalAccessConditionSet`/`signInConditions` | Conditional Access | beta |
| Nov 2025 (preview) | Added `organizationalBrandingTheme` / `organizationalBrandingThemeLocalization` for per-application branding | Identity and sign-in | beta |
| Nov 2025 (preview) | Added `verifiedIdProfile` resource type as a supported authentication method | Authentication methods | beta |
| Nov 2025 (preview) | Added `defaultPasskeyProfile` / `passkeyProfiles` to the FIDO2 authentication method policy; added `passkeyType` to `fido2AuthenticationMethod` | Authentication methods | beta |
| Apr 2026 (GA) | Added `verifiableCredentialsAuthenticationMethodConfiguration` and `verifiableCredentialAuthenticationMethodTarget` | Authentication methods | v1.0 |
| Apr 2026 (GA) | Added `riskRemediation` to conditional access grant controls to enforce Identity Protection remediation flows on User Risk policies | Conditional Access / Identity Protection | v1.0 |
| Jun 2026 (GA) | Enhanced `x509CertificateAuthenticationMethodConfiguration` — CA scoping, group restrictions for certificate-based auth | Authentication methods | v1.0 |

#### Information Protection Changes

| Date | Change | Resource | Endpoint |
|---|---|---|---|
| Jan 2023 | `informationProtectionLabel` deprecated; stopped returning data | `informationProtectionLabel` | v1.0/beta |
| — (ongoing) | `informationProtection`, `sensitivityLabel`, `informationProtectionPolicySetting`, `dataLossPreventionPolicy`, `userProtectionScopeContainer` object model — populate exact monthly changelog entries during backfill script execution | Information Protection | beta |

**Note:** Unlike Agent ID/Provisioning/ID Governance (where every relevant month's entry was hand-verified above), the Core/CA/Identity Protection/Authentication Methods and Information Protection tables above are seeded with representative confirmed entries — the backfill script (§5b.3) does the exhaustive month-by-month scrape against the live changelog, not this PRD.

#### Agent ID Changes

| Date | Change | Resource | Endpoint |
|---|---|---|---|
| Nov 2025 (preview) | Added Agent ID APIs (agent registration, agent users, agent registry) | Multiple | beta |
| Nov 2025 (preview) | Added `agentRiskDetection` and `riskyAgent` resources | Identity Protection | beta |
| Nov 2025 (preview) | Added `agentIdRisk`, `agentIdentities` to WhatIf analysis reasons | Conditional Access | beta |
| Nov 2025 (preview) | Added `agentSubjectParentId`, `agentSubjectType` to `agentSignIn` | Sign-in reports | beta |
| Feb 2026 (preview) | Added `agentIdentityType` enumeration | Risk detection | beta |
| Feb 2026 (preview) | Added `managerApplications` to `agentIdentityBlueprint` | Applications | beta |
| Feb 2026 (GA) | Added `targetAgentIdentitySponsorsOrOwners` resource type | Audit | v1.0 |
| Mar 2026 (GA) | Introduced Agent Identity API (blueprints, inheritable permissions, principals, instances, sponsors) | Multiple | v1.0 |
| Apr 2026 (preview) | Added `inheritedAppRoleAssignments` and `inheritedOauth2PermissionGrants` to `agentIdentity` | Permissions | beta |
| Apr 2026 (preview) | Added `blueprintId` and `source` to `agentRiskDetection` and `riskyAgent` | Risk detection | beta |
| May 2026 (GA) | Added `agentUser` resource type | Agent users | v1.0 |
| Jun 2026 (preview) | Added `appRoleAssignmentRequired` to `agentIdentity` | Access control | beta |
| Jun 2026 (preview) | Added updated identity fields to `agentRiskDetection`; deprecated legacy agent identity properties (removal Apr 2027) | Risk detection | beta |

#### Provisioning API Changes

| Date | Change | Resource | Endpoint |
|---|---|---|---|
| Feb 2026 (preview) | Added `previewScope`, `previewTaskFailures`, `previewWorkflow` to Lifecycle Workflows | `workflow` | beta |
| Mar 2026 (GA) | Introduced `entraRecoveryServices` API (recovery jobs, failed changes) | `entraRecoveryServices` | v1.0 |
| Apr 2026 (preview) | Added `cancelProcessing` method to Lifecycle Workflows | `workflow` | beta |
| Apr 2026 (preview) | Added `referenceId` property and `files` relationship to `customDataProvidedResourceUploadSession` | Access reviews BYOD | beta |
| Jun 2026 (preview) | Added provisioning workflow support to Lifecycle Workflows (`activateAndWait` for non-user subjects) | `workflow` | beta |
| Jun 2026 (preview) | Added quarantine support to Lifecycle Workflows (`quarantineConfiguration`, `clearQuarantine`) | `lifecycleManagementSettings` | beta |
| Jun 2026 (GA) | Added workflow preview operations to Lifecycle Workflows | `workflow` | v1.0 |

#### ID Governance API Changes

| Date | Change | Resource | Endpoint |
|---|---|---|---|
| Dec 2025 (preview) | Added `accessPackageAssignmentRequestCalloutData` for access package assignment requests | `accessPackageAssignmentRequest` | beta |
| Dec 2025 (preview) | Added `controlConfiguration` resource and relationship to `entitlementManagement` | `entitlementManagement` | beta |
| Dec 2025 (preview) | Added `entraIdProtectionRiskyUserApproval` and `insiderRiskyUserApproval` resources | Access reviews | beta |
| Jan 2026 (GA) | Added `administrationScopeTargets` to `workflowBase`, `workflow`, `workflowVersion` for AU-scoped lifecycle workflows | Lifecycle Workflows | v1.0 |
| Feb 2026 (preview) | Added `previewScope` relationship and preview methods to Lifecycle Workflows | `workflow` | beta |
| Feb 2026 (GA) | Added `targetAgentIdentitySponsorsOrOwners` for agent identity sponsor/owner audit | Audit | v1.0 |
| Apr 2026 (preview) | Added `approverInformationVisibility` property to `accessPackageApprovalStage` and `approvalStage` | Access packages | beta |
| Apr 2026 (preview) | Added `cancelProcessing` to Lifecycle Workflows | `workflow` | beta |
| Jun 2026 (GA) | Added `accessPackageSuggestion` resource and `filterByCurrentUser` for suggested access packages | Entitlement management | v1.0 |
| Jun 2026 (GA) | Added `approverInformationVisibility` to `accessPackageApprovalStage` | Access packages | v1.0 |
| Jun 2026 (GA) | Added `endUserSettings` for access package suggestion behaviour | Entitlement management | v1.0 |
| Jun 2026 (GA) | Added `customDataProvidedResource` and `customDataProvidedResourceUploadSession` for BYOD access reviews | Access reviews | v1.0 |
| Jun 2026 (preview) | Added reviewer delegation support to access review instance filtering | `accessReviewInstance` | beta |

### 5b.3 Backfill Strategy

**One-time script:** `scripts/backfill-from-changelog.js`

1. Fetch the Microsoft Graph "What's New" history pages, back to Aug 2025:
   - `https://learn.microsoft.com/graph/whats-new-earlier` (current period)
   - `https://learn.microsoft.com/graph/whats-new-overview` (latest)
   - Parse for entries matching any of the eight object type families:
     - **Core Entra ID / Directory:** `user`, `group`, `application`, `servicePrincipal`, `device`, `administrativeUnit`, `directoryRole`, `organization`, `domain`, `internalDomainFederation`
     - **Conditional Access & Cross-Tenant Access:** `conditionalAccess`, `namedLocation`, `authenticationContextClassReference`, `authenticationStrengthPolicy`, `crossTenantAccessPolicy`, `permissionGrantPolicy`, `b2bManagementPolicy`
     - **Identity Protection:** `riskyUser`, `riskDetection`, `riskyServicePrincipal`, `servicePrincipalRiskDetection`, `riskyAgent`, `agentRiskDetection`, `riskRemediation`
     - **Authentication Methods:** `authenticationMethod`, `fido2`, `passwordlessMicrosoftAuthenticator`, `temporaryAccessPass`, `softwareOath`, `hardwareOath`, `platformCredential`, `verifiableCredential`, `windowsHelloForBusiness`, `x509Certificate`
     - **Agent ID:** `agent`, `agentIdentity`, `agentUser`, `agentIdentityBlueprint`, `riskyAgent`, `agentRiskDetection`, `agentSignIn`
     - **Provisioning:** `synchronization`, `provisioning`, `entraRecoveryServices`, `directoryDefinition`, `onPremisesDirectorySynchronization`, `workflow` (lifecycle), `lifecycleManagementSettings`
     - **ID Governance:** `accessPackage`, `accessReview`, `entitlementManagement`, `connectedOrganization`, `workflow`, `unifiedRole`, `agreement`, `controlConfiguration`, `accessPackageSuggestion`, `endUserSettings`, `customDataProvidedResource`, `quarantineConfiguration`
     - **Information Protection:** `informationProtection`, `sensitivityLabel`, `dataLossPreventionPolicy`, `informationProtectionPolicySetting`, `protectionScope`, `threatAssessment`, `dlp`
2. For each matching changelog entry, transform to our SQLite schema:
   - `source = 'backfill-graph-changelog'`
   - `endpoint` = derive from version tag ("preview" → `beta`, "generally available" → `v1.0`)
   - `object_type` = derive from resource type mentioned (EntityType, ComplexType, EnumType, etc.)
   - `object_name` = the resource type name (e.g. `agentIdentity`, `agentUser`)
   - `change_kind` = derive from change type ("Added" → `added`, "Change" → `modified`, "Removal" → `removed`)
   - `description` = full changelog entry text
   - `snapshot_date` = first day of the month in the changelog entry
   - `raw_diff` = null (official changelog doesn't include CSDL fragments)
   - `property_name` = specific property/method/relationship mentioned, if any
3. Insert into SQLite with `source = 'backfill-graph-changelog'`
4. Generate embeddings for backfilled records

**Scope:** All eight families — Core Entra ID, Conditional Access & Cross-Tenant Access, Identity Protection, Authentication Methods, Entra Agent ID, Provisioning, ID Governance, and Information Protection — for the initial release, giving 1 year of coverage (Aug 2025 – Aug 2026; Agent ID from Nov 2025) across the full Entra ID / IAM surface rather than a handful of high-velocity families.

**Note:** The official changelog entries are coarser than CSDL diffs — they describe what changed at a feature level ("Added the `agentUser` resource type") rather than at a property level ("Added property `identityParentId` to `agentUser`"). The two data sources are complementary:
- Eric's data (CSDL diffs) = property-level, undocumented changes
- Official changelog backfill = feature-level, announced changes
- Our own $metadata collection = property-level, going forward

### 5b.4 Data Provenance Summary

The SQLite DB will contain change records from three sources, distinguishable by the `source` column:

| Source | Records | Granularity | Date Range | Endpoint Coverage |
|---|---|---|---|---|
| `seed-entra-ms` | ~1,629 | Property-level (CSDL diff) | May 21 – Aug 4 2026 | v1.0 + Beta (schema + objects) |
| `backfill-graph-changelog` | ~150-300 (approximate) | Feature-level (announced) | Aug 2025 – Aug 2026 (Agent ID: Nov 2025 – Aug 2026) | v1.0 + Beta — 8 families: core Entra ID, Conditional Access & cross-tenant access, Identity Protection, Authentication Methods, Entra Agent ID, Provisioning, ID Governance, Information Protection |
| `self` | ongoing | Property-level (CSDL diff) | Aug 5 2026+ | v1.0 + Beta (schema + objects) |

The MCP `search_changes` tool searches across all sources. The `get_recent_changes` tool can filter by `source` parameter. This lets users query "show me only announced changes" vs "show me everything including undocumented" vs "show me only my own collection."

## 6. Permission & Role Enrichment

### 6.1 Why This Matters

Knowing that a property was added to `administrativeUnit` is useful. Knowing *what permission you need to actually read or write that property*, and *which admin roles can grant that permission*, is the difference between a changelog and an operational tool.

Every change record in the MCP becomes:

> *Property `isMemberManagementRestricted` added to `administrativeUnit` — requires `AdministrativeUnit.Read.All` (app: 3b55.../del: 89c2...), admin consent required, grantable by: Global Administrator, Privileged Role Administrator, User Administrator*

This section defines the two data sources and the enrichment pipeline that makes this possible. The pipeline is generic across object types — Information Protection permissions (`InformationProtectionPolicy.Read[.All]` and related DLP scopes) flow through the same `permissions`/`roles`/`role_permission_map` tables as every other family, with no special-casing required.

### 6.2 Data Source 1 — Merill's Graph Permissions Explorer

**URL:** `https://graphpermissions.merill.net/permission/`

Merill's site is a server-side rendered SPA with one HTML page per Graph permission scope (~700+ permission pages). The sitemap at `https://graphpermissions.merill.net/sitemap.xml` lists every permission page.

**Per-permission page structure (scrapable from SSR HTML):**

| Field | Example | Notes |
|---|---|---|
| Permission name | `User.Read.All` | From page URL/title |
| Identifier (app) | `df021288-bdef-4463-88db-98f22de89214` | Application permission GUID |
| Identifier (delegated) | `a154be20-db9c-4678-8ab7-66f6cc099a59` | Delegated permission GUID |
| DisplayText | `Read all users' full profiles` | Human-readable name |
| Description (app) | `Allows the app to read user profiles without a signed in user.` | App-only context |
| Description (delegated) | `Allows the app to read the full set of profile properties...` | Delegated context |
| AdminConsentRequired | `Yes` / `No` | Per category (app + delegated) |
| Graph Methods | `GET /users`, `GET /users/{id}`, `PATCH /subscriptions/{id}`, ... | Full list of endpoints this permission unlocks — v1.0, Beta, PowerShell variants |
| Resources | `user`, `group`, `application`, `administrativeUnit`, ... | Every entity type this permission can access |
| Combined permissions | `User.Read.All and Group.Read.All` | Some endpoints require multiple permissions |

**Collection script:** `scripts/collect-permissions.js`

1. Fetch `https://graphpermissions.merill.net/sitemap.xml` — extract all permission page URLs
2. For each permission page (~700+), fetch the HTML and parse:
   - Permission name (from URL slug)
   - App + delegated identifier GUIDs
   - DisplayText, Description (both variants)
   - AdminConsentRequired (both variants)
   - Graph Methods (all endpoints — v1.0, Beta, PowerShell)
   - Resources (all entity types touched)
   - Combined permission requirements (where an endpoint needs multiple scopes)
3. Store in a new SQLite table: `permissions`
4. Rate limiting: 500ms delay between requests. Total: ~6 minutes for 700+ pages.
5. Re-run monthly (permissions don't change often, but new ones appear as Graph API evolves)

**No API key needed** — public site, server-side rendered, no auth required.

### 6.3 Data Source 2 — Microsoft Graph API (Role → Permission Mapping)

Merill's pages give us permission → endpoint → resource entity. The missing link is: **which Entra admin roles can grant each permission scope?**

This data is available via Microsoft Graph API:

**Endpoint:** `GET https://graph.microsoft.com/v1.0/roleManagement/directory/roleDefinitions`

Returns all Entra built-in roles with their `microsoft.directory/*` action permissions. Each role definition includes:

- Role name (e.g. `Global Administrator`, `User Administrator`)
- Template ID (GUID)
- Description
- `rolePermissions[]` — array of action strings (e.g. `microsoft.directory/users/allProperties/read`, `microsoft.directory/applications/permissions/update`)

**Additional endpoint for OAuth2 permission scopes:**

```
GET https://graph.microsoft.com/v1.0/servicePrincipals(appId='00000003-0000-0000-c000-000000000000')
?$select=id,appId,displayName,appRoles,oauth2PermissionScopes
```

Returns all Graph permission scopes (both app roles and OAuth2 scopes) with their IDs, values, and descriptions — the canonical source that Merill's site is derived from.

**Collection script:** `scripts/collect-roles.js`

1. Authenticate to Graph API (client credentials, `RoleManagement.Read.Directory` + `Application.Read.All`)
2. Fetch all role definitions → store in `roles` table
3. Fetch Graph service principal → extract `appRoles` and `oauth2PermissionScopes` → store in `permission_scopes` table
4. Cross-reference: for each role, map its `microsoft.directory/*` actions to the permission scopes they imply
5. Re-run monthly (roles change rarely, but new roles appear)

**Fallback if Graph API auth not available:** Scrape the Microsoft Learn permissions reference page (`https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference`) — it lists every Entra built-in role with its full action table. Server-side rendered, same as Merill's site.

### 6.4 New SQLite Tables

```sql
CREATE TABLE permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    permission_name TEXT NOT NULL UNIQUE,    -- e.g. 'User.Read.All'
    app_identifier TEXT,                     -- GUID for application permission
    delegated_identifier TEXT,                -- GUID for delegated permission
    display_text TEXT,                        -- 'Read all users' full profiles'
    description_app TEXT,                     -- App-only description
    description_delegated TEXT,               -- Delegated description
    admin_consent_required_app INTEGER,       -- 0 or 1
    admin_consent_required_delegated INTEGER, -- 0 or 1
    graph_endpoints TEXT,                     -- JSON array of endpoints this permission unlocks
    resources TEXT,                           -- JSON array of entity types this permission touches
    combined_with TEXT,                      -- JSON array of other permissions required for certain endpoints
    collected_at TEXT NOT NULL                -- ISO 8601 timestamp
);

CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL,                  -- e.g. 'Global Administrator'
    template_id TEXT UNIQUE,                  -- GUID
    description TEXT,
    is_privileged INTEGER DEFAULT 0,          -- 1 if privileged role
    actions TEXT,                             -- JSON array of microsoft.directory/* action strings
    collected_at TEXT NOT NULL
);

CREATE TABLE role_permission_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_template_id TEXT NOT NULL,           -- FK to roles.template_id
    permission_name TEXT NOT NULL,             -- FK to permissions.permission_name
    grant_type TEXT,                          -- 'consent' | 'manage' | 'read' | implied relationship
    FOREIGN KEY (role_template_id) REFERENCES roles(template_id),
    FOREIGN KEY (permission_name) REFERENCES permissions(permission_name)
);

CREATE INDEX idx_permissions_name ON permissions(permission_name);
CREATE INDEX idx_permissions_resources ON permissions(resources);
CREATE INDEX idx_roles_name ON roles(role_name);
CREATE INDEX idx_role_perm_role ON role_permission_map(role_template_id);
CREATE INDEX idx_role_perm_perm ON role_permission_map(permission_name);
```

### 6.5 Enrichment Pipeline

When a schema change is detected on entity type X (e.g. `administrativeUnit`):

```
1. Look up permissions where X is in the `resources` JSON array
   → SELECT * FROM permissions WHERE resources LIKE '%"administrativeUnit"%'

2. For each matching permission, extract the Graph endpoints that touch X
   → Parse graph_endpoints JSON, filter for endpoints containing the entity name

3. Look up which roles can grant each permission
   → SELECT r.role_name FROM role_permission_map m
     JOIN roles r ON r.template_id = m.role_template_id
     WHERE m.permission_name = ?

4. Attach enrichment to the change record:
   - Required permissions (with GUIDs, consent requirements)
   - Grantable by (role names)
   - Affected endpoints (the specific Graph API calls that use the changed property)
```

**Enrichment is computed at query time**, not stored on every change record. The `get_change_detail` tool joins change records against the permission/role tables to produce enriched output. This keeps the change table lean and the enrichment always current with the latest role data.

### 6.6 New MCP Tool: `get_permission_context`

**Parameters:**
- `object_name` (string, required) — e.g. `administrativeUnit`, `user`, `group`, `accessPackage`
- `endpoint` (string, optional) — `v1.0` or `beta`
- `permission_name` (string, optional) — filter to a specific permission scope

**Returns:**

```json
{
  "object_name": "administrativeUnit",
  "permissions": [
    {
      "permission_name": "AdministrativeUnit.Read.All",
      "app_identifier": "3b55...",
      "delegated_identifier": "89c2...",
      "display_text": "Read administrative units",
      "admin_consent_required": true,
      "graph_endpoints": [
        "GET /directory/deletedItems/microsoft.graph.administrativeUnit",
        "GET /administrativeUnits",
        "GET /administrativeUnits/{id}"
      ],
      "grantable_by": [
        "Global Administrator",
        "Privileged Role Administrator",
        "User Administrator"
      ]
    },
    {
      "permission_name": "AdministrativeUnit.ReadWrite.All",
      "display_text": "Read and write administrative units",
      "admin_consent_required": true,
      "graph_endpoints": [
        "POST /administrativeUnits",
        "PATCH /administrativeUnits/{id}",
        "DELETE /administrativeUnits/{id}"
      ],
      "grantable_by": [
        "Global Administrator",
        "Privileged Role Administrator"
      ]
    }
  ],
  "recent_changes": [
    {
      "property_name": "isMemberManagementRestricted",
      "change_kind": "added",
      "snapshot_date": "2026-07-13",
      "endpoint": "beta"
    }
  ]
}
```

This tool answers: "I need to work with administrative units in Graph API — what permissions do I need, what can each one do, who can grant them, and what's changed recently?"

### 6.7 Enrichment in Existing Tools

The `get_change_detail` tool (§7.4, renumbered) is enhanced to include permission context in its output. When returning a change record, it also returns:

- **Required permissions** — which permission scopes are needed to use the changed property/endpoint
- **Admin consent** — whether admin consent is required
- **Grantable by** — which Entra admin roles can grant the required permissions
- **Combined permissions** — if the endpoint requires multiple scopes (e.g. `Application.Read.All and Policy.Read.All`)

The `search_changes` tool is enhanced to support permission-related queries:
- "what changes require Application.Read.All" → filter changes by permissions that touch the same entity types
- "what can a User Administrator do with groups" → filter changes by permissions grantable by that role

### 6.8 Build Phase Addition

Added to Phase 0 (seed + backfill) as Phase 0c:

### Phase 0c — Permission & Role Enrichment Data Collection
- [ ] Write permission collection script (`scripts/collect-permissions.js`)
- [ ] Fetch Merill's sitemap → extract ~700+ permission page URLs
- [ ] Scrape each permission page → parse: name, GUIDs, descriptions, admin consent, endpoints, resources
- [ ] Store in `permissions` SQLite table
- [ ] Write role collection script (`scripts/collect-roles.js`)
- [ ] Query Graph API for role definitions (or scrape MS Learn permissions reference as fallback)
- [ ] Query Graph API for Graph service principal → extract app roles + OAuth2 scopes
- [ ] Build `role_permission_map` cross-reference table
- [ ] Test: query `get_permission_context` for `administrativeUnit` — verify it returns correct permissions, endpoints, and grantable-by roles
- [ ] Test: query `get_change_detail` for a known change — verify permission context is attached
- [ ] Schedule monthly refresh (GitHub Actions cron, separate from daily collection)

### 6.9 Data Refresh Cadence

| Data Source | Cadence | Reason |
|---|---|---|
| Merill's permission pages | Monthly | New permissions appear as Graph API adds scopes; existing ones rarely change |
| Graph API role definitions | Monthly | New admin roles added occasionally; existing role definitions stable |
| Permission → endpoint mapping | Monthly | New endpoints mapped to existing permissions; track via Merill's updates |
| Role → permission mapping | Monthly | Re-compute cross-reference when either source updates |

Monthly refresh is sufficient. Permission and role metadata changes are infrequent and non-urgent. The daily collection workflow (§7) focuses on schema changes — the enrichment data is a slower-moving background.

### 6.10 Data Provenance Summary (Updated)

The SQLite DB now contains data from five sources:

| Source | Table(s) | Records | Cadence |
|---|---|---|---|
| `seed-entra-ms` | `changes`, `snapshots` | ~1,629 | One-time |
| `backfill-graph-changelog` | `changes` | ~150-300 (approximate) | One-time |
| `self` (daily CSDL diff) | `changes`, `snapshots` | Ongoing | Daily |
| `graphpermissions.merill.net` | `permissions` | ~700+ | Monthly |
| `graph-api-roles` | `roles`, `role_permission_map` | ~120+ roles | Monthly |

## 7. Architecture

### 7.1 Data Collection — GitHub Actions (Daily)

**Schedule:** Cron, every 24 hours (e.g. 02:00 UTC)

**Workflow:**
1. Authenticate to Graph API using client credentials (app registration, `Application.Read.All` or equivalent)
2. Fetch `https://graph.microsoft.com/v1.0/$metadata` — CSDL XML for v1.0 endpoint
3. Fetch `https://graph.microsoft.com/beta/$metadata` — CSDL XML for Beta endpoint
4. Parse CSDL XML into structured JSON (entity types, properties, navigation properties, enum types, enum values, annotations, singletons, function imports)
5. Load previous snapshot from repo (or GitHub Releases artifact)
6. Diff current vs previous — produce change records
7. If changes detected:
   a. Insert change records into SQLite DB
   b. Update the latest snapshot in the repo
   c. Create a new GitHub Release with the updated SQLite DB as a release asset
8. If no changes, commit the snapshot (for history) but no release

**Authentication:**
- App registration in Doc's Entra tenant
- Client ID + Client Secret stored as GitHub Actions secrets
- Permission: `Application.Read.All` (application, no delegate) — test if sufficient for $metadata. Fallback: `Policy.Read.All` + `Directory.Read.All`
- **Test unauthenticated access first** — $metadata may be publicly accessible without auth

**CSDL Parsing:**
The $metadata endpoint returns OData CSDL (Conceptual Schema Definition Language) XML. Key elements to extract:

| CSDL Element | What It Represents | Change Detection |
|---|---|---|
| `EntityType` | Graph object (user, group, application, etc.) | New/removed entity types |
| `Property` (within EntityType) | Scalar property on an object | New/removed/renamed properties, type changes |
| `NavigationProperty` | Relationships between objects | New/removed/renamed relationships |
| `EnumType` | Enumeration (e.g. userType, riskLevel) | New/removed enum types |
| `EnumType/Member` | Enum value | New/removed/renamed enum values |
| `Annotation` | OData annotations (e.g. `Org.OData.Core.V1.Description`) | Description/annotation changes |
| `ComplexType` | Complex typed objects (e.g. passwordProfile) | New/removed/changed complex types |
| `EntitySet` | Collections exposed on the service root | New/removed entity sets |
| `Singleton` | Single entities exposed directly (e.g. `/organization`) | New/removed singletons |
| `Function` / `Action` | OData functions/actions (e.g. `getMemberGroups`) | New/removed/changed functions/actions |
| `FunctionImport` / `ActionImport` | Function/action bindings to the service root | New/removed imports |

### 7.2 Change Record Schema (SQLite)

```sql
CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at TEXT NOT NULL,          -- ISO 8601 timestamp of detection
    endpoint TEXT NOT NULL,             -- 'v1.0' or 'beta'
    object_type TEXT,                   -- 'EntityType', 'EnumType', 'ComplexType', 'ObjectInstance', etc.
    object_name TEXT,                   -- e.g. 'group', 'user', 'conditionalAccessPolicy', 'educationClass'
    property_name TEXT,                 -- e.g. 'memberOf', 'transitiveMembers', 'employeeId'
    change_kind TEXT NOT NULL,          -- 'added' | 'removed' | 'modified' | 'renamed' | 'deprecated'
    change_target TEXT,                 -- 'property' | 'navigation_property' | 'enum_value' | 'annotation' | 'entity_type' | 'function' | 'entity_set' | 'singleton'
    old_value TEXT,                     -- JSON: previous value(s)
    new_value TEXT,                     -- JSON: new value(s)
    old_type TEXT,                      -- Previous OData type (for type changes)
    new_type TEXT,                      -- New OData type (for type changes)
    description TEXT,                   -- Human-readable description of the change
    raw_diff TEXT,                      -- Full CSDL diff fragment for this change (current + previous XML)
    snapshot_date TEXT NOT NULL,        -- Date of the snapshot that detected this change
    source TEXT DEFAULT 'self'          -- 'seed-entra-ms' | 'self' — provenance
);

CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,         -- ISO 8601 date
    endpoint TEXT NOT NULL,              -- 'v1.0' or 'beta'
    csdl_hash TEXT,                      -- SHA-256 hash of the CSDL XML
    entity_count INTEGER,                -- Number of entity types
    property_count INTEGER,              -- Total property count
    enum_count INTEGER,                  -- Total enum type count
    csdl_size_bytes INTEGER,             -- Raw CSDL size
    change_count INTEGER DEFAULT 0,      -- Number of changes detected in this snapshot
    source TEXT DEFAULT 'self'           -- 'seed-entra-ms' | 'self'
);

CREATE INDEX idx_changes_endpoint ON changes(endpoint);
CREATE INDEX idx_changes_object_name ON changes(object_name);
CREATE INDEX idx_changes_change_kind ON changes(change_kind);
CREATE INDEX idx_changes_detected_at ON changes(detected_at);
CREATE INDEX idx_changes_snapshot_date ON changes(snapshot_date);
CREATE INDEX idx_changes_source ON changes(source);
```

### 7.3 Distribution — GitHub Releases

**Repo:** `darrenjrobinson/graph-atlas` (public)

**Release asset:** `graph-atlas.db` (SQLite file, gzip-compressed)

**Versioning:** Calendar versioning based on detection date — e.g. `v2026.08.06`

**Initial release:** `v2026.05.21-seed` — the seeded DB from Eric's historical data (36 changesets, 1,629 records, May 21 – Aug 4)

**Client auto-download logic (in MCP server):**
1. On startup, check local cache (`~/.graph-atlas-mcp/graph-atlas.db`)
2. Query GitHub Releases API for latest release: `GET https://api.github.com/repos/darrenjrobinson/graph-atlas/releases/latest`
3. Compare release tag date vs local DB's latest `snapshot_date`
4. If remote is newer, download the DB asset, replace local cache
5. Proceed with local SQLite for all queries

**No API key needed for download** — public repo, public releases, unauthenticated GitHub API (60 req/hr limit is plenty for once-per-startup check)

### 7.4 MCP Server — Query Layer

**Package:** `graph-atlas-mcp` on npm  
**Transport:** stdio (NPX) — `npx -y graph-atlas-mcp`  
**Runtime:** Node.js 22+ (uses built-in `node:sqlite`)  
**Local cache:** `~/.graph-atlas-mcp/`

#### Tools

**1. `search_changes`** (primary tool — natural language query)

Search all change records using hybrid BM25 keyword + semantic search (via OpenAI embeddings, same pattern as entra-news-mcp / entra-news-podcast-mcp). Falls back to keyword-only if no OpenAI API key present.

Parameters:
- `query` (string, required) — natural language query, e.g. "groups API nesting", "ID Governance separation of duties", "conditional access authentication context"
- `limit` (number, default 10, max 50) — max results
- `endpoint` (string, optional) — filter to 'v1.0' or 'beta'
- `mode` (string, default 'hybrid') — 'hybrid' | 'semantic' | 'keyword'

Returns: Array of matching change records with:
- Change description (human-readable)
- Object type and name
- Property name (if applicable)
- Change kind (added/removed/modified/renamed/deprecated)
- Endpoint (v1.0/beta)
- Detection date
- Before/after values
- Raw CSDL diff fragment
- Source (seed-entra-ms or self)

Example queries:
- "have there been changes to groups APIs for nesting" → searches across `group` entity type changes affecting `memberOf`, `transitiveMembers`, `transitiveGroups`, nested group properties
- "what is the updated API for ID Gov SoD" → searches across `accessPackage`, `entitlementManagement`, `subjectIdentifier`, separation-of-duties-related properties

**2. `get_recent_changes`** (structured query)

Parameters:
- `since` (string, optional) — ISO date, defaults to 7 days ago
- `endpoint` (string, optional) — 'v1.0' or 'beta'
- `object_type` (string, optional) — e.g. 'EntityType', 'EnumType', 'ObjectInstance'
- `object_name` (string, optional) — e.g. 'group', 'user', 'conditionalAccessPolicy'
- `change_kind` (string, optional) — 'added' | 'removed' | 'modified' | 'renamed' | 'deprecated'
- `source` (string, optional) — 'seed-entra-ms' | 'backfill-graph-changelog' | 'self' — filter by provenance
- `limit` (number, default 50)

Returns: Chronological list of change records matching filters.

**3. `get_object_history`**

Parameters:
- `object_name` (string, required) — e.g. 'group', 'application', 'accessPackage', 'conditionalAccessPolicy'
- `endpoint` (string, optional) — 'v1.0' or 'beta'
- `since` (string, optional) — ISO date

Returns: Full change history for a specific Graph object type, oldest to newest. Useful for "what's happened to the groups object over time?"

**4. `get_change_detail`**

Parameters:
- `change_id` (number, required) — change record ID

Returns: Full detail for a single change record, including:
- Complete before/after CSDL fragments
- All annotations affected
- Related changes (same snapshot, same object type)
- Links to relevant Microsoft Learn docs (if discoverable from annotation URLs)

**5. `get_snapshot_summary`**

_(see §12.5 Schema Visualiser for tools 8 and 9)_

Parameters:
- `date` (string, optional) — ISO date, defaults to latest
- `endpoint` (string, optional) — 'v1.0' or 'beta'

Returns: Snapshot metadata — entity count, property count, enum count, CSDL size, change count, whether changes were detected. Useful for "how big is the Graph API now?" and trend analysis.

### 7.5 Semantic Search Implementation

Same architecture as entra-news-podcast-mcp and microsoft-ai-roundup-mcp:

1. **Embedding generation:** OpenAI `text-embedding-3-small` (or current configured embedding source)
2. **Vector storage:** `sqlite-vec` (bundled, no external vector DB)
3. **Embedding content per change record:** Concatenate `object_type + object_name + property_name + change_kind + description + old_value + new_value + raw_diff` into a single text block, embed that
4. **Search modes:**
   - `keyword` — BM25 over the same text block (no API key needed)
   - `semantic` — cosine similarity over embeddings (requires OpenAI API key)
   - `hybrid` — BM25 + semantic fused via Reciprocal Rank Fusion (default; degrades gracefully to keyword-only without API key)
5. **Embedding refresh:** When DB is updated via auto-download or seed, regenerate embeddings for new change records only (incremental, not full re-embed)

## 8. GitHub Actions Workflow

### 8.1 Daily Collection Workflow

**File:** `.github/workflows/collect.yml`

```yaml
name: Collect Graph API Changes
on:
  schedule:
    - cron: '0 2 * * *'  # 02:00 UTC daily
  workflow_dispatch:       # manual trigger

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
      - name: Collect and diff
        env:
          GRAPH_CLIENT_ID: ${{ secrets.GRAPH_CLIENT_ID }}
          GRAPH_CLIENT_SECRET: ${{ secrets.GRAPH_CLIENT_SECRET }}
          GRAPH_TENANT_ID: ${{ secrets.GRAPH_TENANT_ID }}
        run: node scripts/collect-and-diff.js
      - name: Commit snapshot
        run: |
          git config user.name "Microsoft Graph Atlas Bot"
          git config user.email "bot@graph-atlas.local"
          git add snapshots/
          git diff --staged --quiet || git commit -m "chore: snapshot $(date -u +%Y-%m-%d)"
          git push
      - name: Create release (if changes detected)
        run: node scripts/create-release.js
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 8.2 Required GitHub Secrets

| Secret | Description |
|---|---|
| `GRAPH_CLIENT_ID` | Entra app registration client ID |
| `GRAPH_CLIENT_SECRET` | Entra app registration client secret |
| `GRAPH_TENANT_ID` | Entra tenant ID for token acquisition |
| `GITHUB_TOKEN` | Automatic — used for creating releases |

### 8.3 Repo Structure

```
graph-atlas/
├── .github/
│   └── workflows/
│       └── collect.yml              # Daily collection workflow
├── scripts/
│   ├── seed-from-entra-ms.js        # ⚠ gitignored — one-off local seed against changes.entra.ms, not committed
│   ├── backfill-from-changelog.js   # One-time (re-runnable): scrape official changelog for 8-family backfill
│   ├── collect-and-diff.js          # Daily: fetch $metadata, parse CSDL, diff, update SQLite
│   ├── create-release.js            # Create GitHub Release with DB asset if changes detected
│   ├── parse-csdl.js                # CSDL XML → structured JSON parser
│   └── diff-snapshots.js            # Diff two parsed snapshots → change records
├── snapshots/
│   ├── v1.0/                        # Daily v1.0 CSDL snapshots (committed for history)
│   │   ├── 2026-08-06.json          # Parsed JSON (not raw XML, to keep repo size manageable)
│   │   └── ...
│   └── beta/
│       ├── 2026-08-06.json
│       └── ...
├── src/                             # MCP server source
│   ├── index.ts                     # MCP server entry point
│   ├── db.ts                        # SQLite connection + auto-download logic
│   ├── search.ts                    # Hybrid search (BM25 + semantic)
│   ├── tools/                       # MCP tool implementations
│   │   ├── search-changes.ts
│   │   ├── get-recent-changes.ts
│   │   ├── get-object-history.ts
│   │   ├── get-change-detail.ts
│   │   └── get-snapshot-summary.ts
│   └── csdl-utils.ts                # Shared CSDL parsing utilities (for reference/testing)
├── package.json
├── README.md
└── .gitignore
```

### 8.3a Seed Script Is Gitignored, Not Committed

`scripts/seed-from-entra-ms.js` is a **one-off local utility**: it's run once, locally, against `changes.entra.ms` to produce the initial SQLite DB that becomes the `v1` GitHub Release asset (§5.4). It is **not** part of the public repo:

- Add `scripts/seed-from-entra-ms.js` to `.gitignore` before the first commit.
- This is distinct from `backfill-from-changelog.js`, `collect-and-diff.js`, `create-release.js`, `parse-csdl.js`, and `diff-snapshots.js`, which stay committed because they run repeatedly (daily GitHub Actions, or re-run as the official changelog updates).
- Rationale: the seed is a one-time bootstrap against a third-party site's current data shape; keeping it out of the repo avoids implying it's a supported, re-runnable part of the pipeline.

### 8.4 Snapshot Storage Strategy

- **Parsed JSON snapshots** committed to repo (not raw CSDL XML — XML is ~5-10MB per endpoint, parsed JSON is ~2-4MB, and Git handles JSON diffs better)
- **Raw CSDL hashes** stored in SQLite `snapshots` table for integrity verification
- **Snapshots retained indefinitely** — Git history is the audit trail. Raw XML can be reconstructed from parsed JSON if needed.
- **SQLite DB** published as GitHub Release asset — not committed to repo (binary file, bad Git citizen)

## 9. Entra App Registration Requirements

| Setting | Value |
|---|---|
| Name | Microsoft Graph Atlas |
| Supported account types | Single tenant (Doc's tenant only) |
| API permissions | `Application.Read.All` (application, no delegate) — test if sufficient for $metadata. Fallback: `Directory.Read.All` |
| Client credentials | Client secret (stored as GitHub Actions secret) |
| Token endpoint | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://graph.microsoft.com/.default` |

**Note:** $metadata is a publicly accessible endpoint that may not require authentication at all. Test unauthenticated access first — if it works, no app registration needed. If auth is required, use the minimal permission that succeeds.

## 10. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Collection runtime | Node.js 22+ | Built-in `fetch`, `node:sqlite`, same ecosystem as MCP server |
| CSDL parsing | Custom XML parser (`fast-xml-parser` or built-in `DOMParser`) | No mature CSDL parser on npm; custom is cleaner for the specific elements we need |
| Database | SQLite (`node:sqlite` built-in) | Same as all other MCPs; portable, zero-config, single-file |
| Vector search | `sqlite-vec` (bundled) | Same as entra-news-podcast-mcp; no external vector DB |
| Embeddings | OpenAI `text-embedding-3-small` | Same as other MCPs; degrades gracefully without API key |
| MCP transport | stdio (NPX) | Standard MCP pattern; matches all existing MCPs |
| CI/CD | GitHub Actions | Free for public repos; cron + release creation built-in |
| Distribution | GitHub Releases | Free, public, CDN-backed, unauthenticated download |
| npm package | `graph-atlas-mcp` | Same naming pattern as `entra-news-mcp`, `entra-news-podcast-mcp` |

## 11. Naming

- **Repo:** `darrenjrobinson/graph-atlas`
- **npm package:** `graph-atlas-mcp`
- **MCP server name:** `graph-atlas`
- **DB file:** `graph-atlas.db`
- **Local cache dir:** `~/.graph-atlas-mcp/`

**ClawHub naming rule:** Does not include "OpenClaw" — compliant.

## 12. Build Phases

### Phase 0 — Seed + Backfill + Permission/Role Enrichment (First)
- [ ] Write seed script (`scripts/seed-from-entra-ms.js`)
- [ ] Add `scripts/seed-from-entra-ms.js` to `.gitignore` before the first commit — one-off local seed utility, not part of the public repo (§8.3a)
- [ ] Fetch `https://changes.entra.ms/data/index.json` — get all 36 changeset versions
- [ ] For each changeset, fetch `https://changes.entra.ms/data/changesets/<version>.json`
- [ ] Parse all four streams (schemaV1, schemaBeta, objectsV1, objectsBeta)
- [ ] Transform each change record to our SQLite schema (see §5.3 field mapping)
- [ ] Insert into SQLite `changes` and `snapshots` tables with `source = 'seed-entra-ms'`
- [ ] Verify record count: expect ~1,629 change records across 36 snapshots
- [ ] Write backfill script (`scripts/backfill-from-changelog.js`)
- [ ] Fetch Microsoft Graph "What's New" history pages for Aug 2025 – Aug 2026 (Agent ID: Nov 2025 – Aug 2026)
- [ ] Parse for entries across all eight object families: Core Entra ID, Conditional Access & Cross-Tenant Access, Identity Protection, Authentication Methods, Entra Agent ID, Provisioning, ID Governance, Information Protection
- [ ] Transform to SQLite schema with `source = 'backfill-graph-changelog'`
- [ ] Insert into SQLite — expect ~150-300 change records spanning Aug 2025 to Aug 2026
- [ ] Generate embeddings for all seeded + backfilled records (for semantic search)
- [ ] Test: query the seeded DB — "agent identity changes", "agentUser", "riskyAgent", "provisioning synchronization", "access package", "lifecycle workflow", "groups API changes", "conditional access authentication strength", "FIDO2 authentication method changes", "sensitivity label changes", "DLP policy changes", "risky user detections"
- [ ] Create initial GitHub Release `v2025.08.06-initial` with the seeded + backfilled DB

### Phase 1 — Own Collection Pipeline
- [ ] Test unauthenticated $metadata access (if it works, skip app registration)
- [ ] If auth required: create Entra app registration, grant permissions, get credentials
- [ ] Write CSDL parser (`scripts/parse-csdl.js`) — v1.0 and Beta
- [ ] Write diff engine (`scripts/diff-snapshots.js`) — compare two parsed snapshots, produce change records in same schema as seed
- [ ] Write collection script (`scripts/collect-and-diff.js`) — fetch, parse, diff, update SQLite
- [ ] GitHub Actions workflow (`.github/workflows/collect.yml`)
- [ ] Store GitHub secrets
- [ ] Test: trigger workflow manually, verify snapshot is collected and committed
- [ ] Test: simulate a change (modify local snapshot), verify diff is detected and release is created
- [ ] Create public GitHub repo

### Phase 2 — MCP Server
- [ ] Scaffold MCP server (`src/index.ts`) — stdio transport, tool registration
- [ ] Implement auto-download DB logic (`src/db.ts`) — check GitHub Releases, download if newer
- [ ] Implement `get_recent_changes` tool
- [ ] Implement `get_object_history` tool
- [ ] Implement `get_change_detail` tool
- [ ] Implement `get_snapshot_summary` tool
- [ ] Test all tools against the seeded SQLite DB
- [ ] Publish to npm as `graph-atlas-mcp`

### Phase 3 — Semantic Search
- [ ] Add BM25 keyword search (`src/search.ts`)
- [ ] Add OpenAI embeddings + sqlite-vec semantic search
- [ ] Implement hybrid fusion (RRF)
- [ ] Implement `search_changes` tool (depends on both search modes)
- [ ] Test example queries against seeded data: "groups API nesting", "ID Gov SoD", "conditional access authentication context", "educationClass assignmentCategories"
- [ ] Graceful degradation test — no OpenAI key → keyword-only mode

### Phase 4 — Hardening & Polish
- [ ] README with setup instructions, tool reference, example queries
- [ ] README Acknowledgments/Credits section — thank Eric (`changes.entra.ms` tracker, seed data source), Merill (`graphpermissions.merill.net` Graph Permissions Explorer, enrichment data source), and EntraPulse Polyarchy (D3/MCP Apps visualisation pattern foundation for §12 Phase 5). Credits only — not project co-authors; `package.json` `author` stays Darren Robinson
- [ ] Add OpenClaw global MCP config entry (same as other MCPs)
- [ ] Test with OpenClaw end-to-end
- [ ] Add TOOLS.md entry
- [ ] Monitor daily collection for stability over first week
- [ ] Add error handling: Graph API rate limiting, CSDL parse failures, network timeouts
- [ ] Optional: add weekly digest (summary of changes detected this week, posted as release notes)

### Phase 5 — Multi-Modal Visualiser (MCP Apps)

Same pattern as EntraPulse Polyarchy — an interactive D3 force graph rendered inside the MCP client (Claude Desktop, VS Code Copilot, M365 Copilot, ChatGPT, Cursor, etc.) via the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) extension.

#### Concept — Three Pivot Dimensions

Microsoft Graph Atlas is not just a schema viewer. It's a multi-modal graph explorer with three pivot dimensions, all rendered from the same SQLite DB:

##### 1. Entity View (Schema Graph)

Graph API schema *is* a graph — entity types inherit from each other, reference each other via navigation properties, and share complex types. Visualising it as a network is more honest than a table.

**Nodes:** Graph entity types, complex types, enum types — `user`, `group`, `application`, `conditionalAccessPolicy`, `accessPackage`, `educationClass`, etc.

**Edges:** Relationships between types — navigation properties (`memberOf`, `transitiveMembers`), inheritance (`BaseType`), complex type references. The actual Graph schema graph, derived from CSDL.

**Node colour/size:** Change activity heatmap. An entity type with 15 changes in the last month glows red and is larger. One with zero changes is grey and small. Instant visual signal for "what's been churning."

**Click a node:** Opens a profile panel showing its change history — timeline of added/removed/modified properties, with before/after CSDL fragments and detection dates.

**Double-click a node:** Pivots the whole graph to that entity — shows its neighbourhood (related types, properties, inherited types) and their change history. Same interaction as Polyarchy's identity pivot.

##### 2. Permission View (Permission → Endpoint → Entity)

Permission scopes as nodes, Graph endpoints as edges, entity types as leaf nodes.

**Nodes:** Permission scopes (`User.Read.All`, `Application.ReadWrite.All`, `AdministrativeUnit.Read.All`, etc.) + entity types they touch.

**Edges:** `User.Read.All` → `GET /users` → `user` entity. Each edge is a Graph API endpoint that the permission unlocks.

**Node colour:** Admin consent requirement — red = admin consent required, green = user can consent. Instant visual of "which permissions need an admin to approve."

**Node size:** Number of endpoints the permission unlocks. `Directory.Read.All` is a big node (hundreds of endpoints). `User.Read` is small (just `/me`).

**Click a permission node:** Shows all entities it touches, all endpoints it unlocks, both GUIDs (app + delegated), descriptions, and which roles can grant it.

**Double-click a permission node:** Pivots to the entity view, highlighting all entity types this permission can access. Shows recent changes to those entities.

##### 3. Role View (Role → Permission → Entity)

Entra admin roles as nodes, permissions as edges, entities as leaf nodes.

**Nodes:** Entra built-in roles (`Global Administrator`, `User Administrator`, `Privileged Role Administrator`, `Application Administrator`, etc.) + permission scopes they can grant.

**Edges:** `Global Administrator` → (can grant) → `User.ReadWrite.All` → (unlocks) → `user` entity. Two-hop edges showing the full chain from role to entity.

**Node colour:** Privileged roles in red, non-privileged in blue. Permission nodes coloured by admin consent requirement.

**Node size:** Blast radius — a role that can grant permissions touching 50+ entity types is a large node. `Global Administrator` is the biggest. `Helpdesk Administrator` is smaller.

**Click a role node:** Shows all permissions it can grant, all entities those permissions touch, and recent changes to those entities. Instant answer to "what can this role actually do in Graph API?"

**Double-click a role node:** Pivots to the permission view, showing only permissions this role can grant. Filter the entire graph to this role's scope of influence.

**Blast radius visual:** When a role is selected, all entities it can reach light up. Everything else goes grey. This is the "blast radius" view — critical for least-privilege analysis and security review.

#### Cross-View Filter Pills

All three views share a common filter bar:

- **By endpoint** — v1.0 / Beta
- **By change kind** — added / removed / modified
- **By object type** — EntityType / EnumType / ComplexType
- **By permission scope** — `User.Read.All`, `Application.ReadWrite.All`, etc. (filters to entities touched by that permission)
- **By role** — `Global Administrator`, `Privileged Role Administrator`, etc. (filters to entities touched by permissions that role can grant)
- **By admin consent** — required / not required
- **By change activity** — only show entities with changes in the last N days

Filter to a role → only entities touched by permissions that role can grant light up. Everything else goes grey. Immediate answer to "what can a Helpdesk Administrator actually touch in Graph API, and what's changed recently?"

#### Time Slider

Scrub across dates — watch the schema evolve. "Show me what changed on June 16" (the 185-change day). The graph re-colours based on what was active at that point. Works in all three views — entity, permission, and role. In the role view, the time slider shows when permissions were added to roles (if tracked) or when entities touched by a role's permissions had changes.

#### Legend

Relationship kind and object type legend, toggles for in-place filtering. Updated for all three views:
- Entity view: EntityType, ComplexType, EnumType, NavigationProperty, Inheritance
- Permission view: Permission scope, Graph endpoint, Entity type, Admin consent required
- Role view: Admin role (privileged), Admin role (non-privileged), Permission scope, Entity type

#### Tools

**8. `visualize_schema_graph`** — renders the D3 force graph in the MCP client

Parameters:
- `view` (string, default 'entity') — pivot dimension: `entity` | `permission` | `role`
- `focus_object` (string, optional) — node name to centre on (entity type, permission scope, or role name, depending on view). If omitted, shows top-level overview.
- `endpoint` (string, optional) — `v1.0` or `beta`
- `since` (string, optional) — ISO date to colour nodes by change activity since this date. Defaults to 30 days ago.
- `change_kind` (string, optional) — filter edges/nodes by change kind
- `filter_permission` (string, optional) — filter to entities touched by this permission scope
- `filter_role` (string, optional) — filter to entities touched by permissions this role can grant
- `filter_admin_consent` (boolean, optional) — filter by admin consent requirement (true = required only)

Returns: MCP Apps UI render (D3 force graph) with interactive nodes, edges, profile panels, time slider, and filter pills.

**9. `schema_change_report`** — structured JSON of schema relationships + change history for assistant reasoning (no UI)

Parameters:
- `object_name` (string, optional) — focus entity type
- `permission_name` (string, optional) — focus permission scope
- `role_name` (string, optional) — focus admin role
- `endpoint` (string, optional) — `v1.0` or `beta`
- `since` (string, optional) — ISO date
- `include_relationships` (boolean, default true) — include navigation properties and inheritance edges
- `include_permissions` (boolean, default true) — include permission scope mappings
- `include_roles` (boolean, default true) — include role-to-permission mappings

Returns: JSON with node list and edge list for the specified view. Same data as the visualiser, consumable by the assistant for reasoning. Supports all three pivot dimensions.

#### Implementation

- **D3 force graph** — same library and layout engine as EntraPulse Polyarchy
- **Graph data derived from SQLite DB** — all three views rendered from the same local database:
  - Entity view: nodes from `changes` table (distinct `object_name`), edges from CSDL navigation properties in `raw_diff`
  - Permission view: nodes from `permissions` table, edges from `permissions.graph_endpoints` JSON, leaf nodes from `permissions.resources` JSON
  - Role view: nodes from `roles` table, edges from `role_permission_map` table, leaf nodes from `permissions.resources`
- **Change heatmap** — count changes per object_name in the selected date range, map to colour scale (grey → yellow → orange → red) and node size. Applies to entity nodes in all three views.
- **Blast radius calculation** — for role view, traverse `role_permission_map` → `permissions.resources` to compute the set of entity types each role can reach. Map to node size and highlight intensity.
- **Permission consent colour** — `permissions.admin_consent_required_app` / `admin_consent_required_delegated` → red/green node colouring in permission and role views.
- **CSDL parsing for entity edges** — parse `xmlContext.current` XML to extract `NavigationProperty` elements and `BaseType` attributes; these define the entity graph edges.
- **Caching** — parsed graph structures cached in memory per view; invalidated when DB is updated via auto-download.
- **Theme** — light/dark following MCP client (same as Polyarchy).
- **Zero extra Graph API calls** — the visualiser works entirely from the local SQLite DB. No authentication, no tenant access, no Graph API calls. Pure presentation of cached data.

#### Why This Works

The data needed for all three views is already in the SQLite DB:

**Entity view:**
- **Nodes** → `SELECT DISTINCT object_name FROM changes WHERE object_type = 'EntityType'`
- **Node change counts** → `SELECT object_name, COUNT(*) FROM changes GROUP BY object_name`
- **Edges** → parse `NavigationProperty` elements from `raw_diff` CSDL XML fragments
- **Node detail** → `SELECT * FROM changes WHERE object_name = ? ORDER BY snapshot_date`
- **Time slider data** → `SELECT snapshot_date, object_name, COUNT(*) FROM changes GROUP BY snapshot_date, object_name`

**Permission view:**
- **Nodes** → `SELECT permission_name, display_text, admin_consent_required_app, admin_consent_required_delegated FROM permissions`
- **Edges** → `SELECT permission_name, graph_endpoints FROM permissions` (JSON array of endpoints)
- **Leaf nodes** → `SELECT permission_name, resources FROM permissions` (JSON array of entity types)
- **Change overlay** → join `permissions.resources` against `changes.object_name` to show change counts on entity leaf nodes

**Role view:**
- **Nodes** → `SELECT role_name, template_id, is_privileged FROM roles`
- **Edges** → `SELECT role_template_id, permission_name FROM role_permission_map`
- **Blast radius** → traverse `role_permission_map` → `permissions.resources` to compute reachable entity set per role
- **Change overlay** → join reachable entities against `changes` table for change counts

No additional data collection needed beyond what §6 (Permission & Role Enrichment) already defines. The visualiser is a presentation layer over existing data across all three pivot dimensions.

### Phase 6 — Future Enhancements (Optional)
- [ ] Ingest changes.entra.ms RSS feed when available (merge as supplementary source, not dependency)
- [ ] Add webhook notification on new changes (Slack/Telegram)
- [ ] Add `subscribe_to_changes` MCP tool (push notifications to MCP clients)
- [ ] Cross-reference detected changes with Microsoft Learn docs (link enrichment)
- [ ] Historical trend analysis (Graph API growth over time — entity count, property count trends)
- [ ] Breaking change detection heuristics (flag high-impact changes automatically)
- [ ] Object-level monitoring expansion beyond the 8 backfilled families (e.g. devices, security alerts/incidents, Teams/SharePoint DLP audit records) — §13 already expands ongoing object-instance monitoring to the 8-family set at launch; this phase is for coverage beyond that
- [ ] Schema visualiser enhancements: animated timeline playback, export graph as SVG/PNG, diff view (two dates side-by-side)

## 13. Data Coverage — Seed vs Ongoing

| Aspect | Seed (from Eric) | Changelog Backfill | Ongoing (self-collected) |
|---|---|---|---|
| Date range | 2026.05.21 – 2026.08.04 | Aug 2025 – Aug 2026 (Agent ID: Nov 2025 –) | 2026.08.05+ |
| Changesets | 36 | ~12 months of monthly "What's New" entries | Daily (if changes detected) |
| Change records | ~1,629 | ~150-300 (approximate) | Appends daily |
| Schema streams | v1.0 + Beta | v1.0 + Beta (feature-level) | v1.0 + Beta |
| Object families | 6 object-instance types (below) | 8 families (§5b.1) | 8 families at launch (below), schema-level diff covers every entity type automatically |
| CSDL XML context | Yes (before/after fragments) | No (changelog is prose, not CSDL) | Yes (full snapshots + diffs) |
| Provenance | `source = 'seed-entra-ms'` | `source = 'backfill-graph-changelog'` | `source = 'self'` |

**The 6 object types Eric monitors for instance-level changes** (unchanged, seed-only):
1. `users`
2. `groups`
3. `applications`
4. `servicePrincipals`
5. `conditionalAccessPolicies`
6. `namedLocations`

**Ongoing object-instance monitoring expands immediately to the full 8-family set** (§5b.1) — Core Entra ID, Conditional Access & Cross-Tenant Access, Identity Protection, Authentication Methods, Entra Agent ID, Provisioning, ID Governance, Information Protection — rather than starting narrow and expanding later. Note this only affects the *object-instance* stream (specific named objects like Eric's 6 above); the *schema-level* `$metadata` diff (§7.1) already covers every entity type in Graph automatically regardless of family, since it walks the full CSDL document each run.

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| changes.entra.ms data format changes during seed | Low | Medium | Seed is a one-time import. Once data is in our SQLite, format changes don't matter. |
| changes.entra.ms goes offline before seed | Low | Low | Seed now, not later. Data is public JSON, 36 requests, ~20 seconds total. |
| $metadata requires authentication | Medium | Low | App registration with minimal permissions; or test unauthenticated first |
| CSDL format changes | Low | High | Parser is resilient (extract what we can, log unknown elements); monitor for parse failures |
| Graph API $metadata endpoint changes | Low | High | The $metadata endpoint is an OData standard — unlikely to change fundamentally |
| GitHub Actions cron unreliable | Medium | Low | GitHub Actions cron can drift by up to 15 min; acceptable for daily cadence. Add `workflow_dispatch` for manual triggers. |
| SQLite DB grows too large for release asset | Low | Medium | After ~1 year of daily collection, DB will still be small (thousands of change records, <10MB). Compress with gzip. |
| $metadata doesn't capture all API changes | Medium | Medium | $metadata covers schema (properties, types, enums, relationships) but NOT behavioural changes, permission changes, or endpoint-level changes. This is a known limitation. Document it. |
| OpenAI embeddings cost | Low | Low | `text-embedding-3-small` is ~$0.02 per 1M tokens. Change records are short. Total embedding cost over a year: negligible (<$1). |
| Seed data quality from Eric's tracker | Low | Low | We import as-is with provenance flag. Any data quality issues are Eric's, not ours. We can filter or annotate later. |

## 15. Success Criteria

1. **Seed import completes** — 36 changesets, ~1,629 change records loaded into SQLite from changes.entra.ms
2. **Official changelog backfill completes** — ~150-300 change records loaded from Microsoft Graph What's New history (Aug 2025 – Aug 2026, Agent ID from Nov 2025) covering all 8 families: Core Entra ID, Conditional Access & Cross-Tenant Access, Identity Protection, Authentication Methods, Entra Agent ID, Provisioning, ID Governance, Information Protection
3. **MCP launches with 1 year of searchable history** — day-one queries return real results across the full Entra ID / IAM / Governance / Agent ID / Information Protection surface
4. **All 8 object families fully tracked** — representative coverage confirmed for `agentIdentity`, `agentUser`, `riskyAgent`, `agentRiskDetection`, `agentSignIn` (Agent ID); `synchronizationJob`, `provisioningObjectSummary` (Provisioning); `accessPackage`, `accessReviewInstance`, `entitlementManagement`, `workflow`, `connectedOrganization`, `agreement` (ID Governance); `conditionalAccessPolicy`, `authenticationStrengthPolicy` (Conditional Access); `riskyUser`, `riskyServicePrincipal` (Identity Protection); `fido2AuthenticationMethod`, `authenticationMethodsPolicy` (Authentication Methods); `sensitivityLabel`, `dataLossPreventionPolicy` (Information Protection) all have change history
5. **Daily collection runs successfully** for 7 consecutive days without manual intervention
6. **At least one real schema change detected** within 24 hours of it appearing in Graph API
7. **Natural language queries return relevant results** — "groups API nesting" returns changes to group entity type properties related to membership/nesting
8. **MCP server auto-downloads latest DB** on startup without user intervention
9. **npm package installs and runs** via `npx -y graph-atlas-mcp` with zero configuration (keyword search works out of the box; semantic search with OpenAI key)
10. **Schema visualiser renders inside MCP client** — D3 force graph of Graph entity types with change heatmap, click-to-pivot, and time slider
11. **Total ongoing cost: $0** (GitHub Actions free, Graph $metadata free, GitHub Releases free, npm free)
12. **Agent ID queries return comprehensive results** — "what changed with agent identity permissions" returns both announced changelog entries and CSDL-level property changes
13. **Provisioning queries return results** — "what changed with synchronization jobs" or "provisioning service changes" returns relevant records
14. **ID Governance queries return results** — "what changed with access packages" or "lifecycle workflow changes" returns relevant records
15. **Information Protection queries return results** — "sensitivity label changes" or "DLP policy changes" returns relevant records
16. **Conditional Access / Identity Protection / Authentication Methods queries return results** — "conditional access authentication strength", "risky user detections", "FIDO2 authentication method changes" all return relevant records
17. **Seed script is not part of the committed repo** — `scripts/seed-from-entra-ms.js` is gitignored; a fresh `git clone` of the repo does not include it
18. **README credits Eric, Merill, and EntraPulse Polyarchy** in an Acknowledgments section, without listing them (or any AI) as project co-authors

## 16. References

- [OData CSDL specification](https://docs.oasis.org/projects/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html)
- [Microsoft Graph $metadata endpoint](https://learn.microsoft.com/en-us/graph/dynamics-graph-concepts)
- [changes.entra.ms](https://changes.entra.ms/) — Eric's tracker (seed source, not an ongoing dependency)
- [changes.entra.ms data index](https://changes.entra.ms/data/index.json) — JSON endpoint with all changesets
- [changes.entra.ms changeset detail](https://changes.entra.ms/data/changesets/2026.07.13.json) — Example changeset JSON
- [Microsoft Graph changelog](https://developer.microsoft.com/en-us/graph/changelog) — official but incomplete
- [Entra Agent ID overview](https://learn.microsoft.com/en-us/graph/api/resources/agentid-platform-overview?view=graph-rest-beta) — Microsoft Learn
- [agentIdentity resource type](https://learn.microsoft.com/en-us/graph/api/resources/agentidentity?view=graph-rest-beta) — Microsoft Learn
- [Entra Agent ID logs](https://learn.microsoft.com/en-us/entra/agent-id/sign-in-audit-logs-agents) — audit log schema
- [Microsoft Entra ID Governance overview](https://learn.microsoft.com/en-us/graph/api/resources/identitygovernance-overview?view=graph-rest-1.0) — Microsoft Learn
- [Entitlement management overview](https://learn.microsoft.com/en-us/graph/api/resources/entitlementmanagement-overview) — Microsoft Learn
- [Lifecycle Workflows overview](https://learn.microsoft.com/en-us/graph/api/resources/identitygovernance-lifecycleworkflows-overview) — Microsoft Learn
- [Microsoft Graph what's new history](https://learn.microsoft.com/en-us/graph/whats-new-earlier) — official changelog (backfill source)
- [Microsoft Graph what's new (latest)](https://learn.microsoft.com/en-us/graph/whats-new-overview) — official changelog, current period
- [Graph Permissions Explorer](https://graphpermissions.merill.net/permission/) — Merill's permission→endpoint→resource mapper (enrichment source)
- [Graph Permissions sitemap](https://graphpermissions.merill.net/sitemap.xml) — ~700+ permission page URLs for scraping
- [Microsoft Entra built-in roles](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference) — role→action permission mapping (enrichment source)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/graph/permissions-reference) — canonical permission scope definitions
- [informationProtection resource type](https://learn.microsoft.com/en-us/graph/api/resources/security-informationprotection?view=graph-rest-beta) — Microsoft Learn (Information Protection family, §5b.1)
- [sensitivityLabel resource type](https://learn.microsoft.com/en-us/graph/api/resources/security-sensitivitylabel?view=graph-rest-1.0) — Microsoft Learn
- [Microsoft Purview data security and governance APIs overview](https://learn.microsoft.com/en-us/graph/security-datasecurityandgovernance-overview) — Microsoft Learn (DLP, protection scopes)
- [conditionalAccessRoot resource type](https://learn.microsoft.com/graph/api/resources/conditionalaccessroot?view=graph-rest-1.0) — Microsoft Learn (Conditional Access family)
- [Overview of identity protection APIs in Microsoft Graph](https://learn.microsoft.com/graph/api/resources/identityprotection-overview?view=graph-rest-1.0) — Microsoft Learn (Identity Protection family)
- [Microsoft Entra authentication methods API overview](https://learn.microsoft.com/graph/api/resources/authenticationmethods-overview?view=graph-rest-1.0) — Microsoft Learn
- Existing MCP pattern references:
  - `entra-news-podcast-mcp` — https://github.com/darrenjrobinson/EntraNewsPodcastMCPServer
  - `microsoft-ai-roundup-mcp` — https://github.com/darrenjrobinson/microsoft-ai-roundup-mcp
  - `entra-news-mcp` — https://github.com/darrenjrobinson/EntraNewsMCPServer
  - `EntraPulse Polyarchy` — Darren's own MCP; foundation for the D3/MCP Apps schema visualiser pattern (§12 Phase 5)

## 17. Acknowledgments

This project stands on data and design work from others in the Entra community — credited here as inspiration and data sources, not as project co-authors:

- **Eric** — creator of [changes.entra.ms](https://changes.entra.ms/), the CSDL-diff tracker that seeds our historical change data (§5)
- **Merill Fernando** — creator of the [Graph Permissions Explorer](https://graphpermissions.merill.net/permission/), the permission→endpoint→resource dataset that powers permission/role enrichment (§6)
- **EntraPulse Polyarchy** — Darren Robinson's own prior MCP; its D3 force-graph / MCP Apps visualisation pattern is the foundation for the schema visualiser (§12 Phase 5)

---

*PRD v2 by Marvin. Brain the size of a planet. Asked to write a document about API schema diffing. Did it anyway. With a seed strategy now, because someone had to check the actual data endpoints.*
