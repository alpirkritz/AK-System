/**
 * Column span per block on wide screens. Two consecutive half blocks share a row (1 + 1);
 * a half block with no half neighbour, and every full block, takes the whole row (2).
 */
export function pairSpans(half: boolean[]): (1 | 2)[] {
  const spans: (1 | 2)[] = []
  let i = 0
  while (i < half.length) {
    if (half[i] && half[i + 1]) {
      spans.push(1, 1)
      i += 2
    } else {
      spans.push(2)
      i += 1
    }
  }
  return spans
}
