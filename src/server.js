var _ = require('lodash')
var Q = require('q')

/** config localtion */
process.env.NODE_CONFIG_DIR = _.isUndefined(process.env.NODE_CONFIG_DIR) ? './' : process.env.NODE_CONFIG_DIR
/** config filename */
process.env.NODE_ENV = _.isUndefined(process.env.NODE_ENV) ? 'config' : process.env.NODE_ENV
/** load config */
var config = require('config')

/** bitcoinjs-lib monkey patching */
require('./bitcoinjs-lib-patching')

var logger = require('./logger').logger

var Blockchain = require('./blockchain')
var Electrum = require('./interface/electrum')


Q.spawn(function* () {
  try {
    if (!_.isUndefined(global.gc))
      setInterval(global.gc, 10*1000)

    var blockchain = new Blockchain()
    yield blockchain.initialize()

    var promises = config.get('server.interface').map(function(configInterface) {
      switch (configInterface) {
        case 'electrum':
          return new Electrum(blockchain).initialize()

        default:
          throw new Error('Unknow interface')
      }
    })

    if (promises.length === 0)
      throw new Error('Interfaces not found')

    yield Q.all(promises)
    logger.info('Server ready')

  } catch (error) {
    logger.error(error)
    process.kill(process.pid, 'SIGINT') // wait blockchain

  }
})
