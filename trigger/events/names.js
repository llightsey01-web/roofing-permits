import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { EVENT_NAMES } = require('../../lib/workflow/constants.js')

export { EVENT_NAMES }
export default EVENT_NAMES
