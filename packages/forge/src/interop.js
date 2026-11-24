// CommonJS packages such as @forge/resolver export their class as `exports.default`. Depending
// on how the bundler wraps the module, a default import can arrive as the class itself, as
// `{ default: Class }`, or as `{ default: { default: Class } }`. Take the first function found.
export function pickClass(mod) {
  const found = [mod?.default?.default, mod?.default, mod].find((c) => typeof c === 'function');
  if (!found) throw new Error('Could not find the exported class in the imported module.');
  return found;
}
