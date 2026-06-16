import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export type UserStatus = 'activo' | 'suspendido' | 'bloqueado';
export type UserRole = 'User' | 'Moderator' | 'Admin' | 'SuperAdmin';

const ADMIN_ROLES: UserRole[] = ['Moderator', 'Admin', 'SuperAdmin'];

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string;
  status: UserStatus;
  role: UserRole;
  avatarUrl?: string;
  surveysCount: number;
  responsesCount: number;
}

export interface AdminSurvey {
  id: string;
  title: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  status: 'activo' | 'archivado' | 'despublicado';
  responsesCount: number;
}

export interface AdminAuditLog {
  id: string;
  timestamp: string;
  adminName: string;
  adminEmail: string;
  adminRole: UserRole;
  action: 'ROLE_CHANGE' | 'USER_SUSPENSION' | 'USER_ACTIVATION' | 'USER_BLOCK' | 'USER_UNBLOCK' | 'SURVEY_ARCHIVE' | 'SURVEY_UNPUBLISH' | 'SURVEY_RESTORE';
  target: string;
  details: string;
  ip: string;
}

export interface AdminActionResult {
  success: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminDataService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);

  readonly users = signal<AdminUser[]>([]);
  readonly surveys = signal<AdminSurvey[]>([]);
  readonly auditLogs = signal<AdminAuditLog[]>([]);

  // Rol/estado del usuario actualmente autenticado, resueltos contra
  // la columna real `perfiles.rol` / `perfiles.estado` (protegida por RLS
  // y por el trigger que impide auto-asignarse un rol).
  readonly currentUserRole = signal<UserRole>('User');
  readonly currentUserStatus = signal<UserStatus>('activo');

  readonly isCurrentUserAdmin = computed(() =>
    ADMIN_ROLES.includes(this.currentUserRole()) && this.currentUserStatus() === 'activo'
  );

  constructor() {
    effect(() => {
      const user = this.authService.user();
      if (user) {
        void this.refreshCurrentUserRole(user.id);
      } else {
        this.currentUserRole.set('User');
        this.currentUserStatus.set('activo');
        this.users.set([]);
        this.surveys.set([]);
        this.auditLogs.set([]);
      }
    });
  }

  // Refresca rol/estado del usuario actual desde `perfiles`. Devuelve
  // si es administrador activo. Pensado para usarse en guards, donde
  // no se puede depender del timing del effect del constructor.
  async checkIsAdmin(userId: string): Promise<boolean> {
    await this.refreshCurrentUserRole(userId);
    return this.isCurrentUserAdmin();
  }

  private async refreshCurrentUserRole(userId: string): Promise<void> {
    const supabase = this.supabaseService.client;
    if (!supabase) return;

    const { data, error } = await supabase
      .from('perfiles')
      .select('rol, estado')
      .eq('id', userId)
      .single();

    if (error || !data) {
      this.currentUserRole.set('User');
      this.currentUserStatus.set('activo');
      return;
    }

    this.currentUserRole.set((data['rol'] as UserRole) || 'User');
    this.currentUserStatus.set((data['estado'] as UserStatus) || 'activo');
  }

  // Carga el listado completo de usuarios y encuestas. RLS garantiza
  // que solo un administrador activo recibe filas de otros usuarios;
  // para el resto, Supabase solo devolverá su propio perfil/encuestas.
  async loadRealData(): Promise<void> {
    const supabase = this.supabaseService.client;
    if (!supabase) return;

    try {
      const { data: perfiles, error: errProfiles } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, email, url_avatar, creado_el, rol, estado');

      if (errProfiles) throw errProfiles;

      const { data: encuestas, error: errSurveys } = await supabase
        .from('encuestas')
        .select(`
          id,
          usuario_id,
          titulo,
          descripcion,
          estado,
          moderacion_estado,
          creado_el,
          actualizado_el,
          envios (count)
        `);

      if (errSurveys) throw errSurveys;

      const resolvedSurveys: AdminSurvey[] = (encuestas || []).map((s: any) => {
        const owner = (perfiles || []).find((p: any) => p.id === s.usuario_id);

        return {
          id: s.id,
          title: s.titulo || 'Encuesta sin título',
          ownerId: s.usuario_id,
          ownerName: owner?.nombre_completo || 'Usuario Desconocido',
          ownerEmail: owner?.email || 'desconocido@cliente.com',
          createdAt: s.creado_el,
          status: (s.moderacion_estado as AdminSurvey['status']) || 'activo',
          responsesCount: s.envios?.[0]?.count || 0
        };
      });

      const resolvedUsers: AdminUser[] = (perfiles || []).map((p: any) => {
        const userSurveys = resolvedSurveys.filter((s) => s.ownerId === p.id);
        const surveysCount = userSurveys.length;
        const responsesCount = userSurveys.reduce((sum, s) => sum + s.responsesCount, 0);
        const email = p.email || '';

        return {
          id: p.id,
          name: p.nombre_completo || email.split('@')[0] || 'Usuario',
          email,
          createdAt: p.creado_el,
          lastLoginAt: p.creado_el,
          status: (p.estado as UserStatus) || 'activo',
          role: (p.rol as UserRole) || 'User',
          avatarUrl: p.url_avatar || undefined,
          surveysCount,
          responsesCount
        };
      });

      this.surveys.set(resolvedSurveys);
      this.users.set(resolvedUsers);
    } catch (e) {
      console.error('Error loading real production data in AdminDataService:', e);
    }
  }

  // Carga la auditoría real desde `admin_audit_logs` (escrita solo por
  // las RPCs SECURITY DEFINER, no manipulable desde el cliente).
  async loadAuditLogs(): Promise<void> {
    const supabase = this.supabaseService.client;
    if (!supabase) return;

    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('id, creado_el, admin_nombre, admin_email, admin_rol, accion, objetivo, detalles, ip')
      .order('creado_el', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Error loading audit logs:', error);
      return;
    }

    this.auditLogs.set((data || []).map((log: any) => ({
      id: log.id,
      timestamp: log.creado_el,
      adminName: log.admin_nombre,
      adminEmail: log.admin_email,
      adminRole: log.admin_rol as UserRole,
      action: log.accion as AdminAuditLog['action'],
      target: log.objetivo,
      details: log.detalles,
      ip: log.ip || 'desconocida'
    })));
  }

  // 3. Admin Core Actions — todas pasan por RPCs SECURITY DEFINER que
  //    verifican el rol del llamador en el servidor y registran la
  //    auditoría. Tras cada acción se recargan datos y logs.
  private async callAdminRpc(fn: string, params: Record<string, unknown>): Promise<AdminActionResult> {
    const supabase = this.supabaseService.client;
    if (!supabase) return { success: false, error: 'Falta configurar Supabase en public/env.js.' };

    const { error } = await supabase.rpc(fn, params);
    if (error) {
      console.error(`Error en RPC ${fn}:`, error);
      return { success: false, error: error.message };
    }

    await Promise.all([this.loadRealData(), this.loadAuditLogs()]);
    return { success: true };
  }

  changeUserRole(userId: string, newRole: UserRole): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_user_role', { p_user_id: userId, p_new_role: newRole });
  }

  suspendUser(userId: string, reason: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_user_status', { p_user_id: userId, p_new_status: 'suspendido', p_reason: reason });
  }

  activateUser(userId: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_user_status', { p_user_id: userId, p_new_status: 'activo', p_reason: null });
  }

  blockUser(userId: string, reason: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_user_status', { p_user_id: userId, p_new_status: 'bloqueado', p_reason: reason });
  }

  unblockUser(userId: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_user_status', { p_user_id: userId, p_new_status: 'activo', p_reason: null });
  }

  archiveSurvey(surveyId: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_survey_moderation', { p_survey_id: surveyId, p_new_status: 'archivado', p_reason: null });
  }

  unpublishSurvey(surveyId: string, reason: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_survey_moderation', { p_survey_id: surveyId, p_new_status: 'despublicado', p_reason: reason });
  }

  restoreSurvey(surveyId: string): Promise<AdminActionResult> {
    return this.callAdminRpc('admin_set_survey_moderation', { p_survey_id: surveyId, p_new_status: 'activo', p_reason: null });
  }

  // 2. Metrics (Computed Signals for Admin Dashboard Widget Metrics)
  readonly totalUsersCount = computed(() => this.users().length);
  readonly activeUsersCount = computed(() => this.users().filter(u => u.status === 'activo').length);
  readonly suspendedUsersCount = computed(() => this.users().filter(u => u.status === 'suspendido').length);
  readonly blockedUsersCount = computed(() => this.users().filter(u => u.status === 'bloqueado').length);

  readonly totalSurveysCount = computed(() => this.surveys().length);
  readonly activeSurveysCount = computed(() => this.surveys().filter(s => s.status === 'activo').length);
  readonly archivedSurveysCount = computed(() => this.surveys().filter(s => s.status === 'archivado').length);
  readonly unpublishedSurveysCount = computed(() => this.surveys().filter(s => s.status === 'despublicado').length);

  readonly totalResponsesCount = computed(() => {
    return this.surveys().reduce((sum, s) => sum + s.responsesCount, 0);
  });
}
