import { csvCell, toCsv } from './csv';

describe('export CSV (EF-98)', () => {
  it('neutralise les formules', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('+225 07')).toBe("'+225 07");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('laisse les nombres négatifs (montants) et échappe séparateurs et guillemets', () => {
    expect(csvCell(-500)).toBe('-500');
    expect(csvCell('Abidjan; Cocody')).toBe('"Abidjan; Cocody"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell(null)).toBe('');
  });

  it('fichier avec BOM, séparateur point-virgule et fins de ligne CRLF', () => {
    const out = toCsv(['a', 'b'], [[1, 'x'], [2, '=1+1']]).toString('utf8');
    expect(out).toBe("﻿a;b\r\n1;x\r\n2;'=1+1\r\n");
  });
});
