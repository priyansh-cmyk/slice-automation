/**
 * Phase 0 — MCP OAuth + Tool Discovery
 *
 * Phases:
 *   A  Dynamic client registration (RFC 7591) — non-interactive
 *   B  Stored token check + refresh             — non-interactive
 *   C  Authorization Code + PKCE flow           — one browser step
 *   D  Authenticated MCP inspection             — non-interactive
 *
 * No image generation. No credits consumed.
 *
 * Run: npm run phase0:mcp-full
 */

import https from "https";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { URLSearchParams } from "url";

// ── Config ────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve("scripts/output");
const CLIENT_FILE = path.join(OUTPUT_DIR, "mcp-client.json");
const TOKENS_FILE = path.join(OUTPUT_DIR, "mcp-tokens.json");

const AUTH_SERVER = "https://clerk.higgsfield.ai";
const MCP_ENDPOINT = "https://mcp.higgsfield.ai/mcp";
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = "openid email offline_access";
const CALLBACK_PORT = 3000;

// ── Utilities ─────────────────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}
function info(msg: string) { console.log(`  ${msg}`); }
function pass(msg: string) { console.log(`  ✓  ${msg}`); }
function warn(msg: string) { console.log(`  ⚠  ${msg}`); }
function fail(msg: string, doExit = true): never | void {
  console.error(`\n✗  FAIL: ${msg}\n`);
  if (doExit) process.exit(1);
}

function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 20_000,
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (responseBody += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: responseBody }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.write(body);
    req.end();
  });
}

function httpsStream(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 30_000,
      },
      (res) => {
        const contentType = res.headers["content-type"] ?? "";
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (responseBody += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, contentType, body: responseBody })
        );
        res.on("close", () =>
          resolve({ status: res.statusCode ?? 0, contentType, body: responseBody })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("MCP request timed out")); });
    req.write(body);
    req.end();
  });
}

// ── PKCE helpers ──────────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function generateVerifier(): string {
  return b64url(crypto.randomBytes(48));
}
function generateChallenge(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}
function generateState(): string {
  return b64url(crypto.randomBytes(16));
}

// ── Types ─────────────────────────────────────────────────────────────────

interface ClientConfig {
  client_id: string;
  registered_at: string;
  _full_response?: unknown;
}

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  id_token?: string;
}

// ── Phase A: Client Registration ──────────────────────────────────────────

async function ensureClient(): Promise<ClientConfig> {
  if (fs.existsSync(CLIENT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(CLIENT_FILE, "utf8")) as ClientConfig;
    pass(`Existing registration loaded  client_id: ${existing.client_id.slice(0, 16)}…`);
    return existing;
  }

  info(`POST ${AUTH_SERVER}/oauth/register`);

  const payload = JSON.stringify({
    client_name: "soma-ai-ad-production",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // public client — PKCE only
    scope: SCOPES,
  });

  const res = await httpsPost(`${AUTH_SERVER}/oauth/register`, payload, {
    "Content-Type": "application/json",
  });

  if (res.status !== 200 && res.status !== 201) {
    let detail = res.body.slice(0, 300);
    try { detail = JSON.stringify(JSON.parse(res.body), null, 2).slice(0, 300); } catch {}
    fail(`Registration failed (HTTP ${res.status}):\n${detail}`);
  }

  const reg = JSON.parse(res.body);
  pass(`Registered  client_id: ${reg.client_id}`);

  const config: ClientConfig = {
    client_id: reg.client_id,
    registered_at: new Date().toISOString(),
    _full_response: reg,
  };
  fs.writeFileSync(CLIENT_FILE, JSON.stringify(config, null, 2));
  return config;
}

// ── Phase B: Token Management ─────────────────────────────────────────────

