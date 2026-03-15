/**
 * Supabase Edge Function: statcan-proxy
 *
 * Proxies POST requests to the Statistics Canada WDS v2 REST API.
 * Needed because StatCan does not set CORS headers, so browser pages
 * hosted on GitHub Pages cannot call it directly.
 *
 * Request:  POST /functions/v1/statcan-proxy
 *           Body: { vectorId: number, latestN: number }
 *
 * Response: The raw JSON array from StatCan's
 *           getDataFromVectorsAndLatestNPeriods endpoint.
 *
 * Deploy:
 *   supabase functions deploy statcan-proxy --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const STATCAN_URL =
  "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json() as { vectorId: number; latestN: number }

    if (!body.vectorId || !body.latestN) {
      return new Response(
        JSON.stringify({ error: "Missing vectorId or latestN" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      )
    }

    // Retry up to 3 times with exponential backoff on 429 / 5xx
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    let upstream: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1000 * attempt)   // 1s, 2s
      upstream = await fetch(STATCAN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ vectorId: body.vectorId, latestN: body.latestN }]),
      })
      if (upstream.status !== 429 && upstream.status < 500) break
    }

    if (!upstream!.ok) {
      return new Response(
        JSON.stringify({ error: `StatCan returned HTTP ${upstream!.status}` }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      )
    }

    const data = await upstream!.json()

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }
})
