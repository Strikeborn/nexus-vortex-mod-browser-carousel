let webpack = require('vortex-api/bin/webpack').default;
var path = require('path');
var fs = require('fs');
var webpackLib = require('webpack');

const injectionRuntime = fs.readFileSync(
  path.join(__dirname, 'src', 'injectionRuntime.js'),
  'utf8',
);

const config = webpack('mod-browser-carousel', __dirname, 4);

config.plugins = config.plugins || [];
config.plugins.push(new webpackLib.DefinePlugin({
  INJECTION_RUNTIME: JSON.stringify(injectionRuntime),
}));

if (!!config.module.rules) {
  config.module.rules.push({
    test: /\.css$/i,
    use: [
      "style-loader",
      "@teamsupercell/typings-for-css-modules-loader",
      {
        loader: "css-loader",
        options: { modules: true }
      }
    ]
  });
} else {
  config.module.rules = [
    {
      test: /\.css$/i,
      use: [
        "style-loader",
        "@teamsupercell/typings-for-css-modules-loader",
        {
          loader: "css-loader",
          options: { modules: true }
        }
      ]
    }
  ];
}
module.exports = config;
