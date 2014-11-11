module.exports = function (grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      src: ['Gruntfile.js', 'src/**/*.js', 'test/**/*.js'],
      src: ['src/**/*.js'],
      options: {
        jshintrc: true,
        reporter: require('jshint-stylish')
      }
    },
    jscs: {
      src: ['Gruntfile.js', 'src/**/*.js', 'test/**/*.js'],
      options: {
        config: '.jscsrc'
      }
    },
    mochaTest: {
      test: {
        src: ['test/*.js'],
        options: {
          reporter: 'spec',
          timeout: 10000
        }
      }
    }
  })

  grunt.loadNpmTasks('grunt-contrib-jshint')
  grunt.loadNpmTasks('grunt-jscs')
  grunt.loadNpmTasks('grunt-mocha-test')

  grunt.registerTask('test', ['mochaTest'])
  grunt.registerTask('default', ['jshint', 'jscs', 'test'])
}
