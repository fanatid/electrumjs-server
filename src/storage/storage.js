/**
 * @class Storage
 */
function Storage() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.initialize = function() {}

/**
 * @abstract
 * @param {string} header
 * @param {number} [height]
 * @return {Q.Promise}
 */
Storage.prototype.pushHeader = function() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.popHeader = function() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Storage.prototype.getAllHeaders = function() {}

/**
 * @abstract
 * @param {string} address
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {number} cValue
 * @param {number} cHeight
 * @return {Q.Promise}
 */
Storage.prototype.addCoin = function() {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.removeCoin = function() {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @param {string} sTxId
 * @param {number} sHeight
 * @return {Q.Promise}
 */
Storage.prototype.setSpent = function() {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 */
Storage.prototype.setUnspent = function() {}

/**
 * @abstract
 * @param {string} cTxId
 * @param {number} cIndex
 * @return {Q.Promise}
 */
Storage.prototype.getAddress = function() {}

/**
 * @abstract
 * @param {string} address
 * @return {Q.Promise}
 */
Storage.prototype.getCoins = function() {}


module.exports = Storage
