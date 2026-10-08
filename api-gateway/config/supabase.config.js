const { createClient } = require('@supabase/supabase-js');

/**
 * Singleton Supabase client initialized with the Service Role Key.
 * This client bypasses RLS policies and is intended for backend administrative tasks
 * such as managing Storage buckets, generating signed URLs, or ingesting manifests.
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = { supabase };
