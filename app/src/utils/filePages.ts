export const FILE_PAGE_SIZE = 80;

const SORTS: Record<string, [string, string]> = {
  created_at_DESC: ['created_at', 'DESC'],
  created_at_ASC: ['created_at', 'ASC'],
  file_name_ASC: ['file_name', 'ASC'],
  file_name_DESC: ['file_name', 'DESC'],
  file_size_DESC: ['file_size', 'DESC'],
  file_size_ASC: ['file_size', 'ASC'],
};

export function filePageUrl(options: { folderId?: string; sortKey: string; query?: string; type?: string; offset: number }) {
  const [sort, order] = SORTS[options.sortKey] || SORTS.created_at_DESC;
  const values = [`sort=${sort}`, `order=${order}`, `limit=${FILE_PAGE_SIZE}`, `offset=${Math.max(0, options.offset)}`];
  if (options.folderId) values.push(`folder_id=${encodeURIComponent(options.folderId)}`);
  if (options.query?.trim()) values.push(`q=${encodeURIComponent(options.query.trim())}`);
  if (options.type && options.type !== 'all') values.push(`type=${encodeURIComponent(options.type)}`);
  return `/files?${values.join('&')}`;
}

/** Keep one row per file when a fresh upload appears between page requests. */
export function appendUniqueFiles<T extends { id: string }>(current: T[], next: T[]): T[] {
  const seen = new Set(current.map(file => String(file.id)));
  return [...current, ...next.filter(file => {
    const id = String(file.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  })];
}
