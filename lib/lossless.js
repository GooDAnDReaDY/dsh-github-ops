// Making every tool result survive JSON without losing anything.
//
// The harness refuses a tool result that cannot be serialised losslessly, and it refuses the
// WHOLE call: one `undefined` deep inside a payload drops the answer the caller waited for. That
// is how a directory entry without a `size` field took down `gh_repo_tree`, and how the same
// class of defect took down two tools of another plugin.
//
// This module is the single place that decides what a result may contain. It is applied to every
// tool result in one wrapper, so no individual tool has to remember the rule.

const MAX_DEPTH = 40

/**
 * Return a value that serialises identically in every JSON implementation:
 * - `undefined` is dropped from objects and becomes `null` inside arrays (JSON has no holes);
 * - `NaN` and the infinities become `null` (they have no JSON form);
 * - a `Date` becomes its ISO string; a `Map` an object; a `Set` and a typed array an array; a
 *   `Buffer` a base64 string;
 * - functions and symbols are dropped — they cannot be sent anywhere;
 * - a `BigInt` becomes a string (JSON has no integer that large);
 * - a cycle becomes the string "[circular]" instead of endless recursion.
 */
export function lossless(value, depth = 0, seen = new WeakSet()) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'bigint') return value.toString()
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined

  if (depth > MAX_DEPTH) return '[too deep]'
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('base64')

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)

    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const out = Array.from(value, (item) => {
        const converted = lossless(item, depth + 1, seen)
        return converted === undefined ? null : converted
      })
      seen.delete(value)
      return out
    }
    if (value instanceof Map) {
      const out = {}
      for (const [key, item] of value.entries()) {
        const converted = lossless(item, depth + 1, seen)
        if (converted !== undefined) out[String(key)] = converted
      }
      seen.delete(value)
      return out
    }
    if (value instanceof Set) {
      const out = []
      for (const item of value.values()) {
        const converted = lossless(item, depth + 1, seen)
        out.push(converted === undefined ? null : converted)
      }
      seen.delete(value)
      return out
    }

    const out = {}
    for (const key of Object.keys(value)) {
      const converted = lossless(value[key], depth + 1, seen)
      if (converted !== undefined) out[key] = converted
    }
    seen.delete(value)
    return out
  }

  return undefined
}

/**
 * Whether a value would pass the harness's check. Kept as a separate, tiny predicate so tests can
 * assert the rule instead of comparing strings.
 */
export function isLossless(value) {
  try {
    const once = JSON.stringify(value)
    if (once === undefined) return false
    return JSON.stringify(lossless(JSON.parse(once))) === once
  } catch {
    return false
  }
}
