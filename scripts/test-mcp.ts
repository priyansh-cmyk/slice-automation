/**
 * Phase 0 — MCP Endpoint Probe
 *
 * Probes https://mcp.higgsfield.ai/mcp to read the OAuth challenge and
 * identify the authorization server. No credentials are sent. No generation
 * calls are made. No credits are consumed.
 *
 * Run: npm run phase0:mcp
 */

import https from "https";
import { URL } from "url";

const MCP_ENDPOINT = "https://mcp.higgsfield.ai/mcp";

// ─── Utilities ───────────────────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function info(msg: string) {
  console.log(`  ${msg}`);
}

// ─── HTTP probe (plain https, no SDK) ────────────────────────────────────────

interface ProbeResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function probe(url: string, method = "GET", extraHeaders: Record<string, string> = {}): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          Accept: "text/event-stream, application/json, */*",
          "User-Agent": "soma-phase0-probe/1.0",
          ...extraHeaders,
        },
        timeout: 10_000,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 3000) res.destroy();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers, body: body.slice(0, 3000) }));
        res.on("close", () => resolve({ status: res.statusCode ?? 0, headers, body: body.slice(0, 3000) }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Connection timed out after 10s"));
    });
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nPhase 0 — MCP Endpoint Probe");
  console.log("No credentials sent. No generation calls. No credits consumed.");

  // ── Step 1: Probe the MCP endpoint without credentials ───────────────────

  section("Step 1 — Probe MCP endpoint (no auth)");
  info(`Target: ${MCP_ENDPOINT}`);

  let result: ProbeResult;
  try {
    result = await probe(MCP_ENDPOINT);
  } catch (err: any) {
    info(`Connection failed: ${err.message}`);
    info("");
    info("Cannot reach the MCP endpoint. Possible causes:");
    info("  • No internet access");
    info("  • The endpoint has changed or is unavailable");
    info("  • A firewall is blocking the connection");
    process.exit(1);
  }

  info(`HTTP Status: ${result.status}`);
  info("");
  info("Response headers:");
  for (const [k, v] of Object.entries(result.headers)) {
    if (v) info(`  ${k}: ${v}`);
  }
  if (result.body) {
    info("");
    info("Response body (first 3000 chars):");
    info(result.body);
  }

  // ── Step 2: Parse the WWW-Authenticate header ─────────────────────────────

  section("Step 2 — OAuth challenge analysis");

  const wwwAuth = result.headers["www-authenticate"];

  if (!wwwAuth) {
    info("No WWW-Authenticate header in the response.");
    info("");
    info("Without this header, the OAuth flow type cannot be determined from");
    info("the response alone. The server may require a different request method,");
    info("a different Accept header, or the endpoint path may differ.");
    info("");
    info("Recommendation: Contact Higgsfield developer support and ask:");
    info("  1. Does https://mcp.higgsfield.ai/mcp support third-party OAuth clients?");
    info("  2. What OAuth grant type is used?");
    info("  3. Is there a developer portal for client registration?");
  } else {
    info(`WWW-Authenticate: ${wwwAuth}`);
    info("");

    // Look for authorization_server (MCP spec compliant)
    const authServerMatch = wwwAuth.match(/authorization_server="([^"]+)"/);
    const resourceMatch = wwwAuth.match(/resource="([^"]+)"/);

    if (authServerMatch) {
      const authServer = authServerMatch[1];
      info(`OAuth authorization server: ${authServer}`);
      if (resourceMatch) info(`Resource: ${resourceMatch[1]}`);
      info("");
      info("Probing OAuth server metadata...");

      const metadataUrls = [
        `${authServer}/.well-known/oauth-authorization-server`,
        `${authServer}/.well-known/openid-configuration`,
      ];

      for (const metaUrl of metadataUrls) {
        try {
          info(`  GET ${metaUrl}`);
          const meta = await probe(metaUrl);
          if (meta.status === 200) {
            info(`  HTTP ${meta.status} — OAuth metadata found`);
            info("");
            try {
              const parsed = JSON.parse(meta.body);
              info(`  grant_types_supported: ${JSON.stringify(parsed.grant_types_supported ?? "not listed")}`);
              info(`  registration_endpoint: ${parsed.registration_endpoint ?? "not listed"}`);
              info(`  token_endpoint: ${parsed.token_endpoint ?? "not listed"}`);
              info(`  authorization_endpoint: ${parsed.authorization_endpoint ?? "not listed"}`);
              info(`  scopes_supported: ${JSON.stringify(parsed.scopes_supported ?? "not listed")}`);
              info("");
              if (parsed.registration_endpoint) {
                info("► Dynamic client registration is available at:");
                info(`  ${parsed.registration_endpoint}`);
                info("  This means a third-party application may be able to register");
                info("  without manual intervention from Higgsfield.");
              } else {
                info("► No dynamic client registration endpoint found.");
                info("  Contact Higgsfield to request a client_id and client_secret.");
              }
            } catch {
              info("  Body is not JSON — raw content:");
              info(meta.body.slice(0, 500));
            }
            break;
          } else {
            info(`  HTTP ${meta.status} — not available at this path`);
          }
        } catch (err: any) {
          info(`  Error: ${err.message}`);
        }
      }
    } else if (wwwAuth.toLowerCase().includes("bearer")) {
      info("The server expects a Bearer token.");
      info("The authorization_server is not specified in the header.");
      info("");
      info("This header format does not conform to the MCP spec for OAuth.");
      info("Contact Higgsfield to learn where to obtain Bearer tokens for MCP.");
    }
  }

  // ── Step 3: Conclusion ────────────────────────────────────────────────────

  section("Step 3 — Conclusion");

  if (result.status === 401 && wwwAuth?.includes("authorization_server")) {
    info("The MCP endpoint is OAuth-protected with a discoverable authorization server.");
    info("See Step 2 above for registration and grant type details.");
    info("");
    info("MCP integration path:");
    info("  1. Register a client application (see registration_endpoint above)");
    info("  2. Implement the OAuth grant type listed in grant_types_supported");
    info("  3. Store and refresh tokens in app_settings (encrypted)");
    info("  4. Use @modelcontextprotocol/sdk SSEClientTransport or");
    info("     StreamableHTTPClientTransport with authProvider");
    info("  5. Call client.listTools() to discover available tool names/schemas");
    info("");
    info("This is a real integration task. The REST API is simpler and unblocked.");
    info("MCP remains optional — proceed with REST and add MCP if needed.");
  } else if (result.status === 401) {
    info("The MCP endpoint returned 401 with insufficient OAuth metadata.");
    info("Third-party OAuth registration cannot be self-served from these responses.");
    info("");
    info("Required action: Contact Higgsfield developer support.");
    info("  Ask for: OAuth client registration, grant type, and token endpoint.");
    info("");
    info("Decision: proceed with REST API. MCP is blocked pending Higgsfield contact.");
  } else {
    info(`Unexpected HTTP ${result.status}. See full response in Step 1.`);
    info("Contact Higgsfield to clarify the expected connection method.");
  }
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
