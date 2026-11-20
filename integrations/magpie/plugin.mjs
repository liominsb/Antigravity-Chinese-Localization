import controlCenter from './control-center.js';

export async function AntigravityLocalization(_context, options = {}) {
  await controlCenter.startControlCenter(options);
  return {};
}
