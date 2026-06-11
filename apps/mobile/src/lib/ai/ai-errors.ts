/**
 * Map a ModelErrorCode (or null/unknown) to a short, human-facing message.
 * Keyed on the code STRING so it stays free of expo-ai-kit imports and works
 * identically on web and native. Always returns a non-null string.
 */
export function friendlyAiError(code: string | null | undefined): string {
  switch (code) {
    case 'INFERENCE_BUSY':
      return 'The AI engine is busy. Try again in a moment.';
    case 'INFERENCE_OOM':
      return 'Not enough memory to generate this. Close other apps and retry.';
    case 'INFERENCE_FAILED':
    case 'MODEL_LOAD_FAILED':
      return 'The AI model could not run. Try again.';
    case 'MODEL_NOT_DOWNLOADED':
    case 'MODEL_NOT_FOUND':
      return 'The AI model is not ready yet.';
    case 'DEVICE_NOT_SUPPORTED':
      return 'On-device AI is not supported on this device.';
    default:
      return 'Failed to generate summary.';
  }
}
