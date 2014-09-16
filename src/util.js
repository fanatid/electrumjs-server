var crypto = require('crypto')


/**
 * @param {Buffer} data
 * @return {Buffer}
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest()
}

/**
 * Calculate double sha256 hash
 *
 * @param {Buffer} data
 * @return {Buffer}
 */
function hash256(data) {
  return sha256(sha256(data))
}

/**
 * @param {Buffer} s
 * @return {string}
 */
function hashEncode(s) {
  return Array.prototype.reverse.call(new Buffer(s)).toString('hex')
}

/**
 * @param {string} s
 * @return {Buffer}
 */
function hashDecode(s) {
  return Array.prototype.reverse.call(new Buffer(s, 'hex'))
}

/**
 * Revert bytes order
 *
 * @param {string} s
 * @return {string}
 */
function revHex(s) {
  return hashDecode(s).toString('hex')
}

/**
 * @typedef {Object} BitcoinBlock
 * @param {number} block.version
 * @param {string} block.previousblockhash
 * @param {string} block.merkleroot
 * @param {number} block.time
 * @param {string} block.bits
 * @param {number} block.nonce
 */

/**
 * Convert bitcoin block to raw header (80bytes Buffer)
 * @param {BitcoinBlock} block
 * @return {Buffer}
 */
function block2rawHeader(block) {
  var result = new Buffer(80)

  result.writeUInt32LE(block.version, 0)
  result.write(revHex(block.previousblockhash), 4, 32, 'hex')
  result.write(revHex(block.merkleroot), 36, 32, 'hex')
  result.writeUInt32LE(block.time, 68)
  result.write(revHex(block.bits), 72, 4, 'hex')
  result.writeUInt32LE(block.nonce, 76)

  return result
}

/**
 * Convert raw header to bitcoin block
 *
 * @param {Buffer} rawHeader
 * @return {BitcoinBlock}
 */
function rawHeader2block(rawHeader) {
  var block = {
    version: rawHeader.readUInt32LE(0),
    previousblockhash: revHex(rawHeader.slice(4, 36).toString('hex')),
    merkleroot: revHex(rawHeader.slice(36, 68).toString('hex')),
    time: rawHeader.readUInt32LE(68),
    bits: revHex(rawHeader.slice(72, 76).toString('hex')),
    nonce: rawHeader.readUInt32LE(76)
  }

  return block
}


module.exports = {
  Set: require('set'),

  sha256: sha256,
  hash256: hash256,
  hashEncode: hashEncode,
  hashDecode: hashDecode,

  block2rawHeader: block2rawHeader,
  rawHeader2block: rawHeader2block
}
