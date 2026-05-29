require('dotenv').config({ path: '.env.local' })
const { runPolkCounty } = require('./ahjs/polk-county.runner')

// Demo job data — simulates a real job from the database
const demoJob = {
  id: 'test-job-001',
  owner_name: 'ZUROWSKI KENDRA KAY',
  owner_email: 'test@example.com',
  owner_phone: '863-555-1234',
  property_address: '603 CLAYTON CIR',
  property_city: 'WINTER HAVEN',
  property_state: 'FL',
  property_zip: '33880',
  scope_of_work: 'Full re-roof replacement. Remove existing shingle roof and replace with new shingle system.',
  roof_type: 'Shingle',
  roof_specs: {
    squares: '18',
    primary_material: {
      manufacturer: 'GAF',
      product_name: 'Timberline HDZ',
      approval_number: 'FL #16876',
    },
    underlayment: {
      manufacturer: 'GAF',
      product_name: 'Feltbuster',
      approval_number: 'FL #14526',
    },
  },
  valuation: 12500,
  contractor_name: 'Demo Roofing LLC',
  contractor_license: 'CCC1234567',
  qualifier_name: 'John Demo',
  qualifier_license: 'CBC9876543',
  credentials: {
    username: process.env.POLK_COUNTY_USERNAME,
    password: process.env.POLK_COUNTY_PASSWORD,
  },
  documents: [
    { document_type: 'insurance_certificate', file_name: 'insurance.pdf', file_path: 'test/insurance.pdf' },
    { document_type: 'notice_of_commencement', file_name: 'noc.pdf', file_path: 'test/noc.pdf' },
  ],
}

const demoRunId = 'test-run-001'

console.log('========================================')
console.log('POLK COUNTY FULL AUTOMATION TEST')
console.log('========================================')
console.log('Job:', demoJob.owner_name)
console.log('Address:', demoJob.property_address, demoJob.property_city)
console.log('Run ID:', demoRunId)
console.log('========================================\n')

runPolkCounty(demoJob, demoRunId)
  .then(() => {
    console.log('\n✓ Full automation test completed successfully')
    process.exit(0)
  })
  .catch(err => {
    console.error('\n✗ Automation test failed:', err.message)
    process.exit(1)
  })