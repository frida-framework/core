
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyFix() {
    console.log(`Connecting to: ${supabaseUrl}`);

    // 1. SELECT - Verify column existence
    console.log("\n--- 1. SELECT Check ---");
    const { data: routeData, error: selectError } = await supabase
        .from("route")
        .select("id, details_status")
        .limit(1);

    if (selectError) {
        console.error("SELECT Failed:", selectError);
    } else {
        console.log("SELECT Success:", routeData);
    }

    if (!routeData || routeData.length === 0) {
        console.log("No routes found to test UPDATE. Creating dummy route...");
        // Create dummy route if needed, but risky. 
        // Better to just wait.
        return;
    }

    const routeId = routeData[0].id;
    console.log(`\n--- 2. UPDATE Check (Route ID: ${routeId}) ---`);

    // 2. UPDATE - Verify write access to column
    // This replicates what the Edge Function does
    const { data: updateData, error: updateError } = await supabase
        .from("route")
        .update({
            details_status: 'running', // valid enum value? text?
            updated_at: new Date().toISOString()
        })
        .eq('id', routeId)
        .select();

    if (updateError) {
        console.error("UPDATE Failed:", updateError);
        console.error("This replicates the 'Lock failed' error!");
    } else {
        console.log("UPDATE Success:", updateData);
    }
}

verifyFix();
