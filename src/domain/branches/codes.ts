/**
 * Human-readable branch codes.
 *
 * Roots use letters (A, B, …, Z, AA, AB, …). Children append their 1-based rank:
 * a root's children are `A1`, `A2`; deeper levels use a dot: `A1.1`, `A1.2`, `A1.2.3`.
 * Roots never contain digits, so codes are unambiguous. Ranks are never reused, even
 * after a child dies, so a code identifies one branch forever. UUIDs stay internal.
 */

const ROOT_CODE_RE = /^[A-Z]+$/;
const BRANCH_CODE_RE = /^[A-Z]+(\d+(\.\d+)*)?$/;

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB" (bijective base-26). */
export function rootCode(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("Root index must be >= 0");
  let n = index + 1;
  let code = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    code = String.fromCharCode(65 + rem) + code;
    n = Math.floor((n - 1) / 26);
  }
  return code;
}

/** Inverse of {@link rootCode}: "A" → 0, "AA" → 26. */
export function rootIndex(code: string): number {
  if (!ROOT_CODE_RE.test(code)) throw new RangeError(`Not a root code: ${code}`);
  let n = 0;
  for (const char of code) n = n * 26 + (char.charCodeAt(0) - 64);
  return n - 1;
}

export function isRootCode(code: string): boolean {
  return ROOT_CODE_RE.test(code);
}

export function isValidBranchCode(code: string): boolean {
  return BRANCH_CODE_RE.test(code);
}

/** Code of the `rank`-th child (1-based) of `parentCode`. */
export function childCode(parentCode: string, rank: number): string {
  if (!Number.isInteger(rank) || rank < 1) throw new RangeError("Child rank must be >= 1");
  return isRootCode(parentCode) ? `${parentCode}${rank}` : `${parentCode}.${rank}`;
}

/** Next root code: the one after the highest root code already used (gaps are never refilled). */
export function nextRootCode(existingRootCodes: readonly string[]): string {
  const maxUsed = existingRootCodes.reduce(
    (max, code) => (isRootCode(code) ? Math.max(max, rootIndex(code)) : max),
    -1,
  );
  return rootCode(maxUsed + 1);
}

/** Generation implied by a code: "A" → 0, "A1" → 1, "A1.2" → 2. */
export function generationFromCode(code: string): number {
  if (isRootCode(code)) return 0;
  return code.split(".").length;
}

/** Natural sort for codes: A2 < A10, A1.2 < A1.10. */
export function compareBranchCodes(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}
