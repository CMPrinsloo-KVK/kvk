// ============================================================
// supabase/functions/render-invoice/index.ts
//
// Holds the GitHub token so the browser never sees it.
// Marks the invoice as pending, then fires repository_dispatch.
//
// Deploy:
//   supabase functions deploy render-invoice --no-verify-jwt
//
// Secrets:
//   supabase secrets set GITHUB_PAT=ghp_xxx
//   supabase secrets set GITHUB_REPO=cmprinsloo-kvk/kvk
//   supabase secrets set RENDER_TOKEN=<any long random string>
// ============================================================

const ALLOWED_ORIGINS = [
  'https://cmprinsloo-kvk.github.io',
  'https://kaalvellies.co.za',
  'https://www.kaalvellies.co.za',
  'http://localhost:8000'
]

function corsHeaders (origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'content-type, x-render-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN')
  if (RENDER_TOKEN && req.headers.get('x-render-token') !== RENDER_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorised' }), {
      status: 401, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  let body: { invoice_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), {
      status: 400, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  const invoiceId = body.invoice_id
  if (!invoiceId) {
    return new Response(JSON.stringify({ error: 'invoice_id required' }), {
      status: 400, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const GITHUB_PAT   = Deno.env.get('GITHUB_PAT')!
  const GITHUB_REPO  = Deno.env.get('GITHUB_REPO') || 'cmprinsloo-kvk/kvk'

  // 1. flag it pending so the UI has something to poll on
  const patch = await fetch(
    SUPABASE_URL + '/rest/v1/invoices?id=eq.' + encodeURIComponent(invoiceId),
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        'content-type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ render_status: 'pending', render_log: null })
    }
  )

  const rows = await patch.json()
  if (!patch.ok || !Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ error: 'invoice not found' }), {
      status: 404, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  // 2. kick the workflow
  const dispatch = await fetch(
    'https://api.github.com/repos/' + GITHUB_REPO + '/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + GITHUB_PAT,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'content-type': 'application/json',
        'User-Agent': 'kvk-invoice-renderer'
      },
      body: JSON.stringify({
        event_type: 'render-invoice',
        client_payload: { invoice_id: invoiceId }
      })
    }
  )

  if (!dispatch.ok) {
    const detail = await dispatch.text()
    await fetch(
      SUPABASE_URL + '/rest/v1/invoices?id=eq.' + encodeURIComponent(invoiceId),
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: 'Bearer ' + SERVICE_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          render_status: 'failed',
          render_log: 'dispatch failed: ' + detail.slice(0, 2000)
        })
      }
    )
    return new Response(JSON.stringify({ error: 'dispatch failed', detail }), {
      status: 502, headers: { ...cors, 'content-type': 'application/json' }
    })
  }

  return new Response(
    JSON.stringify({ ok: true, invoice_id: invoiceId, number: rows[0].number }),
    { headers: { ...cors, 'content-type': 'application/json' } }
  )
})
