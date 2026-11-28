import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl      = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey  = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseAdminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verify the caller is a real, authenticated user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id

    // Admin client — bypasses RLS, can delete auth users
    const admin = createClient(supabaseUrl, supabaseAdminKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Delete all user data — child tables first to avoid FK conflicts
    const tables = [
      'project_tasks',
      'project_milestones',
      'project_billing',
      'project_timesheet',
      'project_meetings',
      'project_shares',
      'invoices',
      'pipeline_cards',
      'clients',
      'rate_scenarios',
      'tax_entries',
      'user_settings',
      'projects',
    ]

    for (const table of tables) {
      const { error } = await admin.from(table).delete().eq('user_id', userId)
      if (error) {
        // Log but don't abort — a missing table or already-empty row is fine
        console.error(`delete-account: error on table "${table}":`, error.message)
      }
    }

    // Delete the auth user record (requires service role key)
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId)
    if (deleteAuthError) {
      return new Response(JSON.stringify({ error: 'Failed to remove auth record: ' + deleteAuthError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('delete-account: unexpected error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
