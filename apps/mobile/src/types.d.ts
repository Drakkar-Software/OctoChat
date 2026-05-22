/// <reference types="node" />

// SDK 56 dropped the transitive `node` types reference that previously put the
// Node `Buffer` global in scope. starfish/client.ts uses `Buffer.from` as the
// native base64 fallback (provided at runtime by react-native-quick-crypto's
// install(); web takes the `btoa` branch). Pull node's ambient types back in so
// tsc resolves the global. Backed by the @types/node devDependency.
