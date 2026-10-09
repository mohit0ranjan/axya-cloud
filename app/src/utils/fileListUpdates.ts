export type FileListEvent = { type: 'add'; file: any } | { type: 'update'; id: string; updates: any } | { type: 'delete'; id: string };
export const applyFileListEvent = (files: any[], event: FileListEvent, accepts: (file: any) => boolean = () => true): any[] => {
    if (event.type === 'delete') return files.filter(file => String(file.id) !== String(event.id));
    if (event.type === 'add') {
        if (!accepts(event.file) || files.some(file => String(file.id) === String(event.file.id))) return files;
        return [event.file, ...files];
    }
    return files.map(file => String(file.id) === String(event.id) ? { ...file, ...event.updates } : file).filter(accepts);
};
