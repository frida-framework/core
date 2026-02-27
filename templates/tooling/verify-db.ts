import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

console.log(`Connecting to: ${supabaseUrl}`);
console.log(`Using key: ${supabaseKey ? "YES" : "NO"} (${supabaseKey?.substring(0, 5)}...)`);

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    // 1. Check if we can select from route
    console.log("\n--- Checking 'route' table ---");
    const { data: routeData, error: routeError } = await supabase
        .from("route")
        .select("details_status, id")
        .limit(1);

    if (routeError) {
        console.error("Error selecting id, details_status:", routeError);
    } else {
        console.log("Success! Data:", routeData);
    }
}

check();
