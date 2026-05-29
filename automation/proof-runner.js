require('dotenv').config({ path: '.env.local' })
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { writeFileSync, unlinkSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function removeOverlays(page) {
  await page.evaluate(function() {
    document.querySelectorAll('[class*="Modal"], [class*="overlay"], [class*="Overlay"], nav').forEach(function(el) {
      var style = window.getComputedStyle(el)
      if (style.position === 'fixed' || style.position === 'absolute') {
        el.style.pointerEvents = 'none'
      }
    })
  })
  await page.waitForTimeout(300)
}

async function login(page) {
  console.log('Logging into Proof...')
  await page.goto('https://business.proof.com/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  var emailField = await page.waitForSelector('input[type="email"]', { timeout: 10000 })
  await emailField.fill(process.env.PROOF_EMAIL)
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)
  var passwordField = await page.waitForSelector('input[type="password"]', { timeout: 10000 })
  await passwordField.fill(process.env.PROOF_PASSWORD)
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(5000)
  console.log('Logged in: ' + page.url())
}

async function startProofNotarization(jobId, job, nocPdfBytes) {
  console.log('Starting Proof notarization for job ' + jobId)
  var supabase = getSupabase()
  var browser = await chromium.launch({ headless: false, slowMo: 500 })
  var page = await browser.newPage()
  page.setDefaultTimeout(45000)
  var tempPath = join(tmpdir(), 'noc-' + jobId + '.pdf')
  writeFileSync(tempPath, Buffer.from(nocPdfBytes))

  try {
    await login(page)

    console.log('Step 2: New transaction...')
    await page.goto('https://business.proof.com/transaction/new?configId=notarization', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    console.log('Step 3: Uploading document...')
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Upload a document') })
    })
    await page.evaluate(function() {
      Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Upload a document') }).click()
    })
    await page.waitForTimeout(1000)
    var fileInput = await page.waitForSelector('input[type="file"]', { timeout: 10000 })
    await fileInput.setInputFiles(tempPath)
    console.log('Waiting for upload...')
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Add') && b.textContent.includes('document to transaction') })
    }, { timeout: 30000 })
    await page.waitForTimeout(500)
    await page.evaluate(function() {
      Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Add') && b.textContent.includes('document to transaction') }).click()
    })
    await page.waitForTimeout(2000)
    console.log('Document uploaded')

    console.log('Step 4: Opening editor...')
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Upload a document') })
    })
    await page.evaluate(function() {
      Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Upload a document') }).click()
    })
    await page.waitForTimeout(4000)
    console.log('Editor opened')

    console.log('Step 5: Clicking Sign here...')
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Sign here') && b.textContent.includes('pencil') })
    }, { timeout: 15000 })
    await page.evaluate(function() {
      Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Sign here') && b.textContent.includes('pencil') }).click()
    })
    await page.waitForTimeout(1500)
    console.log('Sign here activated')

    console.log('Step 6: Placing signature...')

    // Scroll all the way to the bottom of the document area
    await page.evaluate(function() {
      var docArea = document.querySelector('[class*="document"], [class*="Document"], [class*="editor"], [class*="Editor"]')
      if (docArea) {
        docArea.scrollTop = docArea.scrollHeight
      } else {
        window.scrollTo(0, document.body.scrollHeight)
      }
    })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'automation/logs/proof-06a-bottom.png' })

    // Now find the signature line fresh after scrolling to bottom
    var coords = await page.evaluate(function() {
      var allEls = Array.from(document.querySelectorAll('*'))
      var sigEls = allEls.filter(function(el) {
        return el.children.length === 0 && el.textContent.includes('Signature of Owner')
      })
      if (sigEls.length > 0) {
        var el = sigEls[sigEls.length - 1]
        var rect = el.getBoundingClientRect()
        console.log('Sig el rect: ' + JSON.stringify(rect))
        return { x: rect.x + 100, y: rect.y + rect.height - 5, found: true, rectY: rect.y, rectH: rect.height }
      }
      return { x: 300, y: 500, found: false }
    })

    console.log('Sig label at y:' + coords.rectY + ' clicking at y:' + Math.round(coords.y))

    // Only click if the signature line is visible on screen (y between 0 and 800)
    if (coords.y > 0 && coords.y < 800) {
      await page.mouse.click(coords.x, coords.y)
      console.log('Clicked at x:' + Math.round(coords.x) + ' y:' + Math.round(coords.y))
    } else {
      // Scroll into view and try again
      await page.evaluate(function() {
        var allEls = Array.from(document.querySelectorAll('*'))
        var sigEls = allEls.filter(function(el) {
          return el.children.length === 0 && el.textContent.includes('Signature of Owner')
        })
        if (sigEls.length > 0) {
          sigEls[sigEls.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
      await page.waitForTimeout(2000)
      var coords2 = await page.evaluate(function() {
        var allEls = Array.from(document.querySelectorAll('*'))
        var sigEls = allEls.filter(function(el) {
          return el.children.length === 0 && el.textContent.includes('Signature of Owner')
        })
        if (sigEls.length > 0) {
          var rect = sigEls[sigEls.length - 1].getBoundingClientRect()
          return { x: rect.x + 100, y: rect.y + rect.height - 5 }
        }
        return { x: 300, y: 400 }
      })
      await page.mouse.click(coords2.x, coords2.y)
      console.log('Clicked (after scroll) at x:' + Math.round(coords2.x) + ' y:' + Math.round(coords2.y))
    }

    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'automation/logs/proof-06-placed.png' })
    console.log('Signature placed')

    console.log('Step 7: Save and close...')
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Save') && b.textContent.includes('Close') })
    }, { timeout: 10000 })
    await page.evaluate(function() {
      Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Save') && b.textContent.includes('Close') }).click()
    })
    await page.waitForTimeout(3000)
    console.log('Saved and closed')

    console.log('Step 8: Filling signer info...')
    var nameParts = job.owner_name.trim().split(' ')
    var firstName = nameParts[0]
    var lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName
    await page.waitForSelector('input[name="recipients.0.firstName"]', { timeout: 10000 })
    await page.fill('input[name="recipients.0.firstName"]', firstName)
    await page.waitForTimeout(300)
    await page.fill('input[name="recipients.0.lastName"]', lastName)
    await page.waitForTimeout(300)
    if (job.owner_email) {
      await page.fill('input[name="recipients.0.emailWithRecipientId.email"]', job.owner_email)
      await page.waitForTimeout(300)
    }
    if (job.owner_phone) {
      await page.fill('input[name="recipients.0.phoneNumber"]', job.owner_phone.replace(/\D/g, ''))
      await page.waitForTimeout(300)
    }
    var smsCheckbox = await page.$('input[name="transactionSmsAuthRequired"]')
    if (smsCheckbox) {
      var isChecked = await smsCheckbox.isChecked()
      if (!isChecked) await smsCheckbox.check()
    }
    console.log('Signer info filled')

    console.log('Step 9: Sending transaction...')
    await removeOverlays(page)
    await page.waitForFunction(function() {
      return Array.from(document.querySelectorAll('button')).some(function(b) { return b.textContent.includes('Send transaction') })
    }, { timeout: 10000 }).catch(function() {})
    await page.evaluate(function() {
      var btn = Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.includes('Send transaction') })
      if (btn) btn.click()
    })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: 'automation/logs/proof-09-sent.png' })
    console.log('Final URL: ' + page.url())

    await supabase.from('jobs').update({
      noc_status: 'sent_for_notarization',
      noc_sent_at: new Date().toISOString()
    }).eq('id', jobId)

    console.log('Proof notarization sent for job ' + jobId)
    try { unlinkSync(tempPath) } catch (e) {}
    return { success: true }

  } catch (err) {
    console.error('Proof automation failed: ' + err.message)
    await page.screenshot({ path: 'automation/logs/proof-error.png' })
    await supabase.from('jobs').update({ noc_status: 'error' }).eq('id', jobId)
    try { unlinkSync(tempPath) } catch (e) {}
    throw err
  } finally {
    await browser.close()
  }
}

module.exports = { startProofNotarization }
