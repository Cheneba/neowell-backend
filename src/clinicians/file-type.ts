/** Detects a document type from its leading bytes; the client-supplied MIME header is not trusted. */
export function sniffDocumentMime(
  data: Buffer,
): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  return null;
}
