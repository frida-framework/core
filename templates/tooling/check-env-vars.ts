import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const hasDbUrl = !!process.env.DATABASE_URL;
const hasDirectUrl = !!process.env.DIRECT_URL;
const hasSupabaseUrl = !!process.env.VITE_SUPABASE_URL;

console.log('Env Check:');
console.log('DATABASE_URL:', hasDbUrl ? 'Present' : 'Missing');
console.log('DIRECT_URL:', hasDirectUrl ? 'Present' : 'Missing');
console.log('VITE_SUPABASE_URL:', hasSupabaseUrl ? 'Present' : 'Missing');
