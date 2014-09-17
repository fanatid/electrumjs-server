module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jshint: {
      options: {
        asi: true,
        camelcase: false,
        esnext: true,
        freeze: true,
        immed: true,
        indent: 2,
        latedef: true,
        maxcomplexity: 10,
        maxlen: 120,
        noarg: true,
        noempty: true,
        nonbsp: true,
        node: true,
        nonew: true,
        undef: true,
        unused: true,
        strict: false,
        trailing: true
      },
      files: ['src']
    },
    mochaTest: {
      test: {
        src: ['test/*.js'],
        options: {
          reporter: 'spec',
          timeout: 10*1000
        }
      }
    }
  })

  grunt.loadNpmTasks('grunt-contrib-jshint')
  grunt.loadNpmTasks('grunt-mocha-test')

  grunt.registerTask('test', ['mochaTest'])
  grunt.registerTask('default', ['jshint', 'test'])
}
