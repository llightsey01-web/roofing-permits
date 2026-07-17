'use strict'

/**
 * Delete all is_demo company data and re-seed a fresh demo environment.
 *
 * Usage: npm run seed:reset-demo
 */

require('dotenv').config({ path: '.env.local' })

const { deleteDemoData, seedDemo } = require('./seed-demo')

async function main() {
  console.log('=== Reset demo environment ===')
  await deleteDemoData()
  console.log('')
  await seedDemo()
  console.log('=== Reset complete ===')
}

main().catch(function (err) {
  console.error('seed:reset-demo failed:', err.message)
  process.exit(1)
})
