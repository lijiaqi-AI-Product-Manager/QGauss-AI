/** Protocol capabilities, not model availability. Unknown gateways still need provider validation. */
export function imageFeatures(type: string, model = '') {
  if (type === 'GEMINI') {
    const fixed1K = /gemini-2\.5-flash-image|flash-lite-image/i.test(model);
    return { qualities: ['auto'], resolutions: fixed1K ? ['1K'] : ['1K', '2K', '4K'], ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'], seed: true, pixelSize: false, maxReferences: 8, mask: false };
  }
  const nativeEdit = type === 'MOCK' || /^(gpt-image|chatgpt-image)/i.test(model);
  return { qualities: ['auto', 'low', 'medium', 'high'], resolutions: ['1K', '2K', '4K'], ratios: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '2:1', '21:9'], seed: false, pixelSize: true, maxReferences: nativeEdit ? 8 : 1, mask: nativeEdit };
}
