// lib/proof/transaction-setup.js
// Set Proof transaction title and signer message during send

async function tryFillFirstMatchingSelector(page, selectors, value) {
  for (var i = 0; i < selectors.length; i++) {
    var el = await page.$(selectors[i])
    if (!el) continue
    try {
      await el.fill(value)
      return selectors[i]
    } catch (e) {}
  }
  return null
}

async function configureProofTransactionIdentity(page, identity) {
  if (!identity || !identity.expected_transaction_title) return { titleSet: false }

  console.log('Setting Proof transaction title: ' + identity.expected_transaction_title)

  await page.evaluate(function() {
    var candidates = Array.from(document.querySelectorAll('button, a, span, div, h1, h2'))
    var titleEl = candidates.find(function(el) {
      return /untitled transaction/i.test((el.textContent || '').trim())
    })
    if (titleEl) titleEl.click()
  })
  await page.waitForTimeout(700)

  var titleSelector = await tryFillFirstMatchingSelector(page, [
    'input[name*="transaction" i]',
    'input[aria-label*="transaction" i]',
    'input[placeholder*="transaction" i]',
    'input[type="text"]',
  ], identity.expected_transaction_title)

  if (titleSelector) {
    await page.keyboard.press('Enter').catch(function() {})
    await page.waitForTimeout(500)
    return { titleSet: true, titleSelector: titleSelector }
  }

  return { titleSet: false }
}

async function fillSignerMessage(page, message) {
  if (!message) return { messageSet: false }

  console.log('Setting Proof signer message/notes')

  var selector = await tryFillFirstMatchingSelector(page, [
    'textarea[name*="message" i]',
    'textarea[name*="note" i]',
    'textarea[placeholder*="message" i]',
    'textarea[placeholder*="note" i]',
    'textarea',
  ], message)

  return { messageSet: !!selector, messageSelector: selector || null }
}

module.exports = {
  configureProofTransactionIdentity,
  fillSignerMessage,
}
