// react-native-quick-crypto exposes its `/polyfill` side-effect entry with no
// type declaration and no `exports` map. Metro resolves it at runtime on native
// (see platform.native.ts), but tsc under SDK 56's moduleResolution:"bundler"
// cannot. Declaring the module lets the side-effect import typecheck; this has
// no effect on bundling or runtime resolution.
declare module 'react-native-quick-crypto/polyfill';
