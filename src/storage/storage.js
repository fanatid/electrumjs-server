var NotImplementedError = require('../errors').NotImplementedError


/**
 * @class Storage
 */
function Storage() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.initialize = function () {
  throw new NotImplementedError('Storage.initialize')
}

/**
 * @abstract
 * @param {string} header
 * @param {number} [height]
 * @return {Q.Promise}
 */
Storage.prototype.pushHeader = function () {
  throw new NotImplementedError('Storage.pushHeader')
}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.popHeader = function () {
  throw new NotImplementedError('Storage.popHeader')
}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.getAllHeaders = function () {
  throw new NotImplementedError('Storage.getAllHeaders')
}

/**
 * @abstract
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
Storage.prototype.addCoin = function () {
  throw new NotImplementedError('Storage.addCoin')
}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.removeCoin = function () {
  throw new NotImplementedError('Storage.removeCoin')
}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sHeight
 * @return {Q.Promise}
 */
Storage.prototype.setSpent = function () {
  throw new NotImplementedError('Storage.setSpent')
}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 */
Storage.prototype.setUnspent = function () {
  throw new NotImplementedError('Storage.setUnspent')
}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.getAddresses = function () {
  throw new NotImplementedError('Storage.getAddresses')
}

/**
 * @abstract
 * @param {string} address
 * @return {Q.Promise}
 */
Storage.prototype.getCoins = function () {
  throw new NotImplementedError('Storage.getCoins')
}


module.exports = Storage
