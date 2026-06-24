import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Question, Survey, SurveyMetadata, SurveyService } from '../../services/survey.service';
import { AdminDataService } from '../../services/admin-data.service';
import { SupabaseService } from '../../services/supabase.service';

type DashboardFilter = 'all' | 'activo' | 'borrador' | 'cerrado' | 'withResponses' | 'withoutResponses';
type DashboardSort = 'updated' | 'responses' | 'created' | 'status';
type CreateMode = 'blank' | 'template' | 'import';
type DashboardLayout = 'grid' | 'list';

interface DashboardFolder {
  id: string;
  name: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPage implements OnInit, OnDestroy {
  surveys = signal<Survey[]>([]);
  folders = signal<DashboardFolder[]>([]);
  surveyFolders = signal<Record<string, string>>({});
  selectedFolderId = signal<string | null>(null);
  copiedId = signal<string | null>(null);
  openMenuId = signal<string | null>(null);
  searchTerm = signal('');
  activeFilter = signal<DashboardFilter>('all');
  sortBy = signal<DashboardSort>('created');
  layoutMode = signal<DashboardLayout>('grid');
  
  isCreating = signal<boolean>(false);
  showCreateModal = signal<boolean>(false);
  newSurveyTitle = signal<string>('');
  newSurveyDescription = signal<string>('');
  createError = signal<string | null>(null);
  createMode = signal<CreateMode>('blank');
  importTitle = signal<string>('Encuesta importada');
  importText = signal<string>('');

  // General controls
  showNotifications = signal<boolean>(false);
  showUserMenu = signal<boolean>(false);
  showConfigModal = signal<boolean>(false);
  showHelpModal = signal<boolean>(false);
  showTutorial = signal<boolean>(false);
  showProfileModal = signal<boolean>(false);
  tutorialStep = signal<number>(0);

  // General settings (local storage)
  themePreference = signal<'light' | 'dark'>('light');
  languagePreference = signal<'es' | 'en'>('es');
  accountName = signal<string>('');
  accountEmail = signal<string>('');
  accountRole = signal<string>('Creador');
  enableEmailNotifications = signal<boolean>(true);
  enableSystemNotifications = signal<boolean>(true);

  // Notification items
  notifications = signal<Array<{
    id: string;
    title: string;
    description: string;
    date: Date;
    read: boolean;
    type: 'system' | 'survey' | 'activity';
  }>>([
    {
      id: '1',
      title: 'Nueva respuesta recibida',
      description: 'Tu encuesta "Satisfacción del Cliente" tiene 1 nueva respuesta.',
      date: new Date(Date.now() - 1000 * 60 * 30),
      read: false,
      type: 'survey'
    },
    {
      id: '2',
      title: 'Encuesta publicada con éxito',
      description: 'La encuesta "Feedback de Producto v2" ahora está activa.',
      date: new Date(Date.now() - 1000 * 60 * 120),
      read: false,
      type: 'activity'
    },
    {
      id: '3',
      title: '¡Bienvenido a DataEncuesta!',
      description: 'Comienza creando tu primera encuesta o usando una plantilla.',
      date: new Date(Date.now() - 1000 * 60 * 60 * 24),
      read: true,
      type: 'system'
    }
  ]);

  unreadNotificationsCount = computed(() => 
    this.notifications().filter(n => !n.read).length
  );

  dialogModal = signal<{ type: 'prompt' | 'confirm'; title: string; placeholder?: string; message?: string; value?: string; onConfirm: (val?: string) => void } | null>(null);
  dialogInputValue = '';

  closeDialogModal(): void {
    this.dialogModal.set(null);
  }

  confirmDialogModal(): void {
    const modal = this.dialogModal();
    if (modal) {
      modal.onConfirm(this.dialogInputValue);
    }
    this.closeDialogModal();
  }

  private readonly foldersStorageKey = 'dataencuesta-dashboard-folders';
  private readonly surveyFoldersStorageKey = 'dataencuesta-dashboard-survey-folders';

  readonly filterOptions: { value: DashboardFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'activo', label: 'Activas' },
    { value: 'borrador', label: 'Borradores' },
    { value: 'withResponses', label: 'Con respuestas' }
  ];

