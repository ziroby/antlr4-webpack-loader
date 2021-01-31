var tmp = require('tmp');
var path = require('path');
var fs = require('fs');
var spawn = require('child_process').spawn;
var webpack = require('webpack');

antlrJar = path.resolve(__dirname, 'antlr-4.9.1-complete.jar');

antlrArgs = [
  '-Dlanguage=JavaScript',
  '-visitor'
];

module.exports.raw = true;
module.exports = function (grammar) {
  var callback = this.async();
  var grammarName = extractGrammarName(grammar) || this.emitError('Grammar is not named');
  createTempGrammarFile(grammarName, grammar, function (err, outputDir, grammarFile, cleanup) {
    if (err) { return callback(err); }
    runAntlr(grammarFile, outputDir, function (err) {
      if (err) { return callback(err); }
      compileAntlr(grammarName, outputDir, callback);
    });
  });
};

function extractGrammarName(grammar) {
  var matches = /grammar\s+(\w+)\s*;/i.exec(grammar);
  return matches && matches[1];
}

function createTempGrammarFile(grammarName, grammarData, callback) {
  tmp.dir(function (err, tmpDir, cleanup) {
    if (err) { return callback(err); }
    var grammarFile = path.resolve(tmpDir, grammarName + '.g4');
    fs.writeFile(grammarFile, grammarData, function (err) {
      if (err) { return callback(err); }
      callback(null, tmpDir, grammarFile, function () {
        fs.unlink(grammarFile, cleanup);
      });
    });
  });
}

function runAntlr(grammarFile, outputDir, callback) {
  var antlr = spawn('java', ['-jar', antlrJar, '-o', outputDir, grammarFile].concat(antlrArgs), {
    stdio: [ 'ignore', process.stdout, process.stderr ]
  });
  antlr.on('error', callback);
  antlr.on('exit', function (code, signal) {
    if (code) { return callback(new Error('ANTLR exited with code ' + code)); }
    if (signal) { return callback(new Error('ANTLR exited with signal ' + signal)); }
    callback(null);
  });
}

function compileAntlr(name, workingDir, callback) {
  fs.readdir(workingDir, function (err, files) {
    if (err) { callback(err); }
    var jsfiles = files
        .filter(function (file) { return path.extname(file) === '.js'; })
        .map(function (jsfile) { return path.basename(jsfile, '.js'); })
    var imports = jsfiles
      .map(function (name) { return 'import ' + name + ' from \'./' + name + '\''; })
      .join(';\n') + ';\n\n';
    var exports = jsfiles
      .map(function (name) { return name; })
      .join(',\n');
    var indexData = imports + 'export {\n' + exports + '\n};\n';
    var indexFile = path.resolve(workingDir, 'index.js');

    fs.writeFile(indexFile, indexData, function (err) {
      if (err) { return callback(err); }
      webpack({
        entry: indexFile,
        output: {
          path: path.resolve(workingDir),
          filename: 'bundle.js',
//          library: name,
          libraryTarget: 'commonjs2'
        },
        externals: [ 'antlr4' ],
        module: {
        rules: [
            {
                test: /\.m?js$/,
                exclude: /(node_modules|bower_components)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                      presets: ['@babel/preset-env',
                      {
                        'plugins': ['@babel/plugin-proposal-class-properties']
                      }]
                    }
                }
            }
        ]},
        resolve: { fallback: { fs: false } }
      }, function (err, stats) {
        if (err) { return callback(err); }
        if (stats.hasErrors()) {
          return callback(Error('Compilation of ANTLR resources failed: ' + stats.toString()));
        }

        fs.readFile(path.resolve(workingDir, 'bundle.js'), callback);
      });
    });
  });
}
