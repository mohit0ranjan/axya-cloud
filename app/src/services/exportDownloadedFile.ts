import { File } from 'expo-file-system';

const COPY_CHUNK_BYTES = 1024 * 1024;

/** SAF destinations cannot use copyAsync. Write bounded chunks through the
 * native content resolver instead of converting the entire file to base64. */
export async function exportDownloadedFile(
  sourceUri: string,
  destinationUri: string,
  checkCancelled: () => void,
  onProgress: (fraction: number) => void,
) {
  const source = new File(sourceUri);
  const destination = new File(destinationUri);
  const size = source.size;
  let handle: ReturnType<File['open']> | undefined;
  let copied = 0;
  try {
    checkCancelled();
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Cannot determine file size.');
    handle = source.open();
    if (size === 0) destination.write(new Uint8Array(0));
    while (copied < size) {
      checkCancelled();
      const bytes = handle.readBytes(Math.min(COPY_CHUNK_BYTES, size - copied));
      if (!bytes.length) throw new Error('Download ended before the complete file was saved.');
      destination.write(bytes, { append: copied > 0 });
      copied += bytes.length;
      onProgress(copied / size);
      // Allow cancellation and rendering between synchronous native writes.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    checkCancelled();
    if (destination.size !== size) throw new Error('The saved file size does not match the download.');
  } catch (error) {
    try { destination.delete(); } catch { /* keep the original download for retry */ }
    throw error;
  } finally {
    handle?.close();
  }
}
