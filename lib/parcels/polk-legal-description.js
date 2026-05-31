// lib/parcels/polk-legal-description.js
// Resolve Polk County legal descriptions from portal DOM or Property Appraiser fallback

const POLK_PA_LEGAL_DESC_URL = 'https://www.polkflpa.gov/LegalDesc.aspx?strap='
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

function normalizeParcelNumber(parcelNumber) {
  return String(parcelNumber || '').replace(/\D/g, '')
}

function parseLegalDescriptionFromAppraiserHtml(html) {
  var match = html.match(/Property Description:<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  if (match && match[1]) return match[1].trim()
  return ''
}

async function lookupPolkLegalDescriptionFromAppraiser(parcelNumber) {
  var strap = normalizeParcelNumber(parcelNumber)
  if (!strap) return ''

  var url = POLK_PA_LEGAL_DESC_URL + encodeURIComponent(strap)
  var res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error('Polk Property Appraiser legal description lookup failed: HTTP ' + res.status)
  }

  var html = await res.text()
  return parseLegalDescriptionFromAppraiserHtml(html)
}

async function readLegalDescriptionFromPortal(page, selectors) {
  return page.evaluate(function(sels) {
    function fieldVal(sel) {
      var el = document.querySelector(sel)
      return el ? (el.value || el.innerText || '').trim() : ''
    }

    var legal = fieldVal(sels.legalDescription)
    if (legal) return { source: 'portal_legal_field', legalDescription: legal }

    var lot = fieldVal(sels.lot)
    var block = fieldVal(sels.block)
    var tract = fieldVal(sels.tract)
    var subdivision = fieldVal(sels.subdivision)
    var parts = []
    if (subdivision) parts.push(subdivision)
    if (tract) parts.push('TRACT ' + tract)
    if (block) parts.push('BLK ' + block)
    if (lot) parts.push('LOT ' + lot)
    if (parts.length) return { source: 'portal_lot_block', legalDescription: parts.join(' ') }

    return { source: null, legalDescription: '' }
  }, selectors)
}

async function resolvePolkLegalDescription(page, parcelNumber, selectors) {
  var result = await readLegalDescriptionFromPortal(page, selectors)
  if (result.legalDescription) return result

  var legalDescription = await lookupPolkLegalDescriptionFromAppraiser(parcelNumber)
  if (legalDescription) {
    return { source: 'polk_property_appraiser', legalDescription: legalDescription }
  }

  return { source: null, legalDescription: '' }
}

module.exports = {
  lookupPolkLegalDescriptionFromAppraiser,
  readLegalDescriptionFromPortal,
  resolvePolkLegalDescription,
}
