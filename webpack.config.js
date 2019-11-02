const path = require('path')
const _ = require('lodash')
const isProduction = process.env.NODE_ENV === 'production'

const baseConfig = {
  context: __dirname,
  mode: isProduction ? 'production' : 'development',
  devtool: isProduction ? 'hidden-source-map' : 'cheap-module-source-map',
  entry: {
    index: './src/index.jsx'
  },

  output: {
    filename: 'cjs.js',
    chunkFilename: '[name].js',
    path: path.resolve('dist'),
    libraryTarget: 'commonjs2',
    libraryExport: 'default'
  },

  resolve: {
    extensions: ['.js', '.jsx', '.json'],
  },

  externals: {
    react: 'react',
    'react-dom': 'react-dom',
    'react-router': 'react-router',
    'react-router-dom': 'react-router-dom'
  },

  module: {
    rules: [
        {
            test: /\.jsx?$/,
            ...!isProduction && {exclude: /(node_modules|bower_components)/},
            use: {
              loader: 'babel-loader',
              options: {
                cacheDirectory: true,
                presets: [
                  require.resolve('@babel/preset-env'),
                  require.resolve('@babel/preset-react')
                ],
                plugins: [
                //   require.resolve('babel-plugin-add-module-exports'),
                  require.resolve('@babel/plugin-proposal-class-properties'),
                  require.resolve('@babel/plugin-proposal-object-rest-spread'),
                ]
              }
            }
          }
    ]
  },
  optimization: {
      minimize: isProduction
  }
}

module.exports = !isProduction ? baseConfig : [
  baseConfig,
  _.merge(_.cloneDeep(baseConfig), {
    output: {
      filename: 'umd.js',
      libraryTarget: 'umd'
    }
  }),
]