var inherits = require('util').inherits

var base58check = require('bs58check')
var config = require('config')
var _ = require('lodash')
var MongoClient = require('mongodb').MongoClient
var Q = require('q')

var Storage = require('./storage')
var storageVersion = require('../version').storage.mongo


/**
 * @class MongoStorage
 */
function MongoStorage() {
  Storage.call(this)

  this._isInialized = false
}

inherits(MongoStorage, Storage)

/**
 * @return {Q.Promise}
 */
MongoStorage.prototype.initialize = function() {
  var self = this
  if (self._isInialized)
    return Q()

  self._isInialized = true

  var deferred = Q.defer()
  Q.spawn(function* () {
    try {
      var serverNetwork = config.get('server.network')

      /** connect to db */
      self.db = yield Q.ninvoke(MongoClient, 'connect', config.get('mongo.url'))

      var collection = yield Q.ninvoke(self.db, 'createCollection', 'info', { max: 1 })
      var row = yield Q.ninvoke(collection, 'findOne')
      if (row === null) {
        yield Q.ninvoke(collection, 'insert', { network: serverNetwork, version: storageVersion })
        row = yield Q.ninvoke(collection, 'findOne')
      }

      if (row.network !== serverNetwork)
        throw new Error('Server network is ' + serverNetwork + ', whereas db network is ' + row.network)
      if (row.version !== storageVersion)
        throw new Error('Storage version is ' + storageVersion + ', whereas db version is ' + row.version)

      self.headers = yield Q.ninvoke(self.db, 'createCollection', 'headers')
      yield Q.ninvoke(self.headers, 'ensureIndex', 'height', { unique: true })

      self.history = yield Q.ninvoke(self.db, 'createCollection', 'history')
      yield Q.ninvoke(self.history, 'ensureIndex', 'address')
      yield Q.ninvoke(self.history, 'ensureIndex', { cTxId: 1, cIndex: 1 })

      /** done */
      console.log('Storage (MongoDB) created')
      deferred.resolve()

    } catch (error) {
      deferred.reject(error)

    }
  })

  return deferred.promise
}

/**
 * @param {string} header
 * @param {number} height
 * @return {Q.Promise}
 */
MongoStorage.prototype.pushHeader = function(header, height) {
  var doc = {
    header: new Buffer(header, 'hex'),
    height: height
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
  return Q.ninvoke(this.headers.find().sort({ height: 1 }), 'toArray').then(function(rows) {
    return rows.map(function(row) { return row.header.toString('hex') })
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
    address: base58check.decode(address),
    cTxId:   new Buffer(cTxId, 'hex'),
    cIndex:  cIndex,
    cValue:  cValue,
    cHeight: cHeight
  }

  return Q.ninvoke(this.history, 'insert', doc)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
MongoStorage.prototype.removeCoin = function(cTxId, cIndex) {
  var query = {
    cTxId: new Buffer(cTxId, 'hex'),
    cIndex: cIndex
  }

  return Q.ninvoke(this.history, 'remove', query)
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sHeight
 * @return {Q.Promise}
 */
MongoStorage.prototype.setSpent = function(cTxId, cIndex, sTxId, sHeight) {
  var query = {
    cTxId: new Buffer(cTxId, 'hex'),
    cIndex: cIndex
  }
  var newFields = {
    sTxId: new Buffer(sTxId, 'hex'),
    sHeight: sHeight
  }

  return Q.ninvoke(this.history, 'update', query, { $set: newFields })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 */
MongoStorage.prototype.setUnspent = function(cTxId, cIndex) {
  var query = {
    cTxId: new Buffer(cTxId, 'hex'),
    cIndex: cIndex
  }

  return Q.ninvoke(this.history, 'update', query, { $unset: { sTxId: '', sHeight: '' } })
}

/**
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
MongoStorage.prototype.getAddress = function(cTxId, cIndex) {
  var query = {
    cTxId: new Buffer(cTxId, 'hex'),
    cIndex: cIndex
  }

  return Q.ninvoke(this.history, 'findOne', query).then(function(doc) {
    if (doc === null)
      return null

    return base58check.encode(doc.address.buffer)
  })
}

/**
 * @param {string} address
 * @return {Q.Promise}
 */
MongoStorage.prototype.getCoins = function(address) {
  var query = { address: base58check.decode(address) }

  return Q.ninvoke(this.history.find(query), 'toArray').then(function(rows) {
    function row2history(row) {
      var obj = {
        cTxId: row.cTxId.toString('hex'),
        cIndex: row.cIndex,
        cValue: row.cValue,
        cHeight: row.cHeight,
        sTxId: null,
        sHeight: null
      }

      if (!_.isUndefined(row.sTxId))
        obj = _.extend(obj, { sTxId: row.sTxId.toString('hex'), sHeight: row.sHeight })

      return obj
    }

    return rows.map(row2history)
  })
}


module.exports = MongoStorage
