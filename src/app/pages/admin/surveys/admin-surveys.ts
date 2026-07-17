import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminDataService, type AdminSurvey } from '../../../services/admin-data.service';

@Component({
  selector: 'app-admin-surveys',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-surveys.html',
  styleUrl: './admin-surveys.css'
})
export class AdminSurveysComponent {
  public readonly adminData = inject(AdminDataService);

  // Filters state
  readonly searchTerm = signal<string>('');
  readonly statusFilter = signal<string>('all');

  // Reactively computed list of filtered surveys
  readonly filteredSurveys = computed<AdminSurvey[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const status = this.statusFilter();

    return this.adminData.surveys().filter(s => {
      const matchesTerm = !term ||
        s.title.toLowerCase().includes(term) ||
        s.ownerName.toLowerCase().includes(term) ||
        s.ownerEmail.toLowerCase().includes(term) ||
        s.id.toLowerCase().includes(term);

      if (!matchesTerm) return false;
      if (status !== 'all' && s.status !== status) return false;

      return true;
    });
  });

  resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
  }

  getStatusBadgeClass(status: AdminSurvey['status']): string {
    switch (status) {
      case 'activo': return 'status-active';
      case 'archivado': return 'status-archived';
      case 'despublicado': return 'status-unpublished';
    }
  }

  // Declarative modal control (unpublish requires a reason)
  readonly activeModal = signal<'unpublish' | null>(null);

  // Bloquea el scroll del fondo mientras el modal está abierto (evita que
  // el swipe en móvil se lo lleve la página de atrás en vez del modal).
  private readonly lockScrollOnModal = effect(() => {
    document.body.style.overflow = this.activeModal() !== null ? 'hidden' : '';
  });
  readonly unpublishReason = signal<string>('');
  readonly targetSurveyId = signal<string>('');
  readonly actionError = signal<string | null>(null);

  async triggerArchiveSurvey(surveyId: string): Promise<void> {
    const result = await this.adminData.archiveSurvey(surveyId);
    if (!result.success) this.actionError.set(result.error || 'No se pudo archivar la encuesta.');
  }

  triggerUnpublishSurvey(surveyId: string): void {
    this.targetSurveyId.set(surveyId);
    this.unpublishReason.set('');
    this.actionError.set(null);
    this.activeModal.set('unpublish');
  }

  async confirmUnpublishSurvey(): Promise<void> {
    const reason = this.unpublishReason().trim();
    const surveyId = this.targetSurveyId();
    if (!reason || !surveyId) return;

    const result = await this.adminData.unpublishSurvey(surveyId, reason);
    if (!result.success) {
      this.actionError.set(result.error || 'No se pudo despublicar la encuesta.');
      return;
    }
    this.closeModal();
  }

  async triggerRestoreSurvey(surveyId: string): Promise<void> {
    const result = await this.adminData.restoreSurvey(surveyId);
    if (!result.success) this.actionError.set(result.error || 'No se pudo restaurar la encuesta.');
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.actionError.set(null);
  }
}
