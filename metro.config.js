// metro.config.js

const {
  getDefaultConfig,
} = require(
  'expo/metro-config'
);

const config =
  getDefaultConfig(
    __dirname
  );

const assetExts =
  config.resolver
    .assetExts
    .filter(
      extension =>
        extension !==
        'svg'
    );

const sourceExts =
  config.resolver
    .sourceExts
    .filter(
      extension =>
        extension !==
          'onnx' &&
        extension !==
          'db'
    );

if (
  !assetExts.includes(
    'onnx'
  )
) {
  assetExts.push(
    'onnx'
  );
}

if (
  !assetExts.includes(
    'db'
  )
) {
  assetExts.push(
    'db'
  );
}

if (
  !sourceExts.includes(
    'svg'
  )
) {
  sourceExts.push(
    'svg'
  );
}

config.transformer = {
  ...config.transformer,

  babelTransformerPath:
    require.resolve(
      'react-native-svg-transformer/expo'
    ),
};

config.resolver = {
  ...config.resolver,

  assetExts,

  sourceExts,
};

module.exports =
  config;