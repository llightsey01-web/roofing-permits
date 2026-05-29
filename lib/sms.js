// lib/sms.js
// Sends SMS notifications via Twilio
// Used for NOC signing requests and status updates

import twilio from 'twilio'

function getTwilioClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  )
}

export async function sendSMS(toPhone, message) {
  const client = getTwilioClient()

  // Clean phone number — ensure it has country code
  const formattedPhone = toPhone.startsWith('+')
    ? toPhone
    : `+1${toPhone.replace(/\D/g, '')}`

  const result = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: formattedPhone,
  })

  console.log(`✓ SMS sent to ${formattedPhone} — SID: ${result.sid}`)
  return result
}

export async function sendNOCSigningRequest(ownerName, ownerPhone, propertyAddress, signingUrl) {
  const firstName = ownerName.split(' ')[0]
  const message = `Hi ${firstName}, your Notice of Commencement for ${propertyAddress} is ready to sign. It takes less than 2 minutes: ${signingUrl}`
  return sendSMS(ownerPhone, message)
}

export async function sendNOCReminder(ownerName, ownerPhone, propertyAddress, signingUrl) {
  const firstName = ownerName.split(' ')[0]
  const message = `Reminder: Your Notice of Commencement for ${propertyAddress} still needs your signature. Please sign here: ${signingUrl}`
  return sendSMS(ownerPhone, message)
}

export async function sendNOCRecorded(ownerName, ownerPhone, propertyAddress) {
  const firstName = ownerName.split(' ')[0]
  const message = `Hi ${firstName}, your Notice of Commencement for ${propertyAddress} has been recorded with the county. Your permit application is moving forward.`
  return sendSMS(ownerPhone, message)
}