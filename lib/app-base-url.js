// lib/app-base-url.js
// Shared base URL for internal automation HTTP calls (fallback when direct imports are unavailable)

function getAppBaseUrl() {
  var url =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://127.0.0.1:3000'
  return String(url).replace(/\/$/, '')
}

module.exports = { getAppBaseUrl }
