// lib/erecord/index.js

module.exports = {
  ...require('./constants'),
  ...require('./service'),
  ...require('./registry'),
  ...require('./recording-payload'),
  ...require('./job-specs'),
  ...require('./provider'),
}
