/* ============================================================
   invoice-template.js

   Single source of truth for the invoice and quote LaTeX.

   Used by:
     - the browser (live preview, manual .tex download)
     - the GitHub Action (the real render)

   Load in a page with:
     <script src="invoice-template.js"></script>
     var tex = InvoiceTemplate.buildTex(invoice, brand)

   Load in Node with:
     const { buildTex } = require('./invoice-template.js')

   `invoice` is a row from public.invoices
   `brand`   is a row from public.brands

   NOTE: brand.signature_name is passed through UNESCAPED so it can
   carry raw LaTeX accents, e.g.  Corn\'e Prinsloo
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.InvoiceTemplate = factory()
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /* ---------- helpers ---------- */

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/&/g, '\\&')
      .replace(/%/g, '\\%')
      .replace(/\$/g, '\\$')
      .replace(/#/g, '\\#')
      .replace(/_/g, '\\_')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}')
  }

  function money (n) {
    return Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  function hex (v, fallback) {
    var c = String(v || '').replace(/^#/, '').toUpperCase()
    return /^[0-9A-F]{6}$/.test(c) ? c : fallback
  }

  function arr (v) {
    if (Array.isArray(v)) return v
    if (typeof v === 'string') { try { return JSON.parse(v) } catch (e) { return [] } }
    return []
  }

  function stripe (i) {
    return (i % 2 === 0) ? '  \\rowcolor{lightgrey}\n' : ''
  }

  /* ---------- table bodies ---------- */

  function lineRows (items) {
    return items.map(function (l, i) {
      var qty  = esc(l.qty) || '---'
      var rate = Number(l.rate) > 0 ? Number(l.rate).toFixed(2) : 'Incl.'
      var amt  = Number(l.amount) > 0 ? Number(l.amount).toFixed(2) : '---'
      return stripe(i) +
        '  \\small ' + esc(l.desc) + ' &\n' +
        '  \\small ' + qty + ' & \\small ' + rate + ' & \\small ' + amt + ' \\\\\n\n'
    }).join('')
  }

  function scopeRows (items, marker) {
    return items.map(function (t, i) {
      var badge = marker === 'number'
        ? '{\\color{highlight}\\textbf{' + (i + 1) + '}}'
        : marker === 'check'
          ? '{\\color{highlight}$\\checkmark$}'
          : '{\\color{darktext}$\\times$}'
      return stripe(i) + '  ' + badge + ' &\n  \\small ' + esc(t) + ' \\\\\n'
    }).join('')
  }

  function scopeBlock (heading, items, marker) {
    if (!items.length) return ''
    return '{\\color{highlight}\\textbf{\\small ' + heading + '}}\\\\[0.5mm]\n' +
           '{\\color{highlight}\\rule{60mm}{0.8pt}}\n' +
           '\\vspace{1.5mm}\n\n' +
           '\\begin{tabularx}{\\linewidth}{M{6mm} L}\n' +
           scopeRows(items, marker) +
           '\\end{tabularx}\n\n' +
           '\\vspace{3.5mm}\n\n'
  }

  /* ---------- main ---------- */

  function buildTex (invoice, brand) {
    invoice = invoice || {}
    brand   = brand   || {}

    var isQuote = invoice.doc_type === 'quote'

    var docTitle  = isQuote ? 'QUOTATION' : 'INVOICE'
    var numLabel  = isQuote ? 'QUOTE NO.' : 'INVOICE NO.'
    var dateLabel = isQuote ? 'VALID UNTIL' : 'DUE DATE'
    var dateValue = isQuote
      ? (invoice.valid_until || '30 days')
      : (invoice.due_date || brand.default_due_date || 'After Delivery')

    var items   = arr(invoice.line_items)
    var receive = arr(invoice.scope_receive)
    var commit  = arr(invoice.scope_commit)
    var exclude = arr(invoice.scope_exclude)

    var sub  = Number(invoice.subtotal || 0)
    var disc = Number(invoice.discount_amount || 0)
    var vat  = Number(invoice.vat_amount || 0)
    var tot  = Number(invoice.total || 0)

    var eNo    = esc(invoice.number)
    var eDate  = esc(invoice.issue_date)
    var eDue   = esc(dateValue)
    var eName  = esc(invoice.client_name)
    var eAddr  = invoice.client_address ? '{\\small ' + esc(invoice.client_address) + '}\\\\\n' : ''
    var eEmail = invoice.client_email   ? '{\\small ' + esc(invoice.client_email)   + '}\\\\\n' : ''

    var cAccent    = hex(brand.dark_colour, '0B0A09')
    var cHighlight = hex(brand.accent_colour, 'D37835')

    var logo = brand.logo_file || 'kvk_logo2.png'
    var sig  = brand.signature_file || ''

    /* optional VAT row */
    var vatRow = Number(invoice.vat_pct) > 0
      ? '  \\small VAT (' + Number(invoice.vat_pct) + '\\%) & \\small R\\ ' + money(vat) + ' \\\\[1.5mm]\n'
      : ''

    /* payment details, invoices only */
    var payBlock = isQuote ? '' :
      '{\\color{highlight}\\textbf{\\small PAYMENT DETAILS}}\\\\[0.8mm]\n' +
      '{\\color{highlight}\\rule{48mm}{0.8pt}}\\\\[1.5mm]\n' +
      '{\\small\n' +
      '\\begin{tabular}{@{}ll@{}}\n' +
      '  Bank:          & ' + esc(brand.bank_name)    + ' \\\\[0.8mm]\n' +
      '  Account Name:  & ' + esc(brand.account_name) + ' \\\\[0.8mm]\n' +
      '  Account No.:   & ' + esc(brand.account_no)   + ' \\\\[0.8mm]\n' +
      '  Branch Code:   & ' + esc(brand.branch_code)  + ' \\\\[0.8mm]\n' +
      '  Reference:     & ' + eNo + ' \\\\\n' +
      '\\end{tabular}\n' +
      '}\n\n'

    /* signature, falls back to a blank rule when the file is missing */
    var sigImage = sig
      ? '  \\IfFileExists{' + sig + '}{%\n' +
        '    \\includegraphics[width=45mm, height=14mm, keepaspectratio]{' + sig + '}%\n' +
        '  }{\\rule{0pt}{14mm}} \\\\[1mm]\n'
      : '  \\rule{0pt}{14mm} \\\\[1mm]\n'

    return '' +
'\\documentclass[a4paper,9pt]{article}\n\n' +
'\\usepackage[a4paper, top=0mm, bottom=0mm, left=0mm, right=0mm]{geometry}\n' +
'\\usepackage{xcolor}\n' +
'\\usepackage{tabularx}\n' +
'\\usepackage{fontenc}\n' +
'\\usepackage{helvet}\n' +
'\\usepackage{graphicx}\n' +
'\\usepackage{array}\n' +
'\\usepackage{colortbl}\n' +
'\\usepackage{tikz}\n' +
'\\usepackage{multirow}\n' +
'\\usepackage{amssymb}\n\n' +
'\\renewcommand{\\familydefault}{\\sfdefault}\n\n' +
'\\definecolor{accent}{HTML}{' + cAccent + '}\n' +
'\\definecolor{highlight}{HTML}{' + cHighlight + '}\n' +
'\\definecolor{darktext}{HTML}{24211F}\n' +
'\\definecolor{lightgrey}{HTML}{F7F0E6}\n' +
'\\definecolor{midgrey}{HTML}{75726C}\n\n' +
'\\pagestyle{empty}\n' +
'\\setlength{\\parindent}{0pt}\n\n' +
'\\newcolumntype{M}[1]{>{\\centering\\arraybackslash}m{#1}}\n' +
'\\newcolumntype{L}{>{\\raggedright\\arraybackslash}m{\\dimexpr\\linewidth-8mm\\relax}}\n\n' +
'\\begin{document}\n\n' +

'% ---------- PAGE 1 ----------\n\n' +
'\\begin{tikzpicture}[remember picture, overlay]\n' +
'  \\fill[accent] (current page.north west) rectangle ([yshift=-38mm]current page.north east);\n\n' +
'  \\IfFileExists{' + logo + '}{%\n' +
'    \\node[anchor=north west] at ([xshift=12mm, yshift=-3mm]current page.north west)\n' +
'      {\\includegraphics[width=38mm, height=30mm, keepaspectratio]{' + logo + '}};\n' +
'  }{}%\n\n' +
'  \\node[white, font=\\bfseries\\large, anchor=east] at\n' +
'    ([xshift=-18mm, yshift=-15mm]current page.north east)\n' +
'    {' + esc(brand.display_name) + '};\n' +
'  \\node[white, font=\\small, anchor=east] at\n' +
'    ([xshift=-18mm, yshift=-22mm]current page.north east)\n' +
'    {' + esc(brand.tagline) + '};\n' +
'\\end{tikzpicture}\n\n' +
'\\vspace{38mm}\n\n' +
'\\hspace{18mm}%\n' +
'\\begin{minipage}[t]{170mm}\n\n' +
'\\vspace{3mm}\n' +
'\\begin{minipage}[t]{0.55\\linewidth}\n' +
'  {\\color{darktext}\\fontsize{22}{26}\\selectfont\\textbf{' + docTitle + '}}\n' +
'\\end{minipage}%\n' +
'\\begin{minipage}[t]{0.44\\linewidth}\n' +
'  \\raggedleft\n' +
'  \\begin{tabular}{@{}ll@{}}\n' +
'    {\\color{midgrey}\\scriptsize ' + numLabel  + '} & \\textbf{' + eNo   + '} \\\\[0.5mm]\n' +
'    {\\color{midgrey}\\scriptsize DATE}                & \\textbf{' + eDate + '} \\\\[0.5mm]\n' +
'    {\\color{midgrey}\\scriptsize ' + dateLabel + '} & \\textbf{' + eDue  + '} \\\\\n' +
'  \\end{tabular}\n' +
'\\end{minipage}\n\n' +
'\\vspace{1mm}\n' +
'{\\color{highlight}\\rule{\\linewidth}{1.2pt}}\n' +
'\\vspace{3mm}\n\n' +
'{\\color{midgrey}\\scriptsize BILLED TO}\\\\[0.8mm]\n' +
'{\\normalsize\\textbf{' + eName + '}}\\\\[0.5mm]\n' +
eAddr + eEmail +
'\n\\vspace{4mm}\n\n' +
'\\renewcommand{\\arraystretch}{1.5}\n\n' +
'\\begin{tabularx}{\\linewidth}{>{\\raggedright\\arraybackslash}X\n' +
'                              >{\\centering\\arraybackslash}p{13mm}\n' +
'                              >{\\centering\\arraybackslash}p{18mm}\n' +
'                              >{\\raggedleft\\arraybackslash}p{21mm}}\n\n' +
'  \\rowcolor{accent}\n' +
'  \\color{white}\\textbf{\\small DESCRIPTION} &\n' +
'  \\color{white}\\textbf{\\small QTY} &\n' +
'  \\color{white}\\textbf{\\small RATE (R)} &\n' +
'  \\color{white}\\textbf{\\small AMOUNT (R)} \\\\\n\n' +
lineRows(items) +
'\\end{tabularx}\n\n' +
'\\vspace{3mm}\n\n' +
'\\begin{flushright}\n' +
'\\begin{tabular}{@{}lr@{}}\n' +
'  \\small Subtotal & \\small R\\ ' + money(sub) + ' \\\\[0.8mm]\n' +
'  \\small Discount (' + Number(invoice.discount_pct || 0) + '\\%) & \\small -R\\ ' + money(disc) + ' \\\\[1.5mm]\n' +
vatRow +
'  \\rowcolor{accent}\n' +
'  \\color{white}\\textbf{\\small ' + (isQuote ? 'TOTAL' : 'TOTAL DUE') + '} & ' +
'\\color{white}\\textbf{\\small R\\ ' + money(tot) + '} \\\\\n' +
'\\end{tabular}\n' +
'\\end{flushright}\n\n' +
'\\vspace{4mm}\n\n' +
payBlock +
'\\end{minipage}\n\n' +
'\\vspace*{\\fill}\n' +
'\\vspace{10mm}\n\n' +

'% ---------- PAGE 2 ----------\n\n' +
'\\newpage\n\n' +
'\\begin{tikzpicture}[remember picture, overlay]\n' +
'  \\fill[accent] (current page.south west) rectangle ([yshift=10mm]current page.south east);\n' +
'  \\node[white, font=\\small] at ([yshift=5mm]current page.south)\n' +
'    {' + esc(brand.footer_text) + '};\n' +
'\\end{tikzpicture}\n\n' +
'\\vspace{10mm}\n\n' +
'\\hspace{18mm}%\n' +
'\\begin{minipage}[t]{170mm}\n\n' +
'\\vspace{3mm}\n' +
'{\\color{darktext}\\fontsize{22}{26}\\selectfont\\textbf{SCOPE OF WORK}}\\\\[1mm]\n' +
'{\\color{midgrey}\\small ' + (isQuote ? 'Quote' : 'Invoice') + ' ' + eNo +
'\\ $\\bullet$ \\ ' + eName + ' \\ $\\bullet$ \\ ' + eDate + '}\n\n' +
'\\vspace{1mm}\n' +
'{\\color{highlight}\\rule{\\linewidth}{1.2pt}}\n' +
'\\vspace{3mm}\n\n' +
'\\renewcommand{\\arraystretch}{1.5}\n' +
scopeBlock('WHAT YOU WILL RECEIVE', receive, 'number') +
scopeBlock('PRODUCTION COMMITMENTS', commit, 'check') +
scopeBlock('NOT INCLUDED', exclude, 'cross') +
'\\vspace{0.5mm}\n\n' +
'{\\color{highlight}\\textbf{\\small PORTFOLIO \\& CREDIT}}\\\\[0.5mm]\n' +
'{\\color{highlight}\\rule{60mm}{0.8pt}}\\\\[1.5mm]\n' +
'{\\small ' + esc(invoice.portfolio_text || brand.default_portfolio_text) + '}\n\n' +
'\\vspace{4mm}\n\n' +
'{\\color{highlight}\\textbf{\\small ACCEPTANCE}}\\\\[0.5mm]\n' +
'{\\color{highlight}\\rule{60mm}{0.8pt}}\\\\[1.5mm]\n' +
'{\\small ' + esc(invoice.acceptance_text || brand.default_acceptance_text) + '}\n\n' +
'\\vspace{5mm}\n' +
'\\begin{tabular}{@{}p{70mm}@{}}\n' +
'  \\small \\textbf{' + (brand.signature_name || '') + '} \\\\[1mm]\n' +
sigImage +
'  \\hrule \\\\[1mm]\n' +
'  \\small Signature \\\\ ' + eDate + ' \\\\\n' +
'\\end{tabular}\n' +
'\\end{minipage}\n\n' +
'\\vspace*{\\fill}\n\n' +
'\\end{document}\n'
  }

  return { buildTex: buildTex, esc: esc, money: money }
}))
