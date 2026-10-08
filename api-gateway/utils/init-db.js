const fs = require('fs');
const path = require('path');
const { pgPool } = require('../config/db.config');

const schemaPath = path.join(__dirname, '../../docs/DB_SCHEMA.md');

async function run() {
  console.log('🔄 Initializing database schema...');
  
  let schemaContent;
  try {
    schemaContent = fs.readFileSync(schemaPath, 'utf8');
  } catch (error) {
    console.error('❌ Could not read DB_SCHEMA.md:', error.message);
    process.exit(1);
  }

  // Extract the SQL block from DB_SCHEMA.md
  const sqlMatch = schemaContent.match(/```sql([\s\S]*?)```/);
  if (!sqlMatch || !sqlMatch[1]) {
    console.error('❌ Could not find SQL code block in DB_SCHEMA.md');
    process.exit(1);
  }

  let sqlStatements = sqlMatch[1].trim();

  // Create client from pool
  const client = await pgPool.connect();

  try {
    // 1. For local development compatibility, ensure the 'auth' schema and 'users' table exist 
    // before binding the trigger, mirroring Supabase Auth's environment.
    console.log('🛠️ Creating mock auth schema for local environment...');
    try {
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            raw_user_meta_data JSONB,
            created_at TIMESTAMP DEFAULT now()
        );
      `);
    } catch (e) {
      console.log('⚠️ Could not modify auth schema (expected on Supabase cloud hosts):', e.message);
    }

    // Begin main table transaction
    await client.query('BEGIN');

    // 2. Drop existing tables if they exist to allow clean redeployments (Cascade ensures constraints drop too)
    console.log('🗑️ Dropping existing tables for clean setup...');
    const dropTables = [
      'notifications', 'reports', 'ai_assessments', 'advisory_surfaces',
      'osv_findings', 'osv_vulnerabilities', 'dependency_vulnerabilities',
      'security_alerts', 'cves', 'dependency_edges', 'dependencies',
      'dependency_files', 'repositories', 'projects',
      'team_members', 'teams', 'users', 'organizations'
    ];
    for (const table of dropTables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE;`);
    }

    // 3. Execute main DB Schema SQL statements
    console.log('🚀 Executing main DDL schema statements...');
    await client.query(sqlStatements);

    await client.query('COMMIT');
    console.log('✅ Main tables and constraints created successfully!');

    // 4. Create the handles/triggers for Supabase Auth replication
    console.log('⚡ Establishing handle_new_user trigger on auth.users...');
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION public.handle_new_user() 
        RETURNS trigger AS $$
        BEGIN
          INSERT INTO public.users (user_id, email, full_name, role)
          VALUES (
            new.id, 
            new.email, 
            COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 
            'developer'
          );
          RETURN new;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;

        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        
        CREATE TRIGGER on_auth_user_created
          AFTER INSERT ON auth.users
          FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
      `);
      console.log('✅ Database triggers initialized successfully!');
    } catch (triggerErr) {
      console.log('⚠️ Could not create replication trigger directly via pool (normal on Supabase Cloud):', triggerErr.message);
      console.log('💡 Note: You can paste the trigger code from Phase 1 documentation directly into your Supabase SQL Editor.');
    }
    console.log('✅ Database schema and triggers initialized successfully!');

    // 5. The DROP TABLE step above just wiped public.users, but auth.users
    // (Supabase-managed) was untouched — the trigger only fires on new
    // inserts there, so existing accounts would silently lose their profile
    // row on every redeploy without this backfill.
    console.log('🔁 Backfilling public.users from existing auth.users records...');
    try {
      const backfillResult = await client.query(`
        INSERT INTO public.users (user_id, email, full_name, role)
        SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 'developer'
        FROM auth.users
        ON CONFLICT (user_id) DO NOTHING;
      `);
      console.log(`✅ Backfilled ${backfillResult.rowCount} existing user(s) into public.users.`);
    } catch (backfillErr) {
      console.log('⚠️ Could not backfill users from auth.users:', backfillErr.message);
      console.log('💡 Note: run the equivalent INSERT ... SELECT FROM auth.users manually in the Supabase SQL Editor.');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error initializing schema:', error);
  } finally {
    client.release();
    await pgPool.end();
  }
}

run();
