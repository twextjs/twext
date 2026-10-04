export function parseFunctionSource(source) {
  const text = source.trim();
  let m;

  m = /^(async\s+)?function\s*[A-Za-z_$][\w$]*\s*\(([\s\S]*?)\)\s*\{([\s\S]*)\}$/.exec(text);
  if (m) return { async: Boolean(m[1]), params: m[2], body: m[3], expressionBody: false };

  m = /^(async\s+)?function\s*\(([\s\S]*?)\)\s*\{([\s\S]*)\}$/.exec(text);
  if (m) return { async: Boolean(m[1]), params: m[2], body: m[3], expressionBody: false };

  m = /^(async\s+)?[A-Za-z_$][\w$]*\s*\(([\s\S]*?)\)\s*\{([\s\S]*)\}$/.exec(text);
  if (m) return { async: Boolean(m[1]), params: m[2], body: m[3], expressionBody: false };

  m = /^(async\s+)?\(([\s\S]*?)\)\s*=>\s*\{([\s\S]*)\}$/.exec(text);
  if (m) return { async: Boolean(m[1]), params: m[2], body: m[3], expressionBody: false };

  m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*)\}$/.exec(text);
  if (m) return { async: Boolean(m[1]), params: m[2], body: m[3], expressionBody: false };

  m = /^(async\s+)?(?:\(([\s\S]*?)\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]*)$/.exec(text);
  if (m)
    return {
      async: Boolean(m[1]),
      params: m[2] ?? m[3],
      body: m[4].trim(),
      expressionBody: true,
    };

  return null;
}
