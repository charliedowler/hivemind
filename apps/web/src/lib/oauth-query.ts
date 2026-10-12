export type PageQuery = Record<string, string | string[] | undefined>;

export function pageQuery(params: PageQuery) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return query.toString();
}
