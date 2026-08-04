#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  runCli: () => runCli
});
module.exports = __toCommonJS(cli_exports);
var import_node_util = require("node:util");

// src/contracts.ts
var DEFAULT_ROLE_MAP = {
  admin: "Admin",
  maintain: "Editor",
  write: "Editor",
  push: "Editor",
  triage: "Viewer",
  read: "Viewer",
  pull: "Viewer"
};
function optionalString(value) {
  if (typeof value !== "string" && typeof value !== "number") return void 0;
  const normalized = String(value).trim();
  return normalized || void 0;
}
function firstString(...values) {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return void 0;
}
var GITHUB_PERMISSION_PRECEDENCE = [
  "admin",
  "maintain",
  "write",
  "push",
  "triage",
  "read",
  "pull"
];
function permissionsFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const permissions = value;
  const enabled = new Set(Object.entries(permissions).flatMap(([key, allowed]) => {
    const normalized = key.trim().toLowerCase();
    return allowed === true && normalized ? [normalized] : [];
  }));
  return [
    ...GITHUB_PERMISSION_PRECEDENCE.filter((permission) => enabled.delete(permission)),
    ...[...enabled].sort()
  ];
}
function permissionCandidates(member) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of [
    member.githubPermission,
    member.github_permission,
    member.permission,
    member.roleName,
    member.role_name,
    member.role,
    ...permissionsFromObject(member.permissions)
  ]) {
    const permission = optionalString(value)?.toLowerCase();
    if (permission && !seen.has(permission)) {
      result.push(permission);
      seen.add(permission);
    }
  }
  return result;
}
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function roleRank(role) {
  const normalized = role.toLowerCase();
  if (normalized === "admin") return 3;
  if (normalized === "editor") return 2;
  if (normalized === "viewer") return 1;
  return 0;
}
function parseRoleMap(value) {
  if (!value?.trim()) return { ...DEFAULT_ROLE_MAP };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`role-map-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("role-map-json must be a JSON object.");
  }
  const result = { ...DEFAULT_ROLE_MAP };
  for (const [key, target] of Object.entries(parsed)) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedTarget = optionalString(target);
    if (!normalizedKey || !normalizedTarget) {
      throw new Error("role-map-json keys and values must be non-empty strings.");
    }
    result[normalizedKey] = normalizedTarget;
  }
  return result;
}
function unwrapMembers(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value;
    if (Array.isArray(record.members)) return record.members;
    if (Array.isArray(record.collaborators)) return record.collaborators;
  }
  throw new Error("Members input must be an array or an object with a members/collaborators array.");
}
function parseMembersJson(value, roleMap, defaultWorkspaceRole) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Members input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const deduplicated = /* @__PURE__ */ new Map();
  for (const [index, raw] of unwrapMembers(parsed).entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Member at index ${index} must be a JSON object.`);
    }
    const member = raw;
    const email = firstString(member.email)?.toLowerCase();
    if (!email || !isEmail(email)) {
      throw new Error(`Member at index ${index} must include a valid email address.`);
    }
    const explicitRole = firstString(
      member.postmanRole,
      member.postman_role,
      member.workspaceRole,
      member.workspace_role
    );
    const candidates = permissionCandidates(member);
    const permission = candidates.find((candidate) => roleMap[candidate]);
    const fallbackRole = optionalString(defaultWorkspaceRole);
    const workspaceRole = explicitRole ?? (permission ? roleMap[permission] : void 0) ?? fallbackRole;
    if (!workspaceRole) {
      throw new Error(
        `Member ${email} has no Postman workspace role and its GitHub permission is not present in role-map-json.`
      );
    }
    const githubLogin = optionalString(member.login);
    const scimId = firstString(member.scimId, member.scim_id);
    const externalId = firstString(member.externalId, member.external_id, member.login);
    const givenName = firstString(member.givenName, member.given_name);
    const familyName = firstString(member.familyName, member.family_name);
    const displayName = firstString(member.displayName, member.display_name);
    const normalized = {
      email,
      workspaceRole,
      ...githubLogin ? { githubLogin } : {},
      ...permission ?? candidates[0] ? { githubPermission: permission ?? candidates[0] } : {},
      ...scimId ? { scimId } : {},
      ...externalId ? { externalId } : {},
      ...givenName ? { givenName } : {},
      ...familyName ? { familyName } : {},
      ...displayName ? { displayName } : {}
    };
    const previous = deduplicated.get(email);
    if (previous?.scimId && normalized.scimId && previous.scimId !== normalized.scimId) {
      throw new Error(`Duplicate member ${email} has conflicting SCIM IDs.`);
    }
    if (!previous) {
      deduplicated.set(email, normalized);
      continue;
    }
    const preferred = roleRank(normalized.workspaceRole) > roleRank(previous.workspaceRole) ? normalized : previous;
    deduplicated.set(email, {
      ...previous,
      ...normalized,
      workspaceRole: preferred.workspaceRole,
      ...previous.scimId || normalized.scimId ? { scimId: previous.scimId ?? normalized.scimId } : {}
    });
  }
  return [...deduplicated.values()];
}
function parseBoolean(value, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Expected true or false, received ${value}.`);
}

// src/postman-client.ts
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
var SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
var HttpError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
  status;
};
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function sleep(milliseconds) {
  return new Promise((resolve3) => setTimeout(resolve3, milliseconds));
}
function responseDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1e3;
  return 250 * 2 ** attempt;
}
var PostmanClient = class {
  hasScimKey;
  postmanApiKey;
  scimApiKey;
  baseUrl;
  fetcher;
  constructor(options) {
    this.postmanApiKey = options.postmanApiKey.trim();
    this.scimApiKey = options.scimApiKey?.trim() || void 0;
    this.hasScimKey = Boolean(this.scimApiKey);
    this.baseUrl = (options.baseUrl?.trim() || "https://api.postman.com").replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? fetch;
    if (!this.postmanApiKey) throw new Error("postman-api-key is required.");
  }
  async requestJson(path, init, expectedStatuses) {
    let lastResponse;
    const method = String(init.method ?? "GET").toUpperCase();
    const mayRetry = method !== "POST";
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
    const body = lastResponse ? (await lastResponse.text()).slice(0, 500) : "No response";
    throw new HttpError(`Postman API request failed with HTTP ${status}: ${body}`, status);
  }
  async getWorkspaceRoles() {
    const payload = await this.requestJson("/workspace-roles", {
      method: "GET",
      headers: { "x-api-key": this.postmanApiKey }
    }, [200]);
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    return roles.flatMap((value) => {
      const role = asRecord(value);
      const id = typeof role.id === "string" || typeof role.id === "number" ? String(role.id) : "";
      const displayName = typeof role.displayName === "string" ? role.displayName.trim() : "";
      return id && displayName ? [{ id, displayName }] : [];
    });
  }
  async getWorkspace(workspaceId) {
    const payload = await this.requestJson(`/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: "GET",
      headers: { "x-api-key": this.postmanApiKey }
    }, [200]);
    const workspace = asRecord(payload.workspace);
    const id = typeof workspace.id === "string" || typeof workspace.id === "number" ? String(workspace.id).trim() : "";
    if (!id) throw new Error(`Postman did not return workspace ${workspaceId}.`);
    const name = typeof workspace.name === "string" ? workspace.name.trim() : "";
    return { id, ...name ? { name } : {} };
  }
  async checkScimAccess() {
    if (!this.scimApiKey) {
      throw new Error("POSTMAN_SCIM_API_KEY is required for doctor mode.");
    }
    await this.requestJson("/scim/v2/Users?count=1&startIndex=1", {
      method: "GET",
      headers: { Authorization: this.scimApiKey }
    }, [200]);
  }
  async findScimUserByEmail(email) {
    if (!this.scimApiKey) return void 0;
    const filter = encodeURIComponent(`userName eq "${email.replaceAll('"', '\\"')}"`);
    const payload = await this.requestJson(`/scim/v2/Users?filter=${filter}&count=2`, {
      method: "GET",
      headers: { Authorization: this.scimApiKey }
    }, [200]);
    const resources = Array.isArray(payload.Resources) ? payload.Resources : Array.isArray(payload.resources) ? payload.resources : [];
    for (const value of resources) {
      const user = asRecord(value);
      const id = typeof user.id === "string" ? user.id.trim() : "";
      const userName = typeof user.userName === "string" ? user.userName.trim() : "";
      if (id && userName.toLowerCase() === email.toLowerCase()) {
        return {
          id,
          userName,
          ...typeof user.active === "boolean" ? { active: user.active } : {},
          ...typeof user.externalId === "string" ? { externalId: user.externalId } : {}
        };
      }
    }
    return void 0;
  }
  async provisionScimUser(member) {
    if (!this.scimApiKey) {
      throw new Error(`A Postman SCIM API key is required to provision ${member.email}.`);
    }
    const name = {
      givenName: member.givenName ?? member.displayName?.split(/\s+/)[0] ?? member.githubLogin ?? member.email.split("@")[0],
      familyName: member.familyName ?? member.displayName?.split(/\s+/).slice(1).join(" ") ?? "User"
    };
    const body = {
      schemas: [SCIM_USER_SCHEMA],
      userName: member.email,
      active: true,
      externalId: member.externalId ?? member.githubLogin ?? member.email,
      displayName: member.displayName ?? `${name.givenName} ${name.familyName}`.trim(),
      name
    };
    let payload;
    try {
      payload = await this.requestJson("/scim/v2/Users", {
        method: "POST",
        headers: {
          Authorization: this.scimApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      }, [201]);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
      const existing = await this.findScimUserByEmail(member.email);
      if (!existing) throw error;
      return { user: existing, created: false };
    }
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    const userName = typeof payload.userName === "string" ? payload.userName.trim() : member.email;
    if (!id) throw new Error(`Postman SCIM did not return an ID for ${member.email}.`);
    return {
      user: {
        id,
        userName,
        ...typeof payload.active === "boolean" ? { active: payload.active } : {}
      },
      created: true
    };
  }
  async reactivateScimUser(user) {
    if (!this.scimApiKey) {
      throw new Error(`A Postman SCIM API key is required to reactivate ${user.userName}.`);
    }
    const payload = await this.requestJson(`/scim/v2/Users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: {
        Authorization: this.scimApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", value: { active: true } }]
      })
    }, [200]);
    const id = typeof payload.id === "string" ? payload.id.trim() : user.id;
    const userName = typeof payload.userName === "string" ? payload.userName.trim() : user.userName;
    return {
      id,
      userName,
      active: typeof payload.active === "boolean" ? payload.active : true,
      ...typeof payload.externalId === "string" ? { externalId: payload.externalId } : {}
    };
  }
  async assignWorkspaceRoles(workspaceId, assignments) {
    if (assignments.length === 0) return;
    await this.requestJson(`/workspaces/${encodeURIComponent(workspaceId)}/roles`, {
      method: "PATCH",
      headers: {
        "x-api-key": this.postmanApiKey,
        "content-type": "application/json-patch+json",
        identifierType: "scim"
      },
      body: JSON.stringify({
        roles: [{
          op: "add",
          path: "/user",
          value: assignments.map(({ scimId, roleId }) => ({ id: scimId, role: roleId }))
        }]
      })
    }, [200]);
  }
};

// src/reconcile.ts
var PENDING_INVITE_STATUSES = /* @__PURE__ */ new Set([400, 404, 409, 422]);
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function summarize(workspaceId, dryRun, results) {
  return {
    workspaceId,
    dryRun,
    results,
    counts: {
      added: results.filter((result) => result.workspaceAccess === "added").length,
      invited: results.filter((result) => result.lifecycle === "provisioned").length,
      pending: results.filter((result) => result.workspaceAccess === "pending").length,
      skipped: results.filter((result) => result.workspaceAccess === "would-add").length,
      failed: results.filter((result) => result.lifecycle === "failed" || result.workspaceAccess === "failed").length
    }
  };
}
function resultFor(assignment, workspaceAccess, message) {
  return {
    email: assignment.member.email,
    workspaceRole: assignment.member.workspaceRole,
    lifecycle: assignment.lifecycle,
    workspaceAccess,
    scimId: assignment.scimId,
    ...message ? { message } : {}
  };
}
async function reconcileWorkspaceAccess(client, options, reporter) {
  const roles = await client.getWorkspaceRoles();
  const roleIds = new Map(roles.map((role) => [role.displayName.toLowerCase(), role.id]));
  const results = [];
  const assignments = [];
  for (const member of options.members) {
    const roleId = roleIds.get(member.workspaceRole.toLowerCase());
    if (!roleId) {
      results.push({
        email: member.email,
        workspaceRole: member.workspaceRole,
        lifecycle: "failed",
        workspaceAccess: "failed",
        message: `Postman workspace role ${member.workspaceRole} is not available.`
      });
      continue;
    }
    let scimId = member.scimId;
    let lifecycle = member.scimId ? "provided-scim-id" : "existing";
    try {
      if (!scimId) {
        const existing = await client.findScimUserByEmail(member.email);
        if (existing?.active === false) {
          if (options.dryRun) {
            results.push({
              email: member.email,
              workspaceRole: member.workspaceRole,
              lifecycle: "would-reactivate",
              workspaceAccess: "would-add",
              scimId: existing.id,
              message: "Would reactivate the existing SCIM user, then assign the workspace role."
            });
            continue;
          }
          const reactivated = await client.reactivateScimUser(existing);
          scimId = reactivated.id;
          lifecycle = "reactivated";
          reporter.info(`Reactivated ${member.email} through Postman SCIM.`);
        } else {
          scimId = existing?.id;
        }
      }
      if (!scimId && options.dryRun) {
        results.push({
          email: member.email,
          workspaceRole: member.workspaceRole,
          lifecycle: "would-provision",
          workspaceAccess: "would-add",
          message: "Would provision or invite the user, then assign the workspace role."
        });
        continue;
      }
      if (!scimId) {
        const provision = await client.provisionScimUser(member);
        scimId = provision.user.id;
        lifecycle = provision.created ? "provisioned" : "existing";
        if (provision.created) {
          reporter.info(`Submitted ${member.email} to Postman SCIM for provisioning or invitation.`);
        }
      }
      if (!scimId) throw new Error(`Unable to resolve a SCIM ID for ${member.email}.`);
      assignments.push({ member, scimId, roleId, lifecycle });
    } catch (error) {
      results.push({
        email: member.email,
        workspaceRole: member.workspaceRole,
        lifecycle: "failed",
        workspaceAccess: "failed",
        message: errorMessage(error)
      });
    }
  }
  if (options.dryRun) {
    results.push(...assignments.map((assignment) => resultFor(
      assignment,
      "would-add",
      "Would assign the resolved user to the workspace."
    )));
    return summarize(options.workspaceId, true, results);
  }
  for (let offset = 0; offset < assignments.length; offset += 50) {
    const batch = assignments.slice(offset, offset + 50);
    try {
      await client.assignWorkspaceRoles(
        options.workspaceId,
        batch.map(({ scimId, roleId }) => ({ scimId, roleId }))
      );
      results.push(...batch.map((assignment) => resultFor(assignment, "added")));
      continue;
    } catch (batchError) {
      reporter.warning(`A workspace-role batch failed; retrying ${batch.length} user(s) individually.`);
    }
    for (const assignment of batch) {
      try {
        await client.assignWorkspaceRoles(options.workspaceId, [{
          scimId: assignment.scimId,
          roleId: assignment.roleId
        }]);
        results.push(resultFor(assignment, "added"));
      } catch (error) {
        const pending = assignment.lifecycle === "provisioned" && error instanceof HttpError && PENDING_INVITE_STATUSES.has(error.status);
        results.push(resultFor(
          assignment,
          pending ? "pending" : "failed",
          pending ? "The team invite was submitted; assign the workspace role after the user accepts the invite." : errorMessage(error)
        ));
      }
    }
  }
  return summarize(options.workspaceId, false, results);
}

// src/doctor.ts
async function diagnoseWorkspaceAccess(client, options, reporter) {
  const workspace = await client.getWorkspace(options.workspaceId);
  await client.checkScimAccess();
  const plan = await reconcileWorkspaceAccess(client, {
    workspaceId: options.workspaceId,
    members: options.members,
    dryRun: true
  }, reporter);
  const roleMappingOk = plan.counts.failed === 0;
  return {
    ok: roleMappingOk,
    workspace,
    scanner: {
      source: options.scannerSource,
      members: options.members.length
    },
    checks: [
      {
        name: "workspace-access",
        status: "passed",
        message: `POSTMAN_API_KEY can read workspace ${workspace.name ?? workspace.id}.`
      },
      {
        name: "scim-access",
        status: "passed",
        message: "POSTMAN_SCIM_API_KEY can read the team directory."
      },
      {
        name: "scanner-contract",
        status: "passed",
        message: `Validated and normalized ${options.members.length} unique member(s).`
      },
      {
        name: "role-mapping",
        status: roleMappingOk ? "passed" : "failed",
        message: roleMappingOk ? "Every requested Postman workspace role is available." : `${plan.counts.failed} member(s) request unavailable workspace roles.`
      },
      {
        name: "read-only-plan",
        status: "passed",
        message: "Doctor mode issued read-only requests; no users or workspace roles were changed."
      }
    ],
    plan
  };
}

// src/notifications.ts
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var DEFAULT_NOTIFICATION_SUBJECT = "Deloitte: Your Postman workspace access";
var DEFAULT_POSTMAN_WORKSPACE_URL = "https://go.postman.co/";
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
function normalizeWorkspaceUrl(value) {
  const candidate = value?.trim() || DEFAULT_POSTMAN_WORKSPACE_URL;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("postman-workspace-url must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("postman-workspace-url must be a credential-free HTTPS URL.");
  }
  return url.toString();
}
function normalizeSubject(value) {
  const subject = (value?.trim() || DEFAULT_NOTIFICATION_SUBJECT).replaceAll(/[\r\n]+/g, " ").trim();
  if (subject.length > 200) throw new Error("notification-subject must be 200 characters or fewer.");
  return subject;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function notificationStatus(result) {
  if (result.workspaceAccess === "pending") return "invitation-pending";
  if (result.workspaceAccess === "would-add") return "preview";
  if (result.workspaceAccess === "failed" || result.lifecycle === "failed") return "needs-attention";
  return "ready";
}
function statusCopy(result) {
  if (result.workspaceAccess === "pending") {
    return {
      headline: "Your Postman team invitation has been submitted.",
      nextStep: "Accept the Postman invitation in your inbox. The pipeline can add your workspace access on its next run."
    };
  }
  if (result.workspaceAccess === "would-add") {
    return {
      headline: "Your Postman onboarding is included in the current preview.",
      nextStep: "No email is sent from a preview. The pipeline will provision access when the approved apply run starts."
    };
  }
  if (result.workspaceAccess === "failed" || result.lifecycle === "failed") {
    return {
      headline: "Deloitte identified that you need Postman access, but this run could not finish it.",
      nextStep: "The pipeline owner has the failure details and can safely retry your onboarding."
    };
  }
  if (result.lifecycle === "provisioned") {
    return {
      headline: "Your Postman team membership and workspace access are ready.",
      nextStep: "Sign in with your Deloitte email address, use Deloitte SSO if prompted, and open the workspace."
    };
  }
  if (result.lifecycle === "reactivated") {
    return {
      headline: "Your Postman account was reactivated and your workspace access is ready.",
      nextStep: "Sign in with your Deloitte email address and open the workspace."
    };
  }
  return {
    headline: "Your Postman workspace access is ready.",
    nextStep: "Sign in with your Deloitte email address and open the workspace."
  };
}
function repositoryCopy(sourceRepository) {
  return sourceRepository ? `You were included in Postman onboarding because you were detected as a contributor to ${sourceRepository}.` : "You were included in Postman onboarding because you were detected as a contributor to a Deloitte GitHub repository.";
}
function renderText(result, workspaceUrl, sourceRepository) {
  const copy = statusCopy(result);
  return [
    "Hello,",
    "",
    repositoryCopy(sourceRepository),
    copy.headline,
    "",
    `Postman workspace role: ${result.workspaceRole}`,
    `Next step: ${copy.nextStep}`,
    `Open Postman: ${workspaceUrl}`,
    "",
    "Three useful ways to get started:",
    "- Find and reuse the APIs, collections, and environments your repository depends on.",
    "- Run collections locally or in CI to validate API behavior before merging.",
    "- Collaborate in the workspace so API changes, examples, and tests stay discoverable.",
    "",
    "\u2014 Deloitte API Enablement"
  ].join("\n");
}
function renderHtml(result, workspaceUrl, sourceRepository) {
  const copy = statusCopy(result);
  const safeUrl = escapeHtml(workspaceUrl);
  return [
    "<!doctype html>",
    '<html><body style="margin:0;background:#f7f7f7;font-family:Arial,sans-serif;color:#212121">',
    '<div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden">',
    '<div style="height:8px;background:#ff6c37"></div>',
    '<div style="padding:32px">',
    '<p style="margin-top:0">Hello,</p>',
    `<p>${escapeHtml(repositoryCopy(sourceRepository))}</p>`,
    `<h2 style="color:#ff6c37">${escapeHtml(copy.headline)}</h2>`,
    `<p><strong>Postman workspace role:</strong> ${escapeHtml(result.workspaceRole)}</p>`,
    `<p><strong>Next step:</strong> ${escapeHtml(copy.nextStep)}</p>`,
    `<p style="margin:28px 0"><a href="${safeUrl}" style="background:#ff6c37;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">Open Postman</a></p>`,
    "<h3>Get value from the workspace</h3>",
    "<ul>",
    "<li>Find and reuse the APIs, collections, and environments your repository depends on.</li>",
    "<li>Run collections locally or in CI before merging API changes.</li>",
    "<li>Keep API examples, tests, and collaboration discoverable for the whole team.</li>",
    "</ul>",
    '<p style="margin-bottom:0">\u2014 Deloitte API Enablement</p>',
    "</div></div></body></html>"
  ].join("");
}
function notificationFor(result, summary, options) {
  return {
    to: result.email,
    subject: options.subject,
    text: renderText(result, options.workspaceUrl, options.sourceRepository),
    html: renderHtml(result, options.workspaceUrl, options.sourceRepository),
    workspaceRole: result.workspaceRole,
    lifecycle: result.lifecycle,
    workspaceAccess: result.workspaceAccess,
    status: notificationStatus(result),
    send: !summary.dryRun && result.workspaceAccess !== "would-add"
  };
}
function buildNotificationEnvelope(summary, options = {}) {
  const workspaceUrl = normalizeWorkspaceUrl(options.workspaceUrl);
  const subject = normalizeSubject(options.subject);
  const sourceRepository = options.sourceRepository?.trim() || void 0;
  return {
    schemaVersion: 1,
    kind: "deloitte-postman-onboarding",
    workspace: { id: summary.workspaceId, url: workspaceUrl },
    ...sourceRepository ? { sourceRepository } : {},
    notifications: summary.results.map((result) => notificationFor(result, summary, {
      workspaceUrl,
      subject,
      ...sourceRepository ? { sourceRepository } : {}
    }))
  };
}
async function writeNotificationEnvelope(path, envelope) {
  const outputPath = (0, import_node_path.resolve)(path);
  await (0, import_promises.mkdir)((0, import_node_path.dirname)(outputPath), { recursive: true });
  await (0, import_promises.writeFile)(outputPath, `${JSON.stringify(envelope, null, 2)}
`, { mode: 384 });
  return outputPath;
}
function notificationEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("The notification webhook must be a valid HTTPS URL.");
  }
  const local = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost" || endpoint.hostname === "::1";
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new Error("The notification webhook must use HTTPS (HTTP is allowed only for localhost tests).");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("The notification webhook URL must not contain credentials.");
  }
  return endpoint;
}
function validateNotificationConfiguration(options, webhookUrl) {
  normalizeWorkspaceUrl(options.workspaceUrl);
  normalizeSubject(options.subject);
  if (webhookUrl?.trim()) notificationEndpoint(webhookUrl);
}
function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1e3, 5e3);
  return attempt * 250;
}
async function delay(milliseconds) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
async function deliverNotificationEnvelope(envelope, options) {
  const notifications = envelope.notifications.filter((notification) => notification.send);
  if (notifications.length === 0) return 0;
  const endpoint = notificationEndpoint(options.webhookUrl);
  const token = options.token?.trim();
  const idempotencyKey = options.idempotencyKey?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const payload = { ...envelope, notifications };
  const maxAttempts = idempotencyKey ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "deloitte-postman-workspace-access-action",
        ...token ? { authorization: `Bearer ${token}` } : {},
        ...idempotencyKey ? { "idempotency-key": idempotencyKey } : {}
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15e3)
    });
    if (response.ok) return notifications.length;
    if (attempt < maxAttempts && RETRYABLE_STATUSES.has(response.status)) {
      await delay(retryDelay(response, attempt));
      continue;
    }
    throw new Error(`Notification gateway returned HTTP ${response.status}.`);
  }
  throw new Error("Notification gateway delivery failed.");
}

// src/runtime.ts
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var SCANNER_FILENAMES = /* @__PURE__ */ new Set([
  "deloitte-github-scanner-output.json",
  "github-scanner-output.json",
  "scanner-output.json"
]);
var SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([".git", "node_modules"]);
async function findScannerFiles(directory, results) {
  const entries = await (0, import_promises2.readdir)(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = (0, import_node_path2.join)(directory, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await findScannerFiles(path, results);
    } else if (entry.isFile() && SCANNER_FILENAMES.has(entry.name.toLowerCase())) {
      results.push(path);
    }
  }
}
async function discoverMembersFile(searchRoot = process.cwd()) {
  const root = (0, import_node_path2.resolve)(searchRoot);
  const matches = [];
  try {
    await findScannerFiles(root, matches);
  } catch (error) {
    throw new Error(
      `Unable to search scanner root ${root}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (matches.length === 0) {
    throw new Error(
      `No scanner output was found under ${root}. Expected one file named ${[...SCANNER_FILENAMES].join(", ")}.`
    );
  }
  if (matches.length > 1) {
    const candidates = matches.map((path) => (0, import_node_path2.relative)(root, path) || path).join(", ");
    throw new Error(`Multiple scanner outputs were found under ${root}: ${candidates}. Set members-file explicitly.`);
  }
  return matches[0];
}
async function resolveMembersInput(membersJson, membersFile, roleMapJson, scannerSearchRoot, defaultWorkspaceRole) {
  const inline = membersJson?.trim();
  const explicitPath = membersFile?.trim();
  if (inline && explicitPath) throw new Error("Provide only one of members-json or members-file.");
  const discovered = !inline && !explicitPath;
  const path = explicitPath ?? (discovered ? await discoverMembersFile(scannerSearchRoot) : void 0);
  const source = inline ?? await (0, import_promises2.readFile)(path, "utf8");
  return {
    members: parseMembersJson(source, parseRoleMap(roleMapJson), defaultWorkspaceRole),
    source: inline ? "inline JSON" : (0, import_node_path2.resolve)(path),
    discovered
  };
}
function formatSummary(summary) {
  return JSON.stringify(summary, null, 2);
}
function buildValidationReport(members, source) {
  const workspaceRoles = {};
  for (const member of members) {
    workspaceRoles[member.workspaceRole] = (workspaceRoles[member.workspaceRole] ?? 0) + 1;
  }
  const withScimId = members.filter((member) => Boolean(member.scimId)).length;
  return {
    ok: true,
    scanner: {
      source,
      uniqueMembers: members.length,
      withScimId,
      requiringScimLookup: members.length - withScimId
    },
    workspaceRoles,
    members: members.map((member) => ({
      email: member.email,
      workspaceRole: member.workspaceRole,
      ...member.githubPermission ? { githubPermission: member.githubPermission } : {},
      ...member.githubLogin ? { githubLogin: member.githubLogin } : {},
      hasScimId: Boolean(member.scimId)
    }))
  };
}

// src/cli.ts
var HELP = `postman-workspace-access

Reconcile scanner-produced collaborators into a Postman workspace.

Usage:
  postman-workspace-access --workspace-id <id> --members-file <path> [options]
  postman-workspace-access doctor --workspace-id <id> [options]
  postman-workspace-access validate [--members-file <path> | --scanner-search-root <path>]

Options:
  --workspace-id <id>               Target Postman workspace ID.
  --members-file <path>             Scanner output JSON file.
  --members-json <json>             Inline scanner output JSON.
  --scanner-search-root <path>      Root used to auto-discover scanner output; defaults to current directory.
  --role-map-json <json>            Overrides/extensions for the default GitHub-to-Postman role map.
  --default-workspace-role <role>   Role for otherwise unmapped collaborators; defaults to Viewer.
  --postman-base-url <url>          Defaults to https://api.postman.com.
  --postman-workspace-url <url>     Link included in onboarding notifications.
  --notification-subject <text>     Email subject used by the notification gateway.
  --notifications-file <path>       Write rendered notification payloads to a JSON file.
  --dry-run                         Plan without writes.
  --fail-on-pending-invites         Exit non-zero while invitations are pending.
  --help                            Show this help.

Environment:
  POSTMAN_API_KEY                    Required for doctor and reconciliation; not required for validate.
  POSTMAN_SCIM_API_KEY               Required for doctor and for users needing SCIM lookup/provisioning.
  DELOITTE_NOTIFICATION_WEBHOOK_URL  Optional HTTPS endpoint that accepts the rendered email batch.
  DELOITTE_NOTIFICATION_WEBHOOK_TOKEN Optional bearer token for the notification endpoint.
`;
async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] === "doctor" || argv[0] === "validate" ? argv[0] : "reconcile";
  const commandArgs = command === "reconcile" ? argv : argv.slice(1);
  const { values } = (0, import_node_util.parseArgs)({
    args: commandArgs,
    allowPositionals: false,
    strict: true,
    options: {
      "workspace-id": { type: "string" },
      "members-file": { type: "string" },
      "members-json": { type: "string" },
      "scanner-search-root": { type: "string", default: process.cwd() },
      "role-map-json": { type: "string", default: JSON.stringify(DEFAULT_ROLE_MAP) },
      "default-workspace-role": { type: "string", default: "Viewer" },
      "postman-base-url": { type: "string", default: "https://api.postman.com" },
      "postman-workspace-url": { type: "string" },
      "notification-subject": { type: "string" },
      "notifications-file": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "fail-on-pending-invites": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const resolved = await resolveMembersInput(
    values["members-json"],
    values["members-file"],
    values["role-map-json"],
    values["scanner-search-root"],
    values["default-workspace-role"]
  );
  if (resolved.discovered) process.stderr.write(`info: Auto-discovered scanner output at ${resolved.source}.
`);
  if (command === "validate") {
    process.stdout.write(`${formatSummary(buildValidationReport(resolved.members, resolved.source))}
`);
    return 0;
  }
  const workspaceId = values["workspace-id"]?.trim();
  if (!workspaceId) throw new Error("--workspace-id is required.");
  const postmanApiKey = process.env.POSTMAN_API_KEY?.trim();
  if (!postmanApiKey) throw new Error("POSTMAN_API_KEY is required.");
  const workspaceUrl = values["postman-workspace-url"];
  const notificationSubject = values["notification-subject"];
  const notificationWebhookUrl = process.env.DELOITTE_NOTIFICATION_WEBHOOK_URL?.trim();
  const client = new PostmanClient({
    postmanApiKey,
    ...process.env.POSTMAN_SCIM_API_KEY?.trim() ? { scimApiKey: process.env.POSTMAN_SCIM_API_KEY.trim() } : {},
    ...values["postman-base-url"] ? { baseUrl: values["postman-base-url"] } : {}
  });
  if (command === "doctor") {
    const report = await diagnoseWorkspaceAccess(client, {
      workspaceId,
      members: resolved.members,
      scannerSource: resolved.source
    }, {
      info: (message) => process.stderr.write(`info: ${message}
`),
      warning: (message) => process.stderr.write(`warning: ${message}
`)
    });
    process.stdout.write(`${formatSummary(report)}
`);
    return report.ok ? 0 : 1;
  }
  validateNotificationConfiguration({
    ...workspaceUrl ? { workspaceUrl } : {},
    ...notificationSubject ? { subject: notificationSubject } : {}
  }, notificationWebhookUrl);
  const dryRun = parseBoolean(String(values["dry-run"]));
  const summary = await reconcileWorkspaceAccess(client, {
    workspaceId,
    members: resolved.members,
    dryRun
  }, {
    info: (message) => process.stderr.write(`info: ${message}
`),
    warning: (message) => process.stderr.write(`warning: ${message}
`)
  });
  const sourceRepository = process.env.GITHUB_REPOSITORY ?? process.env.CI_PROJECT_PATH;
  const notificationEnvelope = buildNotificationEnvelope(summary, {
    ...workspaceUrl ? { workspaceUrl } : {},
    ...sourceRepository ? { sourceRepository } : {},
    ...notificationSubject ? { subject: notificationSubject } : {}
  });
  if (values["notifications-file"]) {
    const notificationPath = await writeNotificationEnvelope(values["notifications-file"], notificationEnvelope);
    process.stderr.write(`info: Wrote ${notificationEnvelope.notifications.length} onboarding notification(s) to ${notificationPath}.
`);
  }
  if (notificationWebhookUrl) {
    const runId = process.env.GITHUB_RUN_ID?.trim() ?? process.env.CI_PIPELINE_ID?.trim();
    const delivered = await deliverNotificationEnvelope(notificationEnvelope, {
      webhookUrl: notificationWebhookUrl,
      ...process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN?.trim() ? { token: process.env.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN.trim() } : {},
      ...runId ? { idempotencyKey: `deloitte-postman:${workspaceId}:${runId}` } : {}
    });
    process.stderr.write(`info: Deloitte notification gateway accepted ${delivered} onboarding notification(s).
`);
  }
  process.stdout.write(`${formatSummary(summary)}
`);
  if (summary.counts.failed > 0) return 1;
  if (values["fail-on-pending-invites"] && summary.counts.pending > 0) return 2;
  return 0;
}
runCli().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runCli
});
