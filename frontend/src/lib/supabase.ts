import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy frontend/.env.example to ' +
      'frontend/.env and fill in your Supabase project credentials. Auth calls will fail until then.'
  );
}

// Fall back to a syntactically valid placeholder so createClient() never throws at module
// load (which would otherwise blank the entire app, even on routes that don't need auth).
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
