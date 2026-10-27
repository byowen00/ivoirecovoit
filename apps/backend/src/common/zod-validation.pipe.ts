import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError } from './api-error';

/** Valide et normalise une entrée (query, body) avec un schéma zod ; 400 avec le détail des champs sinon. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = Object.fromEntries(result.error.issues.map((i) => [i.path.join('.') || '_', i.message]));
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', { fields });
    }
    return result.data;
  }
}
