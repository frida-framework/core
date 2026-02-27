#!/usr/bin/env node

import {
  ensureSupabaseRunning,
  ensureUser,
  calculateRoute,
  fetchSharedRoutePublic,
} from "./e2e-route-sharing.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const USERS = {
  fallback: { email: "e2e-llm-fallback@example.com", password: "LlmFallback123!" },
};

const BASE_ROUTE_REQUEST = {
  startLocation: "CDMX",
  endLocation: "Puebla",
  departureDate: "2025-02-15",
  departureTime: "08:30",
  riderLevel: "intermediate",
  time_mode: "with_time",
  persist: true,
  roundtrip: false,
};

const WARNING_TEXT = "No se pudo generar la ruta escénica. Mostramos la ruta rápida.";
const LOG_PATH = process.env.E2E_NODE_LOG || "artifacts/e2e/e2e-llm-fallback.log";

const assertTruthy = (value, message) => {
  if (!value) {
    throw new Error(message);
  }
};

const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const pickWarning = (payload) => {
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  return warnings.find(
    (warning) => warning?.code === "llm_unavailable" || warning?.code === "llm_error",
  );
};

const summarizePayload = (payload) => {
  if (!payload) return null;

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map(({ code, message, severity }) => ({ code, message, severity }))
    : payload.warnings;

  return {
    analysis_level: payload.analysis_level,
    fallback: payload.fallback,
    warnings,
  };
};

const writeFailureLog = (error, response, viewerPayload) => {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const summary = {
      error: error instanceof Error ? error.message : String(error),
      response: summarizePayload(response),
      viewer: summarizePayload(viewerPayload),
    };
    writeFileSync(LOG_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  } catch (writeError) {
    console.error("[e2e] Failed to write fallback log:", writeError);
  }
};

const main = async () => {
  let response = null;
  let viewerPayload = null;

  const { apiUrl, anonKey } = ensureSupabaseRunning();
  const user = await ensureUser(apiUrl, anonKey, USERS.fallback);

  try {
    response = await calculateRoute(apiUrl, anonKey, user.access_token, BASE_ROUTE_REQUEST);

    assertTruthy(response.routeId, "Route ID missing from calculate-route");
    assertTruthy(response.shareUrl, "Share URL missing from calculate-route");

    assertCondition(response.analysis_level === "fast_only", "analysis_level should be fast_only after LLM fallback");
    assertCondition(response.fallback?.mode === "fast_only", "Fallback mode missing");
    assertCondition(response.fallback?.reason === "llm_error", "Fallback reason missing");

    const warning = pickWarning(response);
    assertTruthy(warning, "LLM fallback warning missing");
    assertCondition(warning.message === WARNING_TEXT, "LLM fallback warning text mismatch");

    viewerPayload = await fetchSharedRoutePublic(apiUrl, anonKey, response.routeId);

    assertCondition(
      viewerPayload?.fallback?.mode === "fast_only",
      "Viewer payload missing fallback mode",
    );
    const viewerWarning = pickWarning(viewerPayload);
    assertTruthy(viewerWarning, "Viewer payload missing fallback warning");
    assertCondition(viewerWarning.message === WARNING_TEXT, "Viewer warning text mismatch");

    console.log(
      `[e2e] LLM fallback flow passed: routeId=${response.routeId}, shareUrl=${response.shareUrl}`,
    );
  } catch (error) {
    writeFailureLog(error, response, viewerPayload);
    throw error;
  }
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("[e2e] LLM fallback failed:", error);
    process.exit(1);
  });
}

export { main };
