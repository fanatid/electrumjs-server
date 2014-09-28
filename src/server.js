var path = require('path')

var _ = require('lodash')
var Q = require('q')

var optimist = require('optimist')
  .usage('Usage: $0 [-h] [-c CONFIG]')
  .options('c', {
    alias: 'config',
    describe: 'configuration file',
    default: 'config.yml'
  })
  .options('h', {
    alias: 'help',
    describe: 'show this help',
    default: false
  })

var argv = optimist.argv
if (argv.help) {
  optimist.showHelp()
  process.exit(0)
}

/** config localtion */
if (_.isUndefined(process.env.NODE_CONFIG_DIR))
  process.env.NODE_CONFIG_DIR = path.dirname(path.resolve(argv.config))
/** config filename */
if (_.isUndefined(process.env.NODE_ENV))
  process.env.NODE_ENV = argv.config.slice(0, argv.config.length - path.extname(argv.config).length)

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
