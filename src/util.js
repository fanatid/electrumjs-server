var crypto = require('crypto')

var bitcoin = require('bitcoinjs-lib')
var Address = bitcoin.Address
var ECPubKey = bitcoin.ECPubKey
var _ = require('lodash')
var Q = require('q')

var logger = require('./logger').logger


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
 * @param {bitcoin.Client} bitcoinClient
 * @param {string} blockHash
 * @return {Q.Promise}
 */
function getFullBlock(bitcoinClient, blockHash) {
  var st = process.hrtime()

  return Q.ninvoke(bitcoinClient, 'cmd', 'getblock', blockHash).spread(function(block) {
    if (block.height === 0) {
      block.tx = []
      block.previousblockhash = '0000000000000000000000000000000000000000000000000000000000000000'
      return block
    }

    var deferred = Q.defer()

    var batch = block.tx.map(function(txId) {
      return { method: 'getrawtransaction', params: [txId] }
    })

    block.tx = []
    bitcoinClient.cmd(batch, function(error, rawTx) {
      if (error)
        return deferred.reject(error)

      block.tx.push(bitcoin.Transaction.fromHex(rawTx))
      if (block.tx.length === batch.length)
        return deferred.resolve(block)
    })

    return deferred.promise

  }).then(function(block) {
    logger.verbose('getFullBlock #%s, %sms', block.height, spendTime(st))
    return block

  })
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


/**
 * @param {bitcoinjs-lib.Script} script
 * @param {Object} network
 * @param {number} network.pubKeyHash
 * @param {number} network.scriptHash
 * @return {string[]}
 */
function getAddressesFromOutputScript(script, network) {
  var addresses = []

  switch (bitcoin.scripts.classifyOutput(script)) {
    case 'pubkeyhash':
      addresses = [new Address(script.chunks[2], network.pubKeyHash)]
      break

    case 'pubkey':
      addresses = [ECPubKey.fromBuffer(script.chunks[0]).getAddress(network)]
      break

    case 'multisig':
      addresses = script.chunks.slice(1, -2).map(function(pubKey) {
        return ECPubKey.fromBuffer(pubKey).getAddress(network)
      })
      break

    case 'scripthash':
      addresses = [new Address(script.chunks[1], network.scriptHash)]
      break

    default:
      break
  }

  return addresses.map(function(addr) { return addr.toBase58Check() })
}


module.exports = {
  Set: require('set'),
  spendTime: spendTime,

  sha256: sha256,
  hash256: hash256,
  hashEncode: hashEncode,
  hashDecode: hashDecode,

  getFullBlock: getFullBlock,
  block2rawHeader: block2rawHeader,
  rawHeader2block: rawHeader2block,

  getAddressesFromOutputScript: getAddressesFromOutputScript
}
