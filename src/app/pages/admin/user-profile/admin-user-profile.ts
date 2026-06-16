import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { AdminDataService, type AdminUser, type AdminSurvey, type AdminAuditLog, type UserRole, type UserStatus } from '../../../services/admin-data.service';

@Component({
  selector: 'app-admin-user-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-user-profile.html',
  styleUrl: './admin-user-profile.css'
})
export class AdminUserProfileComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  public readonly adminData = inject(AdminDataService);

  // Retrieve user ID from route params
  readonly userId = computed<string>(() => {
    const params = this.route.snapshot.params;
    return params['id'] || '';
  });

  // Resolve target user profile
  readonly userProfile = computed<AdminUser | null>(() => {
    const id = this.userId();
    return this.adminData.users().find(u => u.id === id) || null;
  });

  // Resolve surveys owned by this user
  readonly userSurveys = computed<AdminSurvey[]>(() => {
    const id = this.userId();
    return this.adminData.surveys().filter(s => s.ownerId === id);
  });

  // Resolve audit logs targeting this user
  readonly userLogs = computed<AdminAuditLog[]>(() => {
    const id = this.userId();
    return this.adminData.auditLogs().filter(
      log => log.target.includes(id)
    );
  });

  // Logged-in admin credentials helper
  readonly loggedInAdmin = computed<AdminUser | null>(() => {
    const active = this.auth.user();
    if (!active) return null;
    return this.adminData.users().find(u => u.email.toLowerCase() === active.email.toLowerCase()) || null;
  });

  // Declarative Modal Control Signals
  readonly activeModal = signal<'role' | 'suspend' | 'block' | 'survey_unpublish' | null>(null);

  // Modal form bindings
  readonly selectedNewRole = signal<UserRole>('User');
  readonly suspensionReason = signal<string>('');
  readonly blockReason = signal<string>('');
  readonly unpublishReason = signal<string>('');
  readonly targetSurveyId = signal<string>('');
  readonly permissionError = signal<string | null>(null);

  // Initializing role select dropdown
  initializeRoleModal(): void {
    const user = this.userProfile();
    if (user) {
      this.selectedNewRole.set(user.role);
    }
    this.activeModal.set('role');
  }

  async confirmRoleChange(): Promise<void> {
    const admin = this.loggedInAdmin();
    const target = this.userProfile();
    if (!admin || !target) return;

    this.permissionError.set(null);

    // Security requirement check: only SuperAdmin can promote/demote to SuperAdmin or edit SuperAdmins
    if (target.role === 'SuperAdmin' && admin.role !== 'SuperAdmin') {
      this.permissionError.set('Acceso Denegado. Solo un SuperAdministrador puede modificar una cuenta SuperAdmin.');
      return;
    }
    if (this.selectedNewRole() === 'SuperAdmin' && admin.role !== 'SuperAdmin') {
      this.permissionError.set('Acceso Denegado. Solo un SuperAdministrador puede ascender cuentas a SuperAdmin.');
      return;
    }

    const result = await this.adminData.changeUserRole(target.id, this.selectedNewRole());
    if (!result.success) {
      this.permissionError.set(result.error || 'No se pudo cambiar el rol.');
      return;
    }
    this.closeModal();
  }

  // Active status triggers
  async triggerActivate(): Promise<void> {
    const target = this.userProfile();
    if (!target) return;

    await this.adminData.activateUser(target.id);
  }

  triggerSuspend(): void {
    this.suspensionReason.set('');
    this.activeModal.set('suspend');
  }

  async confirmSuspend(): Promise<void> {
    const reason = this.suspensionReason().trim();
    if (!reason) return;

    const target = this.userProfile();
    if (!target) return;

    const result = await this.adminData.suspendUser(target.id, reason);
    if (!result.success) {
      this.permissionError.set(result.error || 'No se pudo suspender la cuenta.');
      return;
    }
    this.closeModal();
  }

  triggerBlock(): void {
    this.blockReason.set('');
    this.activeModal.set('block');
  }

  async confirmBlock(): Promise<void> {
    const reason = this.blockReason().trim();
    if (!reason) return;

    const target = this.userProfile();
    if (!target) return;

    const result = await this.adminData.blockUser(target.id, reason);
    if (!result.success) {
      this.permissionError.set(result.error || 'No se pudo bloquear la cuenta.');
      return;
    }
    this.closeModal();
  }

  async triggerUnblock(): Promise<void> {
    const target = this.userProfile();
    if (!target) return;

    await this.adminData.unblockUser(target.id);
  }

  // Survey controls
  async triggerArchiveSurvey(surveyId: string): Promise<void> {
    await this.adminData.archiveSurvey(surveyId);
  }

  triggerUnpublishSurvey(surveyId: string): void {
    this.targetSurveyId.set(surveyId);
    this.unpublishReason.set('');
    this.activeModal.set('survey_unpublish');
  }

  async confirmUnpublishSurvey(): Promise<void> {
    const reason = this.unpublishReason().trim();
    const surveyId = this.targetSurveyId();
    if (!reason || !surveyId) return;

    const result = await this.adminData.unpublishSurvey(surveyId, reason);
    if (!result.success) {
      this.permissionError.set(result.error || 'No se pudo despublicar la encuesta.');
      return;
    }
    this.closeModal();
  }

  async triggerRestoreSurvey(surveyId: string): Promise<void> {
    await this.adminData.restoreSurvey(surveyId);
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.permissionError.set(null);
  }

  getRoleBadgeClass(role: UserRole): string {
    switch (role) {
      case 'SuperAdmin': return 'role-superadmin';
      case 'Admin': return 'role-admin';
      case 'Moderator': return 'role-moderator';
      default: return 'role-user';
    }
  }

  getStatusBadgeClass(status: UserStatus): string {
    switch (status) {
      case 'activo': return 'status-active';
      case 'suspendido': return 'status-suspended';
      case 'bloqueado': return 'status-blocked';
    }
  }

  formatLogAction(action: string): string {
    return action.replace(/_/g, ' ');
  }

  getLogBadgeClass(action: string): string {
    if (action.includes('ROLE')) return 'badge-role';
    if (action.includes('SUSPENSION') || action.includes('BLOCK')) return 'badge-danger';
    if (action.includes('ACTIVATION') || action.includes('RESTORE')) return 'badge-success';
    return 'badge-info';
  }
}
