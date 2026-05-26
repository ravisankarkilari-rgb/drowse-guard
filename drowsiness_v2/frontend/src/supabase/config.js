// frontend/src/supabase/config.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://dxfhteizzcinpirvlnvg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4Zmh0ZWl6emNpbnBpcnZsbnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjMwOTUsImV4cCI6MjA5NTA5OTA5NX0.aUbILkRXqlkuMeef9fEUJsUnbOIAQaPjWPYkQEcLKag";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
