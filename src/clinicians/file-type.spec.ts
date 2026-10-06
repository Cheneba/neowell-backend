import { sniffDocumentMime } from './file-type';

describe('sniffDocumentMime', () => {
  it('recognises PDF, JPEG and PNG signatures', () => {
    expect(sniffDocumentMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(
      sniffDocumentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe('image/png');
  });

  it('rejects anything else, including scripts and short buffers', () => {
    expect(sniffDocumentMime(Buffer.from('<?php echo 1;?>'))).toBeNull();
    expect(sniffDocumentMime(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffDocumentMime(Buffer.alloc(0))).toBeNull();
    expect(sniffDocumentMime(Buffer.from('%PD'))).toBeNull();
  });
});
