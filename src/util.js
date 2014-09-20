var crypto = require('crypto')

var _ = require('lodash')


/**
 * @param {bitcoinjs-lib.Transaction[]}
 * @param {bitcoinjs-lib.Transaction[][]}
 */
function groupTransactions(transactions) {
  var transactionsIds = _.zipObject(transactions.map(function(tx) { return [tx.getId(), tx] }))
  var resultIds = {}
  var result = []

  function sort(tx, topTx, level) {
    if (!_.isUndefined(resultIds[tx.getId()]))
      return

    tx.ins.forEach(function(input) {
      var inputId = Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex')
      if (_.isUndefined(transactionsIds[inputId]))
        return

      if (transactionsIds[inputId].getId() === topTx.getId())
        throw new Error('graph is cyclical')

      sort(transactionsIds[inputId], tx, level+1)
    })

    resultIds[tx.getId()] = true
    result[result.length - 1].push(tx)
    if (level === 0 && result.length > 1)
      result[result.length - 1].reverse()
  }

  transactions.forEach(function(tx) {
    result.push([])
    sort(tx, tx, 0)
  })

  return result
}

/**
 * @param {number[]} prevTime
 * @return {number}
 */
function spendTime(prevTime) {
  var tm = process.hrtime(prevTime)
  return tm[0]*1000 + tm[1]/1000000
}

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

  groupTransactions: groupTransactions,
  spendTime: spendTime,

  sha256: sha256,
  hash256: hash256,
  hashEncode: hashEncode,
  hashDecode: hashDecode,

  block2rawHeader: block2rawHeader,
  rawHeader2block: rawHeader2block
}
