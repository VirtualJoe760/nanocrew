module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // three.js ships ES "static initialization blocks" (`static { ... }`). The native Babel transform
    // doesn't enable that syntax by default, so importing three on native (the Venus Lab) fails to
    // parse without this. (babel-preset-expo still auto-adds the react-native-worklets plugin.)
    plugins: ['@babel/plugin-transform-class-static-block'],
  };
};
