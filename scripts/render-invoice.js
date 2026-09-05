/* ============================================================
   scripts/render-invoice.js

   Runs inside GitHub Actions. Node 20+, no dependencies.

   node scripts/render-invoice.js build    reads the row, writes build/document.tex
   node scripts/render-invoice.js finish   files the PDF, patches the row
   node scripts/render-invoice.js fail     marks the row failed with the log

   Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, INVOICE_ID, SITE_BASE
   ============================================================ */

const fs   = require('fs')
const path = require('path')
const { buildTex } = require('../invoice-template.js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const INVOICE_ID   = process.env.INVOICE_ID
const SITE_BASE    = process.env.SITE_BASE || 'https://cmprinsloo-kvk.github.io/kvk'

const BUILD_DIR   = path.join(process.cwd(), 'build')
const INVOICE_DIR = path.join(process.cwd(), 'invoices')

if (!SUPABASE_URL || !SERVICE_KEY || !INVOICE_ID) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or INVOICE_ID')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'content-type': 'application/json'
}

async function sbGet (pathAndQuery) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, { headers })
  if (!res.ok) throw new Error('GET ' + pathAndQuery + ' -> ' + res.status + ' ' + await res.text())
  return res.json()
}

async function sbPatch (pathAndQuery, body) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('PATCH ' + pathAndQuery + ' -> ' + res.status + ' ' + await res.text())
}

function suffix () {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function copyIfPresent (name) {
  if (!name) return
  const src = path.join(process.cwd(), name)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(BUILD_DIR, name))
    console.log('bundled ' + name)
  } else {
    console.log('missing ' + name + ', template will fall back')
  }
}

/* ---------- build ---------- */

async function build () {
  const invoices = await sbGet('invoices?id=eq.' + encodeURIComponent(INVOICE_ID) + '&select=*')
  if (!invoices.length) throw new Error('No invoice with id ' + INVOICE_ID)
  const invoice = invoices[0]

  const brands = await sbGet('brands?key=eq.' + encodeURIComponent(invoice.brand) + '&select=*')
  if (!brands.length) throw new Error('No brand ' + invoice.brand)
  const brand = brands[0]

  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(BUILD_DIR, { recursive: true })

  fs.writeFileSync(path.join(BUILD_DIR, 'document.tex'), buildTex(invoice, brand), 'utf8')

  copyIfPresent(brand.logo_file)
  copyIfPresent(brand.signature_file)

  const filename = invoice.number + '-' + suffix() + '.pdf'
  fs.writeFileSync(
    path.join(BUILD_DIR, 'meta.json'),
    JSON.stringify({ filename, number: invoice.number, brand: invoice.brand }, null, 2)
  )

  console.log('Built ' + invoice.number + ' -> ' + filename)
}

/* ---------- finish ---------- */

async function finish () {
  const meta = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, 'meta.json'), 'utf8'))
  const pdf  = path.join(BUILD_DIR, 'document.pdf')

  if (!fs.existsSync(pdf)) throw new Error('No PDF produced')

  fs.mkdirSync(INVOICE_DIR, { recursive: true })
  fs.copyFileSync(pdf, path.join(INVOICE_DIR, meta.filename))

  await sbPatch('invoices?id=eq.' + encodeURIComponent(INVOICE_ID), {
    pdf_filename: meta.filename,
    pdf_url: SITE_BASE + '/invoices/' + meta.filename,
    render_status: 'done',
    render_log: null,
    rendered_at: new Date().toISOString()
  })

  console.log('Filed invoices/' + meta.filename)
}

/* ---------- fail ---------- */

async function fail () {
  let log = 'Render failed. No log captured.'
  const candidates = ['document.log', 'document.fls', 'document.tex']
  for (const name of candidates) {
    const p = path.join(BUILD_DIR, name)
    if (name === 'document.log' && fs.existsSync(p)) {
      log = fs.readFileSync(p, 'utf8').slice(-4000)
      break
    }
  }
  await sbPatch('invoices?id=eq.' + encodeURIComponent(INVOICE_ID), {
    render_status: 'failed',
    render_log: log
  })
  console.log('Marked failed')
}

const mode = process.argv[2]
const run = mode === 'build' ? build : mode === 'finish' ? finish : mode === 'fail' ? fail : null

if (!run) {
  console.error('Usage: render-invoice.js build|finish|fail')
  process.exit(1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
