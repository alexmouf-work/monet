/**
 * Tiny arithmetic evaluator for numeric fields — docs/11 §10.1 ("fields accept arithmetic:
 * 8+2, 16/3"). Recursive descent over + - * / and parentheses, numbers only. No eval(), no
 * identifiers, and any malformed input returns null so the field just keeps its old value.
 */
export function evalExpr(input: string): number | null {
  const src = input.trim();
  if (!src) return null;
  let pos = 0;

  const peek = () => src[pos];
  const skip = () => {
    while (src[pos] === ' ') pos++;
  };

  function number(): number | null {
    skip();
    const start = pos;
    if (peek() === '-' || peek() === '+') pos++;
    while (/[0-9.]/.test(src[pos] ?? '')) pos++;
    if (pos === start) return null;
    const n = Number(src.slice(start, pos));
    return Number.isFinite(n) ? n : null;
  }

  function atom(): number | null {
    skip();
    if (peek() === '(') {
      pos++;
      const v = sum();
      skip();
      if (src[pos] !== ')') return null;
      pos++;
      return v;
    }
    return number();
  }

  function product(): number | null {
    let left = atom();
    if (left === null) return null;
    for (;;) {
      skip();
      const op = peek();
      if (op !== '*' && op !== '/') return left;
      pos++;
      const right = atom();
      if (right === null) return null;
      left = op === '*' ? left * right : right === 0 ? NaN : left / right;
      if (!Number.isFinite(left)) return null;
    }
  }

  function sum(): number | null {
    let left = product();
    if (left === null) return null;
    for (;;) {
      skip();
      const op = peek();
      if (op !== '+' && op !== '-') return left;
      pos++;
      const right = product();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
  }

  const result = sum();
  skip();
  return pos === src.length && result !== null && Number.isFinite(result) ? result : null;
}
