#!/usr/bin/env node

import { execSync } from "node:child_process";

const USERS = {
  a: { email: "e2e-share-a@example.com", password: "ShareRouteA123!" },
  b: { email: "e2e-share-b@example.com", password: "ShareRouteB123!" },
};

const BASE_ROUTE_REQUEST = {
  startLocation: "CDMX",
  endLocation: "Toluca",
  departureDate: "2025-01-11",
  departureTime: "08:00",
  riderLevel: "intermediate",
  time_mode: "with_time",
  persist: true,
  roundtrip: false,
};

const asJson = async (response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const API_URL_KEYS = ["API_URL", "SUPABASE_URL", "SUPABASE_API_URL"];
const ANON_KEY_KEYS = ["ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"];

const pickFirst = (...values) => values.find(Boolean) || null;

const stripWrappingQuotes = (value) => {
  if (!value) return value;

  const hasMatchingQuotes =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return hasMatchingQuotes ? value.slice(1, -1) : value;
};

const parseSupabaseEnvOutput = (output) => {
  const entries = {};

  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (!match) return;

      const key = match[1];
      const value = stripWrappingQuotes(match[2].trim());
      entries[key] = value;
    });

  return {
    apiUrl: pickFirst(...API_URL_KEYS.map((key) => entries[key])),
    anonKey: pickFirst(...ANON_KEY_KEYS.map((key) => entries[key])),
  };
};

const parseSupabaseStatusHumanOutput = (output) => {
  let apiUrl = null;
  let anonKey = null;

  const extractAfterColon = (line) => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : line.slice(idx + 1).trim();
  };

  const extractUrl = (line) => {
    const match = line.match(/https?:\/\/[^\s'"]+/i);
    return match ? match[0] : null;
  };

  const extractLastField = (line) => {
    const pipeParts = line.split("|").map((part) => part.trim()).filter(Boolean);
    if (pipeParts.length >= 2) {
      return pipeParts[pipeParts.length - 1];
    }

    const spacedParts = line.split(/\s{2,}|\t/);
    if (spacedParts.length > 1) {
      return spacedParts[spacedParts.length - 1].trim();
    }

    const fallbackParts = line.split(/\s+/);
    return fallbackParts.length ? fallbackParts[fallbackParts.length - 1].trim() : null;
  };

  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const normalized = line.toLowerCase();

      if (!apiUrl && normalized.includes("project url")) {
        apiUrl = stripWrappingQuotes(extractAfterColon(line) || extractUrl(line));
      }

      const mentionsPublishable = normalized.includes("publishable");
      const mentionsAnon = normalized.includes("anon") && normalized.includes("key");
      if (!anonKey && (mentionsPublishable || mentionsAnon)) {
        anonKey = stripWrappingQuotes(extractAfterColon(line) || extractLastField(line));
      }
    });

  return { apiUrl, anonKey };
};

const readSupabaseEnvFromProcess = () => ({
  apiUrl: pickFirst(...API_URL_KEYS.map((key) => process.env[key])),
  anonKey: pickFirst(...ANON_KEY_KEYS.map((key) => process.env[key])),
});

const runCommandCapture = (command) => {
  try {
    return execSync(command, { encoding: "utf8" });
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || "";
    const stderr = error?.stderr?.toString?.() || "";
    return `${stdout}\n${stderr}`.trim();
  }
};

const ensureSupabaseRunning = () => {
  let statusOutputEnv = "";
  let statusOutputHuman = "";
  let { apiUrl, anonKey } = readSupabaseEnvFromProcess();

  if (!apiUrl || !anonKey) {
    statusOutputEnv = runCommandCapture("supabase status -o env");
    const parsed = parseSupabaseEnvOutput(statusOutputEnv);
    apiUrl ||= parsed.apiUrl;
    anonKey ||= parsed.anonKey;
  }

  if (!apiUrl || !anonKey) {
    console.log("[e2e] Supabase not running or status incomplete, starting...");
    execSync("supabase start", { stdio: "inherit" });

    statusOutputEnv = runCommandCapture("supabase status -o env");
    const parsedEnv = parseSupabaseEnvOutput(statusOutputEnv);
    apiUrl ||= parsedEnv.apiUrl;
    anonKey ||= parsedEnv.anonKey;

    if (!apiUrl || !anonKey) {
      statusOutputHuman = runCommandCapture("supabase status");
      const parsedHuman = parseSupabaseStatusHumanOutput(statusOutputHuman);
      apiUrl ||= parsedHuman.apiUrl;
      anonKey ||= parsedHuman.anonKey;
    }
  }

  if (!apiUrl || !anonKey) {
    const errorDetails = [
      statusOutputEnv ? `supabase status -o env:\n${statusOutputEnv}` : null,
      statusOutputHuman ? `supabase status:\n${statusOutputHuman}` : null,
    ]
      .filter(Boolean)
      .join("\n----\n");

    throw new Error(
      `Failed to determine Supabase API URL or anon/publishable key.\n${errorDetails || "No status output captured."}`,
    );
  }

  console.log(`[e2e] Supabase API: ${apiUrl}`);
  return { apiUrl, anonKey };
};

