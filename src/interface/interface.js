var NotImplementedError = require('../errors').NotImplementedError


/**
 * @class Interface
 * @param {Blockchain} blockchain
 */
function Interface() {}

/**
 * @abstract
 * @return {Q.Promise}
 */
Interface.prototype.initialize = function () {
  throw new NotImplementedError('Interface.initialize')
}

/**
 * @abstract
 * @param {Client} Client
 */
Interface.prototype.newClient = function () {
  throw new NotImplementedError('Interface.newClient')
}


module.exports = Interface
