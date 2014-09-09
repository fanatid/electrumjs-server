var crypto = require('crypto')

var _ = require('lodash')
var Q = require('q')


/**
 * @param {bitcoin.Client} bitcoind
 * @param {string} blockHash
 * @return {Q.Promise}
 */
function getFullBlock(bitcoind, blockHash) {
  return Q.ninvoke(bitcoind, 'cmd', 'getblock', blockHash).spread(function(block) {
    if (block.height === 0) {
      block.tx = []
      block.previousblockhash = '0000000000000000000000000000000000000000000000000000000000000000'
      return block
    }

    return Q.Promise(function(resolve, reject) {
      var batch = block.tx.map(function(txId) {
        return { method: 'getrawtransaction', params: [txId] }
      })

      var resultTx = []
      function callback(error, tx) {
        if (error) {
          reject(error)
          return
        }

        resultTx.push(tx)
        if (resultTx.length === batch.length) {
          block.tx = resultTx
          resolve(block)
        }
      }

      bitcoind.cmd(batch, callback)
    })
  })
}

/**
 * @param {bitcoinjs-lib.Transaction[]}
 * @return {bitcoinjs-lib.Transaction[]}
 */
function toposort(transactions) {
  var transactionsIds = _.zipObject(transactions.map(function(tx) { return [tx.getId(), tx] }))
  var result = []
  var resultIds = {}

  function sort(tx, topTx) {
    if (!_.isUndefined(resultIds[tx.getId()]))
      return

    tx.ins.forEach(function(input) {
      var inputId = Array.prototype.reverse.call(new Buffer(input.hash)).toString('hex')
      if (_.isUndefined(transactionsIds[inputId]))
        return

      if (transactionsIds[inputId].getId() === topTx.getId())
        throw new Error('graph is cyclical')

      sort(transactionsIds[inputId], tx)
    })

    result.push(tx)
    resultIds[tx.getId()] = true
  }

  transactions.forEach(function(tx) { sort(tx, tx) })

  return result
}

/**
 * Revert bytes order
 *
 * @param {string} s
 * @return {string}
 */
function revHex(s) {
  return Array.prototype.reverse.call(new Buffer(s, 'hex')).toString('hex')
}

/**
 * Convert bitcoin block to raw header (80bytes Buffer)
 *
 * @param {Object} block
 * @param {number} block.version
 * @param {string} block.previousblockhash
 * @param {string} block.merkleroot
 * @param {number} block.time
 * @param {string} block.bits
 * @param {number} block.nonce
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


module.exports = {
  getFullBlock: getFullBlock,
  toposort: toposort,

  block2rawHeader: block2rawHeader,
  hash256: hash256
}
