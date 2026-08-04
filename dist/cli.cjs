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
function permissionFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const permissions = value;
  for (const key of ["admin", "maintain", "push", "write", "triage", "pull", "read"]) {
    if (permissions[key] === true) return key;
  }
  return void 0;
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
  const result = {};
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
function parseMembersJson(value, roleMap) {
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
    const permission = firstString(
      member.githubPermission,
      member.github_permission,
      member.permission,
      member.roleName,
      member.role_name,
      member.role,
      permissionFromObject(member.permissions)
    )?.toLowerCase();
    const workspaceRole = explicitRole ?? (permission ? roleMap[permission] : void 0);
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
      ...permission ? { githubPermission: permission } : {},
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
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      return existing;
    }
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    const userName = typeof payload.userName === "string" ? payload.userName.trim() : member.email;
    if (!id) throw new Error(`Postman SCIM did not return an ID for ${member.email}.`);
    return {
      id,
      userName,
      ...typeof payload.active === "boolean" ? { active: payload.active } : {}
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
    lifecycle: assignment.provisioned ? "provisioned" : assignment.member.scimId ? "provided-scim-id" : "existing",
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
    let provisioned = false;
    try {
      if (!scimId) {
        const existing = await client.findScimUserByEmail(member.email);
        if (existing?.active === false) {
          if (options.dryRun) {
            results.push({
              email: member.email,
              workspaceRole: member.workspaceRole,
              lifecycle: "would-provision",
              workspaceAccess: "would-add",
              scimId: existing.id,
              message: "Would reactivate the existing SCIM user, then assign the workspace role."
            });
            continue;
          }
          const reactivated = await client.reactivateScimUser(existing);
          scimId = reactivated.id;
          provisioned = true;
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
        const created = await client.provisionScimUser(member);
        scimId = created.id;
        provisioned = true;
        reporter.info(`Submitted ${member.email} to Postman SCIM for provisioning or invitation.`);
      }
      if (!scimId) throw new Error(`Unable to resolve a SCIM ID for ${member.email}.`);
      assignments.push({ member, scimId, roleId, provisioned });
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
        const pending = assignment.provisioned && error instanceof HttpError && PENDING_INVITE_STATUSES.has(error.status);
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

// src/runtime.ts
var import_promises = require("node:fs/promises");
async function loadMembers(membersJson, membersFile, roleMapJson) {
  const inline = membersJson?.trim();
  const path = membersFile?.trim();
  if (inline && path) throw new Error("Provide only one of members-json or members-file.");
  if (!inline && !path) throw new Error("Provide members-json or members-file.");
  const source = inline ?? await (0, import_promises.readFile)(path, "utf8");
  return parseMembersJson(source, parseRoleMap(roleMapJson));
}
function formatSummary(summary) {
  return JSON.stringify(summary, null, 2);
}

// src/cli.ts
var HELP = `postman-workspace-access

Reconcile scanner-produced collaborators into a Postman workspace.

Usage:
  postman-workspace-access --workspace-id <id> --members-file <path> [options]

Options:
  --workspace-id <id>               Target Postman workspace ID.
  --members-file <path>             Scanner output JSON file.
  --members-json <json>             Inline scanner output JSON.
  --role-map-json <json>            GitHub permission to Postman role map.
  --postman-base-url <url>          Defaults to https://api.postman.com.
  --dry-run                         Plan without writes.
  --fail-on-pending-invites         Exit non-zero while invitations are pending.
  --help                            Show this help.

Environment:
  POSTMAN_API_KEY                    Required Postman API key.
  POSTMAN_SCIM_API_KEY               Required to provision or invite missing users.
`;
async function runCli(argv = process.argv.slice(2)) {
  const { values } = (0, import_node_util.parseArgs)({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      "workspace-id": { type: "string" },
      "members-file": { type: "string" },
      "members-json": { type: "string" },
      "role-map-json": { type: "string", default: JSON.stringify(DEFAULT_ROLE_MAP) },
      "postman-base-url": { type: "string", default: "https://api.postman.com" },
      "dry-run": { type: "boolean", default: false },
      "fail-on-pending-invites": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const workspaceId = values["workspace-id"]?.trim();
  if (!workspaceId) throw new Error("--workspace-id is required.");
  const postmanApiKey = process.env.POSTMAN_API_KEY?.trim();
  if (!postmanApiKey) throw new Error("POSTMAN_API_KEY is required.");
  const members = await loadMembers(
    values["members-json"],
    values["members-file"],
    values["role-map-json"]
  );
  const client = new PostmanClient({
    postmanApiKey,
    ...process.env.POSTMAN_SCIM_API_KEY?.trim() ? { scimApiKey: process.env.POSTMAN_SCIM_API_KEY.trim() } : {},
    ...values["postman-base-url"] ? { baseUrl: values["postman-base-url"] } : {}
  });
  const summary = await reconcileWorkspaceAccess(client, {
    workspaceId,
    members,
    dryRun: parseBoolean(String(values["dry-run"]))
  }, {
    info: (message) => process.stderr.write(`info: ${message}
`),
    warning: (message) => process.stderr.write(`warning: ${message}
`)
  });
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
