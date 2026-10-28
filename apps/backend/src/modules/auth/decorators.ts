import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppRequest, AuthContext } from './request-context';

export const IS_PUBLIC = 'auth:public';
export const ALLOW_INCOMPLETE_PROFILE = 'auth:allowIncomplete';
export const STAFF_PERMISSIONS = 'auth:staffPermissions';

/** Route accessible sans connexion. Toutes les autres exigent un jeton (sécurité par défaut). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route accessible avant que le profil soit complété (prénom, nom, CGU). */
export const AllowIncompleteProfile = () => SetMetadata(ALLOW_INCOMPLETE_PROFILE, true);

/**
 * Route du personnel : exige une session STAFF et AU MOINS UNE des permissions listées
 * (les variantes restreintes comme « users.moderate.short » sont vérifiées ensuite dans le service).
 */
export const StaffOnly = (...anyOf: string[]) => SetMetadata(STAFF_PERMISSIONS, anyOf);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('CurrentAuth utilisé sur une route publique');
  return req.auth;
});

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.permissions.has('*') || auth.permissions.has(permission);
}
