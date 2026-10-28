import { detectMime } from './storage.service';

describe('detectMime', () => {
  it('reconnaît JPEG, PNG, WebP et PDF d’après leur contenu', () => {
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0]))).toBe('image/jpeg');
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectMime(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(detectMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('refuse le reste (texte, HTML, GIF, fichier vide)', () => {
    expect(detectMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectMime(Buffer.from('GIF89a'))).toBeNull();
    expect(detectMime(Buffer.alloc(0))).toBeNull();
  });
});
