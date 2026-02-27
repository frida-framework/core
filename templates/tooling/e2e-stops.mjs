#!/usr/bin/env node

import { execSync } from "node:child_process";
import {
  parseSupabaseEnvOutput,
  parseSupabaseStatusHumanOutput,
  readSupabaseEnvFromProcess,
} from "./e2e-route-sharing.mjs";

const USERS = {
  a: { email: "e2e-stops-a@example.com", password: "StopsRouteA123!" },
};

const FAREWELL_REQUEST = {
  startLocation: "Fixture Farewell Start",
  endLocation: "Fixture Farewell Finish",
  departureDate: "2025-01-18",
  departureTime: "09:00",
  riderLevel: "intermediate",
  time_mode: "with_time",
  persist: true,
  roundtrip: true,
  debug: { fixture: true, variant: "stops-farewell" },
};

const NO_FAREWELL_REQUEST = {
  startLocation: "Fixture Short Run",
  endLocation: "Fixture Plaza",
  departureDate: "2025-01-18",
  departureTime: "11:00",
  riderLevel: "beginner",
  time_mode: "with_time",
  persist: false,
  roundtrip: false,
  debug: { fixture: true, variant: "stops-no-farewell" },
};

const asJson = async (response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const pickSupabaseEnv = () => {
  const parsedEnv = readSupabaseEnvFromProcess();
  if (parsedEnv.apiUrl && parsedEnv.anonKey) {
    return parsedEnv;
  }

  let statusOutputEnv = "";
  let statusOutputHuman = "";

  try {
    statusOutputEnv = execSync("supabase status -o env", { encoding: "utf8" });
    const parsed = parseSupabaseEnvOutput(statusOutputEnv);
    if (parsed.apiUrl && parsed.anonKey) {
      return parsed;
    }
  } catch {
    // ignore and fall back to human output
  }

  try {
    statusOutputHuman = execSync("supabase status", { encoding: "utf8" });
    const parsed = parseSupabaseStatusHumanOutput(statusOutputHuman);
    if (parsed.apiUrl && parsed.anonKey) {
      return parsed;
    }
  } catch {
    // ignore, will throw below
  }

  const details = [
    statusOutputEnv ? `supabase status -o env:\n${statusOutputEnv}` : null,
    statusOutputHuman ? `supabase status:\n${statusOutputHuman}` : null,
  ]
    .filter(Boolean)
    .join("\n----\n");

  throw new Error(`Unable to determine Supabase API URL/anon key.\n${details}`);
};

const ensureUser = async (apiUrl, anonKey, credentials) => {
  const signupResponse = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify(credentials),
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
    body: JSON.stringify(credentials),
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

const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertStopsInvariant = (stops, { expectFarewellCount }) => {
  assertCondition(Array.isArray(stops) && stops.length >= 2, "Stops list missing or too short");

  const sequences = stops.map((stop) => stop.sequence);
  const expectedSequences = Array.from({ length: stops.length }, (_v, idx) => idx + 1);
  assertCondition(
    sequences.every((value, idx) => value === expectedSequences[idx]),
    `Sequences not contiguous: got ${sequences.join(",")}`,
  );

  const sortedByKm = [...stops].sort((a, b) => (a.km === b.km ? a.id.localeCompare(b.id) : a.km - b.km));
  assertCondition(
    sortedByKm.every((stop, idx) => stop.id === stops[idx].id),
    "Stops not sorted by km ascending",
  );

  const farewellStops = stops.filter((stop) => stop.isFarewellGas);
  assertCondition(
    farewellStops.length === expectFarewellCount,
    `Unexpected farewell gas count: expected ${expectFarewellCount}, got ${farewellStops.length}`,
  );

  if (expectFarewellCount === 1) {
    const farewell = farewellStops[0];
    assertCondition(farewell.type === "gas", "Farewell gas must keep type=gas");
  }
};

const main = async () => {
  const { apiUrl, anonKey } = pickSupabaseEnv();
  assertCondition(Boolean(apiUrl && anonKey), "Supabase API URL or anon key missing");

  const user = await ensureUser(apiUrl, anonKey, USERS.a);

  const farewellResponse = await calculateRoute(apiUrl, anonKey, user.access_token, FAREWELL_REQUEST);
  assertCondition(farewellResponse.routeId, "Farewell fixture missing routeId");
  assertStopsInvariant(farewellResponse.stops, { expectFarewellCount: 1 });

  const persistedRoute = await fetchSharedRoutePublic(apiUrl, anonKey, farewellResponse.routeId);
  assertCondition(
    JSON.stringify(persistedRoute.stops) === JSON.stringify(farewellResponse.stops),
    "Persisted stops differ from calculate-route response",
  );

  const noFarewellResponse = await calculateRoute(apiUrl, anonKey, null, NO_FAREWELL_REQUEST);
  assertStopsInvariant(noFarewellResponse.stops, { expectFarewellCount: 0 });

  console.log(
    `[e2e-stops] passed: farewell routeId=${farewellResponse.routeId}, farewell stops=${farewellResponse.stops.length}, no-farewell stops=${noFarewellResponse.stops.length}`,
  );
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("[e2e-stops] flow failed:", error);
    process.exit(1);
  });
}
