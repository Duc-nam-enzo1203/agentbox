/**
 * Tagged Error Algebra and Result Type
 * Ensures explicit error modeling and zero uncaught runtime exceptions across boundaries.
 */

export function ok(value) {
  return { success: true, value };
}

export function err(error) {
  return { success: false, error };
}

export function isOk(result) {
  return result && result.success === true;
}

export function isErr(result) {
  return !result || result.success === false;
}

export function map(result, fn) {
  if (result.success) {
    return ok(fn(result.value));
  }
  return result;
}

export function mapErr(result, fn) {
  if (!result.success) {
    return err(fn(result.error));
  }
  return result;
}

export function unwrap(result) {
  if (result.success) {
    return result.value;
  }
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

export function unwrapOr(result, fallback) {
  return result.success ? result.value : fallback;
}