function loadTokens(): StoredTokens | null {
  if (!fs.existsSync(TOKENS_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch { return null; }
}

function saveTokens(data: Record<string, unknown>): StoredTokens {
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const tokens: StoredTokens = {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string | undefined,
    expires_at: Date.now() + (expiresIn - 60) * 1_000,
    token_type: (data.token_type as string) ?? "Bearer",
    id_token: data.id_token as string | undefined,
  };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  return tokens;
}

async function tryRefresh(clientId: string, refreshToken: string): Promise<StoredTokens | null> {
  info("Access token expired — attempting refresh…");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  }).toString();

  const res = await httpsPost(`${AUTH_SERVER}/oauth/token`, body, {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (res.status !== 200) { warn(`Refresh failed (HTTP ${res.status})`); return null; }

  const tokens = saveTokens(JSON.parse(res.body));
  pass("Token refreshed");
  return tokens;
}

async function getValidToken(client: ClientConfig): Promise<string | null> {
  const stored = loadTokens();
  if (!stored) return null;

  if (Date.now() < stored.expires_at) {
    const minsLeft = Math.round((stored.expires_at - Date.now()) / 60_000);
    pass(`Stored token valid (expires in ~${minsLeft}m)`);
    return stored.access_token;
  }

  if (stored.refresh_token) {
    const refreshed = await tryRefresh(client.client_id, stored.refresh_token);
    if (refreshed) return refreshed.access_token;
  }

  info("No valid tokens — authentication required.");
  return null;
}

// ── Phase C: PKCE Authorization Flow ─────────────────────────────────────

async function doAuthFlow(clientId: string): Promise<StoredTokens> {
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = generateState();

  const authUrl = new URL(`${AUTH_SERVER}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  section("Phase C — Authorization (one browser step required)");
  info("What will happen:");
  info("  1. A local callback server starts on http://localhost:3000");
  info("  2. Open the URL below in your browser");
  info("  3. Log in to your Higgsfield account and approve access");
  info("  4. Your browser is redirected to localhost:3000/callback");
  info("  5. This script captures the code and exchanges it for tokens");
  info("  6. Tokens are stored at scripts/output/mcp-tokens.json");
  info("");
  info("Scopes: openid email offline_access");
  info("(offline_access = refresh token, avoids re-auth on every run)");
  info("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  Open this URL in your browser:                          │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log("");
  console.log(`  ${authUrl.toString()}`);
  console.log("");
  info("Waiting for callback on http://localhost:3000/callback …");
  info("(timeout: 5 minutes)");

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404); res.end("Not found"); return;
      }

      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const authCode = url.searchParams.get("code");

      // State MUST be validated before acting on any callback parameter,
      // including error responses — an attacker could forge an error callback
      // without a valid state to probe the callback server.
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>State mismatch</h1><p>Possible CSRF. Please retry.</p>");
        server.close();
        reject(new Error("State mismatch — CSRF protection triggered"));
        return;
      }

      if (error) {
        const desc = url.searchParams.get("error_description") ?? "";
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Auth Error</h1><p>${error}: ${desc}</p>`);
        server.close();
        reject(new Error(`Auth error: ${error} — ${desc}`));
        return;
      }

      if (!authCode) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Missing code</h1><p>No authorization code in callback.</p>");
        server.close();
        reject(new Error("No authorization code in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font-family:sans-serif;max-width:480px;margin:4rem auto">
        <h1 style="color:#22c55e">✓ Authorized</h1>
        <p>Authorization successful. You can close this tab and return to the terminal.</p>
      </body></html>`);
      server.close();
      resolve(authCode);
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      info(`Callback server listening on http://localhost:${CALLBACK_PORT}`);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${CALLBACK_PORT} already in use. Stop the other process and retry.`));
      } else {
        reject(err);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Auth flow timed out after 5 minutes"));
    }, 5 * 60_000);
  });

  pass("Authorization code received");
  info("Exchanging code for tokens…");

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  }).toString();

  const tokenRes = await httpsPost(`${AUTH_SERVER}/oauth/token`, tokenBody, {
    "Content-Type": "application/x-www-form-urlencoded",
  });

  if (tokenRes.status !== 200) {
    let detail = tokenRes.body.slice(0, 300);
    try { detail = JSON.stringify(JSON.parse(tokenRes.body), null, 2).slice(0, 300); } catch {}
    fail(`Token exchange failed (HTTP ${tokenRes.status}):\n${detail}`);
  }

  const tokenData = JSON.parse(tokenRes.body);
  const tokens = saveTokens(tokenData);
  pass(`Tokens received and stored at: ${TOKENS_FILE}`);
  info(`  Access token:  ${tokens.access_token.slice(0, 20)}… (${tokens.access_token.length} chars)`);
  info(`  Refresh token: ${tokens.refresh_token ? `present (${tokens.refresh_token.length} chars)` : "NOT issued — re-auth will be required when access token expires"}`);
  info(`  Expires:       ${new Date(tokens.expires_at).toISOString()}`);

  // Verify refresh works immediately — don't claim persistent auth until confirmed.
  if (tokens.refresh_token) {
    info("");
    info("Verifying refresh token works (mandatory — cannot assume offline_access guarantees it)…");
    const refreshed = await tryRefresh(clientId, tokens.refresh_token);
    if (refreshed) {
      pass("Refresh token verified — persistent authentication confirmed");
      info(`  New access token: ${refreshed.access_token.slice(0, 20)}… (${refreshed.access_token.length} chars)`);
      return refreshed; // use the freshest token
    } else {
      warn("Refresh token present but refresh call failed — persistence unconfirmed");
      warn("The access token is still valid for this session; re-auth will be needed on expiry");
    }
  } else {
    warn("No refresh token issued. Session is not persistent.");
    warn("Re-authentication will be required when the access token expires.");
  }

  return tokens;
}

