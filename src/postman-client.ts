import type {
  FetchLike,
  NormalizedMember,
  ScimUser,
  WorkspaceIdentity,
  WorkspaceRole
} from './types.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface PostmanClientOptions {
  postmanApiKey: string;
  scimApiKey?: string;
  baseUrl?: string;
  fetcher?: FetchLike;
}

export interface ScimProvisionResult {
  user: ScimUser;
  created: boolean;
}

interface JsonResponse {
  [key: string]: unknown;
}

function asRecord(value: unknown): JsonResponse {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonResponse
    : {};
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  return 250 * (2 ** attempt);
}

export class PostmanClient {
  readonly hasScimKey: boolean;
  private readonly postmanApiKey: string;
  private readonly scimApiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: PostmanClientOptions) {
    this.postmanApiKey = options.postmanApiKey.trim();
    this.scimApiKey = options.scimApiKey?.trim() || undefined;
    this.hasScimKey = Boolean(this.scimApiKey);
    this.baseUrl = (options.baseUrl?.trim() || 'https://api.postman.com').replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
    if (!this.postmanApiKey) throw new Error('postman-api-key is required.');
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    expectedStatuses: readonly number[]
  ): Promise<JsonResponse> {
    let lastResponse: Response | undefined;
    const method = String(init.method ?? 'GET').toUpperCase();
    const mayRetry = method !== 'POST';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, init);
      lastResponse = response;
      if (expectedStatuses.includes(response.status)) {
        if (response.status === 204) return {};
        const text = await response.text();
        return text ? asRecord(JSON.parse(text)) : {};
      }
      if (!mayRetry || !RETRYABLE_STATUS.has(response.status) || attempt === 2) break;
      await sleep(responseDelay(response, attempt));
    }
    const status = lastResponse?.status ?? 0;
    const body = lastResponse ? (await lastResponse.text()).slice(0, 500) : 'No response';
    throw new HttpError(`Postman API request failed with HTTP ${status}: ${body}`, status);
  }

  async getWorkspaceRoles(): Promise<WorkspaceRole[]> {
    const payload = await this.requestJson('/workspace-roles', {
      method: 'GET',
      headers: { 'x-api-key': this.postmanApiKey }
    }, [200]);
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    return roles.flatMap((value) => {
      const role = asRecord(value);
      const id = typeof role.id === 'string' || typeof role.id === 'number' ? String(role.id) : '';
      const displayName = typeof role.displayName === 'string' ? role.displayName.trim() : '';
      return id && displayName ? [{ id, displayName }] : [];
    });
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceIdentity> {
    const payload = await this.requestJson(`/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'GET',
      headers: { 'x-api-key': this.postmanApiKey }
    }, [200]);
    const workspace = asRecord(payload.workspace);
    const id = typeof workspace.id === 'string' || typeof workspace.id === 'number'
      ? String(workspace.id).trim()
      : '';
    if (!id) throw new Error(`Postman did not return workspace ${workspaceId}.`);
    const name = typeof workspace.name === 'string' ? workspace.name.trim() : '';
    return { id, ...(name ? { name } : {}) };
  }

  async checkScimAccess(): Promise<void> {
    if (!this.scimApiKey) {
      throw new Error('POSTMAN_SCIM_API_KEY is required for doctor mode.');
    }
    await this.requestJson('/scim/v2/Users?count=1&startIndex=1', {
      method: 'GET',
      headers: { Authorization: this.scimApiKey }
    }, [200]);
  }

  async findScimUserByEmail(email: string): Promise<ScimUser | undefined> {
    if (!this.scimApiKey) return undefined;
    const filter = encodeURIComponent(`userName eq "${email.replaceAll('"', '\\"')}"`);
    const payload = await this.requestJson(`/scim/v2/Users?filter=${filter}&count=2`, {
      method: 'GET',
      headers: { Authorization: this.scimApiKey }
    }, [200]);
    const resources = Array.isArray(payload.Resources)
      ? payload.Resources
      : Array.isArray(payload.resources)
        ? payload.resources
        : [];
    for (const value of resources) {
      const user = asRecord(value);
      const id = typeof user.id === 'string' ? user.id.trim() : '';
      const userName = typeof user.userName === 'string' ? user.userName.trim() : '';
      if (id && userName.toLowerCase() === email.toLowerCase()) {
        return {
          id,
          userName,
          ...(typeof user.active === 'boolean' ? { active: user.active } : {}),
          ...(typeof user.externalId === 'string' ? { externalId: user.externalId } : {})
        };
      }
    }
    return undefined;
  }

  async provisionScimUser(member: NormalizedMember): Promise<ScimProvisionResult> {
    if (!this.scimApiKey) {
      throw new Error(`A Postman SCIM API key is required to provision ${member.email}.`);
    }
    const name = {
      givenName: member.givenName ?? member.displayName?.split(/\s+/)[0] ?? member.githubLogin ?? member.email.split('@')[0],
      familyName: member.familyName ?? member.displayName?.split(/\s+/).slice(1).join(' ') ?? 'User'
    };
    const body = {
      schemas: [SCIM_USER_SCHEMA],
      userName: member.email,
      active: true,
      externalId: member.externalId ?? member.githubLogin ?? member.email,
      displayName: member.displayName ?? `${name.givenName} ${name.familyName}`.trim(),
      name
    };
    let payload: JsonResponse;
    try {
      payload = await this.requestJson('/scim/v2/Users', {
        method: 'POST',
        headers: {
          Authorization: this.scimApiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }, [201]);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
      const existing = await this.findScimUserByEmail(member.email);
      if (!existing) throw error;
      return { user: existing, created: false };
    }
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const userName = typeof payload.userName === 'string' ? payload.userName.trim() : member.email;
    if (!id) throw new Error(`Postman SCIM did not return an ID for ${member.email}.`);
    return {
      user: {
        id,
        userName,
        ...(typeof payload.active === 'boolean' ? { active: payload.active } : {})
      },
      created: true
    };
  }

  async reactivateScimUser(user: ScimUser): Promise<ScimUser> {
    if (!this.scimApiKey) {
      throw new Error(`A Postman SCIM API key is required to reactivate ${user.userName}.`);
    }
    const payload = await this.requestJson(`/scim/v2/Users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: {
        Authorization: this.scimApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: true } }]
      })
    }, [200]);
    const id = typeof payload.id === 'string' ? payload.id.trim() : user.id;
    const userName = typeof payload.userName === 'string' ? payload.userName.trim() : user.userName;
    return {
      id,
      userName,
      active: typeof payload.active === 'boolean' ? payload.active : true,
      ...(typeof payload.externalId === 'string' ? { externalId: payload.externalId } : {})
    };
  }

  async assignWorkspaceRoles(
    workspaceId: string,
    assignments: ReadonlyArray<{ scimId: string; roleId: string }>
  ): Promise<void> {
    if (assignments.length === 0) return;
    await this.requestJson(`/workspaces/${encodeURIComponent(workspaceId)}/roles`, {
      method: 'PATCH',
      headers: {
        'x-api-key': this.postmanApiKey,
        'content-type': 'application/json-patch+json',
        identifierType: 'scim'
      },
      body: JSON.stringify({
        roles: [{
          op: 'add',
          path: '/user',
          value: assignments.map(({ scimId, roleId }) => ({ id: scimId, role: roleId }))
        }]
      })
    }, [200]);
  }
}
