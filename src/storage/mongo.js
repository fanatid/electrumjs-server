throw new Error('mongodb not supported now')

var config = require('config')
var MongoClient = require('mongodb').MongoClient
var Q = require('q')


/**
 * @callback MongoStorage~constructor
 * @param {?Error} error
 */

/**
 * @class MongoStorage
 * @param {MongoStorage~constructor} readyCallback
 */
function MongoStorage(readyCallback) {
  var self = this

  Q.spawn(function* () {
    try {
      self.db = yield Q.ninvoke(MongoClient, 'connect', config.get('mongodb.url'))

      /** check network and storage version */
      var serverNetwork = config.get('server.network')
      var storageVersion = require('./version')

      /**
       * create info collection
       *
       * {number} version
       * {string} network
       */
      var collection = yield Q.ninvoke(self.db, 'createCollection', 'info', { max: 1 })
      var row = yield Q.ninvoke(collection, 'findOne')
 
      if (row !== null && row.network !== serverNetwork)
        throw new Error('Server network is ' + serverNetwork + ', whereas mongodb network is ' + row.network)
      if (row !== null && row.version !== storageVersion)
        throw new Error('Storage version is ' + storageVersion + ', whereas mongodb version is ' + row.version)

      if (row === null)
        yield Q.ninvoke(collection, 'insert', { network: serverNetwork, version: storageVersion })

      /**
       * create headers collection
       *
       * {number} height
       * {number} version
       * {string} previousblockhash
       * {string} merkleroot
       * {number} time
       * {number} bits
       * {number} nonce
       */
      self.headers = yield Q.ninvoke(self.db, 'createCollection', 'headers')
      /** create index for block height */
      yield Q.ninvoke(self.headers, 'ensureIndex', 'height', { unique: true })

      /**
       * create history collection
       *
       * {string} address
       * {string} cTxId
       * {number} cIndex
       * {number} cValue
       * {number} cHeight
       * {string} sTxId
       * {number} sIndex
       * {number} sHeight
       */
      self.history = yield Q.ninvoke(self.db, 'createCollection', 'history')
      /** create index for get address history */
      yield Q.ninvoke(self.history, 'ensureIndex', 'address')
      /** create index for faster scan coins */
      yield Q.ninvoke(self.history, 'ensureIndex', { cTxId: 1, cIndex: 1 })

      /** done */
      readyCallback(null)

    } catch (error) {
      readyCallback(error)

    }
  })
}

/**
 * Create new MongoStorage
 * @return {Q.Promise}
 */
MongoStorage.createMongoStorage = function() {
  return Q.Promise(function(resolve, reject) {
    var mongoStorage

    function readyCallback(error) {
      if (error === null)
        resolve(mongoStorage)
      else
        reject(error)
    }

    mongoStorage = new MongoStorage(readyCallback)
  })
}

/**
 * @param {Object} block
 * @param {number} block.height
 * @param {number} block.version
 * @param {string} block.previousblockhash
 * @param {string} block.merkleroot
 * @param {number} block.time
 * @param {number} block.bits
 * @param {number} block.nonce
 * @return {Q.Promise}
 */
MongoStorage.prototype.pushHeader = function(block) {
  var doc = {
    height: block.height,
    version: block.version,
    previousblockhash: block.previousblockhash,
    merkleroot: block.merkleroot,
    time: block.time,
    bits: block.bits,
    nonce: block.nonce
  }

  return Q.ninvoke(this.headers, 'insert', doc)
}

/**
 * @return {Q.Promise}
 */
MongoStorage.prototype.popHeader = function() {
  return Q.ninvoke(this.headers, 'findAndRemove', {}, [['height', -1]])
}

/**
 * @return {Q.Promise}
 */
MongoStorage.prototype.getAllHeaders = function() {
  return Q.ninvoke(this.headers.find().sort({ height: 1 }), 'toArray')
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
MongoStorage.prototype.getAddress = function(cTxId, cIndex) {
  var query = { cTxId: cTxId, cIndex: cIndex }

  return Q.ninvoke(this.history, 'findOne', query).then(function(doc) {
    if (doc === null)
      return null

    return doc.address
  })
}

/**
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
MongoStorage.prototype.addCoin = function(address, cTxId, cIndex, cValue, cHeight) {
  var doc = {
    address: address,
    cTxId:   cTxId,
    cIndex:  cIndex,
    cValue:  cValue,
    cHeight: cHeight,
    sTxId:   null,
    sIndex:  null,
    sHeight: null
  }

  return Q.ninvoke(this.history, 'insert', doc)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
MongoStorage.prototype.removeCoin = function(cTxId, cIndex) {
  var query = { cTxId: cTxId, cIndex: cIndex }

  return Q.ninvoke(this.history, 'remove', query)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sIndex
 * @param {number} sHeight
 * @return {Q.Promise}
 */
MongoStorage.prototype.setSpent = function(cTxId, cIndex, sTxId, sIndex, sHeight) {
  var query = { cTxId: cTxId, cIndex: cIndex }
  var update = { sTxId: sTxId, sIndex: sIndex, sHeight: sHeight }

  return Q.ninvoke(this.history, 'update', query, { $set: update })
}

/**
 * @param {string} sTxId
 * @param {number} sIndex
 */
MongoStorage.prototype.setUnspent = function(sTxId, sIndex) {
  var query = { sTxId: sTxId, sIndex: sIndex }
  var update = { sTxId: null, sIndex: null, sHeight: null }

  return Q.ninvoke(this.history, 'update', query, { $set: update })
}


module.exports = MongoStorage
