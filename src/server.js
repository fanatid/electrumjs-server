var _ = require('lodash')
var Q = require('q')

/** bitcoinjs-lib monkey patching */
require('./bitcoinjs-lib-patching')

/** config localtion */
process.env.NODE_CONFIG_DIR = _.isUndefined(process.env.NODE_CONFIG_DIR) ? './' : process.env.NODE_CONFIG_DIR
/** config filename */
process.env.NODE_ENV =  _.isUndefined(process.env.NODE_ENV) ? 'config' : process.env.NODE_ENV


var Blockchain = require('./blockchain')


Q.spawn(function* () {
  var blockchain = yield Blockchain.createBlockchain()
  console.log('ready')
})
