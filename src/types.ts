export interface ScannerMember {
  email?: unknown;
  login?: unknown;
  externalId?: unknown;
  external_id?: unknown;
  scimId?: unknown;
  scim_id?: unknown;
  givenName?: unknown;
  given_name?: unknown;
  familyName?: unknown;
  family_name?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  githubPermission?: unknown;
  github_permission?: unknown;
  permission?: unknown;
  role?: unknown;
  roleName?: unknown;
  role_name?: unknown;
  postmanRole?: unknown;
  postman_role?: unknown;
  workspaceRole?: unknown;
  workspace_role?: unknown;
  permissions?: unknown;
  type?: unknown;
}

export interface ScannerIssue {
  index: number;
  identifier: string;
  githubLogin?: string;
  email?: string;
  reason: string;
}

export interface ExcludedScannerMember {
  index: number;
  identifier: string;
  githubLogin?: string;
  email?: string;
  reason: string;
}

export interface ScannerResolution {
  detected: number;
  members: NormalizedMember[];
  unresolved: ScannerIssue[];
  excluded: ExcludedScannerMember[];
}

export interface NormalizedMember {
  email: string;
  githubLogin?: string;
  githubPermission?: string;
  scimId?: string;
  externalId?: string;
  givenName?: string;
  familyName?: string;
  displayName?: string;
  workspaceRole: string;
}

export interface WorkspaceRole {
  id: string;
  displayName: string;
}

export interface WorkspaceIdentity {
  id: string;
  name?: string;
}

export interface ScimUser {
  id: string;
  userName: string;
  active?: boolean;
  externalId?: string;
}

export interface RoleAssignment {
  member: NormalizedMember;
  scimId: string;
  roleId: string;
  lifecycle: 'provided-scim-id' | 'existing' | 'reactivated' | 'provisioned';
}

export type UserLifecycle =
  | 'provided-scim-id'
  | 'existing'
  | 'reactivated'
  | 'provisioned'
  | 'would-reactivate'
  | 'would-provision'
  | 'failed';

export type WorkspaceAccess = 'added' | 'pending' | 'would-add' | 'failed';

export interface MemberResult {
  email: string;
  workspaceRole: string;
  lifecycle: UserLifecycle;
  workspaceAccess: WorkspaceAccess;
  scimId?: string;
  message?: string;
}

export interface ReconcileSummary {
  workspaceId: string;
  dryRun: boolean;
  results: MemberResult[];
  counts: {
    added: number;
    invited: number;
    pending: number;
    skipped: number;
    failed: number;
  };
}

export type NotificationStatus = 'ready' | 'invitation-pending' | 'preview' | 'needs-attention';

export interface OnboardingNotification {
  to: string;
  subject: string;
  text: string;
  html: string;
  workspaceRole: string;
  lifecycle: UserLifecycle;
  workspaceAccess: WorkspaceAccess;
  status: NotificationStatus;
  send: boolean;
}

export interface NotificationEnvelope {
  schemaVersion: 1;
  kind: 'deloitte-postman-onboarding';
  workspace: {
    id: string;
    url: string;
  };
  sourceRepository?: string;
  deliveryPolicy?: {
    allowedDomains: string[];
  };
  notifications: OnboardingNotification[];
}

export interface NotificationOptions {
  workspaceUrl?: string;
  sourceRepository?: string;
  subject?: string;
  gettingStartedUrl?: string;
  helpUrl?: string;
  allowedDomains?: string[];
}

export interface DoctorReport {
  ok: boolean;
  workspace: WorkspaceIdentity;
  scanner: {
    source: string;
    members: number;
  };
  checks: Array<{
    name: 'workspace-access' | 'scim-access' | 'scanner-contract' | 'role-mapping' | 'read-only-plan';
    status: 'passed' | 'failed';
    message: string;
  }>;
  plan: ReconcileSummary;
}

export interface ValidationReport {
  ok: true;
  scanner: {
    source: string;
    detected: number;
    uniqueMembers: number;
    withScimId: number;
    requiringScimLookup: number;
    unresolved: number;
    excluded: number;
  };
  workspaceRoles: Record<string, number>;
  members: Array<{
    email: string;
    workspaceRole: string;
    githubPermission?: string;
    githubLogin?: string;
    hasScimId: boolean;
  }>;
  unresolved: ScannerIssue[];
  excluded: ExcludedScannerMember[];
}

export interface ReconcileOptions {
  workspaceId: string;
  members: NormalizedMember[];
  dryRun: boolean;
}

export interface Reporter {
  info(message: string): void;
  warning(message: string): void;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
