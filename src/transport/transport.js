var NotImplementedError = require('../errors').NotImplementedError


/**
 * @class Transport
 * @param {Interface} interface
 */
function Transport() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Transport.prototype.initialize = function () {
  throw new NotImplementedError('Transport.initialize')
}


module.exports = Transport
