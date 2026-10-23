// Preserve the existing test-only endpoint; all new claims use fenced acknowledgements.
export { dispatchSyntheticAction as testAction } from './action-reliability';