// ── Phase D: MCP Protocol + Tool Discovery ────────────────────────────────

function parseMcpResponse(contentType: string, body: string, targetId: number): unknown {
  if (contentType.includes("text/event-stream")) {
    // SSE transport: extract data: lines
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.id === targetId || msg.method === undefined) return msg;
        } catch {}
      }
    }
    return { _raw_sse: body.slice(0, 500) };
  }
  try { return JSON.parse(body); } catch {
    return { _raw: body.slice(0, 500) };
  }
}

async function mcpCall(token: string, method: string, params: unknown = {}, id = 1): Promise<unknown> {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

  const res = await httpsStream(MCP_ENDPOINT, payload, {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2024-11-05",
  });

  if (res.status === 401) {
    throw new Error("401 Unauthorized — token may be invalid or expired");
  }
  if (res.status === 404) {
    throw new Error("404 — MCP endpoint not found at this path");
  }

  return parseMcpResponse(res.contentType, res.body, id);
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>;
    required?: string[];
  };
}

async function discoverTools(token: string): Promise<void> {
  section("Phase D — MCP Initialization");

  // Initialize
  info('Sending initialize request (protocol version 2024-11-05)…');
  const initResp = await mcpCall(token, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "soma-phase0-probe", version: "1.0.0" },
  }, 1) as any;

  if (initResp?.error) {
    warn(`Initialize error: ${JSON.stringify(initResp.error)}`);
    // Try newer protocol version
    info('Retrying with protocol version 2025-03-26…');
    const initResp2 = await mcpCall(token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "soma-phase0-probe", version: "1.0.0" },
    }, 1) as any;
    if (initResp2?.error) {
      fail(`Initialize failed with both protocol versions:\n${JSON.stringify(initResp2.error)}`, false);
      return;
    }
  }

  const initResult = initResp?.result ?? initResp;
  if (initResult?.serverInfo) {
    pass(`MCP server initialized`);
    info(`  Protocol version: ${initResult.protocolVersion ?? 'unknown'}`);
    info(`  Server: ${initResult.serverInfo?.name ?? 'unknown'} v${initResult.serverInfo?.version ?? 'unknown'}`);
    const caps = initResult.capabilities ?? {};
    info(`  Server capabilities: ${Object.keys(caps).join(', ') || 'none listed'}`);
  } else {
    info(`Initialize response: ${JSON.stringify(initResp).slice(0, 400)}`);
  }

  section("Phase D — Tool Listing");
  info('Sending tools/list request…');
  const toolsResp = await mcpCall(token, "tools/list", {}, 2) as any;

  if (toolsResp?.error) {
    fail(`tools/list failed: ${JSON.stringify(toolsResp.error)}`, false);
    return;
  }

  const tools: MCPTool[] = toolsResp?.result?.tools ?? toolsResp?.tools ?? [];

  const toolsFile = path.join(OUTPUT_DIR, "mcp-tools.json");
  fs.writeFileSync(toolsFile, JSON.stringify(toolsResp, null, 2));

  if (!tools.length) {
    warn('No tools found in response. Full response saved to mcp-tools.json.');
    info(JSON.stringify(toolsResp).slice(0, 600));
    return;
  }

  pass(`${tools.length} tool(s) discovered. Full schemas saved to: ${toolsFile}`);
  console.log('');

  for (const tool of tools) {
    console.log(`  ── ${tool.name}`);
    if (tool.description) info(`     ${tool.description}`);
    const props = tool.inputSchema?.properties ?? {};
    const required = new Set(tool.inputSchema?.required ?? []);
    for (const [name, schema] of Object.entries(props)) {
      const req = required.has(name) ? ' *required*' : '';
      const enumVals = schema.enum ? ` [${schema.enum.slice(0, 5).join(' | ')}${schema.enum.length > 5 ? '…' : ''}]` : '';
      const def = schema.default !== undefined ? ` (default: ${schema.default})` : '';
      info(`     • ${name}${req}: ${schema.type ?? 'any'}${enumVals}${def}`);
      if (schema.description) info(`       └ ${schema.description}`);
    }
    console.log('');
  }

  section("Phase D — Image Generation Analysis");

  // Identify image generation tools
  const genTools = tools.filter(t =>
    /generat|image|creat|render|composit/i.test(t.name + ' ' + (t.description ?? ''))
  );

  if (genTools.length === 0) {
    warn('No image generation tool identified by keyword. Review mcp-tools.json manually.');
  } else {
    pass(`${genTools.length} generation-related tool(s):`);
    for (const t of genTools) info(`  • ${t.name}`);
  }
  console.log('');

  for (const tool of genTools) {
    const props = tool.inputSchema?.properties ?? {};
    const schemaText = JSON.stringify(tool.inputSchema).toLowerCase();

    // Model / endpoint parameter
    const modelParam = ['model', 'model_path', 'endpoint', 'model_id', 'model_name']
      .find(p => props[p]);
    if (modelParam) {
      const ms = props[modelParam];
      info(`[${tool.name}] Model parameter: "${modelParam}"`);
      if (ms.enum) {
        const nanoBanana = ms.enum.find((v: string) => /nano|banana/i.test(v));
        if (nanoBanana) {
          pass(`Nano Banana Pro found in enum: "${nanoBanana}"`);
        } else {
          warn(`"Nano Banana Pro" not in enum. Available models: ${ms.enum.slice(0, 10).join(', ')}${ms.enum.length > 10 ? '…' : ''}`);
        }
      } else {
        info(`  ${JSON.stringify(ms)}`);
      }
    } else {
      warn(`[${tool.name}] No model parameter found. Model may be implicit or use a different parameter name.`);
    }

    // Resolution
    const resParams = Object.entries(props).filter(([k]) =>
      /width|height|resolution|size|aspect/i.test(k)
    );
    if (resParams.length) {
      info(`[${tool.name}] Resolution parameters:`);
      for (const [k, v] of resParams) {
        info(`  ${k}: ${JSON.stringify(v)}`);
      }
      const has2k = JSON.stringify(resParams).includes('2048') ||
                    JSON.stringify(resParams).includes('2k') ||
                    schemaText.includes('2048') || schemaText.includes('2k');
      if (has2k) pass('2K resolution (2048) is supported');
      else warn('2K resolution not confirmed — check parameter constraints');
    }

    // Reference image parameter (critical for our workflow)
    const refParams = Object.entries(props).filter(([k]) =>
      /reference|input_image|image_url|source_image|ref_image|image/i.test(k)
    );
    if (refParams.length) {
      pass(`[${tool.name}] Reference image parameter(s):`);
      for (const [k, v] of refParams) {
        info(`  • ${k}: ${JSON.stringify(v)}`);
      }
    } else {
      warn(`[${tool.name}] No reference image parameter found. Workflow B (modify existing image) may require a different approach.`);
    }
  }

  // Check for file upload / resource tools
  const uploadTools = tools.filter(t =>
    /upload|resource|file|asset/i.test(t.name + ' ' + (t.description ?? ''))
  );
  if (uploadTools.length) {
    pass(`Upload/resource tool(s) found:`);
    for (const t of uploadTools) info(`  • ${t.name}: ${t.description ?? ''}`);
  } else {
    warn('No explicit upload tool found. Reference images may be passed as URLs only.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nPhase 0 — MCP OAuth + Tool Discovery');
  console.log('No image generation. No credits consumed.\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Phase A
  section('Phase A — OAuth Client Registration');
  const client = await ensureClient();

  // Phase B
  section('Phase B — Token State');
  let token = await getValidToken(client);

  if (!token) {
    // Phase C
    const tokens = await doAuthFlow(client.client_id);
    token = tokens.access_token;
  }

  // Phase D
  await discoverTools(token);

  section('Investigation Complete');
  info(`Client config: ${CLIENT_FILE}`);
  info(`Tokens:        ${TOKENS_FILE}`);
  info(`Tool schemas:  ${path.join(OUTPUT_DIR, 'mcp-tools.json')}`);
  console.log('');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err?.message ?? err);
  process.exit(1);
});
