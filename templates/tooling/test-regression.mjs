#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const USERS = {
    regression: { email: "regression-test@example.com", password: "RegressionTest123!" },
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
        console.log("[regression] Supabase not running or status incomplete, starting...");
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

    console.log(`[regression] Supabase API: ${apiUrl}`);
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

const loadFixtures = () => {
    const fixturesDir = join(process.cwd(), "tests", "regression", "fixtures");
    const files = readdirSync(fixturesDir).filter((file) => file.endsWith(".json") && file !== "README.md");
    const fixtures = [];

    for (const file of files) {
        const filePath = join(fixturesDir, file);
        const content = readFileSync(filePath, "utf8");
        const fixture = JSON.parse(content);
        fixtures.push({
            name: file.replace(".json", ""),
            ...fixture,
        });
    }

    return fixtures;
};

const validateResponse = (fixture, actualResponse) => {
    const expected = fixture.expected_response;
    const errors = [];

    // Check api_version
    if (actualResponse.api_version !== expected.api_version) {
        errors.push(`api_version mismatch: expected ${expected.api_version}, got ${actualResponse.api_version}`);
    }

    // Check analysis_level
    if (actualResponse.analysis_level !== expected.analysis_level) {
        errors.push(`analysis_level mismatch: expected ${expected.analysis_level}, got ${actualResponse.analysis_level}`);
    }

    // Check warnings
    const expectedWarningCodes = expected.warnings.map((w) => w.code).filter(Boolean);
    const actualWarningCodes = actualResponse.warnings.map((w) => w.code).filter(Boolean);
    const missingCodes = expectedWarningCodes.filter((code) => !actualWarningCodes.includes(code));
    const extraCodes = actualWarningCodes.filter((code) => !expectedWarningCodes.includes(code));

    if (missingCodes.length > 0) {
        errors.push(`Missing expected warning codes: ${missingCodes.join(", ")}`);
    }
    if (extraCodes.length > 0) {
        errors.push(`Unexpected warning codes: ${extraCodes.join(", ")}`);
    }

    // Check stops structure
    if (!Array.isArray(actualResponse.stops)) {
        errors.push("stops is not an array");
    } else {
        const expectedFarewellCount = expected.stops.filter((s) => s.isFarewellGas).length;
        const actualFarewellCount = actualResponse.stops.filter((s) => s.isFarewellGas).length;
        if (actualFarewellCount !== expectedFarewellCount) {
            errors.push(`Farewell gas count mismatch: expected ${expectedFarewellCount}, got ${actualFarewellCount}`);
        }

        // Check sequences are contiguous
        const sequences = actualResponse.stops.map((s) => s.sequence).sort((a, b) => a - b);
        const expectedSequences = Array.from({ length: actualResponse.stops.length }, (_, i) => i + 1);
        if (JSON.stringify(sequences) !== JSON.stringify(expectedSequences)) {
            errors.push(`Stop sequences not contiguous: got ${sequences.join(",")}`);
        }
    }

    // Check tripContext.roundtrip
    if (actualResponse.tripContext.roundtrip !== expected.tripContext.roundtrip) {
        errors.push(`roundtrip mismatch: expected ${expected.tripContext.roundtrip}, got ${actualResponse.tripContext.roundtrip}`);
    }

    // Check routeCore has required fields
    const requiredRouteCoreFields = ["id", "start", "end", "distance_km"];
    for (const field of requiredRouteCoreFields) {
        if (!(field in actualResponse.routeCore)) {
            errors.push(`Missing required routeCore field: ${field}`);
        }
    }

    return errors;
};

const runTest = async (fixture, apiUrl, anonKey, accessToken) => {
    console.log(`[regression] Running test: ${fixture.name} - ${fixture._description}`);

    try {
        const response = await calculateRoute(apiUrl, anonKey, accessToken, fixture.request);

        const validationErrors = validateResponse(fixture, response);

        if (validationErrors.length > 0) {
            console.log(`[regression] ❌ FAILED: ${fixture.name}`);
            validationErrors.forEach((error) => console.log(`  - ${error}`));
            console.log(`[regression] Actual response: ${JSON.stringify(response, null, 2)}`);
            return { passed: false, errors: validationErrors };
        } else {
            console.log(`[regression] ✅ PASSED: ${fixture.name}`);
            return { passed: true };
        }
    } catch (error) {
        console.log(`[regression] ❌ ERROR: ${fixture.name} - ${error.message}`);
        return { passed: false, errors: [error.message] };
    }
};

const main = async () => {
    const { apiUrl, anonKey } = ensureSupabaseRunning();

    const user = await ensureUser(apiUrl, anonKey, USERS.regression);

    const fixtures = loadFixtures();
    console.log(`[regression] Loaded ${fixtures.length} fixtures`);

    const results = [];
    for (const fixture of fixtures) {
        const result = await runTest(fixture, apiUrl, anonKey, user.access_token);
        results.push({ name: fixture.name, ...result });
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    console.log(`\n[regression] Test Summary:`);
    console.log(`  Total: ${results.length}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
        console.log(`\nFailed tests:`);
        results.filter((r) => !r.passed).forEach((r) => {
            console.log(`  - ${r.name}`);
        });
        process.exit(1);
    } else {
        console.log(`\nAll tests passed! 🎉`);
    }
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
    main().catch((error) => {
        console.error("[regression] Test runner failed:", error);
        process.exit(1);
    });
}