  readonly sortOptions: { value: DashboardSort; label: string }[] = [
    { value: 'updated', label: 'Última modificación' },
    { value: 'created', label: 'Fecha de creación' },
    { value: 'responses', label: 'Más respuestas' },
    { value: 'status', label: 'Estado' }
  ];

  totalResponses = computed(() =>
    this.surveys().reduce((sum, survey) => sum + this.responseCount(survey), 0)
  );

  planUsagePercent = computed(() => Math.min(100, Math.round((this.totalResponses() / 100) * 100)));

  planUsageLabel = computed(() => `${Math.min(this.totalResponses(), 100)}/100`);

  filteredSurveys = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const filter = this.activeFilter();
    const source = this.surveys();
    const folderId = this.selectedFolderId();
    const sorted = [...source].filter((survey) => {
      const matchesTerm = !term
        || survey.title.toLowerCase().includes(term)
        || survey.description.toLowerCase().includes(term);

      if (!matchesTerm) return false;
      if (folderId && this.folderForSurvey(survey.id) !== folderId) return false;
      if (filter === 'withResponses') return this.responseCount(survey) > 0;
      if (filter === 'withoutResponses') return this.responseCount(survey) === 0;
      if (filter === 'all') return true;
      return survey.status === filter;
    });

    const sort = this.sortBy();
    sorted.sort((a, b) => {
      if (sort === 'responses') return this.responseCount(b) - this.responseCount(a);
      if (sort === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === 'status') return this.statusRank(a) - this.statusRank(b);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return sorted;
  });

  readonly isAdministrative = computed(() => this.adminData.isCurrentUserAdmin());

  constructor(
    public auth: AuthService,
    private surveyService: SurveyService,
    public router: Router,
    public adminData: AdminDataService,
    private supabaseService: SupabaseService
  ) {}

  ngOnInit(): void {
    if (!this.ensureAuthenticated()) {
      return;
    }

    this.loadDashboardState();
    this.loadSurveys();
    this.loadUserPreferences();
    this.setupRealtimeSubscription();
  }

  private realtimeChannel: any;

