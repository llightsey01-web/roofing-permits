import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured')
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)')
  }
  return key
}

/**
 * Encrypt plaintext with AES-256-GCM. Returns base64(iv + authTag + ciphertext).
 */
export function encryptCredential(plaintext) {
  if (plaintext == null || plaintext === '') {
    throw new Error('Cannot encrypt empty credential')
  }

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt value produced by encryptCredential. Server-side only.
 */
export function decryptCredential(encryptedBase64) {
  if (!encryptedBase64) {
    throw new Error('Cannot decrypt empty credential')
  }

  const key = getEncryptionKey()
  const data = Buffer.from(encryptedBase64, 'base64')

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted credential format')
  }

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

export function isEncryptionConfigured() {
  return Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY)
}
