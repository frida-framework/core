import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const hasPassword = !!process.env.SUPABASE_DB_PASSWORD;
console.log('SUPABASE_DB_PASSWORD:', hasPassword ? 'Present' : 'Missing');