  private setupRealtimeSubscription(): void {
    const client = this.supabaseService.client;
    if (!client) return;

    this.realtimeChannel = client.channel('dashboard-responses')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'envios' }, (payload) => {
        const surveyId = (payload.new as any)?.encuesta_id;
        if (!surveyId) return;
        this.surveys.update(list =>
          list.map(s => s.id === surveyId ? { ...s, responses_count: (s.responses_count ?? 0) + 1 } : s)
        );
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.realtimeChannel && this.supabaseService.client) {
      void this.supabaseService.client.removeChannel(this.realtimeChannel);
    }
  }

  async loadSurveys(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;

    const data = await this.surveyService.getSurveysByUser(userId);
    this.surveys.set(data);
  }

  openCreateModal(): void {
    this.newSurveyTitle.set('');
    this.newSurveyDescription.set('');
    this.createError.set(null);
    this.createMode.set('blank');
    this.importTitle.set('Encuesta importada');
    this.importText.set('');
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
    this.createError.set(null);
  }

  async confirmCreate(): Promise<void> {
    if (this.createMode() === 'template') {
      this.closeCreateModal();
      void this.router.navigate(['/templates'], { queryParams: { returnTo: '/dashboard' } });
      return;
    }

    if (this.createMode() === 'import') {
      await this.createFromImport();
      return;
    }

    if (!this.newSurveyTitle().trim()) return;

    const user = this.auth.user();
    if (!user) return;

    this.isCreating.set(true);
    this.createError.set(null);

    try {
      const survey = await this.surveyService.createSurvey(
        user.id,
        this.newSurveyTitle().trim(),
        this.newSurveyDescription().trim() || 'Sin descripción',
        this.defaultDirectMetadata()
      );
      if (survey) {
        this.closeCreateModal();
        void this.router.navigate(['/editor', survey.id]);
      } else {
        this.createError.set('No se pudo crear la encuesta. Revisa la conexión o la configuración de la base de datos.');
      }
    } catch (e) {
      console.error('Error creating survey:', e);
      this.createError.set('Ocurrió un error creando la encuesta. Intenta de nuevo.');
    } finally {
      this.isCreating.set(false);
    }
  }

  private defaultDirectMetadata(): SurveyMetadata {
    return {
      welcomeLayout: 'minimal',
      ctaText: 'Comenzar',
      endLayout: 'compact',
      endTitle: 'Gracias por responder',
      endDescription: 'Tus respuestas quedaron registradas.',
      thankYouTitle: 'Gracias por responder',
      thankYouDescription: 'Tus respuestas quedaron registradas.',
      brand: {
        primaryColor: '#18181b',
        secondaryColor: '#71717a',
        backgroundColor: '#ffffff',
        backgroundImageUrl: undefined,
        surfaceColor: '#ffffff',
        textColor: '#09090b',
        questionStyle: 'minimal',
        buttonStyle: 'square',
        cardRadius: 16,
        buttonRadius: 10,
        fontTitle: 'Inter',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'none',
        glassEffect: false,
        borderGlow: false,
        entryAnimation: 'fadeUp',
        progressBar: { enabled: true, style: 'line' }
      }
    };
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  setFilter(value: DashboardFilter): void {
    this.activeFilter.set(value);
  }

  setSortBy(value: DashboardSort): void {
    this.sortBy.set(value);
  }

  setLayoutMode(value: DashboardLayout): void {
    this.layoutMode.set(value);
  }

  resetDashboardFilters(): void {
    this.searchTerm.set('');
    this.activeFilter.set('all');
    this.selectedFolderId.set(null);
  }

  emptyTitle(): string {
    return this.surveys().length === 0 ? 'No hay encuestas todavia' : 'No hay resultados';
  }

  emptyDescription(): string {
    return this.surveys().length === 0
      ? 'Crea tu primera encuesta para empezar a recopilar respuestas.'
      : 'Ajusta la busqueda, cambia el filtro o vuelve al inicio.';
  }

  setCreateMode(mode: CreateMode): void {
    this.createMode.set(mode);
    this.createError.set(null);
  }

  fillImportExample(): void {
    this.importTitle.set('Feedback de producto');
    this.importText.set([
      '# Puedes pegar una pregunta por línea',
      '¿Qué tan fácil fue usar el producto?',
      '¿Qué funcionalidad usas más? | Editor | Plantillas | Analíticas | Compartir',
      '¿Qué deberíamos mejorar primero?',
      '¿Nos recomendarías? | Sí | No | Tal vez'
    ].join('\n'));
  }

  selectFolder(folderId: string): void {
    this.selectedFolderId.set(folderId);
    this.openMenuId.set(null);
  }

  clearFolderFilter(): void {
    this.selectedFolderId.set(null);
  }

  addFolder(): void {
    this.dialogInputValue = '';
    this.dialogModal.set({
      type: 'prompt',
      title: 'Crear nueva carpeta',
      placeholder: 'Nombre de la carpeta',
      value: '',
      onConfirm: (name) => {
        const clean = name?.trim();
        if (!clean) return;
        this.folders.update((folders) => [...folders, { id: crypto.randomUUID(), name: clean }]);
        this.persistFolders();
      }
    });
  }

  renameFolder(folder: DashboardFolder, event: Event): void {
    event.stopPropagation();
    this.dialogInputValue = folder.name;
    this.dialogModal.set({
      type: 'prompt',
      title: 'Renombrar carpeta',
      placeholder: 'Nuevo nombre de la carpeta',
      value: folder.name,
      onConfirm: (name) => {
        const clean = name?.trim();
        if (!clean) return;
        this.folders.update((folders) => folders.map((item) => item.id === folder.id ? { ...item, name: clean } : item));
        this.persistFolders();
      }
    });
  }

  deleteFolder(folder: DashboardFolder, event: Event): void {
    event.stopPropagation();
    this.dialogModal.set({
      type: 'confirm',
      title: 'Eliminar carpeta',
      message: `¿Estás seguro de que deseas eliminar la carpeta "${folder.name}"? Las encuestas dentro de ella no se perderán.`,
      onConfirm: () => {
        this.folders.update((folders) => folders.filter((item) => item.id !== folder.id));
        this.surveyFolders.update((map) => {
          const next = { ...map };
          for (const [surveyId, folderId] of Object.entries(next)) {
            if (folderId === folder.id) delete next[surveyId];
          }
          return next;
        });
        if (this.selectedFolderId() === folder.id) this.selectedFolderId.set(null);
        this.persistFolders();
        this.persistSurveyFolders();
      }
    });
  }

  moveSurveyToFolder(surveyId: string, folderId: string | null, event: Event): void {
    event.stopPropagation();
    this.surveyFolders.update((map) => {
      const next = { ...map };
      if (folderId) next[surveyId] = folderId;
      else delete next[surveyId];
      return next;
    });
    this.openMenuId.set(null);
    this.persistSurveyFolders();
  }

  folderCount(folderId: string): number {
    return this.surveys().filter((survey) => this.folderForSurvey(survey.id) === folderId).length;
  }

  folderForSurvey(surveyId: string): string | null {
    return this.surveyFolders()[surveyId] ?? null;
  }

  folderName(folderId: string | null): string {
    if (!folderId) return 'Sin carpeta';
    return this.folders().find((folder) => folder.id === folderId)?.name ?? 'Sin carpeta';
  }

  toggleCardMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update((current) => current === id ? null : id);
  }

  closeCardMenu(event?: Event): void {
    event?.stopPropagation();
    this.openMenuId.set(null);
  }

  async deleteSurvey(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    this.dialogModal.set({
      type: 'confirm',
      title: 'Eliminar encuesta',
      message: '¿Estás seguro de que deseas eliminar esta encuesta? Esta acción es irreversible y se perderán de manera definitiva todas sus respuestas.',
      onConfirm: async () => {
        const success = await this.surveyService.deleteSurvey(id);
        if (success) {
          await this.loadSurveys();
        }
      }
    });
  }

  copyLink(id: string, event: Event): void {
    event.stopPropagation();
    const link = this.surveyService.getShareLink(id);
    void navigator.clipboard.writeText(link);
    this.copiedId.set(id);
    this.openMenuId.set(null);
    setTimeout(() => this.copiedId.set(null), 2000);
  }

  openPublicSurvey(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    window.open(this.surveyService.getShareLink(id), '_blank', 'noopener,noreferrer');
  }

  async toggleSurveyStatus(survey: Survey, event: Event): Promise<void> {
    event.stopPropagation();
    const nextStatus = survey.status === 'activo' ? 'cerrado' : 'activo';
    const saved = await this.surveyService.saveSurvey({ ...survey, status: nextStatus });

    if (saved) {
      this.surveys.update((list) => list.map((item) => item.id === saved.id ? saved : item));
    }

    this.openMenuId.set(null);
  }

  async duplicateSurvey(source: Survey, event: Event): Promise<void> {
    event.stopPropagation();
    const user = this.auth.user();
    if (!user) return;

    const created = await this.surveyService.createSurvey(user.id, `${source.title} copia`, source.description);
    if (!created) return;

    const copy = await this.surveyService.saveSurvey({
      ...created,
      questions: source.questions.map((question) => ({
        ...question,
        id: crypto.randomUUID(),
        options: question.options.map((option) => ({ ...option, id: crypto.randomUUID() }))
      })),
      metadata: source.metadata,
      status: 'borrador'
    });

    if (copy) {
      this.surveys.update((list) => [copy, ...list]);
      this.openMenuId.set(null);
      void this.router.navigate(['/editor', copy.id]);
    }
  }

  async createFromImport(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;

    const questions = this.parseImportedQuestions(this.importText());
    if (!questions.length) {
      this.createError.set('Pega al menos una pregunta. Usa una línea por pregunta y separa opciones con "|".');
      return;
    }

    this.isCreating.set(true);
    this.createError.set(null);

    try {
      const survey = await this.surveyService.createSurvey(
        user.id,
        this.importTitle().trim() || 'Encuesta importada',
        'Preguntas importadas desde texto.',
        undefined,
        questions
      );
      if (survey) {
        this.closeCreateModal();
        void this.router.navigate(['/editor', survey.id]);
      } else {
        this.createError.set('No se pudo importar la encuesta. Revisa la conexión o configuración.');
      }
    } catch (error) {
      console.error('Error importing questions:', error);
      this.createError.set('Ocurrió un error importando las preguntas.');
    } finally {
      this.isCreating.set(false);
    }
  }

  responseCount(survey: Survey): number {
    return survey.responses_count ?? survey.responses.length ?? 0;
  }

  responseCountLabel(survey: Survey): string {
    const count = this.responseCount(survey);
    return `${count} respuesta${count === 1 ? '' : 's'}`;
  }

  filterCount(filter: DashboardFilter): number {
    const source = this.surveys();
    const folderId = this.selectedFolderId();
    return source.filter((survey) => {
      if (folderId && this.folderForSurvey(survey.id) !== folderId) return false;
      if (filter === 'withResponses') return this.responseCount(survey) > 0;
      if (filter === 'withoutResponses') return this.responseCount(survey) === 0;
      if (filter === 'all') return true;
      return survey.status === filter;
    }).length;
  }

  statusLabel(status: Survey['status']): string {
    if (status === 'activo') return 'Activa';
    if (status === 'cerrado') return 'Cerrada';
    return 'Borrador';
  }

  userInitial(): string {
    const user = this.auth.user();
    const source = user?.name || user?.email || 'A';
    return source.trim().charAt(0).toUpperCase();
  }

  coverColor(id: string): string {
    const colors = ['#bfe7d5', '#f2dfb7', '#cfe2ff', '#e5d4ff', '#ffd4c8', '#d8ead2'];
    const index = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  }

  private ensureAuthenticated(): boolean {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/']);
      return false;
    }

    return true;
  }

  private statusRank(survey: Survey): number {
    if (survey.status === 'activo') return 0;
    if (survey.status === 'borrador') return 1;
    return 2;
  }

  private loadDashboardState(): void {
    try {
      this.folders.set(JSON.parse(localStorage.getItem(this.foldersStorageKey) || '[]') as DashboardFolder[]);
      this.surveyFolders.set(JSON.parse(localStorage.getItem(this.surveyFoldersStorageKey) || '{}') as Record<string, string>);
    } catch {
      this.folders.set([]);
      this.surveyFolders.set({});
    }
  }

  private persistFolders(): void {
    localStorage.setItem(this.foldersStorageKey, JSON.stringify(this.folders()));
  }

  private persistSurveyFolders(): void {
    localStorage.setItem(this.surveyFoldersStorageKey, JSON.stringify(this.surveyFolders()));
  }

  private parseImportedQuestions(text: string): Question[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, ''))
      .filter((line) => Boolean(line) && !line.startsWith('#'))
      .map((line) => {
        const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
        const questionText = parts[0] ?? '';
        const options = parts.slice(1);
        return {
          id: crypto.randomUUID(),
          type: options.length ? 'multiple-choice' : 'text',
          text: questionText,
          required: false,
          options: options.map((option) => ({ id: crypto.randomUUID(), texto: option }))
        };
      });
  }

  // Load preferences from local storage
  private loadUserPreferences(): void {
    const savedTheme = localStorage.getItem('dataencuesta-theme') as 'light' | 'dark' || 'light';
    this.themePreference.set(savedTheme);
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const savedLang = localStorage.getItem('dataencuesta-lang') as 'es' | 'en' || 'es';
    this.languagePreference.set(savedLang);

    const savedEmailNotifs = localStorage.getItem('dataencuesta-email-notifs') !== 'false';
    this.enableEmailNotifications.set(savedEmailNotifs);

    const savedSysNotifs = localStorage.getItem('dataencuesta-sys-notifs') !== 'false';
    this.enableSystemNotifications.set(savedSysNotifs);
  }

  // Dropdown controls
  toggleNotifications(event: Event): void {
    event.stopPropagation();
    this.showNotifications.update((v) => !v);
    this.showUserMenu.set(false);
  }

  toggleUserMenu(event: Event): void {
    event.stopPropagation();
    this.showUserMenu.update((v) => !v);
    this.showNotifications.set(false);
  }

  // Settings modal
  openSettingsModal(): void {
    const user = this.auth.user();
    this.accountName.set(user?.name || 'Usuario DataEncuesta');
    this.accountEmail.set(user?.email || 'usuario@dataencuesta.com');
    this.accountRole.set('Creador');

    this.showConfigModal.set(true);
    this.showUserMenu.set(false);
  }

  closeSettingsModal(): void {
    this.showConfigModal.set(false);
  }

  setThemePreference(theme: 'light' | 'dark'): void {
    this.themePreference.set(theme);
  }

  setLanguagePreference(lang: 'es' | 'en'): void {
    this.languagePreference.set(lang);
  }

  saveSettings(): void {
    localStorage.setItem('dataencuesta-theme', this.themePreference());
    localStorage.setItem('dataencuesta-lang', this.languagePreference());
    localStorage.setItem('dataencuesta-email-notifs', String(this.enableEmailNotifications()));
    localStorage.setItem('dataencuesta-sys-notifs', String(this.enableSystemNotifications()));
    
    if (this.themePreference() === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    this.addNotification({
      title: 'Configuración guardada',
      description: 'Tus preferencias generales se actualizaron con éxito.',
      type: 'system'
    });

    this.closeSettingsModal();
  }

  // Help modal
  openHelpModal(): void {
    this.showHelpModal.set(true);
    this.showUserMenu.set(false);
  }

  closeHelpModal(): void {
    this.showHelpModal.set(false);
  }

  sendSupportMessage(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const subjectInput = form.querySelector('input[name="subject"]') as HTMLInputElement;

    this.dialogModal.set({
      type: 'confirm',
      title: 'Mensaje enviado',
      message: `Mensaje enviado con éxito.\nAsunto: ${subjectInput.value}\nNos pondremos en contacto contigo pronto.`,
      onConfirm: () => {}
    });
    form.reset();

    this.addNotification({
      title: 'Mensaje de soporte enviado',
      description: `Se registró tu consulta con el asunto: "${subjectInput.value}".`,
      type: 'activity'
    });

    this.closeHelpModal();
  }

  // Welcome tutorial
  startInteractiveTutorial(): void {
    this.showHelpModal.set(false);
    this.tutorialStep.set(0);
    this.showTutorial.set(true);
  }

  closeTutorial(): void {
    this.showTutorial.set(false);
  }

  nextTutorialStep(): void {
    if (this.tutorialStep() < 3) {
      this.tutorialStep.update((s) => s + 1);
    } else {
      this.closeTutorial();
      this.addNotification({
        title: 'Tutorial completado',
        description: '¡Felicidades! Ya conoces las herramientas básicas de DataEncuesta.',
        type: 'system'
      });
    }
  }

  prevTutorialStep(): void {
    if (this.tutorialStep() > 0) {
      this.tutorialStep.update((s) => s - 1);
    }
  }

  // Notifications logic
  markAsRead(id: string): void {
    this.notifications.update((list) => 
      list.map((n) => n.id === id ? { ...n, read: true } : n)
    );
  }

  markAllNotificationsAsRead(): void {
    this.notifications.update((list) => 
      list.map((n) => ({ ...n, read: true }))
    );
  }

  addNotification(item: { title: string; description: string; type: 'system' | 'survey' | 'activity' }): void {
    this.notifications.update((list) => [
      {
        id: crypto.randomUUID(),
        title: item.title,
        description: item.description,
        date: new Date(),
        read: false,
        type: item.type
      },
      ...list
    ]);
  }

  openProfileModal(): void {
    this.showProfileModal.set(true);
    this.showUserMenu.set(false);
  }

  closeProfileModal(): void {
    this.showProfileModal.set(false);
  }

  logoutUser(): void {
    this.showUserMenu.set(false);
    void this.auth.logout();
    void this.router.navigate(['/']);
  }
}
