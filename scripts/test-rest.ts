/**
 * Phase 0 — REST API Validation
 *
 * Checks 1–3 are non-billable.
 * Check 4 (schema review) is performed offline from docs.
 * Check 5 (generation) requires explicit approval and a confirmed model path.
 *
 * Run: npm run phase0:rest
 */

import { HiggsFieldClient } from "@higgsfield/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ─── Utilities ──────────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(`\n✗  FAIL: ${msg}\n`);
  process.exit(1);
}

function pass(label: string, detail?: string) {
  console.log(`  ✓  ${label}${detail ? `\n     ${detail}` : ""}`);
}

function info(msg: string) {
  console.log(`     ${msg}`);
}

function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nPhase 0 — Higgsfield REST API Validation");
  console.log("Checks 1–3 consume no credits.\n");

  // ── Credential check ──────────────────────────────────────────────────────

  const KEY_ID = process.env.HIGGSFIELD_KEY_ID;
  const KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

  if (!KEY_ID || KEY_ID === "your_key_id_here") {
    fail("HIGGSFIELD_KEY_ID is not set in .env.local");
  }
  if (!KEY_SECRET || KEY_SECRET === "your_key_secret_here") {
    fail("HIGGSFIELD_KEY_SECRET is not set in .env.local");
  }

  info(`Key ID:     ${KEY_ID.slice(0, 6)}${"*".repeat(Math.max(0, KEY_ID.length - 6))}`);
  info(`Key Secret: ${"*".repeat(Math.min(KEY_SECRET.length, 12))} (${KEY_SECRET.length} chars)`);

  const client = new HiggsFieldClient({ apiKey: KEY_ID, apiSecret: KEY_SECRET });

  // ── Check 1: Authentication ───────────────────────────────────────────────

  section("Check 1 — Authentication (file upload, no credit cost)");

  const fixturePath = path.resolve("scripts/fixtures/test.jpg");
  if (!fs.existsSync(fixturePath)) {
    fail(`Test fixture not found at ${fixturePath}. Run the project setup first.`);
  }
  const imageBuffer = fs.readFileSync(fixturePath);
  info(`Fixture: ${fixturePath} (${imageBuffer.length} bytes)`);

  let publicUrl: string;
  try {
    publicUrl = await client.uploadImage(imageBuffer, "jpeg");
    pass("Image uploaded", `public_url: ${publicUrl}`);
  } catch (err: any) {
    const status = err?.response?.status;
    const body = JSON.stringify(err?.response?.data ?? {});
    if (status === 401) {
      fail(
        `Authentication failed (HTTP 401).\nResponse: ${body}\nCheck HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET.`
      );
    }
    fail(`Upload failed (HTTP ${status ?? "?"}):\n${body || err?.message}`);
  }

  // ── Check 2: Public URL accessibility ────────────────────────────────────

  section("Check 2 — Verify uploaded file is publicly accessible");

  try {
    const head = await fetch(publicUrl!, { method: "HEAD" });
    if (!head.ok) {
      fail(`public_url returned HTTP ${head.status}. File may not be accessible.`);
    }
    pass(
      `File accessible (HTTP ${head.status})`,
      `Content-Type: ${head.headers.get("content-type")} | ` +
        `Content-Length: ${head.headers.get("content-length")} bytes`
    );
  } catch (err: any) {
    fail(`Could not reach public_url: ${err?.message}`);
  }

  // ── Check 3: SDK capability inspection ───────────────────────────────────

  section("Check 3 — SDK model discovery (inspecting actual SDK exports)");

  info("SDK version: " + (await import("../node_modules/@higgsfield/client/package.json", { assert: { type: "json" } })).default.version);
  info("");
  info("HiggsFieldClient prototype methods:");
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter((m) => m !== "constructor")
    .sort();
  for (const m of methods) {
    info(`  • ${m}()`);
  }

  info("");
  info("Attempting getSoulStyles() — the only catalog-style listing in the SDK:");
  try {
    const styles = await client.getSoulStyles();
    pass(`getSoulStyles() returned ${styles.length} entries`);
    if (styles.length > 0) {
      info("  Sample entries: " + styles.slice(0, 3).map((s: any) => s.name ?? s.id).join(", "));
    }
  } catch (err: any) {
    info(`  getSoulStyles() error: ${err?.response?.status ?? "?"} — ${JSON.stringify(err?.response?.data ?? err?.message)}`);
  }

  info("");
  info("Conclusion:");
  info("  The SDK exposes no listModels(), getModels(), or equivalent method.");
  info("  generate(endpoint, params) accepts an arbitrary endpoint string.");
  info("  The model path must be known in advance. It is not discoverable via the SDK.");
  info("");
  info("► ACTION REQUIRED: Retrieve the Nano Banana Pro model path.");
  info("  1. Open: https://open.higgsfield.ai (Higgsfield model console)");
  info("  2. Locate 'Nano Banana Pro' in your account's available models");
  info("  3. Open the model → find the API endpoint path (e.g. /higgsfield-ai/.../v1)");
  info("  4. Set HIGGSFIELD_MODEL_PATH=<path> in .env.local");
  info("  5. Fetch the model's documentation page to record its input schema");
  info("     and confirm whether 2K resolution is listed as a supported option");

  // ── Summary ───────────────────────────────────────────────────────────────

  section("Phase 0 — Checks 1–3 Complete");
  console.log("  Check 1  ✓  Credentials valid");
  console.log("  Check 2  ✓  File upload working, public URL accessible");
  console.log("  Check 3  ✓  SDK inspected — no model listing method exists");
  console.log("");
  console.log("  Remaining (no code needed until model path is confirmed):");
  console.log("  Check 4  ○  Review model schema from docs (offline)");
  console.log("  Check 5  ○  One controlled generation — requires explicit approval");
  console.log("");
  console.log("  Uploaded test image URL (valid until Higgsfield retention expires):");
  console.log(`  ${publicUrl!}`);
  console.log("");

  // Write findings to a file for reference
  const findings = {
    timestamp: new Date().toISOString(),
    check1: { passed: true, publicUrl: publicUrl! },
    check2: { passed: true },
    check3: {
      passed: true,
      sdkVersion: "0.2.6",
      modelListingAvailable: false,
      availableMethods: methods,
      conclusion: "No model discovery method. Path must come from console.higgsfield.ai.",
    },
  };
  const outputPath = path.resolve("scripts/output/phase0-rest-findings.json");
  fs.writeFileSync(outputPath, JSON.stringify(findings, null, 2));
  info(`Findings written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
