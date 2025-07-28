/**
 * Syscoinjs-lib Error Response Sanitizer
 *
 * This utility sanitizes error messages from syscoinjs-lib to prevent XSS attacks
 * and properly handle HTML entities that may be present in error responses.
 */

export interface ISyscoinErrorResponse {
  code?: string;
  details?: any;
  error?: boolean;
  fee?: number;
  message?: string;
  remainingFee?: number;
  shortfall?: number;
}

/**
 * Sanitizes a string by decoding HTML entities and only escaping dangerous HTML characters
 * @param input - The input string to sanitize
 * @returns Sanitized string safe for display with readable text
 */
const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') {
    return String(input || '');
  }

  // First decode HTML entities that might be present to make them readable
  const decoded = input
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // Do this last to avoid double-decoding

  // Only escape truly dangerous characters that could cause XSS
  // Leave quotes and other safe characters as readable text
  return decoded
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/javascript:/gi, 'javascript_') // Prevent javascript: URLs
    .replace(/data:text\/html/gi, 'data_text_html'); // Prevent data URLs with HTML
};

/**
 * Sanitizes syscoinjs-lib error responses for safe display in UI
 * @param error - The error response from syscoinjs-lib
 * @returns Sanitized error response with safe strings
 */
export const sanitizeSyscoinError = (error: any): ISyscoinErrorResponse => {
  if (!error || typeof error !== 'object') {
    return {
      error: true,
      code: 'UNKNOWN_ERROR',
      message: sanitizeString(String(error || 'Unknown error occurred')),
    };
  }

  const sanitized: ISyscoinErrorResponse = {
    error: Boolean(error.error),
  };

  // Sanitize code if present
  if (error.code) {
    sanitized.code = sanitizeString(error.code);
  }

  // Sanitize message if present
  if (error.message) {
    console.log('[syscoinErrorSanitizer] Original message:', error.message);
    sanitized.message = sanitizeString(error.message);
    console.log(
      '[syscoinErrorSanitizer] Sanitized message:',
      sanitized.message
    );
  }

  // Sanitize details if present (convert to string if it's an object)
  if (error.details) {
    if (typeof error.details === 'object') {
      sanitized.details = sanitizeString(JSON.stringify(error.details));
    } else {
      sanitized.details = sanitizeString(String(error.details));
    }
  }

  // Preserve numeric values (these should be safe)
  if (typeof error.fee === 'number') {
    sanitized.fee = error.fee;
  }

  if (typeof error.remainingFee === 'number') {
    sanitized.remainingFee = error.remainingFee;
  }

  if (typeof error.shortfall === 'number') {
    sanitized.shortfall = error.shortfall;
  }

  return sanitized;
};

/**
 * Sanitizes generic error messages (for fallback error handling)
 * @param error - Any error object or string
 * @returns Sanitized error message string
 */
export const sanitizeErrorMessage = (error: any): string => {
  if (!error) {
    return 'Unknown error occurred';
  }

  if (typeof error === 'string') {
    return sanitizeString(error);
  }

  if (error.message) {
    return sanitizeString(error.message);
  }

  if (error.toString && typeof error.toString === 'function') {
    return sanitizeString(error.toString());
  }

  return sanitizeString(String(error));
};

/**
 * Checks if an error response is from syscoinjs-lib
 * @param error - The error to check
 * @returns True if the error appears to be from syscoinjs-lib
 */
export const isSyscoinLibError = (error: any): boolean =>
  error &&
  typeof error === 'object' &&
  error.error === true &&
  typeof error.code === 'string' &&
  typeof error.message === 'string';
