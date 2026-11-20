import controlCenter from './control-center.js';

export async function AntigravityLocalization(context, options = {}) {
  await controlCenter.startControlCenter(options, context.directory);
  return {};
}
