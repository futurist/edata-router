const path = require('path')

module.exports = {
  context: __dirname,
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'cheap-module-source-map',
  entry: {
    index: './src/index.jsx'
  },

  output: {
    filename: '[name].js',
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
            exclude: /(node_modules|bower_components)/,
    
            use: {
              loader: 'babel-loader',
              options: {
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
      minimize: false
  }
}