const ensureUser = async (apiUrl, anonKey, credentials) => {
  const signupResponse = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });

  if (!signupResponse.ok) {
    const payload = await asJson(signupResponse);
    const message = payload?.msg || payload?.message || "";
    const alreadyRegistered = typeof message === "string" && message.toLowerCase().includes("registered");
    if (!alreadyRegistered) {
      throw new Error(`Signup failed for ${credentials.email}: ${signupResponse.status} ${message}`);
    }
  }

  const tokenResponse = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });

  if (!tokenResponse.ok) {
    const payload = await asJson(tokenResponse);
    throw new Error(`Sign-in failed for ${credentials.email}: ${tokenResponse.status} ${JSON.stringify(payload)}`);
  }

  const tokenPayload = await asJson(tokenResponse);
  if (!tokenPayload?.access_token) {
    throw new Error(`Sign-in did not return access_token for ${credentials.email}`);
  }

  return tokenPayload;
};

const invokeFunction = async (url, { method = "POST", headers = {}, body, expectStatus = 200 } = {}) => {
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await asJson(response);

  if (response.status !== expectStatus) {
    throw new Error(`Request to ${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
};

const calculateRoute = async (apiUrl, anonKey, accessToken, body, expectStatus = 200) => {
  const headers = {
    apikey: anonKey,
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  return invokeFunction(`${apiUrl}/functions/v1/calculate-route`, {
    headers,
    body,
    expectStatus,
  });
};

const fetchSharedRoutePublic = async (apiUrl, anonKey, routeId) => {
  const url = `${apiUrl}/functions/v1/get-route?routeId=${encodeURIComponent(routeId)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  const payload = await asJson(response);
  if (!response.ok) {
    throw new Error(`get-route failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
};

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

const main = async () => {
  const { apiUrl, anonKey } = ensureSupabaseRunning();

  const userA = await ensureUser(apiUrl, anonKey, USERS.a);
  const initialPayload = await calculateRoute(apiUrl, anonKey, userA.access_token, {
    ...BASE_ROUTE_REQUEST,
    debug: { fixture: true, variant: "initial" },
  });

  assertTruthy(initialPayload.routeId, "First calculate-route missing routeId");
  assertTruthy(initialPayload.updated_at, "First calculate-route missing updated_at");

  const firstPublic = await fetchSharedRoutePublic(apiUrl, anonKey, initialPayload.routeId);
  assertCondition(firstPublic.routeId === initialPayload.routeId, "Public read returned different routeId");
  assertCondition(firstPublic.updated_at === initialPayload.updated_at, "Public read returned different updated_at");
  assertCondition(
    firstPublic.routeCore.scenic_score === initialPayload.routeCore.scenic_score,
    "Public read returned different scenic_score",
  );

  const updatedPayload = await calculateRoute(apiUrl, anonKey, userA.access_token, {
    ...BASE_ROUTE_REQUEST,
    routeId: initialPayload.routeId,
    roundtrip: true,
    destinationPlace: {
      label: "E2E Cantina",
      latitude: 19.4326,
      longitude: -99.1332,
    },
    debug: { fixture: true, variant: "updated" },
  });

  assertCondition(updatedPayload.routeId === initialPayload.routeId, "Route ID changed on update");
  assertTruthy(updatedPayload.updated_at, "Updated calculate-route missing updated_at");

  const initialUpdatedAt = new Date(initialPayload.updated_at).getTime();
  const updatedUpdatedAt = new Date(updatedPayload.updated_at).getTime();
  assertCondition(updatedUpdatedAt > initialUpdatedAt, "updated_at did not advance after update");
  assertCondition(
    updatedPayload.tripContext?.roundtrip === true,
    "Roundtrip flag missing on update",
  );
  assertCondition(
    updatedPayload.routeCore.end === BASE_ROUTE_REQUEST.startLocation,
    "Roundtrip did not append start as final destination",
  );
  assertCondition(
    updatedPayload.routeCore.destinationPlace?.label === "E2E Cantina",
    "Destination place was not persisted on update",
  );

  const updatedPublic = await fetchSharedRoutePublic(apiUrl, anonKey, updatedPayload.routeId);
  assertCondition(updatedPublic.updated_at === updatedPayload.updated_at, "Public read missing latest updated_at");
  assertCondition(
    updatedPublic.tripContext?.roundtrip === true,
    "Public read missing roundtrip flag",
  );
  assertCondition(
    updatedPublic.routeCore.end === BASE_ROUTE_REQUEST.startLocation,
    "Public read missing roundtrip endpoint",
  );
  assertCondition(
    updatedPublic.routeCore.destinationPlace?.label === "E2E Cantina",
    "Public read missing destination place",
  );

  const userB = await ensureUser(apiUrl, anonKey, USERS.b);
  await calculateRoute(
    apiUrl,
    anonKey,
    userB.access_token,
    {
      ...BASE_ROUTE_REQUEST,
      routeId: updatedPayload.routeId,
      debug: { fixture: true, variant: "forbidden" },
    },
    403,
  );

  console.log(
    `[e2e] Route sharing flow passed: routeId=${updatedPayload.routeId}, updated_at=${updatedPayload.updated_at}`,
  );
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("[e2e] Route sharing failed:", error);
    process.exit(1);
  });
}

export {
  parseSupabaseEnvOutput,
  parseSupabaseStatusHumanOutput,
  readSupabaseEnvFromProcess,
  ensureSupabaseRunning,
  ensureUser,
  calculateRoute,
  fetchSharedRoutePublic,
  invokeFunction,
};
