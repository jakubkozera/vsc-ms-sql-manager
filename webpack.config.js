//@ts-check

'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node', // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
    msnodesqlv8: 'commonjs msnodesqlv8' // msnodesqlv8 contains native binary modules that cannot be bundled
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /webview[\\/]sqlEditor-react/],
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'webview',
          to: 'webview',
          // Exclude sqlNotebook source/tooling files — only its Vite-built
          // dist/ subfolder is needed at runtime. node_modules alone is 100 MB+.
          filter: (resourcePath) => {
            const normalized = resourcePath.replace(/\\/g, '/');
            if (normalized.includes('/sqlEditor/')) {
              return false;
            }
            // For React sub-projects that have their own node_modules and src,
            // only the Vite/webpack-built dist/ subfolder is needed at runtime.
            const reactProjects = ['/sqlNotebook/', '/sqlEditor-react/'];
            for (const proj of reactProjects) {
              if (normalized.includes(proj)) {
                return normalized.includes(proj + 'dist/');
              }
            }
            return true;
          },
        }
      ]
    })
  ],
  optimization: {
    minimizer: [
      new TerserPlugin({
        // Only minify extension.js — webview assets are already optimised
        // by their own build tools (Vite, etc.) and some are too complex for
        // Terser to re-parse without errors.
        exclude: /webview\//,
      }),
    ],
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};
module.exports = [ extensionConfig ];