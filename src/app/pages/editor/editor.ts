import { CommonModule } from '@angular/common';
import { Component, HostListener, NgZone, OnDestroy, OnInit, QueryList, ViewChildren, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { SurveySimulatorComponent } from '../../components/survey-simulator/survey-simulator';
import {
  ConditionalRule,
  DecoratedImage,
  Question,
  QuestionValidation,
  QuestionType,
  Survey,
  SurveyBrand,
  SurveyElementConfig,
  SurveyMetadata,
  SurveyService
} from '../../services/survey.service';
import type { CanvasElement, CanvasScreen } from '../../services/survey.service';
import { AuthService } from '../../services/auth.service';
import { AnalyticsService } from '../../services/analytics.service';
import { SupabaseService } from '../../services/supabase.service';

type EditorTab = 'design' | 'preview' | 'collect' | 'analyze';
type DesignCenterTab = 'templates' | 'design';
type ShareSection = 'dashboard' | 'link' | 'qr' | 'channels' | 'embed' | 'checklist' | 'analytics' | 'settings';
type AnalyticsRange = '7d' | '14d' | '30d' | 'all';
type QuestionChartView = 'bars' | 'donut' | 'pie' | 'table';
type ResultsSection = 'analysis' | 'responses' | 'report';
type QrPresetId = 'flyer' | 'counter' | 'screen' | 'sticker' | 'event';
type AssetKind =
  | 'logo'
  | 'welcome-image'
  | 'end-image'
  | 'question-image'
  | 'welcome-title'
  | 'welcome-desc'
  | 'welcome-cta'
  | 'welcome-kicker'
  | 'welcome-meta'
  | 'welcome-preview'
  | 'question-meta'
  | 'question-title'
  | 'question-help'
  | 'question-answer'
  | 'end-rule'
  | 'end-icon'
  | 'end-title'
  | 'end-desc'
  | 'end-summary'
  | 'end-brand';
type TransformMode = 'move' | 'resize' | 'stretch';
type LayoutFrameMap = Record<string, SurveyElementConfig>;

interface PalettePreset {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
}

interface VisualDesignPreset {
  name: string;
  description: string;
  category: string;
  image: string;
  brand: Partial<SurveyBrand>;
}

interface PresentationPreset {
  name: string;
  description: string;
  icon: string;
  layout: NonNullable<SurveyMetadata['welcomeLayout']>;
  title: string;
  surveyDescription: string;
  ctaText: string;
  brand?: Partial<SurveyBrand>;
}

interface CompletionPreset {
  name: string;
  description: string;
  icon: string;
  layout: NonNullable<SurveyMetadata['endLayout']>;
  title: string;
  endDescription: string;
  brand?: Partial<SurveyBrand>;
}

interface QuestionStylePreset {
  value: NonNullable<SurveyBrand['questionStyle']>;
  name: string;
  description: string;
  icon: string;
  preview: 'classic' | 'compact' | 'soft' | 'outlined' | 'minimal' | 'boxed' | 'glass' | 'solid' | 'underline';
}

interface DesignCombinationPreset {
  kind: string;
  label: string;
  recipe: string;
  description: string;
  presentationName: string;
  visualName: string;
  question: NonNullable<SurveyBrand['questionStyle']>;
  completionName: string;
  background: string;
  dark?: boolean;
}

interface ActiveTransform {
  kind: AssetKind | string;
  index?: number;
  mode: TransformMode;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  originX: number;
  originY: number;
  initialFontSize?: number;
}

interface PublishChecklistItem {
  label: string;
  ok: boolean;
  detail: string;
}

interface QrPreset {
  id: QrPresetId;
  name: string;
  description: string;
  icon: string;
  size: number;
  color: string;
  useCase: string;
  trackingLabel: string;
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, CommonModule, SurveySimulatorComponent],
  templateUrl: './editor.html',
  styleUrls: ['./editor.css', './editor-canvas.css', './editor-share-results.css']
})
export class EditorPage implements OnInit, OnDestroy {
  survey = signal<Survey | null>(null);
  isNew = signal(false);
  saved = signal(false);
  isSaving = signal(false);
  saveError = signal<string | null>(null);
  infoMessage = signal<string | null>(null);
  copied = signal(false);

  dialogModal = signal<{ type: 'prompt' | 'confirm'; title: string; placeholder?: string; message?: string; value?: string; onConfirm: (val?: string) => void } | null>(null);
  dialogInputValue = '';

  openAnalyticsModal(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.showAnalyticsModal.set(true);
  }

  closeAnalyticsModal(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.showAnalyticsModal.set(false);
  }

  // Recuerda qué elemento tenía el foco antes de abrir un modal, para
  // devolverlo ahí al cerrarlo (si no, el usuario "pierde" su lugar en la página).
  private lastFocusedElement: HTMLElement | null = null;

  private captureFocus(): void {
    this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private restoreFocus(): void {
    const el = this.lastFocusedElement;
    this.lastFocusedElement = null;
    if (el && document.contains(el)) el.focus();
  }

  closeDialogModal(): void {
    this.dialogModal.set(null);
    this.restoreFocus();
  }

  confirmDialogModal(): void {
    const modal = this.dialogModal();
    if (modal) {
      modal.onConfirm(this.dialogInputValue);
    }
    this.closeDialogModal();
  }
  publishChecklist = signal<PublishChecklistItem[]>([]);
  showPublishChecklist = signal(false);
  activeShareSection = signal<ShareSection>('link');
  showShareDropdown = signal(false);

  surveyMaxResponses = signal<number | null>(null);
  surveyPreventDuplicates = signal(false);
  surveySkipWelcome = signal(false);
  surveyCloseDate = signal<string>('');

  // #3 Persistent save status
  hasUnsavedChanges = signal(false);
  saveFailed = signal(false);
  readonly saveStatusLabel = computed(() => {
    if (this.isSaving()) return { text: 'Guardando…', icon: 'sync', state: 'saving' };
    if (this.saveFailed()) return { text: 'Error al guardar — clic para reintentar', icon: 'error', state: 'error' };
    if (this.hasUnsavedChanges()) return { text: 'Sin guardar', icon: 'circle', state: 'unsaved' };
    if (this.saved()) return { text: 'Guardado', icon: 'check_circle', state: 'saved' };
    return { text: 'Guardado', icon: 'check_circle', state: 'idle' };
  });

  // #2 Pending delete (undo toast)
  deletePendingQuestion = signal<{ question: Question; index: number; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  // Feature: sidebar search
  sidebarSearch = signal('');
  readonly sidebarSearchResults = computed(() => {
    const term = this.sidebarSearch().trim().toLowerCase();
    if (!term) return null;
    const questions = this.survey()?.questions ?? [];
    const breaks = (this.survey()?.metadata as any)?.questionPageBreaks as number[] | undefined ?? [0];
    return questions
      .map((q, qi) => {
        const pageIdx = breaks.filter(b => b <= qi).length - 1;
        return { question: q, questionIndex: qi, pageIndex: Math.max(0, pageIdx), text: q.text || `Pregunta ${qi + 1}` };
      })
      .filter(r => r.text.toLowerCase().includes(term));
  });

  // Feature: drag-and-drop option reorder
  private dragOptionIndex: number | null = null;

  // Feature: preview restart
  @ViewChildren(SurveySimulatorComponent) simulators!: QueryList<SurveySimulatorComponent>;
  previewResetKey = signal(0);
  qrSize = signal(360);
  qrDownloading = signal(false);
  qrColor = signal('#111827');
  selectedQrPreset = signal<QrPresetId>('flyer');
  qrCtaText = signal('Escanea para responder');
  publicationDeadline = signal('');
  publicationAccess = signal<'public' | 'private'>('public');
  shareCopyHistory = signal<string[]>([]);
  readonly shareSections: { id: ShareSection; label: string; description: string; icon: string }[] = [
    { id: 'link', label: 'Enlace de encuesta', description: 'Link, estado y copias', icon: 'link' },
    { id: 'qr', label: 'Código QR', description: 'Impresos y eventos', icon: 'qr_code_2' },
    { id: 'channels', label: 'Canales rápidos', description: 'WhatsApp, email y texto', icon: 'send' },
    { id: 'settings', label: 'Configuración de publicación', description: 'Acceso y seguridad', icon: 'tune' }
  ];
  readonly resultsSections: { id: ResultsSection; label: string; description: string; icon: string }[] = [
    { id: 'analysis', label: 'Análisis', description: 'Métricas, gráficos y preguntas', icon: 'query_stats' },
    { id: 'responses', label: 'Respuestas individuales', description: 'Cada envío con detalle', icon: 'fact_check' },
    { id: 'report', label: 'Informe automático', description: 'Próximamente', icon: 'auto_awesome' }
  ];
  readonly qrPresets: QrPreset[] = [
    {
      id: 'flyer',
      name: 'Flyer',
      description: 'Impresión clara en hojas o folletos.',
      icon: 'print',
      size: 520,
      color: '#111827',
      useCase: 'Ideal para material A4, volante o carta impresa.',
      trackingLabel: 'flyer'
    },
    {
      id: 'counter',
      name: 'Mostrador',
      description: 'Visible en mesa o punto de atención.',
      icon: 'storefront',
      size: 420,
      color: '#111827',
      useCase: 'Úsalo en recepción, caja, mesa de evento o punto de servicio.',
      trackingLabel: 'mostrador'
    },
    {
      id: 'screen',
      name: 'Pantalla',
      description: 'Escaneo rápido desde proyector o TV.',
      icon: 'co_present',
      size: 640,
      color: '#111827',
      useCase: 'Recomendado para conferencias, aulas, webinars o pantallas grandes.',
      trackingLabel: 'pantalla'
    },
    {
      id: 'sticker',
      name: 'Sticker',
      description: 'Compacto para etiquetas pequeñas.',
      icon: 'loyalty',
      size: 300,
      color: '#111827',
      useCase: 'Funciona para stickers, credenciales o material físico pequeño.',
      trackingLabel: 'sticker'
    },
    {
      id: 'event',
      name: 'Evento',
      description: 'Alto contraste para alto tráfico.',
      icon: 'festival',
      size: 560,
      color: '#111827',
      useCase: 'Pensado para stands, activaciones, ferias y puntos de registro.',
      trackingLabel: 'evento'
    }
  ];

  activeSection = signal<'welcome' | 'questions' | 'end'>('welcome');
  activeQuestionIndex = signal(0);
  activeQuestionPageIndex = signal(0);
  activeResultsSection = signal<ResultsSection>('analysis');
  showAnalyticsModal = signal(false);
  showExportDropdown = signal(false);
  selectedAnalyticsQuestions = signal<string[]>([]);  selectedResponseId = signal('');
  analyticsRange = signal<AnalyticsRange>('all');
  analyticsTextSearch = signal('');
  questionChartViews = signal<Record<string, QuestionChartView>>({});
  expandedAnalyticsQuestionId = signal<string | null>(null);
  expandedAnalyticsQuestion = computed(() => {
    const id = this.expandedAnalyticsQuestionId();
    if (!id) return null;
    const all = this.getSelectedQuestionsAnalytics();
    return all.find((item: any) => item.question.id === id) ?? null;
  });
  hoveredSlice = signal<{ label: string; percentage: number; count: number } | null>(null);
  addQuestionPanel = false;
  questionEditorOpen = false;
  editingQuestionIndex = 0;
  logicPanelOpen = false;
  logicModalOpen = false;
  openLogicOptionId: string | null = null;
  logicDestinationCategory: 'question' | 'page' | 'web' | 'end' = 'question';
  private insertAfterQuestionIndex: number | null = null;
  private insertIntoPageIndex: number | null = null;

  // --- CANVAS STATE ---
  selectedElementIds = signal<string[]>([]);

  canvasData = computed(() => {
    return this.survey()?.metadata?.canvas;
  });

  currentScreen = computed(() => {
    const data = this.canvasData();
    if (!data || !data.screens || data.screens.length === 0) return null;

    const section = this.activeSection();
    const qIndex = this.activeQuestionIndex();

    const targetId = section === 'questions' ? `question-${qIndex}` : section;
    const screen = data.screens.find(s => s.id === targetId);

    // Fallback to help with state transitions or missing IDs
    return screen || data.screens[0];
  });

  currentElements = computed(() => {
    return this.currentScreen()?.elements || [];
  });

  selectedCanvasElements = computed(() => {
    const selected = new Set(this.selectedElementIds());
    return this.currentElements().filter((element) => selected.has(element.id));
  });

  layerElements = computed(() => {
    return [...this.currentElements()].sort((a, b) => b.zIndex - a.zIndex);
  });

  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  canRedo(): boolean {
    return this.historyIndex < this.historyStack.length - 1;
  }

  onCanvasSelectionChange(ids: string[]) {
    this.selectedElementIds.set(ids);
  }



  // History Stack for Undo/Redo
  private historyStack: string[] = [];
  private historyIndex = -1;
  private isUndoingRedoing = false;
  private copiedElementStyles: Record<string, any> | null = null;
  private infoMessageTimer: ReturnType<typeof setTimeout> | null = null;
  private saveErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private saveRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // Customization Tabs (Canva Style)

  currentTab = signal<EditorTab>('design');
  designCenterTab: DesignCenterTab = 'templates';

  previewDevice: 'desktop' | 'tablet' | 'mobile' = 'desktop';
  selectedBaseCategory = 'Todas';
  contextMenuVisible = false;
  openPageMenuIndex: number | null = null;
  contextMenuX = 0;
  contextMenuY = 0;
  collapsedSections: Record<string, boolean> = {};

  sidebarClass = () => {
    return 'editor-sidebar-right panel-open';
  };

  effectiveRightSidebarWidth(): number {
    if (this.currentTab() === 'design') return Math.min(Math.max(300, this.rightSidebarWidth), 560);
    return Math.max(300, this.rightSidebarWidth);
  }

  // Resizable sidebar logic
  isResizing = false;
  rightSidebarWidth = Number(localStorage.getItem('df_sidebar_width_v3')) || 380;

  // Contextual Focus
  focusSettings(section?: 'welcome' | 'questions' | 'end', index?: number) {
    this.currentTab.set('design');
    if (section) this.activeSection.set(section);
    if (index !== undefined) this.activeQuestionIndex.set(index);
  }

  openDesignCenter(tab: DesignCenterTab = 'templates'): void {
    this.designCenterTab = tab;
    this.showTemplateModal = true;
  }

  private showInfo(message: string): void {
    this.infoMessage.set(message);
    if (this.infoMessageTimer) clearTimeout(this.infoMessageTimer);
    this.infoMessageTimer = setTimeout(() => this.infoMessage.set(null), 2600);
  }

  private showError(message: string): void {
    this.saveError.set(message);
    if (this.saveErrorTimer) clearTimeout(this.saveErrorTimer);
    this.saveErrorTimer = setTimeout(() => this.saveError.set(null), 4200);
  }

  // Da un mensaje más útil que "no se pudo guardar" cuando se puede saber
  // por qué falló (sin conexión, red inalcanzable, timeout del servidor).
  private describeSaveError(error: unknown, fallback: string): string {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'Sin conexión a internet. Revisa tu red; reintentaremos automáticamente.';
    }
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
      return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
    }
    if (/timeout/i.test(message)) {
      return 'El servidor tardó demasiado en responder. Inténtalo de nuevo en unos segundos.';
    }
    return fallback;
  }




  startResizing(event: MouseEvent) {
    this.isResizing = true;
    event.preventDefault();
  }

  setPreviewDevice(device: 'desktop' | 'tablet' | 'mobile'): void {
    this.previewDevice = device;
  }

  openPublicPreview(): void {
    const survey = this.survey();
    if (!survey) return;
    if (survey.status !== 'activo') {
      this.showError('Publica la encuesta antes de abrir la vista pública.');
      return;
    }

    window.open(this.surveyService.getShareLink(survey.id), '_blank', 'noopener,noreferrer');
  }

  showTemplateModal = false;

  // Floating Format Bar State
  selectionVisible = false;
  selectionPos = { x: 0, y: 0 };

  private boundSelectionChange = () => {
    // Most selectionchange events are just the caret moving (collapsed selection).
    // Skip entering NgZone for those when there's no floating bar to hide either.
    const selection = window.getSelection();
    const hasRealSelection = !!selection && !selection.isCollapsed && !!selection.toString().trim();
    if (!hasRealSelection && !this.selectionVisible) {
      return;
    }
    this.ngZone.run(() => this.onSelectionChange());
  };

  private boundDocumentClick = (event: MouseEvent) => {
    // Nothing to react to unless the export dropdown is actually open.
    if (!this.showExportDropdown()) {
      return;
    }
    this.ngZone.run(() => this.onDocumentClick(event));
  };

  onSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      this.selectionVisible = false;
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Check if selection is within our editable canvas
    const canvas = document.querySelector('.editor-canvas');
    if (canvas && canvas.contains(range.commonAncestorContainer)) {
      this.selectionPos = {
        x: rect.left + (rect.width / 2) - 100, // Center the 200px wide bar
        y: rect.top - 50 // Position above
      };
      this.selectionVisible = true;
    } else {
      this.selectionVisible = false;
    }
  }

  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.inline-export-menu')) {
      this.showExportDropdown.set(false);
    }
  }

  toggleExportDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showExportDropdown.update((open) => !open);
  }

  onFontChange(font: string) {
    if (!font) return;
    this.loadGoogleFont(font);
    document.execCommand('fontName', false, font);
    // Also update the global font if it's the whole element (optional, but keep simple for now)
  }

  execCommand(command: string) {
    document.execCommand(command, false);
  }

  readonly templatePresets: {
    name: string;
    description: string;
    icon: string;
    category: string;
    image?: string;
    brand: Partial<import('../../services/survey.service').SurveyBrand>;
    questions: { text: string; type: string }[];
    welcomeTitle: string;
    endTitle: string;
  }[] = [
    {
      name: 'Satisfacción del Cliente',
      description: 'Mide la experiencia de tus clientes con tu producto o servicio.',
      icon: 'ph-star',
      category: 'Negocio',
      brand: { primaryColor: '#2563eb', secondaryColor: '#0ea5e9', backgroundColor: '#eff6ff', surfaceColor: '#ffffff', textColor: '#1e3a5f', buttonStyle: 'pill', fontTitle: 'Poppins', fontBody: 'Inter', shadowPreset: 'soft' },
      questions: [
        { text: '¿Qué tan satisfecho estás con nuestro servicio?', type: 'rating' },
        { text: '¿Recomendarías nuestro producto a un amigo?', type: 'scale' },
        { text: '¿Qué podemos mejorar?', type: 'text' }
      ],
      welcomeTitle: 'Tu opinión nos importa',
      endTitle: '¡Gracias por tu feedback!'
    },
    {
      name: 'Clima Laboral',
      description: 'Evalúa el ambiente de trabajo y satisfacción del equipo.',
      icon: 'ph-users',
      category: 'RRHH',
      brand: { primaryColor: '#059669', secondaryColor: '#10b981', backgroundColor: '#ecfdf5', surfaceColor: '#ffffff', textColor: '#064e3b', buttonStyle: 'rounded', fontTitle: 'Outfit', fontBody: 'Inter', shadowPreset: 'medium' },
      questions: [
        { text: '¿Cómo calificarías tu ambiente de trabajo?', type: 'scale' },
        { text: '¿Te sientes valorado en tu equipo?', type: 'multiple-choice' },
        { text: '¿Qué sugerencias tienes para mejorar?', type: 'text' }
      ],
      welcomeTitle: 'Encuesta de Clima Laboral',
      endTitle: '¡Tu voz hace la diferencia!'
    },
    {
      name: 'Registro de Evento',
      description: 'Formulario de inscripción para eventos y conferencias.',
      icon: 'ph-ticket',
      category: 'Eventos',
      brand: { primaryColor: '#440789', secondaryColor: '#a78bfa', backgroundColor: '#f5f3ff', surfaceColor: '#ffffff', textColor: '#3b0764', buttonStyle: 'pill', fontTitle: 'Space Grotesk', fontBody: 'Inter', shadowPreset: 'float', glassEffect: true },
      questions: [
        { text: '¿Cuál es tu nombre completo?', type: 'text' },
        { text: '¿A qué sesión deseas asistir?', type: 'multiple-choice' },
        { text: '¿Necesitas algún requerimiento especial?', type: 'text' }
      ],
      welcomeTitle: '¡Regístrate al Evento!',
      endTitle: '¡Registro exitoso!'
    },
    {
      name: 'Evaluación Educativa',
      description: 'Evalúa el desempeño docente y cursos académicos.',
      icon: 'ph-books',
      category: 'Educación',
      brand: { primaryColor: '#1d4ed8', secondaryColor: '#3b82f6', backgroundColor: '#eef2ff', surfaceColor: '#ffffff', textColor: '#1e293b', buttonStyle: 'rounded', fontTitle: 'Merriweather', fontBody: 'Source Sans 3', shadowPreset: 'soft' },
      questions: [
        { text: '¿Cómo calificarías la calidad del curso?', type: 'rating' },
        { text: '¿El material fue útil y actualizado?', type: 'scale' },
        { text: '¿Qué tema te gustaría que se agregara?', type: 'text' }
      ],
      welcomeTitle: 'Evaluación del Curso',
      endTitle: '¡Gracias por evaluar!'
    },
    {
      name: 'Consulta Médica',
      description: 'Pre-consulta y seguimiento de pacientes.',
      icon: 'ph-first-aid',
      category: 'Salud',
      brand: { primaryColor: '#0d9488', secondaryColor: '#14b8a6', backgroundColor: '#f0fdfa', surfaceColor: '#ffffff', textColor: '#134e4a', buttonStyle: 'rounded', fontTitle: 'DM Sans', fontBody: 'Inter', shadowPreset: 'soft' },
      questions: [
        { text: '¿Cuál es el motivo de su consulta?', type: 'text' },
        { text: '¿Tiene alguna alergia conocida?', type: 'multiple-choice' },
        { text: '¿Cómo califica la atención recibida?', type: 'rating' }
      ],
      welcomeTitle: 'Formulario de Paciente',
      endTitle: 'Información registrada correctamente'
    },
    {
      name: 'Feedback de Producto',
      description: 'Recopila opiniones sobre tu producto digital.',
      icon: 'ph-rocket',
      category: 'Producto',
      brand: { primaryColor: '#e11d48', secondaryColor: '#f43f5e', backgroundColor: '#fff1f2', surfaceColor: '#ffffff', textColor: '#4c0519', buttonStyle: 'pill', fontTitle: 'Plus Jakarta Sans', fontBody: 'Inter', shadowPreset: 'medium', borderGlow: true },
      questions: [
        { text: '¿Qué funcionalidad usas más?', type: 'multiple-choice' },
        { text: '¿Qué tan fácil es usar el producto?', type: 'scale' },
        { text: '¿Qué funcionalidad te gustaría que agregáramos?', type: 'text' }
      ],
      welcomeTitle: 'Ayúdanos a mejorar',
      endTitle: '¡Tu opinión impulsa nuestro producto!'
    },
    {
      name: 'Encuesta Gastronómica',
      description: 'Evalúa la experiencia en tu restaurante.',
      icon: 'ph-fork-knife',
      category: 'Restaurante',
      brand: { primaryColor: '#b45309', secondaryColor: '#d97706', backgroundColor: '#fffbeb', surfaceColor: '#ffffff', textColor: '#451a03', buttonStyle: 'rounded', fontTitle: 'Playfair Display', fontBody: 'Lato', shadowPreset: 'soft' },
      questions: [
        { text: '¿Cómo calificarías la calidad de la comida?', type: 'rating' },
        { text: '¿El tiempo de espera fue razonable?', type: 'scale' },
        { text: '¿Algún comentario adicional?', type: 'text' }
      ],
      welcomeTitle: '¿Cómo fue tu experiencia?',
      endTitle: '¡Gracias por visitarnos!'
    },
    {
      name: 'Encuesta Inmobiliaria',
      description: 'Captura preferencias para búsqueda de propiedades.',
      icon: 'ph-house',
      category: 'Inmobiliaria',
      brand: { primaryColor: '#374151', secondaryColor: '#6b7280', backgroundColor: '#f9fafb', surfaceColor: '#ffffff', textColor: '#111827', buttonStyle: 'square', fontTitle: 'Outfit', fontBody: 'Inter', shadowPreset: 'strong' },
      questions: [
        { text: '¿Qué tipo de propiedad buscas?', type: 'multiple-choice' },
        { text: '¿Cuál es tu presupuesto aproximado?', type: 'multiple-choice' },
        { text: '¿Qué zona prefieres?', type: 'text' }
      ],
      welcomeTitle: 'Encuentra tu hogar ideal',
      endTitle: '¡Te contactaremos pronto!'
    },
    {
      name: 'Investigación de Mercado',
      description: 'Valida audiencia, hábitos de compra y percepción de marca.',
      icon: 'ph-chart-line-up',
      category: 'Negocio',
      brand: { primaryColor: '#0f766e', secondaryColor: '#f97316', backgroundColor: '#f0fdfa', surfaceColor: '#ffffff', textColor: '#134e4a', buttonStyle: 'rounded', fontTitle: 'Manrope', fontBody: 'Inter', shadowPreset: 'medium' },
      questions: [
        { text: '¿Con qué frecuencia compras productos de esta categoría?', type: 'multiple-choice' },
        { text: '¿Qué factor influye más en tu decisión de compra?', type: 'multiple-choice' },
        { text: '¿Qué marca recuerdas primero en esta categoría?', type: 'text' },
        { text: '¿Qué tan atractivo te parece este concepto?', type: 'rating' }
      ],
      welcomeTitle: 'Queremos entender tu mercado',
      endTitle: 'Gracias por compartir tu perspectiva'
    },
    {
      name: 'Onboarding de Clientes',
      description: 'Recoge necesidades iniciales para configurar un servicio.',
      icon: 'ph-handshake',
      category: 'Servicios',
      brand: { primaryColor: '#2563eb', secondaryColor: '#14b8a6', backgroundColor: '#eff6ff', surfaceColor: '#ffffff', textColor: '#1e3a8a', buttonStyle: 'pill', fontTitle: 'Plus Jakarta Sans', fontBody: 'Inter', shadowPreset: 'soft' },
      questions: [
        { text: '¿Cuál es tu objetivo principal con este servicio?', type: 'text' },
        { text: '¿Qué nivel de experiencia tienes con soluciones similares?', type: 'multiple-choice' },
        { text: '¿Qué plazo ideal manejas para ver resultados?', type: 'multiple-choice' },
        { text: '¿Hay algo que debamos saber antes de empezar?', type: 'text' }
      ],
      welcomeTitle: 'Configuremos tu experiencia',
      endTitle: 'Tenemos lo necesario para empezar'
    },
    {
      name: 'Evaluación de Capacitación',
      description: 'Mide claridad, utilidad y aplicabilidad de una formación.',
      icon: 'ph-graduation-cap',
      category: 'Educación',
      brand: { primaryColor: '#1d4ed8', secondaryColor: '#64748b', backgroundColor: '#f8fafc', surfaceColor: '#ffffff', textColor: '#1e293b', buttonStyle: 'rounded', fontTitle: 'Merriweather', fontBody: 'Source Sans 3', shadowPreset: 'soft' },
      questions: [
        { text: '¿Qué tan claro fue el contenido presentado?', type: 'rating' },
        { text: '¿El ritmo de la capacitación fue adecuado?', type: 'scale' },
        { text: '¿Qué tema te resultó más útil?', type: 'text' },
        { text: '¿Qué mejorarías para futuras sesiones?', type: 'text' }
      ],
      welcomeTitle: 'Evalúa la capacitación',
      endTitle: 'Gracias por ayudarnos a mejorar'
    },
    {
      name: 'Solicitud de Soporte',
      description: 'Ordena reportes de incidencias y nivel de urgencia.',
      icon: 'ph-lifebuoy',
      category: 'Producto',
      brand: { primaryColor: '#dc2626', secondaryColor: '#f59e0b', backgroundColor: '#fff7ed', surfaceColor: '#ffffff', textColor: '#431407', buttonStyle: 'rounded', fontTitle: 'Inter', fontBody: 'Inter', shadowPreset: 'medium' },
      questions: [
        { text: '¿Qué problema estás experimentando?', type: 'text' },
        { text: '¿Qué tan urgente es la solicitud?', type: 'scale' },
        { text: '¿En qué parte del producto ocurrió?', type: 'multiple-choice' },
        { text: '¿Puedes compartir pasos para reproducirlo?', type: 'text' }
      ],
      welcomeTitle: 'Cuéntanos qué ocurrió',
      endTitle: 'Tu solicitud fue registrada'
    }
  ];

  applyTemplate(index: number): void {
    const tpl = this.templatePresets[index];
    if (!tpl) return;

    this.survey.update((survey) => {
      if (!survey) return survey;
      const currentBrand = this.ensureBrand(survey.metadata?.brand);
      const brand = this.ensureBrand({ ...currentBrand, ...tpl.brand });
      const questions = tpl.questions.map((q, i) => ({
        id: crypto.randomUUID(),
        text: q.text,
        type: q.type as 'text' | 'multiple-choice' | 'scale' | 'rating',
        required: i === 0,
        options: q.type === 'multiple-choice'
          ? [
              { id: crypto.randomUUID(), texto: 'Opción 1' },
              { id: crypto.randomUUID(), texto: 'Opción 2' },
              { id: crypto.randomUUID(), texto: 'Opción 3' }
            ]
          : []
      }));
      const metadata = this.ensureMetadata(survey.metadata);
      const updated = {
        ...survey,
        title: survey.title || tpl.name,
        questions,
        metadata: { ...metadata, brand, endTitle: tpl.endTitle, endDescription: 'Tus respuestas han sido registradas.' }
      };
      return this.normalizeSurvey(updated);
    });

    this.activeSection.set('welcome');
    this.activeQuestionIndex.set(0);
    this.showTemplateModal = false;
    this.queueSave();
  }

  baseTemplateCategories(): string[] {
    return ['Todas', ...Array.from(new Set(this.templatePresets.map((template) => template.category)))];
  }

  filteredBaseTemplates(): Array<(typeof this.templatePresets)[number] & { originalIndex: number }> {
    return this.templatePresets
      .map((template, originalIndex) => ({ ...template, originalIndex }))
      .filter((template) => this.selectedBaseCategory === 'Todas' || template.category === this.selectedBaseCategory);
  }

  applyDesignCombination(kind: string): void {
    const combo = this.designCombinations.find((item) => item.kind === kind);
    if (!combo) return;

    const map = {
      presentation: this.presentationPresets.find((item) => item.name === combo.presentationName) ?? this.presentationPresets[0],
      visual: this.visualDesignPresets.find((item) => item.name === combo.visualName) ?? this.visualDesignPresets[0],
      question: combo.question,
      completion: this.completionPresets.find((item) => item.name === combo.completionName) ?? this.completionPresets[0]
    };

    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const brand = this.ensureBrand({
        ...metadata.brand,
        ...map.visual.brand,
        ...(map.presentation.brand ?? {}),
        ...(map.completion.brand ?? {}),
        questionStyle: map.question
      });

      return {
        ...survey,
        title: map.presentation.title,
        description: map.presentation.surveyDescription,
        metadata: {
          ...metadata,
          brand,
          welcomeLayout: map.presentation.layout,
          ctaText: map.presentation.ctaText,
          endLayout: map.completion.layout,
          endTitle: map.completion.title,
          endDescription: map.completion.endDescription,
          thankYouTitle: map.completion.title,
          thankYouDescription: map.completion.endDescription
        }
      };
    });

    for (const font of [
      map.visual.brand.fontTitle,
      map.visual.brand.fontBody,
      map.presentation.brand?.fontTitle,
      map.presentation.brand?.fontBody,
      map.completion.brand?.fontTitle,
      map.completion.brand?.fontBody
    ]) {
      if (font) this.loadGoogleFont(font);
    }

    this.activeSection.set('welcome');
    this.showTemplateModal = false;
    this.queueSave();
    this.showInfo(`Combinación "${combo.label}" aplicada sin cambiar las preguntas.`);
  }

  private readonly saveSubject = new Subject<void>();
  private pendingSave = false;
  private activeTransform: ActiveTransform | null = null;

  readonly palettePresets: PalettePreset[] = [
    {
      name: 'Profesional',
      primaryColor: '#1d4ed8',
      secondaryColor: '#0f766e',
      backgroundColor: '#eaf1ff',
      surfaceColor: '#ffffff',
      textColor: '#0f172a'
    },
    {
      name: 'Coral',
      primaryColor: '#ea580c',
      secondaryColor: '#be123c',
      backgroundColor: '#fff1eb',
      surfaceColor: '#fffaf7',
      textColor: '#431407'
    },
    {
      name: 'Bosque',
      primaryColor: '#15803d',
      secondaryColor: '#0f766e',
      backgroundColor: '#edfdf2',
      surfaceColor: '#ffffff',
      textColor: '#052e16'
    },
    {
      name: 'Nocturna',
      primaryColor: '#440789',
      secondaryColor: '#2563eb',
      backgroundColor: '#16132b',
      surfaceColor: '#221b3d',
      textColor: '#f8fafc'
    },
    {
      name: 'Arena',
      primaryColor: '#a16207',
      secondaryColor: '#b45309',
      backgroundColor: '#fff7ed',
      surfaceColor: '#fffbeb',
      textColor: '#451a03'
    },
    {
      name: 'Magenta',
      primaryColor: '#c026d3',
      secondaryColor: '#440789',
      backgroundColor: '#fdf4ff',
      surfaceColor: '#ffffff',
      textColor: '#581c87'
    },
    {
      name: 'Médico',
      primaryColor: '#0891b2',
      secondaryColor: '#14b8a6',
      backgroundColor: '#ecfeff',
      surfaceColor: '#ffffff',
      textColor: '#164e63'
    },
    {
      name: 'Tecnología',
      primaryColor: '#0284c7',
      secondaryColor: '#06b6d4',
      backgroundColor: '#f0f9ff',
      surfaceColor: '#ffffff',
      textColor: '#0c4a6e'
    },
    {
      name: 'Gamer',
      primaryColor: '#440789',
      secondaryColor: '#22d3ee',
      backgroundColor: '#0f0a1e',
      surfaceColor: '#1a1333',
      textColor: '#f0e6ff'
    },
    {
      name: 'Elegante',
      primaryColor: '#1f2937',
      secondaryColor: '#d4af37',
      backgroundColor: '#fafaf9',
      surfaceColor: '#ffffff',
      textColor: '#111827'
    },
    {
      name: 'Nutrición',
      primaryColor: '#16a34a',
      secondaryColor: '#84cc16',
      backgroundColor: '#f0fdf4',
      surfaceColor: '#ffffff',
      textColor: '#14532d'
    },
    {
      name: 'Agropecuario',
      primaryColor: '#854d0e',
      secondaryColor: '#65a30d',
      backgroundColor: '#fefce8',
      surfaceColor: '#fffbeb',
      textColor: '#422006'
    },
    {
      name: 'Académico',
      primaryColor: '#1e40af',
      secondaryColor: '#64748b',
      backgroundColor: '#f1f5f9',
      surfaceColor: '#ffffff',
      textColor: '#1e293b'
    },
    {
      name: 'Minimalista',
      primaryColor: '#18181b',
      secondaryColor: '#71717a',
      backgroundColor: '#ffffff',
      surfaceColor: '#fafafa',
      textColor: '#09090b'
    },
    {
      name: 'Pastel',
      primaryColor: '#ec4899',
      secondaryColor: '#a78bfa',
      backgroundColor: '#fdf2f8',
      surfaceColor: '#ffffff',
      textColor: '#831843'
    }
  ];

  readonly visualDesignPresets: VisualDesignPreset[] = [
    {
      name: 'Editorial claro',
      description: 'Fondo fotografico suave, tarjeta limpia y titulares elegantes.',
      category: 'Contenido',
      image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#2563eb',
        secondaryColor: '#f97316',
        backgroundColor: '#eef4ff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#172033',
        questionStyle: 'classic',
        buttonStyle: 'pill',
        cardRadius: 24,
        buttonRadius: 999,
        fontTitle: 'Playfair Display',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Producto tech',
      description: 'Oscuro, contraste alto y acentos electricos para productos digitales.',
      category: 'SaaS',
      image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#22d3ee',
        secondaryColor: '#f43f5e',
        backgroundColor: '#0b1020',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#111827',
        textColor: '#f8fafc',
        questionStyle: 'glass',
        buttonStyle: 'rounded',
        cardRadius: 22,
        buttonRadius: 16,
        fontTitle: 'Space Grotesk',
        fontBody: 'Inter',
        fontButton: 'Inter',
        glassEffect: true,
        shadowPreset: 'float',
        borderGlow: true
      }
    },
    {
      name: 'Salud tranquila',
      description: 'Colores calmados, lectura clara e imagen ligera para clinicas.',
      category: 'Salud',
      image: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#0f766e',
        secondaryColor: '#38bdf8',
        backgroundColor: '#ecfeff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#134e4a',
        questionStyle: 'soft',
        buttonStyle: 'rounded',
        cardRadius: 28,
        buttonRadius: 18,
        fontTitle: 'DM Sans',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Evento premium',
      description: 'Impacto visual, alto contraste y respuestas tipo tarjeta.',
      category: 'Eventos',
      image: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#db2777',
        secondaryColor: '#f59e0b',
        backgroundColor: '#18051a',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#fff7ed',
        textColor: '#3b0a2f',
        questionStyle: 'boxed',
        buttonStyle: 'pill',
        cardRadius: 20,
        buttonRadius: 999,
        fontTitle: 'Montserrat',
        fontBody: 'Inter',
        fontButton: 'Montserrat',
        shadowPreset: 'strong',
        borderGlow: true
      }
    },
    {
      name: 'Academico sobrio',
      description: 'Estructura formal para cursos, evaluaciones e investigacion.',
      category: 'Educacion',
      image: 'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#1d4ed8',
        secondaryColor: '#64748b',
        backgroundColor: '#f8fafc',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#111827',
        questionStyle: 'outlined',
        buttonStyle: 'square',
        cardRadius: 16,
        buttonRadius: 10,
        fontTitle: 'Merriweather',
        fontBody: 'Source Sans 3',
        fontButton: 'Source Sans 3',
        shadowPreset: 'none'
      }
    },
    {
      name: 'Minimal blanco',
      description: 'Sin ruido visual, perfecto para encuestas cortas y directas.',
      category: 'Minimal',
      image: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#18181b',
        secondaryColor: '#71717a',
        backgroundColor: '#ffffff',
        backgroundImageUrl: undefined,
        surfaceColor: '#ffffff',
        textColor: '#09090b',
        questionStyle: 'underline',
        buttonStyle: 'square',
        cardRadius: 16,
        buttonRadius: 10,
        fontTitle: 'Inter',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'none',
        glassEffect: false,
        borderGlow: false
      }
    },
    {
      name: 'Retail vibrante',
      description: 'Colores vivos para experiencia de compra, producto y promociones.',
      category: 'Retail',
      image: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#e11d48',
        secondaryColor: '#f59e0b',
        backgroundColor: '#fff1f2',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#4c0519',
        questionStyle: 'boxed',
        buttonStyle: 'pill',
        cardRadius: 26,
        buttonRadius: 999,
        fontTitle: 'Plus Jakarta Sans',
        fontBody: 'Inter',
        fontButton: 'Plus Jakarta Sans',
        shadowPreset: 'medium'
      }
    },
    {
      name: 'Finanzas sobrias',
      description: 'Serio, claro y confiable para reportes, auditorías o B2B.',
      category: 'Finanzas',
      image: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#0f766e',
        secondaryColor: '#334155',
        backgroundColor: '#f8fafc',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        questionStyle: 'outlined',
        buttonStyle: 'square',
        cardRadius: 14,
        buttonRadius: 8,
        fontTitle: 'IBM Plex Sans',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Comunidad cálida',
      description: 'Cercano y humano para ONG, comunidades y programas sociales.',
      category: 'Comunidad',
      image: 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#16a34a',
        secondaryColor: '#f97316',
        backgroundColor: '#f0fdf4',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#14532d',
        questionStyle: 'soft',
        buttonStyle: 'rounded',
        cardRadius: 30,
        buttonRadius: 20,
        fontTitle: 'Nunito Sans',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Lujo discreto',
      description: 'Elegante, editorial y oscuro para marcas premium.',
      category: 'Premium',
      image: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#d4af37',
        secondaryColor: '#f5f5f4',
        backgroundColor: '#11100f',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#1f1b18',
        textColor: '#fffaf0',
        questionStyle: 'solid',
        buttonStyle: 'square',
        cardRadius: 18,
        buttonRadius: 10,
        fontTitle: 'Cormorant Garamond',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'strong'
      }
    },
    {
      name: 'Startup fresca',
      description: 'Ligera, moderna y optimista para producto y crecimiento.',
      category: 'Startup',
      image: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#2563eb',
        secondaryColor: '#10b981',
        backgroundColor: '#eff6ff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#172554',
        questionStyle: 'compact',
        buttonStyle: 'pill',
        cardRadius: 22,
        buttonRadius: 999,
        fontTitle: 'Outfit',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'medium'
      }
    },
    {
      name: 'Restaurante sensorial',
      description: 'Cálido y visual para reseñas gastronómicas y servicio.',
      category: 'Restaurante',
      image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#b45309',
        secondaryColor: '#dc2626',
        backgroundColor: '#fffbeb',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#451a03',
        questionStyle: 'classic',
        buttonStyle: 'rounded',
        cardRadius: 26,
        buttonRadius: 18,
        fontTitle: 'Playfair Display',
        fontBody: 'Lato',
        fontButton: 'Lato',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Inmobiliaria limpia',
      description: 'Espacios amplios y lectura clara para leads y propiedades.',
      category: 'Inmobiliaria',
      image: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#374151',
        secondaryColor: '#0ea5e9',
        backgroundColor: '#f9fafb',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#111827',
        questionStyle: 'minimal',
        buttonStyle: 'square',
        cardRadius: 16,
        buttonRadius: 8,
        fontTitle: 'Outfit',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Creativo neón',
      description: 'Atrevido para campañas, comunidades creativas y lanzamientos.',
      category: 'Creativo',
      image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#440789',
        secondaryColor: '#22d3ee',
        backgroundColor: '#0f0520',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#171129',
        textColor: '#faf5ff',
        questionStyle: 'glass',
        buttonStyle: 'pill',
        cardRadius: 30,
        buttonRadius: 999,
        fontTitle: 'Space Grotesk',
        fontBody: 'Inter',
        fontButton: 'Space Grotesk',
        glassEffect: true,
        borderGlow: true,
        shadowPreset: 'float'
      }
    },
    {
      name: 'Gobierno claro',
      description: 'Neutral, accesible y organizado para consultas ciudadanas.',
      category: 'Institucional',
      image: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#1d4ed8',
        secondaryColor: '#475569',
        backgroundColor: '#f8fafc',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#0f172a',
        questionStyle: 'outlined',
        buttonStyle: 'rounded',
        cardRadius: 12,
        buttonRadius: 10,
        fontTitle: 'Source Sans 3',
        fontBody: 'Source Sans 3',
        fontButton: 'Source Sans 3',
        shadowPreset: 'none'
      }
    },
    {
      name: 'Fitness activo',
      description: 'Energético para retos, bienestar y hábitos saludables.',
      category: 'Bienestar',
      image: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#16a34a',
        secondaryColor: '#facc15',
        backgroundColor: '#f7fee7',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#1a2e05',
        questionStyle: 'boxed',
        buttonStyle: 'pill',
        cardRadius: 24,
        buttonRadius: 999,
        fontTitle: 'Montserrat',
        fontBody: 'Inter',
        fontButton: 'Montserrat',
        shadowPreset: 'medium'
      }
    },
    {
      name: 'Legal profesional',
      description: 'Sobrio y preciso para formularios de cumplimiento o asesoría.',
      category: 'Legal',
      image: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#1e3a8a',
        secondaryColor: '#a16207',
        backgroundColor: '#f8fafc',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#111827',
        questionStyle: 'underline',
        buttonStyle: 'square',
        cardRadius: 12,
        buttonRadius: 8,
        fontTitle: 'Merriweather',
        fontBody: 'Source Sans 3',
        fontButton: 'Source Sans 3',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Zine experimental',
      description: 'Tipografía editorial, contraste fuerte y ritmo de publicación independiente.',
      category: 'Creativo',
      image: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#111827',
        secondaryColor: '#ef4444',
        backgroundColor: '#fff7ed',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#111827',
        questionStyle: 'underline',
        buttonStyle: 'square',
        cardRadius: 10,
        buttonRadius: 4,
        fontTitle: 'Space Grotesk',
        fontBody: 'IBM Plex Sans',
        fontButton: 'Space Grotesk',
        shadowPreset: 'none'
      }
    },
    {
      name: 'Laboratorio de ideas',
      description: 'Exploratorio, luminoso y con tarjetas limpias para validar conceptos.',
      category: 'Innovación',
      image: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#0ea5e9',
        secondaryColor: '#84cc16',
        backgroundColor: '#f0f9ff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#082f49',
        questionStyle: 'soft',
        buttonStyle: 'rounded',
        cardRadius: 32,
        buttonRadius: 18,
        fontTitle: 'Outfit',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'float'
      }
    },
    {
      name: 'Mapa de decisiones',
      description: 'Organizado como recorrido estratégico para priorizar opciones complejas.',
      category: 'Estrategia',
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#166534',
        secondaryColor: '#0f766e',
        backgroundColor: '#ecfdf5',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#052e16',
        questionStyle: 'outlined',
        buttonStyle: 'rounded',
        cardRadius: 18,
        buttonRadius: 12,
        fontTitle: 'Manrope',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'medium'
      }
    },
    {
      name: 'Galería inmersiva',
      description: 'Sensación de exhibición para pedir feedback sobre piezas, campañas o prototipos.',
      category: 'Arte',
      image: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#7c2d12',
        secondaryColor: '#be185d',
        backgroundColor: '#fff7ed',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#fffaf0',
        textColor: '#431407',
        questionStyle: 'minimal',
        buttonStyle: 'square',
        cardRadius: 12,
        buttonRadius: 6,
        fontTitle: 'Cormorant Garamond',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    },
    {
      name: 'Brief creativo',
      description: 'Pensado para levantar objetivos, tono, referencias y restricciones de diseño.',
      category: 'Briefing',
      image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#440789',
        secondaryColor: '#f97316',
        backgroundColor: '#eef2ff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#1e1b4b',
        questionStyle: 'boxed',
        buttonStyle: 'pill',
        cardRadius: 24,
        buttonRadius: 999,
        fontTitle: 'Plus Jakarta Sans',
        fontBody: 'Inter',
        fontButton: 'Plus Jakarta Sans',
        shadowPreset: 'medium'
      }
    },
    {
      name: 'Cine documental',
      description: 'Dramático y narrativo para entrevistas, historias de usuario y discovery.',
      category: 'Storytelling',
      image: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#f97316',
        secondaryColor: '#facc15',
        backgroundColor: '#111827',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#1f2937',
        textColor: '#fff7ed',
        questionStyle: 'solid',
        buttonStyle: 'rounded',
        cardRadius: 20,
        buttonRadius: 14,
        fontTitle: 'Montserrat',
        fontBody: 'Inter',
        fontButton: 'Montserrat',
        shadowPreset: 'strong'
      }
    },
    {
      name: 'Sistema solar de producto',
      description: 'Digital, circular y expansivo para priorizar features o journeys.',
      category: 'Producto',
      image: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#38bdf8',
        secondaryColor: '#a78bfa',
        backgroundColor: '#020617',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#0f172a',
        textColor: '#e0f2fe',
        questionStyle: 'glass',
        buttonStyle: 'pill',
        cardRadius: 34,
        buttonRadius: 999,
        fontTitle: 'Space Grotesk',
        fontBody: 'Inter',
        fontButton: 'Space Grotesk',
        glassEffect: true,
        borderGlow: true,
        shadowPreset: 'float'
      }
    },
    {
      name: 'Mesa de workshop',
      description: 'Colaborativo, táctico y útil para sesiones de cocreación.',
      category: 'Workshop',
      image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=900',
      brand: {
        primaryColor: '#440789',
        secondaryColor: '#14b8a6',
        backgroundColor: '#f5f3ff',
        backgroundImageUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=1400',
        surfaceColor: '#ffffff',
        textColor: '#2e1065',
        questionStyle: 'classic',
        buttonStyle: 'rounded',
        cardRadius: 28,
        buttonRadius: 16,
        fontTitle: 'Nunito Sans',
        fontBody: 'Inter',
        fontButton: 'Inter',
        shadowPreset: 'soft'
      }
    }
  ];

  readonly presentationPresets: PresentationPreset[] = [
    {
      name: 'Directa',
      description: 'Entrada corta para encuestas rápidas.',
      icon: 'bolt',
      layout: 'minimal',
      title: 'Queremos conocer tu opinión',
      surveyDescription: 'Responde unas preguntas breves. Tus respuestas nos ayudan a tomar mejores decisiones.',
      ctaText: 'Comenzar',
      brand: { entryAnimation: 'fadeUp', progressBar: { enabled: true, style: 'line' } }
    },
    {
      name: 'Premium',
      description: 'Tono cuidado para marcas y eventos.',
      icon: 'auto_awesome',
      layout: 'poster',
      title: 'Tu experiencia merece ser escuchada',
      surveyDescription: 'Comparte tu perspectiva con calma. Cada respuesta nos ayuda a diseñar una experiencia más valiosa.',
      ctaText: 'Iniciar experiencia',
      brand: { buttonStyle: 'pill', shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Investigación',
      description: 'Presentación formal para estudios.',
      icon: 'science',
      layout: 'split',
      title: 'Participa en este estudio',
      surveyDescription: 'La información será usada para analizar tendencias y mejorar nuestras decisiones. Completarlo toma pocos minutos.',
      ctaText: 'Participar',
      brand: { buttonStyle: 'rounded', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Cercana',
      description: 'Lenguaje humano para feedback.',
      icon: 'waving_hand',
      layout: 'centered',
      title: 'Tenemos una pregunta para ti',
      surveyDescription: 'Tu punto de vista nos ayuda a mejorar. No hay respuestas incorrectas, solo queremos escucharte.',
      ctaText: 'Dar mi opinión',
      brand: { buttonStyle: 'pill', questionStyle: 'soft', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Editorial',
      description: 'Portada tipo revista para estudios con mucha presencia.',
      icon: 'view_quilt',
      layout: 'editorial',
      title: 'La historia empieza con tu respuesta',
      surveyDescription: 'Ayúdanos a leer mejor el contexto. Esta encuesta reúne señales clave para construir una experiencia más precisa.',
      ctaText: 'Abrir encuesta',
      brand: { buttonStyle: 'square', cardRadius: 18, fontTitle: 'Playfair Display', fontBody: 'Inter', shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Órbita',
      description: 'Composición dinámica con preview flotante y sensación digital.',
      icon: 'orbit',
      layout: 'orbit',
      title: 'Conecta tu opinión con lo que viene',
      surveyDescription: 'Cada respuesta aporta una señal. Completa el recorrido y ayúdanos a priorizar lo que realmente importa.',
      ctaText: 'Entrar al recorrido',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', glassEffect: true, borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Showcase',
      description: 'Portada de alto impacto para productos, eventos o campañas.',
      icon: 'featured_play_list',
      layout: 'showcase',
      title: 'Queremos ver la experiencia desde tus ojos',
      surveyDescription: 'Responde con libertad. Tu feedback nos permite detectar oportunidades concretas y mejorar el resultado final.',
      ctaText: 'Explorar preguntas',
      brand: { buttonStyle: 'rounded', cardRadius: 30, shadowPreset: 'strong', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Diagonal',
      description: 'Diseño en ángulo, moderno y visualmente diferente.',
      icon: 'format_shapes',
      layout: 'diagonal',
      title: 'Tu respuesta cambia la dirección',
      surveyDescription: 'Usaremos tus respuestas para entender prioridades, fricciones y oportunidades reales.',
      ctaText: 'Empezar ahora',
      brand: { buttonStyle: 'pill', questionStyle: 'outlined', shadowPreset: 'medium', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Onboarding',
      description: 'Entrada práctica para nuevos clientes o usuarios.',
      icon: 'rocket_launch',
      layout: 'split',
      title: 'Configuremos tu experiencia',
      surveyDescription: 'Cuéntanos qué necesitas para preparar una experiencia inicial más precisa y útil.',
      ctaText: 'Configurar ahora',
      brand: { buttonStyle: 'pill', questionStyle: 'compact', shadowPreset: 'soft', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Diagnóstico',
      description: 'Inicio consultivo para evaluar situación actual.',
      icon: 'troubleshoot',
      layout: 'centered',
      title: 'Empecemos con un diagnóstico rápido',
      surveyDescription: 'Tus respuestas nos ayudarán a entender el punto de partida y detectar prioridades reales.',
      ctaText: 'Iniciar diagnóstico',
      brand: { buttonStyle: 'rounded', questionStyle: 'outlined', shadowPreset: 'medium', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Registro',
      description: 'Pensado para eventos, listas de espera e inscripciones.',
      icon: 'how_to_reg',
      layout: 'poster',
      title: 'Completa tu registro',
      surveyDescription: 'Solo necesitamos algunos datos para confirmar tu participación y preparar los siguientes pasos.',
      ctaText: 'Registrarme',
      brand: { buttonStyle: 'pill', questionStyle: 'classic', shadowPreset: 'soft', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Pulse check',
      description: 'Muy breve para medir clima, ánimo o satisfacción.',
      icon: 'monitor_heart',
      layout: 'minimal',
      title: 'Un pulso rápido',
      surveyDescription: 'Responde en menos de un minuto. Queremos tomar la temperatura actual y actuar a tiempo.',
      ctaText: 'Responder ahora',
      brand: { buttonStyle: 'rounded', questionStyle: 'soft', progressBar: { enabled: true, style: 'percentage' }, entryAnimation: 'fadeUp' }
    },
    {
      name: 'NPS',
      description: 'Inicio directo para medir recomendación.',
      icon: 'thumb_up',
      layout: 'centered',
      title: '¿Nos recomendarías?',
      surveyDescription: 'Tu respuesta nos ayuda a entender la experiencia completa y priorizar mejoras.',
      ctaText: 'Evaluar experiencia',
      brand: { buttonStyle: 'pill', questionStyle: 'boxed', shadowPreset: 'medium', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Académica',
      description: 'Apertura seria para cursos, evaluaciones y formación.',
      icon: 'school',
      layout: 'editorial',
      title: 'Evaluación del aprendizaje',
      surveyDescription: 'Comparte tu experiencia para mejorar contenido, ritmo, materiales y acompañamiento.',
      ctaText: 'Comenzar evaluación',
      brand: { buttonStyle: 'square', questionStyle: 'outlined', fontTitle: 'Merriweather', fontBody: 'Source Sans 3', shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Post evento',
      description: 'Portada dinámica para feedback después de eventos.',
      icon: 'event_available',
      layout: 'showcase',
      title: 'Queremos saber cómo viviste el evento',
      surveyDescription: 'Tu feedback nos ayuda a mejorar contenido, logística y experiencia para próximas ediciones.',
      ctaText: 'Compartir feedback',
      brand: { buttonStyle: 'pill', questionStyle: 'boxed', borderGlow: true, shadowPreset: 'float', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Paciente',
      description: 'Entrada calmada para experiencias de atención médica.',
      icon: 'local_hospital',
      layout: 'split',
      title: 'Ayúdanos a mejorar tu atención',
      surveyDescription: 'Tus respuestas serán usadas para revisar tiempos, comunicación y calidad del servicio.',
      ctaText: 'Responder con calma',
      brand: { buttonStyle: 'rounded', questionStyle: 'soft', fontTitle: 'DM Sans', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Comunidad',
      description: 'Inicio cercano para iniciativas sociales.',
      icon: 'volunteer_activism',
      layout: 'orbit',
      title: 'Tu voz ayuda a priorizar',
      surveyDescription: 'Queremos entender necesidades, expectativas y oportunidades desde la perspectiva de la comunidad.',
      ctaText: 'Sumar mi voz',
      brand: { buttonStyle: 'pill', questionStyle: 'soft', shadowPreset: 'medium', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Lead calificado',
      description: 'Apertura orientada a ventas y captación.',
      icon: 'person_search',
      layout: 'diagonal',
      title: 'Cuéntanos qué estás buscando',
      surveyDescription: 'Con unas respuestas rápidas podremos recomendar el camino, servicio o solución más adecuada.',
      ctaText: 'Ver opciones',
      brand: { buttonStyle: 'rounded', questionStyle: 'compact', shadowPreset: 'strong', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Satisfacción',
      description: 'Portada clara para medir experiencia del cliente.',
      icon: 'sentiment_satisfied',
      layout: 'centered',
      title: 'Queremos mejorar tu experiencia',
      surveyDescription: 'Tu opinión nos ayuda a entender qué funciona bien y qué podemos ajustar.',
      ctaText: 'Dar feedback',
      brand: { buttonStyle: 'pill', questionStyle: 'classic', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Validación',
      description: 'Para probar ideas, conceptos o prototipos.',
      icon: 'new_releases',
      layout: 'showcase',
      title: 'Ayúdanos a validar esta idea',
      surveyDescription: 'Queremos saber si el concepto es claro, útil y suficientemente atractivo antes de avanzar.',
      ctaText: 'Evaluar concepto',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', glassEffect: true, borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Mapa mental',
      description: 'Abre la encuesta como una exploración de ideas conectadas.',
      icon: 'hub',
      layout: 'orbit',
      title: 'Vamos a ordenar el mapa',
      surveyDescription: 'Cada respuesta conecta una señal con otra. Al final tendremos una lectura más clara de prioridades, dudas y oportunidades.',
      ctaText: 'Abrir el mapa',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', glassEffect: true, borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Sprint creativo',
      description: 'Energía de workshop para decisiones rápidas.',
      icon: 'directions_run',
      layout: 'diagonal',
      title: 'Sprint de respuestas',
      surveyDescription: 'Responde con instinto. Buscamos señales rápidas para decidir qué probar, descartar o mejorar primero.',
      ctaText: 'Arrancar sprint',
      brand: { buttonStyle: 'rounded', questionStyle: 'boxed', shadowPreset: 'strong', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Diario de usuario',
      description: 'Entrada íntima para historias, hábitos y contexto.',
      icon: 'menu_book',
      layout: 'editorial',
      title: 'Cuéntanos cómo ocurre en tu día',
      surveyDescription: 'Queremos entender la experiencia real: momentos, decisiones, fricciones y pequeños detalles que normalmente no se ven.',
      ctaText: 'Empezar relato',
      brand: { buttonStyle: 'square', questionStyle: 'underline', fontTitle: 'Cormorant Garamond', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Museo de opiniones',
      description: 'Presenta cada respuesta como una pieza valiosa de observación.',
      icon: 'museum',
      layout: 'showcase',
      title: 'Tu mirada entra en la colección',
      surveyDescription: 'Cada respuesta suma una perspectiva distinta. Queremos observar patrones, contrastes y detalles memorables.',
      ctaText: 'Entrar a la muestra',
      brand: { buttonStyle: 'square', questionStyle: 'minimal', fontTitle: 'Playfair Display', cardRadius: 12, shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Ruta secreta',
      description: 'Sensación de recorrido guiado para encuestas con lógica condicional.',
      icon: 'route',
      layout: 'split',
      title: 'Elige tu ruta de respuestas',
      surveyDescription: 'Algunas preguntas abrirán caminos distintos según lo que elijas. Responde con naturalidad y sigue el recorrido.',
      ctaText: 'Iniciar ruta',
      brand: { buttonStyle: 'pill', questionStyle: 'compact', shadowPreset: 'medium', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Mesa de crítica',
      description: 'Para evaluar una pieza, campaña, producto o propuesta con criterio.',
      icon: 'rate_review',
      layout: 'centered',
      title: 'Ayúdanos a mirar con criterio',
      surveyDescription: 'Evalúa lo que ves, lo que entiendes y lo que cambiarías. Buscamos feedback específico, no respuestas perfectas.',
      ctaText: 'Comenzar crítica',
      brand: { buttonStyle: 'rounded', questionStyle: 'outlined', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Radar de señales',
      description: 'Inicio analítico para detectar tendencias, riesgos y oportunidades.',
      icon: 'radar',
      layout: 'orbit',
      title: 'Activemos el radar',
      surveyDescription: 'Tus respuestas nos ayudarán a detectar señales tempranas: lo urgente, lo repetido y lo que todavía está emergiendo.',
      ctaText: 'Detectar señales',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Moodboard',
      description: 'Apertura visual para preferencias, tono, marca y estilo.',
      icon: 'palette',
      layout: 'poster',
      title: 'Construyamos el moodboard',
      surveyDescription: 'Elige, describe y compara. Queremos traducir percepciones en dirección visual y decisiones de diseño.',
      ctaText: 'Crear dirección',
      brand: { buttonStyle: 'pill', questionStyle: 'boxed', fontTitle: 'Outfit', shadowPreset: 'medium', entryAnimation: 'scaleIn' }
    }
  ];

  readonly completionPresets: CompletionPreset[] = [
    {
      name: 'Agradecimiento simple',
      description: 'Cierre claro y neutral.',
      icon: 'check_circle',
      layout: 'centered',
      title: 'Gracias por participar',
      endDescription: 'Tus respuestas han sido registradas exitosamente.',
      brand: { entryAnimation: 'fadeUp' }
    },
    {
      name: 'Confirmación formal',
      description: 'Ideal para registros o solicitudes.',
      icon: 'task_alt',
      layout: 'receipt',
      title: 'Información recibida',
      endDescription: 'Hemos guardado tus respuestas. Si corresponde, nuestro equipo revisará la información y dará seguimiento.',
      brand: { buttonStyle: 'rounded', shadowPreset: 'soft' }
    },
    {
      name: 'Feedback cálido',
      description: 'Cierre amable para clientes.',
      icon: 'favorite',
      layout: 'celebration',
      title: 'Gracias por ayudarnos a mejorar',
      endDescription: 'Tu opinión nos da contexto real para seguir ajustando la experiencia.',
      brand: { questionStyle: 'soft', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Próximo paso',
      description: 'Cierre orientado a contacto posterior.',
      icon: 'arrow_forward',
      layout: 'split',
      title: 'Todo listo',
      endDescription: 'Ya tenemos lo necesario. Revisaremos tus respuestas y continuaremos con el siguiente paso.',
      brand: { buttonStyle: 'pill', shadowPreset: 'medium' }
    },
    {
      name: 'Spotlight',
      description: 'Cierre escénico con foco visual en el agradecimiento.',
      icon: 'flare',
      layout: 'spotlight',
      title: 'Tu respuesta quedó registrada',
      endDescription: 'Gracias por sumar tu perspectiva. Este aporte nos ayuda a decidir con más claridad.',
      brand: { shadowPreset: 'float', borderGlow: true, entryAnimation: 'scaleIn' }
    },
    {
      name: 'Certificado',
      description: 'Final elegante para evaluaciones, cursos o procesos formales.',
      icon: 'workspace_premium',
      layout: 'certificate',
      title: 'Participación completada',
      endDescription: 'Has finalizado correctamente. Gracias por dedicar tiempo a responder con atención.',
      brand: { fontTitle: 'Merriweather', fontBody: 'Source Sans 3', buttonStyle: 'square', shadowPreset: 'soft' }
    },
    {
      name: 'Línea de tiempo',
      description: 'Cierre que comunica continuidad y siguiente acción.',
      icon: 'timeline',
      layout: 'timeline',
      title: 'Seguimos con el siguiente paso',
      endDescription: 'Tus respuestas ya están en el proceso. Ahora podremos revisar, priorizar y actuar con mejor información.',
      brand: { buttonStyle: 'rounded', questionStyle: 'compact', shadowPreset: 'medium', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Compacto elegante',
      description: 'Final breve, sobrio y muy pulido.',
      icon: 'done_all',
      layout: 'compact',
      title: 'Recibido',
      endDescription: 'Gracias. Tus respuestas fueron enviadas correctamente.',
      brand: { buttonStyle: 'square', cardRadius: 14, shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Con seguimiento',
      description: 'Indica que habrá una revisión posterior.',
      icon: 'outgoing_mail',
      layout: 'split',
      title: 'Gracias, revisaremos tus respuestas',
      endDescription: 'Nuestro equipo usará esta información para preparar el siguiente paso y contactarte si es necesario.',
      brand: { buttonStyle: 'rounded', questionStyle: 'compact', shadowPreset: 'medium', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Cupón o beneficio',
      description: 'Cierre para campañas, retail o promociones.',
      icon: 'redeem',
      layout: 'celebration',
      title: 'Gracias por participar',
      endDescription: 'Tus respuestas fueron recibidas. Ya puedes continuar con el beneficio o promoción asociada.',
      brand: { buttonStyle: 'pill', questionStyle: 'boxed', shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Lista de espera',
      description: 'Confirma inscripción y genera expectativa.',
      icon: 'hourglass_top',
      layout: 'receipt',
      title: 'Estás en la lista',
      endDescription: 'Guardamos tu registro. Te avisaremos cuando haya novedades o disponibilidad.',
      brand: { buttonStyle: 'pill', questionStyle: 'classic', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Reporte recibido',
      description: 'Cierre para incidencias, soporte o solicitudes.',
      icon: 'support_agent',
      layout: 'timeline',
      title: 'Reporte recibido',
      endDescription: 'Registramos la información. Ahora podremos revisar el caso y priorizar la respuesta.',
      brand: { buttonStyle: 'rounded', questionStyle: 'outlined', shadowPreset: 'medium', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Evaluación completada',
      description: 'Ideal para cursos, pruebas y capacitaciones.',
      icon: 'fact_check',
      layout: 'certificate',
      title: 'Evaluación completada',
      endDescription: 'Gracias por completar la evaluación. Tus respuestas ayudarán a mejorar el proceso formativo.',
      brand: { fontTitle: 'Merriweather', fontBody: 'Source Sans 3', buttonStyle: 'square', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Misión cumplida',
      description: 'Cierre expresivo para retos y experiencias activas.',
      icon: 'emoji_events',
      layout: 'spotlight',
      title: 'Misión cumplida',
      endDescription: 'Terminaste el recorrido. Gracias por aportar información concreta y accionable.',
      brand: { buttonStyle: 'pill', questionStyle: 'solid', borderGlow: true, shadowPreset: 'strong', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Cierre humano',
      description: 'Agradecimiento cálido para comunidades y feedback sensible.',
      icon: 'diversity_1',
      layout: 'centered',
      title: 'Gracias por confiar en nosotros',
      endDescription: 'Apreciamos el tiempo y la sinceridad de tus respuestas. Serán revisadas con atención.',
      brand: { buttonStyle: 'rounded', questionStyle: 'soft', cardRadius: 30, shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Decisión informada',
      description: 'Cierre para estudios, investigación y estrategia.',
      icon: 'insights',
      layout: 'compact',
      title: 'Datos recibidos',
      endDescription: 'Tus respuestas ya forman parte del análisis. Gracias por ayudar a decidir con mejor información.',
      brand: { buttonStyle: 'square', questionStyle: 'underline', shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Reserva confirmada',
      description: 'Cierre para citas, eventos y reservas.',
      icon: 'event',
      layout: 'receipt',
      title: 'Solicitud registrada',
      endDescription: 'Recibimos la información necesaria para procesar tu solicitud y confirmar disponibilidad.',
      brand: { buttonStyle: 'rounded', questionStyle: 'classic', shadowPreset: 'soft', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Gracias premium',
      description: 'Final elegante para marcas cuidadas.',
      icon: 'diamond',
      layout: 'spotlight',
      title: 'Gracias por tu tiempo',
      endDescription: 'Tu perspectiva nos ayuda a cuidar cada detalle de la experiencia.',
      brand: { fontTitle: 'Cormorant Garamond', buttonStyle: 'square', questionStyle: 'solid', shadowPreset: 'strong', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Acción inmediata',
      description: 'Cierre breve para encuestas operativas.',
      icon: 'bolt',
      layout: 'compact',
      title: 'Listo',
      endDescription: 'Recibimos tus respuestas y podemos continuar.',
      brand: { buttonStyle: 'pill', questionStyle: 'compact', shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Mapa completado',
      description: 'Cierre para recorridos exploratorios y decisiones complejas.',
      icon: 'hub',
      layout: 'timeline',
      title: 'El mapa ya tiene señales',
      endDescription: 'Gracias. Tus respuestas ayudan a conectar patrones, prioridades y próximos pasos.',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Insight desbloqueado',
      description: 'Final con sensación de hallazgo para research y discovery.',
      icon: 'lightbulb',
      layout: 'spotlight',
      title: 'Insight desbloqueado',
      endDescription: 'Tu aporte quedó registrado como una señal para el análisis. Ahora podemos mirar el problema con más claridad.',
      brand: { buttonStyle: 'rounded', questionStyle: 'solid', shadowPreset: 'strong', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Brief recibido',
      description: 'Cierre ideal para solicitudes creativas y proyectos de diseño.',
      icon: 'assignment_turned_in',
      layout: 'receipt',
      title: 'Brief recibido',
      endDescription: 'Tenemos una primera base para entender objetivos, tono, referencias y límites del proyecto.',
      brand: { buttonStyle: 'square', questionStyle: 'outlined', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Muestra cerrada',
      description: 'Cierre editorial para encuestas visuales o de concepto.',
      icon: 'collections',
      layout: 'certificate',
      title: 'Gracias por visitar la muestra',
      endDescription: 'Tus observaciones quedaron guardadas. Nos ayudarán a decidir qué piezas funcionan y cuáles necesitan ajuste.',
      brand: { fontTitle: 'Playfair Display', buttonStyle: 'square', questionStyle: 'minimal', shadowPreset: 'soft', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Sprint terminado',
      description: 'Final enérgico para workshops, retrospectivas y sesiones rápidas.',
      icon: 'flag',
      layout: 'celebration',
      title: 'Sprint terminado',
      endDescription: 'Ya tenemos señales suficientes para pasar de conversación a decisión.',
      brand: { buttonStyle: 'pill', questionStyle: 'boxed', shadowPreset: 'float', entryAnimation: 'scaleIn' }
    },
    {
      name: 'Ruta guardada',
      description: 'Confirma una experiencia con saltos o recorrido personalizado.',
      icon: 'route',
      layout: 'split',
      title: 'Ruta guardada',
      endDescription: 'Tu recorrido quedó registrado. Cada respuesta ayuda a entender mejor qué camino tiene más sentido.',
      brand: { buttonStyle: 'rounded', questionStyle: 'compact', shadowPreset: 'medium', entryAnimation: 'slideLeft' }
    },
    {
      name: 'Crítica archivada',
      description: 'Cierre para feedback experto, revisión de piezas o validación de campaña.',
      icon: 'rate_review',
      layout: 'compact',
      title: 'Crítica archivada',
      endDescription: 'Gracias por mirar con detalle. Tus comentarios servirán para ajustar la propuesta con más precisión.',
      brand: { buttonStyle: 'square', questionStyle: 'underline', shadowPreset: 'none', entryAnimation: 'fadeUp' }
    },
    {
      name: 'Moodboard listo',
      description: 'Final visual para preferencias de marca, estética o concepto.',
      icon: 'palette',
      layout: 'spotlight',
      title: 'Moodboard listo',
      endDescription: 'Tus elecciones nos dan una dirección visual más clara para seguir diseñando.',
      brand: { buttonStyle: 'pill', questionStyle: 'glass', glassEffect: true, borderGlow: true, shadowPreset: 'float', entryAnimation: 'scaleIn' }
    }
  ];

  readonly designCombinations: DesignCombinationPreset[] = [
    {
      kind: 'premium',
      label: 'Premium digital',
      recipe: 'Showcase + Producto tech + Cristal + Spotlight',
      description: 'Para SaaS, lanzamientos y experiencias modernas con alto impacto.',
      presentationName: 'Showcase',
      visualName: 'Producto tech',
      question: 'glass',
      completionName: 'Spotlight',
      background: 'linear-gradient(135deg, #0b1020, #1e1b4b 52%, #0891b2)',
      dark: true
    },
    {
      kind: 'minimal',
      label: 'Minimal editorial',
      recipe: 'Directa + Minimal blanco + Subrayado + Compacto',
      description: 'Para encuestas cortas, sobrias y rápidas, sin ruido visual.',
      presentationName: 'Directa',
      visualName: 'Minimal blanco',
      question: 'underline',
      completionName: 'Compacto elegante',
      background: 'linear-gradient(135deg, #ffffff, #f8fafc)'
    },
    {
      kind: 'research',
      label: 'Investigación formal',
      recipe: 'Investigación + Académico + Dos columnas + Certificado',
      description: 'Para educación, estudios de mercado, auditorías y evaluaciones.',
      presentationName: 'Investigación',
      visualName: 'Academico sobrio',
      question: 'outlined',
      completionName: 'Certificado',
      background: 'linear-gradient(135deg, #eff6ff, #ffffff)'
    },
    {
      kind: 'event',
      label: 'Evento con impacto',
      recipe: 'Órbita + Evento premium + Tarjetas + Celebration',
      description: 'Para eventos, activaciones, comunidad y campañas memorables.',
      presentationName: 'Órbita',
      visualName: 'Evento premium',
      question: 'boxed',
      completionName: 'Feedback cálido',
      background: 'linear-gradient(135deg, #18051a, #db2777 58%, #f59e0b)',
      dark: true
    },
    {
      kind: 'mind-map',
      label: 'Mapa mental',
      recipe: 'Mapa mental + Sistema solar + Cristal + Mapa completado',
      description: 'Para descubrir conexiones, prioridades y caminos alternos.',
      presentationName: 'Mapa mental',
      visualName: 'Sistema solar de producto',
      question: 'glass',
      completionName: 'Mapa completado',
      background: 'linear-gradient(135deg, #020617, #312e81 48%, #38bdf8)',
      dark: true
    },
    {
      kind: 'creative-sprint',
      label: 'Sprint creativo',
      recipe: 'Sprint creativo + Brief creativo + Tarjetas + Sprint terminado',
      description: 'Para workshops, ideación rápida y decisiones de equipo.',
      presentationName: 'Sprint creativo',
      visualName: 'Brief creativo',
      question: 'boxed',
      completionName: 'Sprint terminado',
      background: 'linear-gradient(135deg, #eef2ff, #ffffff 42%, #fed7aa)'
    },
    {
      kind: 'user-diary',
      label: 'Diario de usuario',
      recipe: 'Diario de usuario + Cine documental + Sólido + Insight',
      description: 'Para entrevistas, historias de usuario y research cualitativo.',
      presentationName: 'Diario de usuario',
      visualName: 'Cine documental',
      question: 'solid',
      completionName: 'Insight desbloqueado',
      background: 'linear-gradient(135deg, #111827, #7c2d12 52%, #f97316)',
      dark: true
    },
    {
      kind: 'moodboard',
      label: 'Moodboard visual',
      recipe: 'Moodboard + Galería inmersiva + Minimal + Moodboard listo',
      description: 'Para preferencias visuales, tono de marca y dirección creativa.',
      presentationName: 'Moodboard',
      visualName: 'Galería inmersiva',
      question: 'minimal',
      completionName: 'Moodboard listo',
      background: 'linear-gradient(135deg, #fff7ed, #fdf2f8 50%, #fce7f3)'
    },
    {
      kind: 'critique-table',
      label: 'Mesa de crítica',
      recipe: 'Mesa de crítica + Zine experimental + Subrayado + Crítica archivada',
      description: 'Para evaluar piezas, conceptos, campañas o prototipos con criterio.',
      presentationName: 'Mesa de crítica',
      visualName: 'Zine experimental',
      question: 'underline',
      completionName: 'Crítica archivada',
      background: 'linear-gradient(135deg, #fff7ed, #ffffff 45%, #fecaca)'
    },
    {
      kind: 'idea-lab',
      label: 'Laboratorio de ideas',
      recipe: 'Validación + Laboratorio + Suave + Insight desbloqueado',
      description: 'Para probar conceptos, hipótesis y oportunidades de innovación.',
      presentationName: 'Validación',
      visualName: 'Laboratorio de ideas',
      question: 'soft',
      completionName: 'Insight desbloqueado',
      background: 'linear-gradient(135deg, #f0f9ff, #ffffff 45%, #dcfce7)'
    },
    {
      kind: 'secret-route',
      label: 'Ruta con lógica',
      recipe: 'Ruta secreta + Mapa de decisiones + Compacto + Ruta guardada',
      description: 'Para encuestas con saltos, segmentación y recorridos personalizados.',
      presentationName: 'Ruta secreta',
      visualName: 'Mapa de decisiones',
      question: 'compact',
      completionName: 'Ruta guardada',
      background: 'linear-gradient(135deg, #ecfdf5, #ffffff 46%, #ccfbf1)'
    },
    {
      kind: 'signal-radar',
      label: 'Radar de señales',
      recipe: 'Radar de señales + Startup fresca + Compacto + Decisión informada',
      description: 'Para detectar tendencias, riesgos, señales débiles y oportunidades.',
      presentationName: 'Radar de señales',
      visualName: 'Startup fresca',
      question: 'compact',
      completionName: 'Decisión informada',
      background: 'linear-gradient(135deg, #eff6ff, #dbeafe 45%, #bbf7d0)'
    },
    {
      kind: 'gallery-review',
      label: 'Museo de opiniones',
      recipe: 'Museo de opiniones + Galería inmersiva + Minimal + Muestra cerrada',
      description: 'Para revisar piezas visuales, campañas, colecciones o propuestas.',
      presentationName: 'Museo de opiniones',
      visualName: 'Galería inmersiva',
      question: 'minimal',
      completionName: 'Muestra cerrada',
      background: 'linear-gradient(135deg, #fffaf0, #ffffff 48%, #fed7aa)'
    },
    {
      kind: 'onboarding-pro',
      label: 'Onboarding premium',
      recipe: 'Onboarding + Startup fresca + Compacto + Con seguimiento',
      description: 'Para levantar contexto inicial de clientes y activar el siguiente paso.',
      presentationName: 'Onboarding',
      visualName: 'Startup fresca',
      question: 'compact',
      completionName: 'Con seguimiento',
      background: 'linear-gradient(135deg, #eff6ff, #ffffff 46%, #ccfbf1)'
    },
    {
      kind: 'community-pulse',
      label: 'Pulso comunitario',
      recipe: 'Comunidad + Comunidad cálida + Suave + Cierre humano',
      description: 'Para iniciativas sociales, participación ciudadana y escucha sensible.',
      presentationName: 'Comunidad',
      visualName: 'Comunidad cálida',
      question: 'soft',
      completionName: 'Cierre humano',
      background: 'linear-gradient(135deg, #f0fdf4, #ffffff 45%, #fed7aa)'
    },
    {
      kind: 'luxury-feedback',
      label: 'Feedback de lujo',
      recipe: 'Premium + Lujo discreto + Sólido + Gracias premium',
      description: 'Para marcas cuidadas, experiencias boutique y audiencias premium.',
      presentationName: 'Premium',
      visualName: 'Lujo discreto',
      question: 'solid',
      completionName: 'Gracias premium',
      background: 'linear-gradient(135deg, #11100f, #3f2f16 55%, #d4af37)',
      dark: true
    }
  ];

  readonly questionTypes: { type: QuestionType; label: string; description: string }[] = [
    { type: 'text', label: 'Texto corto', description: 'Respuesta breve' },
    { type: 'long-text', label: 'Texto largo', description: 'Respuesta detallada' },
    { type: 'multiple-choice', label: 'Selección única', description: 'Una opción a elegir' },
    { type: 'visual-choice', label: 'Selección visual (Cards)', description: 'Tarjetas grandes' },
    { type: 'multi-select', label: 'Selección múltiple', description: 'Varias opciones a elegir' },
    { type: 'scale', label: 'Escala 1-10', description: 'Nivel numérico' },
    { type: 'nps', label: 'NPS', description: 'Recomendación 0 a 10' },
    { type: 'rating', label: 'Estrellas', description: 'Calificación de 1 a 5' },
    { type: 'email', label: 'Email', description: 'Correo electrónico' },
    { type: 'phone', label: 'Teléfono', description: 'Número de contacto' },
    { type: 'date', label: 'Fecha', description: 'Selector de fecha' },
    { type: 'time', label: 'Hora', description: 'Selector de hora' }
  ];

  readonly questionStylePresets: QuestionStylePreset[] = [
    {
      value: 'classic',
      name: 'Clásico',
      description: 'Mantiene contador, badges y tarjeta amplia.',
      icon: 'view_agenda',
      preview: 'classic'
    },
    {
      value: 'compact',
      name: 'Compacto',
      description: 'Oculta el contador y reduce el bloque.',
      icon: 'density_medium',
      preview: 'compact'
    },
    {
      value: 'soft',
      name: 'Centrado',
      description: 'Pregunta enfocada, sin contador.',
      icon: 'filter_center_focus',
      preview: 'soft'
    },
    {
      value: 'outlined',
      name: 'Dos columnas',
      description: 'Texto a la izquierda y respuestas a la derecha.',
      icon: 'view_column',
      preview: 'outlined'
    },
    {
      value: 'minimal',
      name: 'Minimal',
      description: 'Sin tarjeta pesada, muy limpio y directo.',
      icon: 'format_align_left',
      preview: 'minimal'
    },
    {
      value: 'boxed',
      name: 'Tarjetas',
      description: 'Respuestas con más presencia visual.',
      icon: 'dashboard_customize',
      preview: 'boxed'
    },
    {
      value: 'glass',
      name: 'Cristal',
      description: 'Tarjeta translúcida para fondos con imagen.',
      icon: 'blur_on',
      preview: 'glass'
    },
    {
      value: 'solid',
      name: 'Sólido',
      description: 'Bloque firme con énfasis en lectura.',
      icon: 'crop_square',
      preview: 'solid'
    },
    {
      value: 'underline',
      name: 'Subrayado',
      description: 'Formato editorial con separadores finos.',
      icon: 'border_color',
      preview: 'underline'
    }
  ];

  readonly questionTypeGroups: {
    name: string;
    items: { type: QuestionType; label: string; description: string; icon: string }[];
  }[] = [
    {
      name: 'Basico',
      items: [
        { type: 'multiple-choice', label: 'Selección única', description: 'Una opción', icon: 'radio_button_checked' },
        { type: 'visual-choice', label: 'Selección visual', description: 'Tarjetas grandes', icon: 'grid_view' },
        { type: 'multi-select', label: 'Selección múltiple', description: 'Varias opciones', icon: 'checklist' }
      ]
    },
    {
      name: 'Abierto',
      items: [
        { type: 'text', label: 'Texto corto', description: 'Respuesta breve', icon: 'short_text' },
        { type: 'long-text', label: 'Texto largo', description: 'Respuesta detallada', icon: 'notes' }
      ]
    },
    {
      name: 'Estructurado',
      items: [
        { type: 'email', label: 'Email', description: 'Correo', icon: 'alternate_email' },
        { type: 'phone', label: 'Teléfono', description: 'Contacto', icon: 'call' },
        { type: 'date', label: 'Fecha', description: 'Calendario', icon: 'calendar_month' },
        { type: 'time', label: 'Hora', description: 'Horario', icon: 'schedule' }
      ]
    },
    {
      name: 'Evaluativo',
      items: [
        { type: 'scale', label: 'Escala', description: 'Nivel 1 a 10', icon: 'linear_scale' },
        { type: 'nps', label: 'NPS', description: 'Recomendación', icon: 'trending_up' },
        { type: 'rating', label: 'Estrellas', description: 'Calificación', icon: 'star' }
      ]
    },
    {
      name: 'Premium',
      items: [
        { type: 'nps', label: 'NPS avanzado', description: 'Lealtad', icon: 'workspace_premium' }
      ]
    },
    {
      name: 'Elementos',
      items: [
        { type: 'text', label: 'Bloque informativo', description: 'Texto auxiliar', icon: 'article' }
      ]
    }
  ];

  readonly fontPresets: { family: string; category: string }[] = [
    { family: 'Inter', category: 'Sans' },
    { family: 'Poppins', category: 'Sans' },
    { family: 'Montserrat', category: 'Sans' },
    { family: 'Roboto', category: 'Sans' },
    { family: 'Lato', category: 'Sans' },
    { family: 'Open Sans', category: 'Sans' },
    { family: 'Nunito', category: 'Sans' },
    { family: 'Raleway', category: 'Sans' },
    { family: 'Playfair Display', category: 'Serif' },
    { family: 'Merriweather', category: 'Serif' },
    { family: 'Oswald', category: 'Display' },
    { family: 'Rubik', category: 'Sans' },
    { family: 'Work Sans', category: 'Sans' },
    { family: 'Quicksand', category: 'Sans' },
    { family: 'DM Sans', category: 'Sans' },
    { family: 'Manrope', category: 'Sans' },
    { family: 'Urbanist', category: 'Sans' },
    { family: 'Bebas Neue', category: 'Display' },
    { family: 'Archivo', category: 'Sans' },
    { family: 'Space Grotesk', category: 'Display' },
    { family: 'Plus Jakarta Sans', category: 'Sans' },
    { family: 'Outfit', category: 'Sans' },
    { family: 'Crimson Text', category: 'Serif' },
    { family: 'Lora', category: 'Serif' }
  ];

  readonly fontPairings = [
    { name: 'Moderno', title: 'Plus Jakarta Sans', body: 'Inter', description: 'Limpio y profesional' },
    { name: 'Elegante', title: 'Playfair Display', body: 'Lora', description: 'Refinado y clásico' },
    { name: 'Tech', title: 'Space Grotesk', body: 'Manrope', description: 'Futurista y geométrico' },
    { name: 'Suave', title: 'Outfit', body: 'Quicksand', description: 'Amigable y redondeado' },
    { name: 'Editorial', title: 'Oswald', body: 'Roboto', description: 'Impactante y estructurado' }
  ];

  selectedFontCategory: 'All' | 'Sans' | 'Serif' | 'Display' = 'All';

  private loadedFonts = new Set<string>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly surveyService: SurveyService,
    private readonly auth: AuthService,
    private readonly analyticsService: AnalyticsService,
    private readonly supabaseService: SupabaseService,
    private readonly ngZone: NgZone
  ) {}

  private boundMouseMove = (event: MouseEvent) => this.handleWindowMouseMove(event);
  private boundMouseUp = () => this.handleWindowMouseUp();

  ngOnInit(): void {
    if (!this.ensureAuthenticated()) {
      return;
    }

    // Registered outside NgZone so plain mouse movement/clicks/selection changes
    // don't each trigger a change-detection pass across this very large component.
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', this.boundMouseMove);
      window.addEventListener('mouseup', this.boundMouseUp);
      document.addEventListener('click', this.boundDocumentClick);
      document.addEventListener('selectionchange', this.boundSelectionChange);
    });

    this.saveSubject.pipe(debounceTime(1500)).subscribe(() => {
      void this.executeSave();
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id === 'new' || !id) {
      void this.initializeNewSurvey();
      return;
    }

    void this.loadExistingSurvey(id);
    this.setupRealtimeSubscription(id);
    // Initial history push
    setTimeout(() => this.pushToHistory(), 1000);

    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam === 'analyze') {
      this.currentTab.set('analyze');
    } else if (tabParam === 'preview') {
      this.currentTab.set('preview');
    } else if (tabParam === 'collect') {
      this.currentTab.set('collect');
    } else if (tabParam === 'design') {
      this.currentTab.set('design');
    }
  }

  private realtimeChannel: any;

  private setupRealtimeSubscription(surveyId: string): void {
    const client = this.supabaseService.client;
    if (!client) return;

    this.realtimeChannel = client.channel(`editor-responses-${surveyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'envios', filter: `encuesta_id=eq.${surveyId}` }, () => {
        this.survey.update(s => s ? { ...s, responses_count: (s.responses_count ?? 0) + 1 } : s);
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    this.commitRemoveQuestion();
    if (this.saveRetryTimer) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }
    if (this.survey() && !this.isSaving()) {
      void this.executeSave();
    }
    this.saveSubject.complete();
    if (this.realtimeChannel && this.supabaseService.client) {
      void this.supabaseService.client.removeChannel(this.realtimeChannel);
    }
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('click', this.boundDocumentClick);
    document.removeEventListener('selectionchange', this.boundSelectionChange);
  }

  private handleWindowMouseMove(event: MouseEvent): void {
    // Skip entering NgZone entirely when nothing is being dragged/resized,
    // so idle mouse movement doesn't trigger change detection on this page.
    if (!this.isResizing && !this.activeTransform) {
      return;
    }
    this.ngZone.run(() => this.onMouseMove(event));
  }

  private handleWindowMouseUp(): void {
    if (!this.isResizing && !this.activeTransform) {
      return;
    }
    this.ngZone.run(() => this.onMouseUp());
  }

  onMouseMove(event: MouseEvent): void {
    if (this.isResizing) {
      const newWidth = window.innerWidth - event.clientX;
      if (newWidth > 300 && newWidth < (window.innerWidth * 0.7)) {
        this.rightSidebarWidth = newWidth;
        localStorage.setItem('df_sidebar_width', String(newWidth));
      }
      return;
    }

    const transform = this.activeTransform;
    if (!transform) {
      return;
    }

    event.preventDefault();
    const dx = event.clientX - transform.startX;
    const dy = event.clientY - transform.startY;

    if (transform.kind === 'logo') {
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const brand = this.ensureBrand(survey.metadata?.brand);
        const config = { ...(brand.logoConfig ?? this.defaultLogoConfig()) };
        if (transform.mode === 'move') {
          config.x = this.clamp(transform.initialX + dx, -120, 900);
          config.y = this.clamp(transform.initialY + dy, -120, 760);
        } else {
          const size = this.resizeWithAspectRatio(transform, dx, dy, 48, 320, 32, 220);
          config.width = size.width;
          config.height = size.height;
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;
        brand.logoConfig = config;
        return { ...survey, metadata: { ...this.ensureMetadata(survey.metadata), brand } };
      });
      return;
    }

    if (transform.kind === 'welcome-image' && transform.index !== undefined) {
      const imageIndex = transform.index;
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const metadata = this.ensureMetadata(survey.metadata);
        const images = [...(metadata.welcomeImages ?? [])];
        const item = images[imageIndex];
        if (!item) {
          return survey;
        }

        const config = { ...item.config };
        if (transform.mode === 'move') {
          config.x = this.clamp(transform.initialX + dx, -160, 900);
          config.y = this.clamp(transform.initialY + dy, -160, 760);
        } else {
          const size = this.resizeWithAspectRatio(transform, dx, dy, 40, 420, 40, 420);
          config.width = size.width;
          config.height = size.height;
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        images[imageIndex] = { ...item, config };
        return { ...survey, metadata: { ...metadata, welcomeImages: images } };
      });
      return;
    }

    if (['welcome-title', 'welcome-desc', 'welcome-cta', 'welcome-kicker', 'welcome-meta', 'welcome-preview'].includes(transform.kind) || transform.kind.startsWith('extra-text-')) {
      this.survey.update((survey) => {
        if (!survey) return survey;
        const metadata = this.ensureMetadata(survey.metadata);

        if (transform.kind.startsWith('extra-text-')) {
          const texts = metadata.welcomeExtraTexts || [];
          const index = texts.findIndex(t => t.id === transform.kind);
          if (index !== -1) {
            const extra = texts[index];
            const config = { ...(extra.config ?? { x: 50, y: 350, width: 300, height: 40 }) };
            if (transform.mode === 'move') {
              config.x = transform.initialX + dx;
              config.y = transform.initialY + dy;
              config.width = transform.initialWidth;
              config.height = transform.initialHeight;
            } else if (transform.mode === 'stretch') {
              config.width = Math.max(transform.initialWidth + dx, 50);
            } else {
              config.width = Math.max(transform.initialWidth + dx, 50);
              config.height = Math.max(transform.initialHeight + dy, 30);

              const scale = config.width / transform.initialWidth;
              const initialFS = transform.initialFontSize ?? extra.config?.fontSize ?? 16;
              config.fontSize = Math.max(8, Math.min(120, Math.round(initialFS * scale)));
            }
            config.originX = transform.originX;
            config.originY = transform.originY;
            config.positioned = true;

            const newTexts = [...texts];
            newTexts[index] = { ...extra, config };
            metadata.welcomeExtraTexts = newTexts;
          }
          return { ...survey, metadata };
        }

        let configKey: 'welcomeTitleConfig' | 'welcomeDescConfig' | 'welcomeCtaConfig' | 'welcomeKickerConfig' | 'welcomeMetaConfig' | 'welcomePreviewConfig';
        switch (transform.kind) {
          case 'welcome-title': configKey = 'welcomeTitleConfig'; break;
          case 'welcome-desc': configKey = 'welcomeDescConfig'; break;
          case 'welcome-cta': configKey = 'welcomeCtaConfig'; break;
          case 'welcome-kicker': configKey = 'welcomeKickerConfig'; break;
          case 'welcome-meta': configKey = 'welcomeMetaConfig'; break;
          case 'welcome-preview': configKey = 'welcomePreviewConfig'; break;
          default: return survey;
        }

        const config = { ...(metadata[configKey] ?? { x: 40, y: 150, width: 400, height: 100 }) };
        if (transform.mode === 'move') {
          config.x = transform.initialX + dx;
          config.y = transform.initialY + dy;
          config.width = transform.initialWidth;
          config.height = transform.initialHeight;
        } else if (transform.mode === 'stretch') {
          config.width = Math.max(transform.initialWidth + dx, 50);
        } else {
          config.width = Math.max(transform.initialWidth + dx, 50);
          config.height = Math.max(transform.initialHeight + dy, 30);

          if (transform.kind !== 'welcome-preview') {
            const scale = config.width / transform.initialWidth;
            const initialFS = transform.initialFontSize ?? config.fontSize ?? this.defaultFontSize(transform.kind);
            config.fontSize = Math.max(8, Math.min(120, Math.round(initialFS * scale)));
          }
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        metadata[configKey] = config;
        return { ...survey, metadata };
      });
      return;
    }

    if (['end-rule', 'end-icon', 'end-title', 'end-desc', 'end-summary', 'end-brand'].includes(transform.kind)) {
      this.survey.update((survey) => {
        if (!survey) return survey;
        const metadata = this.ensureMetadata(survey.metadata);

        let configKey: 'endRuleConfig' | 'endIconConfig' | 'endTitleConfig' | 'endDescConfig' | 'endSummaryConfig' | 'endBrandConfig';
        switch (transform.kind) {
          case 'end-rule': configKey = 'endRuleConfig'; break;
          case 'end-icon': configKey = 'endIconConfig'; break;
          case 'end-title': configKey = 'endTitleConfig'; break;
          case 'end-desc': configKey = 'endDescConfig'; break;
          case 'end-summary': configKey = 'endSummaryConfig'; break;
          case 'end-brand': configKey = 'endBrandConfig'; break;
          default: return survey;
        }

        const config = { ...(metadata[configKey] ?? { x: 40, y: 120, width: 420, height: 80 }) };
        if (transform.mode === 'move') {
          config.x = transform.initialX + dx;
          config.y = transform.initialY + dy;
          config.width = transform.initialWidth;
          config.height = transform.initialHeight;
        } else if (transform.mode === 'stretch') {
          config.width = Math.max(transform.initialWidth + dx, 24);
        } else {
          config.width = Math.max(transform.initialWidth + dx, 24);
          config.height = Math.max(transform.initialHeight + dy, 16);

          if (!['end-rule', 'end-icon'].includes(transform.kind)) {
            const scale = config.width / transform.initialWidth;
            const initialFS = transform.initialFontSize ?? config.fontSize ?? this.defaultFontSize(transform.kind);
            config.fontSize = Math.max(8, Math.min(120, Math.round(initialFS * scale)));
          }
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        metadata[configKey] = config;
        return { ...survey, metadata };
      });
      return;
    }

    if (transform.kind === 'end-image' && transform.index !== undefined) {
      const imageIndex = transform.index;
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const metadata = this.ensureMetadata(survey.metadata);
        const images = [...(metadata.endImages ?? [])];
        const item = images[imageIndex];
        if (!item) {
          return survey;
        }

        const config = { ...item.config };
        if (transform.mode === 'move') {
          config.x = this.clamp(transform.initialX + dx, -160, 900);
          config.y = this.clamp(transform.initialY + dy, -160, 760);
        } else {
          const size = this.resizeWithAspectRatio(transform, dx, dy, 40, 420, 40, 420);
          config.width = size.width;
          config.height = size.height;
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        images[imageIndex] = { ...item, config };
        return { ...survey, metadata: { ...metadata, endImages: images } };
      });
      return;
    }

    if (transform.kind === 'question-image' && transform.index !== undefined) {
      const questionIndex = transform.index;
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const questions = [...survey.questions];
        const question = { ...questions[questionIndex] };
        if (!question.imageConfig) {
          return survey;
        }

        const config = { ...question.imageConfig };
        if (transform.mode === 'move') {
          config.x = this.clamp(transform.initialX + dx, -160, 900);
          config.y = this.clamp(transform.initialY + dy, -160, 760);
        } else {
          const size = this.resizeWithAspectRatio(transform, dx, dy, 40, 320, 40, 320);
          config.width = size.width;
          config.height = size.height;
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        question.imageConfig = config;
        questions[questionIndex] = question;
        return { ...survey, questions };
      });
      return;
    }

    if (['question-meta', 'question-title', 'question-help', 'question-answer'].includes(transform.kind) && transform.index !== undefined) {
      const questionIndex = transform.index;
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const questions = [...survey.questions];
        const question = { ...questions[questionIndex] };
        if (!question) {
          return survey;
        }

        let configKey: 'metaConfig' | 'titleConfig' | 'helpConfig' | 'answerConfig';
        switch (transform.kind) {
          case 'question-meta': configKey = 'metaConfig'; break;
          case 'question-title': configKey = 'titleConfig'; break;
          case 'question-help': configKey = 'helpConfig'; break;
          case 'question-answer': configKey = 'answerConfig'; break;
          default: return survey;
        }

        const config = { ...(question[configKey] ?? { x: 0, y: 80, width: 640, height: 100 }) };
        if (transform.mode === 'move') {
          config.x = transform.initialX + dx;
          config.y = transform.initialY + dy;
          config.width = transform.initialWidth;
          config.height = transform.initialHeight;
        } else if (transform.mode === 'stretch') {
          config.width = Math.max(transform.initialWidth + dx, 50);
        } else {
          config.width = Math.max(transform.initialWidth + dx, 50);
          config.height = Math.max(transform.initialHeight + dy, 30);

          const scale = config.width / transform.initialWidth;
          const initialFS = transform.initialFontSize ?? config.fontSize ?? this.defaultFontSize(transform.kind);
          config.fontSize = Math.max(8, Math.min(120, Math.round(initialFS * scale)));
        }
        config.originX = transform.originX;
        config.originY = transform.originY;
        config.positioned = true;

        question[configKey] = config;
        questions[questionIndex] = question;
        return { ...survey, questions };
      });
    }
  }

  onMouseUp(): void {
    if (this.isResizing) {
      this.isResizing = false;
      return;
    }

    if (!this.activeTransform) {
      return;
    }

    this.activeTransform = null;
    this.pushToHistory(); // Save state after transform
    this.queueSave();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.addQuestionPanel) {
        this.addQuestionPanel = false;
      }
      return;
    }

    // Undo: Ctrl + Z
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
    }
    // Redo: Ctrl + Y or Ctrl + Shift + Z
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      this.redo();
    }
    // Save: Ctrl + S
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveNow();
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private pushToHistory() {
    if (this.isUndoingRedoing) return;
    const state = JSON.stringify(this.survey());

    // Only push if different from current head
    if (this.historyIndex >= 0 && this.historyStack[this.historyIndex] === state) return;

    // Remove any forward history if we're making a new change
    this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    this.historyStack.push(state);

    // Limit history size to 50
    if (this.historyStack.length > 50) this.historyStack.shift();
    else this.historyIndex++;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.applyHistoryState(this.historyStack[this.historyIndex]);
    }
  }

  redo() {
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyIndex++;
      this.applyHistoryState(this.historyStack[this.historyIndex]);
    }
  }

  private applyHistoryState(stateJson: string) {
    this.isUndoingRedoing = true;
    try {
      const state = JSON.parse(stateJson);
      this.survey.set(state);

      // Deshacer/rehacer puede cambiar cuántas preguntas o páginas existen;
      // si el foco quedó fuera de rango, el usuario ve un inspector/lienzo
      // vacío sin entender por qué. Lo recortamos al último elemento válido.
      const questionCount = state?.questions?.length ?? 0;
      this.activeQuestionIndex.set(Math.max(0, Math.min(this.activeQuestionIndex(), questionCount - 1)));
      const pageCount = this.questionPageSummaries().length;
      this.activeQuestionPageIndex.set(Math.max(0, Math.min(this.activeQuestionPageIndex(), pageCount - 1)));

      this.queueSave();
    } finally {
      this.isUndoingRedoing = false;
    }
  }

  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.type.startsWith('image/')) {
        continue;
      }

      const file = item.getAsFile();
      if (!file) {
        return;
      }

      if (this.activeSection() === 'welcome') {
        this.readImageFile(file, (imageUrl, width, height) => {
          this.addWelcomeImage(imageUrl, width, height);
        });
      } else if (this.activeSection() === 'end') {
        this.readImageFile(file, (imageUrl, width, height) => {
          this.addEndImage(imageUrl, width, height);
        });
      } else if (this.activeSection() === 'questions') {
        this.readImageFile(file, (imageUrl, width, height) => {
          this.attachQuestionImage(this.activeQuestionIndex(), imageUrl, width, height);
        });
      }
      break;
    }
  }

  async initializeNewSurvey(): Promise<void> {
    this.isNew.set(true);
    const user = this.auth.user();
    if (!user) {
      return;
    }

    const created = await this.surveyService.createSurvey(user.id, 'Nueva Encuesta', '');
    if (!created) {
      this.showError('No se pudo crear la encuesta.');
      return;
    }

    const baseSurvey = this.normalizeSurvey({
      ...created,
      questions: created.questions.length ? created.questions : [this.createBlankQuestion('multiple-choice')],
      metadata: this.ensureMetadata(created.metadata)
    });
    this.survey.set(this.applyDefaultDirectStyle(baseSurvey));
    this.activeSection.set('questions');
    this.activeQuestionIndex.set(0);
    this.activeQuestionPageIndex.set(0);

    this.queueSave();
    await this.router.navigate(['/editor', created.id], { replaceUrl: true });
  }

  async loadExistingSurvey(id: string): Promise<void> {
    const survey = await this.surveyService.getSurvey(id);
    const userId = this.auth.user()?.id;
    if (!survey || survey.userId !== userId) {
      await this.router.navigate(['/dashboard']);
      return;
    }

    this.survey.set({
      ...survey,
      metadata: this.ensureMetadata(survey.metadata)
    });
    this.loadCurrentFonts();
  }

  updateTitle(value: string): void {
    this.survey.update((survey) => survey ? { ...survey, title: value } : null);
    this.queueSave();
  }

  updateDescription(value: string): void {
    this.survey.update((survey) => survey ? { ...survey, description: value } : null);
    this.queueSave();
  }

  addQuestion(type: QuestionType): void {
    const survey = this.survey();
    if (!survey) {
      return;
    }

    const question = this.createBlankQuestion(type);

    const insertIndex = this.insertAfterQuestionIndex === null
      ? survey.questions.length
      : Math.max(0, Math.min(survey.questions.length, this.insertAfterQuestionIndex + 1));
    const oldBreaks = this.normalizePageBreaks(survey.questions.length, survey.metadata?.questionPageBreaks);
    const targetPageIndex = this.insertIntoPageIndex ?? this.pageIndexForQuestion(Math.max(0, insertIndex - 1), oldBreaks);
    const nextBreaks = this.pageBreaksAfterQuestionInsert(oldBreaks, insertIndex, targetPageIndex);
    const questions = [...survey.questions];
    questions.splice(insertIndex, 0, question);
    this.survey.set(this.normalizeSurvey({
      ...survey,
      questions,
      metadata: {
        ...this.ensureMetadata(survey.metadata),
        questionPageBreaks: nextBreaks,
        paginationMode: nextBreaks.length > 1 ? 'paged' : 'all-at-once'
      }
    }));
    this.activeQuestionIndex.set(insertIndex);
    this.activeQuestionPageIndex.set(Math.max(0, Math.min(targetPageIndex, nextBreaks.length - 1)));
    this.activeSection.set('questions');
    this.addQuestionPanel = false;
    this.insertAfterQuestionIndex = null;
    this.insertIntoPageIndex = null;
    this.queueSave();
  }

  openAddQuestionAfter(index: number): void {
    const survey = this.survey();
    const pages = this.questionPageSummaries();
    const activePage = this.activeSection() === 'questions' ? pages[this.activeQuestionPageIndex()] : undefined;
    this.insertAfterQuestionIndex = activePage && activePage.count === 0 ? activePage.start - 1 : index;
    this.insertIntoPageIndex = activePage?.index ?? this.pageIndexForQuestion(Math.max(0, index), this.normalizePageBreaks(survey?.questions.length ?? 0, survey?.metadata?.questionPageBreaks));
    this.activeQuestionIndex.set(Math.max(0, index));
    this.activeSection.set('questions');
    this.addQuestionPanel = true;
  }

  openAddQuestionInPage(page: { index: number; start: number; end: number; count: number }): void {
    this.activeQuestionPageIndex.set(page.index);
    this.insertIntoPageIndex = page.index;
    this.insertAfterQuestionIndex = page.count > 0 ? page.end - 1 : page.start - 1;
    this.activeQuestionIndex.set(Math.max(0, Math.min(page.start, (this.survey()?.questions.length ?? 1) - 1)));
    this.activeSection.set('questions');
    this.addQuestionPanel = true;
  }

  addSurveyPage(): void {
    const survey = this.survey();
    if (!survey) return;

    const start = survey.questions.length;
    this.survey.update((current) => {
      if (!current) return current;
      const metadata = this.ensureMetadata(current.metadata);
      const breaks = this.normalizePageBreaks(current.questions.length, metadata.questionPageBreaks);
      const nextBreaks = [...breaks, start].sort((a, b) => a - b);
      return {
        ...current,
        metadata: {
          ...metadata,
          questionPageBreaks: nextBreaks,
          questionPageTitles: this.normalizePageTitles(metadata.questionPageTitles, nextBreaks.length),
          paginationMode: 'paged'
        }
      };
    });
    this.insertAfterQuestionIndex = survey.questions.length - 1;
    this.insertIntoPageIndex = null;
    this.activeQuestionPageIndex.set(Math.max(0, this.questionPageSummaries().length - 1));
    this.activeQuestionIndex.set(Math.max(0, survey.questions.length - 1));
    this.activeSection.set('questions');
    this.addQuestionPanel = false;
    this.showInfo('Página creada.');
    this.queueSave();
  }

  openQuestionLogic(index: number): void {
    this.activeQuestionIndex.set(index);
    this.activeSection.set('questions');

    this.questionEditorOpen = false;
    this.logicPanelOpen = true;
    this.logicModalOpen = true;
    this.openLogicOptionId = null;
    this.logicDestinationCategory = 'question';
  }

  openQuestionEditor(index: number): void {
    this.editingQuestionIndex = Math.max(0, Math.min(index, (this.survey()?.questions.length ?? 1) - 1));
    this.activeQuestionIndex.set(this.editingQuestionIndex);
    this.activeSection.set('questions');
    this.questionEditorOpen = true;
  }

  closeQuestionEditor(): void {
    this.questionEditorOpen = false;
  }

  saveQuestionEditor(): void {
    this.questionEditorOpen = false;
    this.saveNow();
  }

  editingQuestion(): Question | undefined {
    return this.survey()?.questions[this.editingQuestionIndex];
  }

  questionTypeLabel(type: QuestionType): string {
    return this.questionTypes.find((item) => item.type === type)?.label ?? 'Pregunta';
  }

  closeLogicModal(): void {
    this.logicModalOpen = false;
    this.openLogicOptionId = null;
  }

  saveLogicModal(): void {
    this.closeLogicModal();
    this.queueSave();
  }

  toggleLogicDestination(optionId: string): void {
    this.openLogicOptionId = this.openLogicOptionId === optionId ? null : optionId;
  }

  setLogicDestinationCategory(category: 'question' | 'page' | 'web' | 'end'): void {
    this.logicDestinationCategory = category;
  }

  changeQuestionType(index: number, type: QuestionType): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      const question = { ...questions[index] };
      question.type = type;

      if (this.isChoiceType(type) && question.options.length === 0) {
        question.options = [
          { id: this.createLocalId('option'), texto: 'Opción 1' },
          { id: this.createLocalId('option'), texto: 'Opción 2' }
        ];
      }

      if (!this.isChoiceType(type)) {
        question.options = [];
      }

      if (type === 'rating') {
        question.min = 1;
        question.max = 5;
      } else if (type === 'nps') {
        question.min = 0;
        question.max = 10;
      } else if (type === 'scale') {
        question.min = 1;
        question.max = 10;
      } else {
        delete question.min;
        delete question.max;
      }

      questions[index] = question;
      return this.normalizeSurvey({ ...survey, questions });
    });
    this.queueSave();
  }

  updateQuestionText(index: number, text: string): void {
    this.updateQuestion(index, { text });
  }

  updateQuestionDescription(index: number, description: string): void {
    this.updateQuestion(index, { description });
  }

  toggleRequired(index: number): void {
    const question = this.survey()?.questions[index];
    if (!question) {
      return;
    }

    this.updateQuestion(index, { required: !question.required });
  }

  updateQuestionValidation(index: number, patch: Partial<QuestionValidation>): void {
    const current = this.survey()?.questions[index]?.validation ?? {};
    const validation = this.cleanValidation({ ...current, ...patch });
    this.updateQuestion(index, { validation });
  }

  toggleRandomizeOptions(index: number): void {
    const question = this.survey()?.questions[index];
    if (!question) return;
    this.updateQuestion(index, { randomizeOptions: !question.randomizeOptions });
  }

  updateQuestionLogic(index: number, patch: Partial<ConditionalRule>): void {
    const question = this.survey()?.questions[index];
    if (!question) return;
    const current = question.logic?.[0] ?? {};
    const next = { ...current, ...patch };
    this.updateQuestion(index, { logic: next.goTo ? [next] : [] });
    this.logicPanelOpen = true;
  }

  updateOptionLogicTarget(questionIndex: number, optionText: string, goTo: string): void {
    const question = this.survey()?.questions[questionIndex];
    if (!question) return;

    const rules = (question.logic ?? []).filter((rule) => {
      const value = question.type === 'multi-select' ? rule.answerIncludes : rule.answerEquals;
      return value !== optionText;
    });

    if (goTo) {
      const rule: ConditionalRule = question.type === 'multi-select'
        ? { answerIncludes: optionText, goTo }
        : { answerEquals: optionText, goTo };
      rules.push(rule);
    }

    this.updateQuestion(questionIndex, { logic: rules });
    this.openLogicOptionId = null;
    this.logicPanelOpen = true;
  }

  clearQuestionLogic(index: number): void {
    this.updateQuestion(index, { logic: [] });
  }

  resetLogicModal(): void {
    this.clearQuestionLogic(this.activeQuestionIndex());
    this.openLogicOptionId = null;
  }

  logicAnswerValue(question: Question): string {
    const rule = question.logic?.[0];
    const value = rule?.answerIncludes ?? rule?.answerEquals;
    return typeof value === 'string' ? value : '';
  }

  logicTargetValue(question: Question): string {
    return question.logic?.[0]?.goTo ?? '';
  }

  logicTargetForOption(question: Question, optionText: string): string {
    const rule = (question.logic ?? []).find((item) => {
      const value = question.type === 'multi-select' ? item.answerIncludes : item.answerEquals;
      return value === optionText;
    });
    return rule?.goTo ?? '';
  }

  logicTargetLabel(value: string): string {
    if (!value) return 'Seleccionar';
    if (value === 'end') return 'Final de la encuesta';
    const questions = this.survey()?.questions ?? [];
    const index = questions.findIndex((question) => question.id === value);
    return index >= 0 ? `Pregunta ${index + 1}` : 'Destino no disponible';
  }

  logicTargetQuestions(currentIndex: number): Question[] {
    return this.survey()?.questions.filter((_, index) => index > currentIndex) ?? [];
  }

  updateOption(questionIndex: number, optionIndex: number, value: string): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      const question = { ...questions[questionIndex], options: [...questions[questionIndex].options] };
      const previousValue = question.options[optionIndex]?.texto;
      question.options[optionIndex] = { ...question.options[optionIndex], texto: value };
      if (previousValue && previousValue !== value) {
        question.logic = (question.logic ?? []).map((rule) => {
          if (question.type === 'multi-select' && rule.answerIncludes === previousValue) {
            return { ...rule, answerIncludes: value };
          }
          if (question.type !== 'multi-select' && rule.answerEquals === previousValue) {
            return { ...rule, answerEquals: value };
          }
          return rule;
        });
      }
      questions[questionIndex] = question;
      return { ...survey, questions };
    });
    this.queueSave();
  }

  addOption(questionIndex: number, text = 'Nueva opción'): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      const question = { ...questions[questionIndex], options: [...questions[questionIndex].options] };
      question.options.push({ id: this.createLocalId('option'), texto: text });
      questions[questionIndex] = question;
      return { ...survey, questions };
    });
    this.queueSave();
  }

  addOtherOption(questionIndex: number): void {
    const question = this.survey()?.questions[questionIndex];
    if (!question || !this.isChoiceType(question.type)) return;
    const exists = question.options.some((option) => option.texto.trim().toLowerCase() === 'otra');
    if (exists) return;
    this.addOption(questionIndex, 'Otra');
  }

  removeOption(questionIndex: number, optionIndex: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const source = survey.questions[questionIndex];
      if (source.options.length <= 2) {
        return survey;
      }
      const removedValue = source.options[optionIndex]?.texto;

      const questions = [...survey.questions];
      questions[questionIndex] = {
        ...source,
        options: source.options.filter((_, index) => index !== optionIndex),
        logic: (source.logic ?? []).filter((rule) => {
          if (!removedValue) return true;
          return source.type === 'multi-select'
            ? rule.answerIncludes !== removedValue
            : rule.answerEquals !== removedValue;
        })
      };
      return { ...survey, questions };
    });
    this.queueSave();
  }

  // Sidebar search: jump to the question's page and select it
  jumpToSearchResult(questionIndex: number, pageIndex: number): void {
    this.sidebarSearch.set('');
    this.activeSection.set('questions');
    this.activeQuestionPageIndex.set(pageIndex);
    this.activeQuestionIndex.set(questionIndex);
  }

  // Option drag-and-drop reorder
  onOptionDragStart(optionIndex: number): void {
    this.dragOptionIndex = optionIndex;
  }

  onOptionDrop(questionIndex: number, targetIndex: number): void {
    const from = this.dragOptionIndex;
    this.dragOptionIndex = null;
    if (from === null || from === targetIndex) return;
    this.survey.update(survey => {
      if (!survey) return survey;
      const q = survey.questions[questionIndex];
      if (!q) return survey;
      const options = [...q.options];
      const [moved] = options.splice(from, 1);
      options.splice(targetIndex, 0, moved);
      const questions = [...survey.questions];
      questions[questionIndex] = { ...q, options };
      return { ...survey, questions };
    });
    this.queueSave();
  }

  onOptionDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  // Preview restart
  restartPreview(): void {
    this.simulators.forEach(s => s.restart());
  }

  removeQuestion(index: number): void {
    // Commit any already-pending delete before queuing a new one
    this.commitRemoveQuestion();

    const survey = this.survey();
    if (!survey) return;
    const question = survey.questions[index];
    if (!question) return;

    const timeoutId = setTimeout(() => this.commitRemoveQuestion(), 5000);
    this.deletePendingQuestion.set({ question, index, timeoutId });
  }

  commitRemoveQuestion(): void {
    const pending = this.deletePendingQuestion();
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.deletePendingQuestion.set(null);

    const { index } = pending;
    this.survey.update((survey) => {
      if (!survey) return null;

      if (survey.metadata?.canvas?.screens) {
        const screens = survey.metadata.canvas.screens;
        const deletedScreenId = `question-${index}`;
        const newScreens = screens.filter(s => s.id !== deletedScreenId);
        newScreens.forEach(s => {
          if (s.type === 'question' && s.id.startsWith('question-')) {
            const idx = parseInt(s.id.split('-')[1], 10);
            if (!isNaN(idx) && idx > index) {
              s.id = `question-${idx - 1}`;
            }
          }
        });
        survey.metadata.canvas.screens = newScreens;
      }

      return this.normalizeSurvey({
        ...survey,
        questions: survey.questions.filter((_, questionIndex) => questionIndex !== index)
      });
    });
    this.activeQuestionIndex.update(idx => Math.max(0, idx - (idx >= index ? 1 : 0)));
    this.queueSave();
  }

  undoRemoveQuestion(): void {
    const pending = this.deletePendingQuestion();
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.deletePendingQuestion.set(null);
  }

  duplicateQuestion(index: number): void {
    const survey = this.survey();
    if (!survey) {
      return;
    }

    const original = survey.questions[index];
    const clone: Question = {
      ...original,
      id: this.createLocalId('question'),
      text: original.text ? `${original.text} (copia)` : '',
      options: original.options.map((option) => ({
        ...option,
        id: this.createLocalId('option')
      }))
    };

    const insertIndex = index + 1;
    const oldBreaks = this.normalizePageBreaks(survey.questions.length, survey.metadata?.questionPageBreaks);
    const targetPageIndex = this.pageIndexForQuestion(index, oldBreaks);
    const nextBreaks = this.pageBreaksAfterQuestionInsert(oldBreaks, insertIndex, targetPageIndex);
    const questions = [...survey.questions];
    questions.splice(insertIndex, 0, clone);
    this.survey.set(this.normalizeSurvey({
      ...survey,
      questions,
      metadata: {
        ...this.ensureMetadata(survey.metadata),
        questionPageBreaks: nextBreaks,
        paginationMode: nextBreaks.length > 1 ? 'paged' : 'all-at-once'
      }
    }));
    this.activeQuestionIndex.set(insertIndex);
    this.activeSection.set('questions');
    this.queueSave();
  }

  moveQuestion(index: number, direction: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const target = index + direction;
      if (target < 0 || target >= survey.questions.length) {
        return survey;
      }

      const questions = [...survey.questions];
      [questions[index], questions[target]] = [questions[target], questions[index]];
      this.activeQuestionIndex.set(target);
      return this.normalizeSurvey({ ...survey, questions });
    });
    this.queueSave();
  }

  applyPalette(palette: PalettePreset): void {
    this.patchBrand({
      primaryColor: palette.primaryColor,
      secondaryColor: palette.secondaryColor,
      backgroundColor: palette.backgroundColor,
      surfaceColor: palette.surfaceColor,
      textColor: palette.textColor
    });
  }

  applyVisualDesign(preset: VisualDesignPreset): void {
    for (const font of [preset.brand.fontTitle, preset.brand.fontBody, preset.brand.fontButton]) {
      if (font) this.loadGoogleFont(font);
    }

    this.patchBrand({
      ...preset.brand
    });
    this.showTemplateModal = false;
    this.showInfo(`Diseño visual "${preset.name}" aplicado sin cambiar preguntas.`);
  }

  applyPresentationPreset(preset: PresentationPreset): void {
    for (const font of [preset.brand?.fontTitle, preset.brand?.fontBody, preset.brand?.fontButton]) {
      if (font) this.loadGoogleFont(font);
    }

    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const brand = this.ensureBrand({ ...metadata.brand, ...(preset.brand ?? {}) });
      return {
        ...survey,
        title: preset.title,
        description: preset.surveyDescription,
        metadata: {
          ...metadata,
          welcomeLayout: preset.layout,
          ctaText: preset.ctaText,
          brand
        }
      };
    });
    this.activeSection.set('welcome');
    this.showTemplateModal = false;
    this.queueSave();
    this.showInfo(`Presentación "${preset.name}" aplicada.`);
  }

  applyCompletionPreset(preset: CompletionPreset): void {
    for (const font of [preset.brand?.fontTitle, preset.brand?.fontBody, preset.brand?.fontButton]) {
      if (font) this.loadGoogleFont(font);
    }

    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const brand = this.ensureBrand({ ...metadata.brand, ...(preset.brand ?? {}) });
      return {
        ...survey,
        metadata: {
          ...metadata,
          endLayout: preset.layout,
          endTitle: preset.title,
          endDescription: preset.endDescription,
          thankYouTitle: preset.title,
          thankYouDescription: preset.endDescription,
          brand
        }
      };
    });
    this.activeSection.set('end');
    this.showTemplateModal = false;
    this.queueSave();
    this.showInfo(`Finalización "${preset.name}" aplicada.`);
  }

  isPresentationActive(preset: PresentationPreset): boolean {
    const survey = this.survey();
    return survey?.title === preset.title
      && survey?.description === preset.surveyDescription
      && survey?.metadata?.ctaText === preset.ctaText
      && survey?.metadata?.welcomeLayout === preset.layout;
  }

  isCompletionActive(preset: CompletionPreset): boolean {
    const metadata = this.survey()?.metadata;
    return metadata?.endTitle === preset.title
      && metadata?.endDescription === preset.endDescription
      && metadata?.endLayout === preset.layout;
  }

  isVisualDesignActive(preset: VisualDesignPreset): boolean {
    const brand = this.brand();
    return brand.primaryColor === preset.brand.primaryColor
      && brand.backgroundColor === preset.brand.backgroundColor
      && brand.questionStyle === preset.brand.questionStyle
      && brand.fontTitle === preset.brand.fontTitle;
  }

  currentThemeName(): string {
    const active = this.palettePresets.find((palette) => this.isPaletteActive(palette));
    return active?.name ?? 'Personalizado';
  }

  templateImage(tpl: { image?: string; category: string }): string {
    if (tpl.image) return tpl.image;
    const images: Record<string, string> = {
      Negocio: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=900',
      RRHH: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&q=80&w=900',
      Eventos: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&q=80&w=900',
      Educacion: 'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&q=80&w=900',
      Salud: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&q=80&w=900',
      Producto: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=900',
      Restaurante: 'https://images.unsplash.com/photo-1556745757-8d76bdb6984b?auto=format&fit=crop&q=80&w=900',
      Inmobiliaria: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=900'
    };
    return images[tpl.category] ?? 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&q=80&w=900';
  }

  editThemeName(): void {
    this.showInfo('El nombre se actualiza al personalizar colores.');
  }

  openThemeGallery(): void {
    this.showTemplateModal = true;
  }

  applyDesignToAllPages(): void {
    this.saveNow();
    this.showInfo('Diseño aplicado.');
  }

  resetDesign(): void {
    this.patchBrand(this.ensureBrand(undefined));
    this.showInfo('Diseño reiniciado.');
  }

  updateBrandColor(field: keyof Pick<SurveyBrand, 'primaryColor' | 'secondaryColor' | 'backgroundColor' | 'surfaceColor' | 'textColor'>, value: string): void {
    this.patchBrand({ [field]: value } as Partial<SurveyBrand>);
  }

  setButtonStyle(style: NonNullable<SurveyBrand['buttonStyle']>): void {
    this.patchBrand({ buttonStyle: style });
  }

  setQuestionStyle(style: NonNullable<SurveyBrand['questionStyle']>): void {
    this.patchBrand({ questionStyle: style });
  }

  applyQuestionStyleTemplate(style: NonNullable<SurveyBrand['questionStyle']>): void {
    this.setQuestionStyle(style);
    this.showTemplateModal = false;
    this.activeSection.set('questions');
  }

  updateButtonRadius(value: number): void {
    this.patchBrand({ buttonRadius: value });
  }

  updateCardRadius(value: number): void {
    this.patchBrand({ cardRadius: value });
  }

  updateButtonColor(value: string): void {
    this.patchBrand({ buttonColor: value });
  }

  updateButtonTextColor(value: string): void {
    this.patchBrand({ buttonTextColor: value });
  }

  updateFont(field: 'fontTitle' | 'fontBody' | 'fontButton', family: string): void {
    this.loadGoogleFont(family);
    this.patchBrand({ [field]: family } as Partial<SurveyBrand>);
  }

  elementFontSize(kind: AssetKind | string, index?: number): number {
    const survey = this.survey();
    const fallback = this.defaultFontSize(kind as AssetKind);
    if (!survey) return fallback;
    const metadata = this.ensureMetadata(survey.metadata);
    const question = survey.questions[index ?? this.activeQuestionIndex()];

    if (kind.startsWith('extra-text-')) {
      const extra = metadata.welcomeExtraTexts?.find(t => t.id === kind);
      return extra?.config?.fontSize ?? 16;
    }

    const config = kind === 'welcome-title' ? metadata.welcomeTitleConfig
      : kind === 'welcome-desc' ? metadata.welcomeDescConfig
      : kind === 'welcome-cta' ? metadata.welcomeCtaConfig
      : kind === 'welcome-kicker' ? metadata.welcomeKickerConfig
      : kind === 'welcome-meta' ? metadata.welcomeMetaConfig
      : kind === 'end-title' ? metadata.endTitleConfig
      : kind === 'end-desc' ? metadata.endDescConfig
      : kind === 'end-summary' ? metadata.endSummaryConfig
      : kind === 'end-brand' ? metadata.endBrandConfig
      : kind === 'question-title' ? question?.titleConfig
      : kind === 'question-help' ? question?.helpConfig
      : kind === 'question-answer' ? question?.answerConfig
      : kind === 'question-meta' ? question?.metaConfig
      : undefined;

    return config?.fontSize ?? fallback;
  }

  updateElementFontSize(kind: AssetKind, value: number | string, index?: number): void {
    const parsed = Number(value);
    const fontSize = Math.max(8, Math.min(120, Number.isFinite(parsed) ? Math.round(parsed) : this.defaultFontSize(kind)));

    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);

      const withFontSize = (config: SurveyElementConfig | undefined, fallback: SurveyElementConfig): SurveyElementConfig => ({
        ...fallback,
        ...(config ?? {}),
        fontSize
      });

      if (kind.startsWith('question-')) {
        const questionIndex = index ?? this.activeQuestionIndex();
        const questions = [...survey.questions];
        const question = { ...questions[questionIndex] };
        if (!question) return survey;

        if (kind === 'question-title') question.titleConfig = withFontSize(question.titleConfig, { x: 0, y: 72, width: 708, height: 112 });
        if (kind === 'question-help') question.helpConfig = withFontSize(question.helpConfig, { x: 0, y: 202, width: 620, height: 54 });
        if (kind === 'question-answer') question.answerConfig = withFontSize(question.answerConfig, { x: 0, y: 486, width: 708, height: 150 });
        if (kind === 'question-meta') question.metaConfig = withFontSize(question.metaConfig, { x: 0, y: 0, width: 360, height: 42 });

        questions[questionIndex] = question;
        return { ...survey, questions, metadata };
      }

      if (kind === 'welcome-title') metadata.welcomeTitleConfig = withFontSize(metadata.welcomeTitleConfig, { x: 44, y: 180, width: 500, height: 100 });
      if (kind === 'welcome-desc') metadata.welcomeDescConfig = withFontSize(metadata.welcomeDescConfig, { x: 44, y: 280, width: 450, height: 80 });
      if (kind === 'welcome-cta') metadata.welcomeCtaConfig = withFontSize(metadata.welcomeCtaConfig, { x: 44, y: 400, width: 220, height: 60 });
      if (kind === 'welcome-kicker') metadata.welcomeKickerConfig = withFontSize(metadata.welcomeKickerConfig, { x: 44, y: 140, width: 200, height: 30 });
      if (kind === 'welcome-meta') metadata.welcomeMetaConfig = withFontSize(metadata.welcomeMetaConfig, { x: 44, y: 480, width: 300, height: 40 });
      if (kind === 'end-title') metadata.endTitleConfig = withFontSize(metadata.endTitleConfig, { x: 34, y: 212, width: 480, height: 120 });
      if (kind === 'end-desc') metadata.endDescConfig = withFontSize(metadata.endDescConfig, { x: 54, y: 356, width: 440, height: 84 });
      if (kind === 'end-summary') metadata.endSummaryConfig = withFontSize(metadata.endSummaryConfig, { x: 94, y: 468, width: 360, height: 48 });
      if (kind === 'end-brand') metadata.endBrandConfig = withFontSize(metadata.endBrandConfig, { x: 64, y: 548, width: 420, height: 54 });

      return { ...survey, metadata };
    });

    this.queueSave();
  }

  toggleWelcomeElement(kind: 'welcome-title' | 'welcome-desc' | 'welcome-cta' | 'welcome-kicker' | 'welcome-meta'): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      
      const configKey = kind === 'welcome-title' ? 'welcomeTitleConfig'
        : kind === 'welcome-desc' ? 'welcomeDescConfig'
        : kind === 'welcome-cta' ? 'welcomeCtaConfig'
        : kind === 'welcome-kicker' ? 'welcomeKickerConfig'
        : 'welcomeMetaConfig';
        
      const currentConfig = metadata[configKey];
      metadata[configKey] = {
        x: 0, y: 0, width: 100, height: 50,
        ...(currentConfig || {}),
        hidden: currentConfig ? !currentConfig.hidden : true
      };
      
      return { ...survey, metadata };
    });
    this.queueSave();
  }

  isWelcomeElementHidden(kind: 'welcome-title' | 'welcome-desc' | 'welcome-cta' | 'welcome-kicker' | 'welcome-meta' | string): boolean {
    const survey = this.survey();
    if (!survey) return false;
    const metadata = survey.metadata ?? {};
    
    if (kind.startsWith('extra-text-')) {
      const extra = metadata.welcomeExtraTexts?.find(e => e.id === kind);
      return extra?.config.hidden === true;
    }
    
    const configKey = kind === 'welcome-title' ? 'welcomeTitleConfig'
      : kind === 'welcome-desc' ? 'welcomeDescConfig'
      : kind === 'welcome-cta' ? 'welcomeCtaConfig'
      : kind === 'welcome-kicker' ? 'welcomeKickerConfig'
      : 'welcomeMetaConfig';
      
    return metadata[configKey]?.hidden === true;
  }

  addExtraText(): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const texts = metadata.welcomeExtraTexts || [];
      const id = 'extra-text-' + Math.random().toString(36).substring(2, 9);
      
      metadata.welcomeExtraTexts = [
        ...texts,
        {
          id,
          text: 'Nuevo texto añadido',
          config: { x: 50, y: 350, width: 300, height: 40 }
        }
      ];
      return { ...survey, metadata };
    });
    this.queueSave();
  }

  updateExtraTextContent(id: string, text: string): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const texts = metadata.welcomeExtraTexts || [];
      const index = texts.findIndex(t => t.id === id);
      if (index !== -1) {
        const extra = texts[index];
        const newTexts = [...texts];
        newTexts[index] = { ...extra, text };
        metadata.welcomeExtraTexts = newTexts;
      }
      return { ...survey, metadata };
    });
    this.queueSave();
  }

  updateExtraTextFontSize(id: string, size: number | string): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const texts = metadata.welcomeExtraTexts || [];
      const index = texts.findIndex(t => t.id === id);
      if (index !== -1) {
        const extra = texts[index];
        const config = { ...(extra.config ?? {}), fontSize: Number(size) };
        const newTexts = [...texts];
        newTexts[index] = { ...extra, config };
        metadata.welcomeExtraTexts = newTexts;
      }
      return { ...survey, metadata };
    });
    this.queueSave();
  }

  updateFontSize(configKey: 'welcomeTitleConfig' | 'welcomeDescConfig', size: number | string): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      const currentConfig = metadata[configKey] ?? { x: 40, y: 150, width: 400, height: 100 };
      metadata[configKey] = { ...currentConfig, fontSize: Number(size) };
      return { ...survey, metadata };
    });
    this.queueSave();
  }

  deleteSelectedElement(kind: string): void {
    if (!kind) return;
    
    if (kind.startsWith('extra-text-')) {
      this.survey.update((survey) => {
        if (!survey) return survey;
        const metadata = this.ensureMetadata(survey.metadata);
        metadata.welcomeExtraTexts = (metadata.welcomeExtraTexts || []).filter(t => t.id !== kind);
        return { ...survey, metadata };
      });
    } else if (['welcome-title', 'welcome-desc', 'welcome-cta', 'welcome-kicker', 'welcome-meta'].includes(kind)) {
      this.survey.update((survey) => {
        if (!survey) return survey;
        const metadata = this.ensureMetadata(survey.metadata);
        const configKey = kind === 'welcome-title' ? 'welcomeTitleConfig'
          : kind === 'welcome-desc' ? 'welcomeDescConfig'
          : kind === 'welcome-cta' ? 'welcomeCtaConfig'
          : kind === 'welcome-kicker' ? 'welcomeKickerConfig'
          : 'welcomeMetaConfig';
          
        const currentConfig = metadata[configKey];
        metadata[configKey] = {
          x: 0, y: 0, width: 100, height: 50,
          ...(currentConfig || {}),
          hidden: true
        };
        return { ...survey, metadata };
      });
    }
    
    this.queueSave();
  }

  applyFontPairing(pairing: { title: string, body: string }) {
    this.updateFont('fontTitle', pairing.title);
    this.updateFont('fontBody', pairing.body);
    this.updateFont('fontButton', pairing.body);
  }

  filteredFonts() {
    if (this.selectedFontCategory === 'All') return this.fontPresets;
    return this.fontPresets.filter(f => f.category === this.selectedFontCategory);
  }

  currentFontTitle(): string {
    return this.brand().fontTitle || 'Inter';
  }

  currentFontBody(): string {
    return this.brand().fontBody || 'Inter';
  }

  currentFontButton(): string {
    return this.brand().fontButton || 'Inter';
  }

  currentButtonColor(): string {
    return this.brand().buttonColor || this.brand().primaryColor || '#440789';
  }

  currentButtonTextColor(): string {
    return this.brand().buttonTextColor || '#ffffff';
  }
  loadGoogleFont(family: string): void {
    if (this.loadedFonts.has(family)) return;
    this.loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600;700;800&display=swap`;
    document.head.appendChild(link);
  }

  loadCurrentFonts(): void {
    this.loadGoogleFont(this.currentFontTitle());
    this.loadGoogleFont(this.currentFontBody());
    this.loadGoogleFont(this.currentFontButton());
    
    // Preload pairing fonts for instant high-fidelity sidebar previews
    for (const p of this.fontPairings) {
      this.loadGoogleFont(p.title);
      this.loadGoogleFont(p.body);
    }
  }

  readonly shadowPresets: { value: string; label: string }[] = [
    { value: 'none', label: 'Sin sombra' },
    { value: 'soft', label: 'Suave' },
    { value: 'medium', label: 'Media' },
    { value: 'strong', label: 'Fuerte' },
    { value: 'float', label: 'Flotante' }
  ];

  readonly animationPresets: { value: string; label: string }[] = [
    { value: 'none', label: 'Ninguna' },
    { value: 'fadeUp', label: 'Aparecer' },
    { value: 'scaleIn', label: 'Escalar' },
    { value: 'slideLeft', label: 'Deslizar' }
  ];

  toggleGlass(): void {
    this.patchBrand({ glassEffect: !this.brand().glassEffect });
  }

  setShadowPreset(preset: SurveyBrand['shadowPreset']): void {
    this.patchBrand({ shadowPreset: preset });
  }

  toggleBorderGlow(): void {
    this.patchBrand({ borderGlow: !this.brand().borderGlow });
  }

  setEntryAnimation(animation: SurveyBrand['entryAnimation']): void {
    this.patchBrand({ entryAnimation: animation });
  }

  isGlassActive(): boolean {
    return this.brand().glassEffect === true;
  }

  isGlowActive(): boolean {
    return this.brand().borderGlow === true;
  }

  currentShadow(): string {
    return this.brand().shadowPreset || 'soft';
  }

  currentAnimation(): string {
    return this.brand().entryAnimation || 'none';
  }

  cardEffectClasses(): string {
    const brand = this.brand();
    const classes: string[] = [];
    if (brand.glassEffect) classes.push('effect-glass');
    if (brand.borderGlow) classes.push('effect-glow');
    if (brand.shadowPreset && brand.shadowPreset !== 'soft') classes.push(`shadow-${brand.shadowPreset}`);
    if (brand.entryAnimation && brand.entryAnimation !== 'none') classes.push(`anim-${brand.entryAnimation}`);
    return classes.join(' ');
  }

  showContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
    this.contextMenuVisible = true;
  }

  hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.openPageMenuIndex = null;
  }

  toggleSection(sectionId: string): void {
    this.collapsedSections[sectionId] = !this.collapsedSections[sectionId];
  }

  isSectionOpen(sectionId: string): boolean {
    return !this.collapsedSections[sectionId];
  }

  triggerFileInput(inputId: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement;
    input?.click();
  }

  updateCtaText(value: string): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      return { ...survey, metadata: { ...metadata, ctaText: value } };
    });
    this.queueSave();
  }

  ctaText(): string {
    return this.survey()?.metadata?.ctaText || 'Comenzar encuesta';
  }

  paginationMode(): NonNullable<SurveyMetadata['paginationMode']> {
    return this.survey()?.metadata?.paginationMode ?? 'one-by-one';
  }

  questionsPerPage(): number {
    return this.survey()?.metadata?.questionsPerPage ?? 3;
  }

  updatePaginationMode(mode: NonNullable<SurveyMetadata['paginationMode']>): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      return {
        ...survey,
        metadata: {
          ...metadata,
          paginationMode: mode,
          questionsPerPage: mode === 'paged' ? this.questionsPerPage() : metadata.questionsPerPage
        }
      };
    });
    this.queueSave();
  }

  updateQuestionsPerPage(value: number | string): void {
    const parsed = Number(value);
    const questionsPerPage = Math.max(2, Math.min(50, Number.isFinite(parsed) ? Math.round(parsed) : 3));
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      return {
        ...survey,
        metadata: {
          ...metadata,
          paginationMode: 'paged',
          questionsPerPage
        }
      };
    });
    this.queueSave();
  }

  progressMode(): NonNullable<SurveyMetadata['progressMode']> {
    return this.survey()?.metadata?.progressMode ?? 'percentage';
  }

  updateProgressMode(mode: NonNullable<SurveyMetadata['progressMode']>): void {
    this.survey.update((survey) => {
      if (!survey) return survey;
      const metadata = this.ensureMetadata(survey.metadata);
      return { ...survey, metadata: { ...metadata, progressMode: mode } };
    });
    this.queueSave();
  }

  readonly progressStyles: { value: string; label: string }[] = [
    { value: 'line', label: 'Barra' },
    { value: 'dots', label: 'Puntos' },
    { value: 'percentage', label: 'Porcentaje' }
  ];

  progressBarConfig(): { enabled: boolean; style: string; color: string } {
    const pb = this.brand().progressBar;
    return {
      enabled: pb?.enabled ?? true,
      style: pb?.style ?? 'line',
      color: pb?.color || this.brand().primaryColor || '#440789'
    };
  }

  toggleProgressBar(): void {
    const current = this.progressBarConfig();
    this.patchBrand({ progressBar: { ...current, enabled: !current.enabled, style: current.style as 'line' | 'dots' | 'percentage' } });
  }

  setProgressStyle(style: string): void {
    const current = this.progressBarConfig();
    this.patchBrand({ progressBar: { ...current, style: style as 'line' | 'dots' | 'percentage' } });
  }

  progressPercent(): number {
    const total = this.survey()?.questions.length || 1;
    return Math.round(((this.activeQuestionIndex() + 1) / total) * 100);
  }

  questionNavLabel(): string {
    const total = this.survey()?.questions.length || 1;
    return `${this.activeQuestionIndex() + 1} de ${total}`;
  }

  updateLogoSize(value: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      const brand = this.ensureBrand(metadata.brand);
      const logoConfig = { ...(brand.logoConfig ?? this.defaultLogoConfig()), width: value, height: Math.max(40, Math.round(value * 0.46)) };
      return {
        ...survey,
        metadata: {
          ...metadata,
          brand: {
            ...brand,
            logoConfig
          }
        }
      };
    });
    this.queueSave();
  }

  async onLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.readImageFile(file, (imageUrl, width, height) => {
      this.survey.update((survey) => {
        if (!survey) {
          return survey;
        }

        const metadata = this.ensureMetadata(survey.metadata);
        const brand = this.ensureBrand(metadata.brand);
        brand.logoUrl = imageUrl;
        brand.logoConfig = {
          ...(brand.logoConfig ?? this.defaultLogoConfig()),
          width: Math.min(Math.max(width, 90), 220),
          height: Math.min(Math.max(height, 48), 140)
        };
        return { ...survey, metadata: { ...metadata, brand } };
      });
      this.queueSave();
    });

    input.value = '';
  }

  removeLogo(): void {
    this.patchBrand({ logoUrl: undefined });
  }

  async onBackgroundImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.readImageFile(file, (imageUrl) => {
      this.patchBrand({ backgroundImageUrl: imageUrl });
    });

    input.value = '';
  }

  removeBackgroundImage(): void {
    this.patchBrand({ backgroundImageUrl: undefined });
  }

  updateBackgroundOpacity(value: number): void {
    this.patchBrand({ backgroundOpacity: value });
  }

  async onWelcomeImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.readImageFile(file, (imageUrl, width, height) => {
      this.addWelcomeImage(imageUrl, width, height);
    });

    input.value = '';
  }

  removeWelcomeImage(index: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      return {
        ...survey,
        metadata: {
          ...metadata,
          welcomeImages: (metadata.welcomeImages ?? []).filter((_, imageIndex) => imageIndex !== index)
        }
      };
    });
    this.queueSave();
  }

  updateEndTitle(value: string): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      return { ...survey, metadata: { ...metadata, endTitle: value } };
    });
    this.queueSave();
  }

  updateEndDescription(value: string): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      return { ...survey, metadata: { ...metadata, endDescription: value } };
    });
    this.queueSave();
  }

  async onEndImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.readImageFile(file, (imageUrl, width, height) => {
      this.addEndImage(imageUrl, width, height);
    });

    input.value = '';
  }

  removeEndImage(index: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      return {
        ...survey,
        metadata: {
          ...metadata,
          endImages: (metadata.endImages ?? []).filter((_, imageIndex) => imageIndex !== index)
        }
      };
    });
    this.queueSave();
  }

  async onQuestionImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.readImageFile(file, (imageUrl, width, height) => {
      this.attachQuestionImage(this.activeQuestionIndex(), imageUrl, width, height);
    });

    input.value = '';
  }

  removeQuestionImage(index: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      const question = { ...questions[index] };
      delete question.imageUrl;
      delete question.imageConfig;
      questions[index] = question;
      return { ...survey, questions };
    });
    this.queueSave();
  }

  startLogoTransform(mode: TransformMode, event: MouseEvent): void {
    const config = this.brandLogoConfig();
    if (!config) {
      return;
    }
    const positionedConfig = config as SurveyElementConfig;

    event.preventDefault();
    event.stopPropagation();
    this.activeTransform = this.createActiveTransform('logo', mode, event, positionedConfig);
  }

  startWelcomeImageTransform(index: number, mode: TransformMode, event: MouseEvent): void {
    const item = this.welcomeImages()[index];
    if (!item) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.activeTransform = this.createActiveTransform('welcome-image', mode, event, item.config, index);
  }

  startEndImageTransform(index: number, mode: TransformMode, event: MouseEvent): void {
    const item = this.endImages()[index];
    if (!item) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.activeTransform = this.createActiveTransform('end-image', mode, event, item.config, index);
  }

  startQuestionImageTransform(index: number, mode: TransformMode, event: MouseEvent): void {
    const question = this.survey()?.questions[index];
    if (!question?.imageConfig) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.activeTransform = this.createActiveTransform('question-image', mode, event, question.imageConfig, index);
  }

  async publish(): Promise<void> {
    const survey = this.survey();
    if (!survey || this.isSaving()) {
      return;
    }

    const checklist = this.getPublishChecklist(survey);
    this.publishChecklist.set(checklist);

    const validationError = checklist.find((item) => !item.ok)?.detail ?? null;
    if (validationError) {
      this.showError(validationError);
      this.captureFocus();
      this.showPublishChecklist.set(true);
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      const savedSurvey = await this.surveyService.saveSurvey(this.normalizeSurvey({ ...survey, status: 'activo' }));
      if (!savedSurvey) {
        throw new Error('No se pudo publicar la encuesta.');
      }

      this.survey.set(savedSurvey);
      this.currentTab.set('collect');
      this.pulseSavedState();
      this.showInfo(survey.status === 'activo' ? 'Publicación actualizada.' : 'Encuesta publicada.');
      this.showPublishChecklist.set(false);
      this.restoreFocus();
    } catch (error) {
      console.error('Error publishing survey:', error);
      this.showError(this.describeSaveError(error, 'No se pudo publicar la encuesta.'));
    } finally {
      this.isSaving.set(false);
    }
  }

  copyShareLink(): void {
    const survey = this.survey();
    if (!survey) {
      return;
    }

    if (survey.status !== 'activo') {
      this.showError('Publica la encuesta antes de compartirla.');
      return;
    }

    navigator.clipboard.writeText(this.getShareLink());
    this.recordShareCopy('Enlace copiado');
    this.copied.set(true);
    this.showInfo('Enlace copiado.');
    setTimeout(() => this.copied.set(false), 1800);
  }

  async unpublish(): Promise<void> {
    const survey = this.survey();
    if (!survey || this.isSaving()) return;

    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      const savedSurvey = await this.surveyService.saveSurvey(this.normalizeSurvey({ ...survey, status: 'borrador' }));
      if (!savedSurvey) {
        throw new Error('No se pudo despublicar la encuesta.');
      }

      this.survey.set(savedSurvey);
      this.pulseSavedState();
      this.showInfo('Encuesta despublicada.');
    } catch (error) {
      console.error('Error unpublishing survey:', error);
      this.showError('No se pudo despublicar la encuesta.');
    } finally {
      this.isSaving.set(false);
    }
  }

  copyPreviewLink(): void {
    const survey = this.survey();
    if (!survey) return;

    navigator.clipboard.writeText(this.getShareLink());
    this.copied.set(true);
    this.showInfo('Enlace de vista copiado.');
    setTimeout(() => this.copied.set(false), 1800);
  }

  copyEmbedCode(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de copiar el embed.');
      return;
    }

    const url = this.getShareLink();
    if (!url) return;

    const embed = `<iframe src="${url}" title="Encuesta DataEncuesta" style="width:100%;height:720px;border:0;border-radius:16px;" loading="lazy"></iframe>`;
    navigator.clipboard.writeText(embed);
    this.recordShareCopy('Embed copiado');
    this.copied.set(true);
    this.showInfo('Código embed copiado.');
    setTimeout(() => this.copied.set(false), 1800);
  }

  copyShareMessage(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de compartirla.');
      return;
    }

    const message = this.getShareMessage();
    navigator.clipboard.writeText(message);
    this.recordShareCopy('Mensaje copiado');
    this.copied.set(true);
    this.showInfo('Mensaje de invitación copiado.');
    setTimeout(() => this.copied.set(false), 1800);
  }

  openWhatsAppShare(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de compartirla.');
      return;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(this.getShareMessage())}`, '_blank', 'noopener,noreferrer');
  }

  openEmailShare(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de compartirla.');
      return;
    }

    const subject = encodeURIComponent(`Encuesta: ${survey.title || 'DataEncuesta'}`);
    const body = encodeURIComponent(this.getShareMessage());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  openQrCode(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de abrir el QR.');
      return;
    }

    window.open(this.getQrCodeUrl(), '_blank', 'noopener,noreferrer');
  }

  copyQrCodeUrl(): void {
    const survey = this.survey();
    if (survey?.status !== 'activo') {
      this.showError('Publica la encuesta antes de copiar el QR.');
      return;
    }

    navigator.clipboard.writeText(this.getQrCodeUrl());
    this.recordShareCopy('QR copiado');
    this.copied.set(true);
    this.showInfo('URL del QR copiada.');
    setTimeout(() => this.copied.set(false), 1800);
  }

  saveNow(): void {
    void this.executeSave();
  }

  async executeSave(): Promise<void> {
    const survey = this.survey();
    if (!survey || this.isSaving()) {
      this.pendingSave = true;
      return;
    }

    if (this.saveRetryTimer) {
      clearTimeout(this.saveRetryTimer);
      this.saveRetryTimer = null;
    }

    this.pendingSave = false;
    this.isSaving.set(true);
    this.saveError.set(null);
    this.saveFailed.set(false);
    const saveSnapshot = this.normalizeSurvey(survey);

    try {
      const savedSurvey = await this.surveyService.saveSurvey(saveSnapshot);
      if (savedSurvey) {
        const current = this.survey();
        this.survey.set(current && current !== survey
          ? this.reconcileSavedIds(current, saveSnapshot, savedSurvey)
          : savedSurvey);
        this.pulseSavedState();
      }
    } catch (error) {
      console.error('Error saving survey:', error);
      this.saveFailed.set(true);
      this.showError(`${this.describeSaveError(error, 'No se pudieron guardar los cambios.')} Reintentando en unos segundos…`);
      this.scheduleSaveRetry();
    } finally {
      this.isSaving.set(false);
      if (this.pendingSave) {
        this.pendingSave = false;
        this.queueSave();
      }
    }
  }

  private scheduleSaveRetry(): void {
    if (this.saveRetryTimer) return;
    this.saveRetryTimer = setTimeout(() => {
      this.saveRetryTimer = null;
      if (this.hasUnsavedChanges() && !this.isSaving()) {
        void this.executeSave();
      }
    }, 6000);
  }

  queueSave(): void {
    this.pushToHistory();
    this.hasUnsavedChanges.set(true);
    this.saveSubject.next();
  }

  setCurrentTab(tab: EditorTab): void {
    this.currentTab.set(tab);
  }

  closePublishChecklist(): void {
    this.showPublishChecklist.set(false);
    this.restoreFocus();
  }

  openPublishChecklist(): void {
    const survey = this.survey();
    if (!survey) return;
    this.captureFocus();
    this.publishChecklist.set(this.getPublishChecklist(survey));
    this.showPublishChecklist.set(true);
  }

  goToAnalytics(): void {
    this.currentTab.set('analyze');
  }

  analyticsMetrics() {
    const survey = this.filteredAnalyticsSurvey();
    return survey ? this.analyticsService.getMetrics(survey) : null;
  }

  hasNPSQuestion(): boolean {
    const survey = this.filteredAnalyticsSurvey();
    if (!survey || !survey.questions) return false;
    return survey.questions.some((q: any) => q.type === 'rating' || q.type === 'scale' || q.type === 'nps');
  }

  dailyResponses() {
    return this.analyticsService.getDailyResponses(this.filteredAnalyticsResponses(), 7);
  }

  responseTrend() {
    return this.analyticsService.getResponseTrend(this.filteredAnalyticsResponses(), 14);
  }

  maxDailyResponses(): number {
    return Math.max(...this.dailyResponses().map((item) => item.count), 1);
  }

  maxTrendResponses(): number {
    return Math.max(...this.responseTrend().data, 1);
  }

  generateSmoothSvgData(data: number[], max: number, width: number, height: number): { line: string, area: string, endX: number, endY: number, points: { x: number, y: number }[] } {
    if (data.length === 0) return { line: '', area: '', endX: 0, endY: 0, points: [] };

    const xOffset = 6; // Padding on left/right edges
    const effectiveWidth = width - (xOffset * 2);
    
    if (data.length === 1) {
      const y = height - (data[0] / (max || 1)) * height * 0.85;
      const pts = [{ x: xOffset, y }, { x: width - xOffset, y }];
      return { 
        line: `M ${xOffset},${y} L ${width - xOffset},${y}`, 
        area: `M ${xOffset},${y} L ${width - xOffset},${y} L ${width - xOffset},${height} L ${xOffset},${height} Z`, 
        endX: width - xOffset, 
        endY: y,
        points: pts
      };
    }

    const step = effectiveWidth / (data.length - 1);
    const padding = 0.85; // Leave some space at the top

    const points = data.map((val, i) => {
      const x = xOffset + (i * step);
      const y = height - (val / (max || 1)) * height * padding;
      return { x, y };
    });

    let linePath = `M ${points[0].x},${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const cp1x = curr.x + step / 2;
      const cp1y = curr.y;
      const cp2x = curr.x + step / 2;
      const cp2y = next.y;
      linePath += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
    }

    const areaPath = linePath + ` L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;
    
    return { line: linePath, area: areaPath, endX: points[points.length - 1].x, endY: points[points.length - 1].y, points };
  }

  dailyResponsesSvgData = computed(() => {
    const data = this.dailyResponses().map((item: any) => item.count);
    return this.generateSmoothSvgData(data, this.maxDailyResponses(), 400, 100);
  });

  trendResponsesSvgData = computed(() => {
    const data = this.responseTrend().data;
    return this.generateSmoothSvgData(data, this.maxTrendResponses(), 400, 100);
  });


  toggleAnalyticsQuestion(questionId: string): void {
    if (questionId === 'all') {
      this.selectedAnalyticsQuestions.set(['all']);
      return;
    }
    let current = this.selectedAnalyticsQuestions().filter(id => id !== 'all');
    if (current.includes(questionId)) {
      current = current.filter(id => id !== questionId);
    } else {
      current.push(questionId);
    }
    this.selectedAnalyticsQuestions.set(current);
  }

  getQuestionChartView(questionId: string): QuestionChartView {
    return this.questionChartViews()[questionId] || 'bars';
  }

  setQuestionChartView(questionId: string, view: QuestionChartView): void {
    this.questionChartViews.update(views => ({...views, [questionId]: view}));
  }

  openExpandedAnalytics(item: any): void {
    this.expandedAnalyticsQuestionId.set(item.question.id);
  }

  closeExpandedAnalytics(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.expandedAnalyticsQuestionId.set(null);
  }

  getPieChartGradient(distribution: any[]): string {
    const chartColors = [
      '#440789', '#9333ea', '#c084fc', '#e9d5ff', '#6d28d9', '#a78bfa', '#ddd6fe'
    ];
    let currentPercentage = 0;
    const stops = distribution.map((item, i) => {
      const color = chartColors[i % chartColors.length];
      const start = currentPercentage;
      const end = currentPercentage + item.percentage;
      currentPercentage = end;
      return `${color} ${start}% ${end}%`;
    });
    if (currentPercentage < 100 && currentPercentage > 0) {
      stops.push(`#f1f5f9 ${currentPercentage}% 100%`);
    } else if (currentPercentage === 0) {
       stops.push(`#f1f5f9 0% 100%`);
    }
    return `conic-gradient(${stops.join(', ')})`;
  }

  getPieChartSlices(distribution: any[]) {
    const chartColors = ['#440789', '#9333ea', '#c084fc', '#e9d5ff', '#6d28d9', '#a78bfa', '#ddd6fe'];
    let currentAngle = -90; 
    const totalCount = this.getTotalDistributionCount(distribution);
    
    return distribution.map((item, i) => {
      const percentage = totalCount ? (item.count / totalCount) : 0;
      const angle = percentage * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      currentAngle = endAngle;

      if (percentage === 1 || percentage > 0.999) {
        return { color: chartColors[i % chartColors.length], isFull: true, path: '', label: item.label, count: item.count, percentage: item.percentage };
      }

      const x1 = 50 + 50 * Math.cos((Math.PI * startAngle) / 180);
      const y1 = 50 + 50 * Math.sin((Math.PI * startAngle) / 180);
      const x2 = 50 + 50 * Math.cos((Math.PI * endAngle) / 180);
      const y2 = 50 + 50 * Math.sin((Math.PI * endAngle) / 180);
      
      const largeArcFlag = angle > 180 ? 1 : 0;
      const pathData = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      return { color: chartColors[i % chartColors.length], isFull: false, path: pathData, label: item.label, count: item.count, percentage: item.percentage };
    });
  }

  getTotalDistributionCount(distribution: any[]): number {
    return distribution.reduce((acc, cur) => acc + (cur.count || 0), 0);
  }

  setActiveResultsSection(section: ResultsSection): void {
    this.activeResultsSection.set(section);
  }

  selectIndividualResponse(responseId: string): void {
    this.selectedResponseId.set(responseId);
  }

  getSelectedQuestionsAnalytics() {
    const survey = this.filteredAnalyticsSurvey();
    if (!survey) return [];
    
    const selected = this.selectedAnalyticsQuestions();
    let questionsToAnalyze = survey.questions;
    
    if (selected.length > 0 && !selected.includes('all')) {
      questionsToAnalyze = survey.questions.filter(q => selected.includes(q.id));
    } else if (selected.length === 0) {
      return [];
    }

    return questionsToAnalyze.map(q => {
      const isText = this.isTextAnalyticsQuestion(q.id);
      let dist: any[] = [];
      let textRes: string[] = [];
      if (!isText) {
        dist = this.analyticsService.getQuestionDistribution(survey, q.id);
      } else {
        const query = this.analyticsTextSearch().trim().toLowerCase();
        const allText = this.analyticsService.getTextResponses(survey, q.id);
        textRes = query ? allText.filter((text: string) => text.toLowerCase().includes(query)) : allText;
      }
      
      const maxDist = Math.max(...dist.map(item => item.count), 1);
      const totalDist = dist.reduce((sum, item) => sum + item.count, 0);
      
      const colors = ['#440789', '#6d28d9', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#e0e7ff'];
      let cursor = 0;
      const distributionWithColors = dist.map((item, index) => ({
        ...item,
        color: colors[index % colors.length]
      }));
      const segments = distributionWithColors.map((item) => {
        const start = cursor;
        cursor += item.percentage;
        return `${item.color} ${start}% ${cursor}%`;
      });
      const donutGradient = segments.length > 0
        ? `conic-gradient(${segments.join(', ')})`
        : 'conic-gradient(#e2e8f0 0 100%)';

      return {
        question: q,
        isText,
        distribution: dist,
        distributionWithColors,
        textResponses: textRes,
        maxDist,
        totalDist,
        donutGradient
      };
    });
  }



  exportInlineAnalyticsCSV(): void {
    const survey = this.survey();
    if (!survey) return;
    const headers = ['Response ID', 'Timestamp', 'Duration (s)', 'Nombre', 'Email', ...survey.questions.map((question) => question.text)];
    const rows = survey.responses.map((response) => {
      const name = response.answers.find((answer) => answer.questionId === '__participant_name')?.value ?? '';
      const email = response.answers.find((answer) => answer.questionId === '__participant_email')?.value ?? '';
      const answers = survey.questions.map((question) => this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === question.id)?.value ?? ''));
      return [response.id, response.completedAt, String(response.duration), this.formatAnalyticsCell(name), this.formatAnalyticsCell(email), ...answers];
    });
    const csv = [headers.map((header) => this.csvEscape(header)).join(','), ...rows.map((row) => row.map((cell) => this.csvEscape(cell)).join(','))].join('\n');
    this.downloadAnalyticsBlob(new Blob([csv], { type: 'text/csv' }), `${survey.title.replace(/\s+/g, '_')}_export.csv`);
  }

  exportInlineAnalyticsExcel(): void {
    const survey = this.survey();
    if (!survey) return;
    const headers = ['Response ID', 'Timestamp', 'Duration (s)', 'Nombre', 'Email', ...survey.questions.map((question) => question.text)];
    const rows = survey.responses.map((response) => {
      const name = response.answers.find((answer) => answer.questionId === '__participant_name')?.value ?? '';
      const email = response.answers.find((answer) => answer.questionId === '__participant_email')?.value ?? '';
      return [
        response.id,
        response.completedAt,
        String(response.duration),
        this.formatAnalyticsCell(name),
        this.formatAnalyticsCell(email),
        ...survey.questions.map((question) => this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === question.id)?.value ?? ''))
      ];
    });
    const table = `<table><thead><tr>${headers.map((header) => `<th>${this.htmlEscape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${this.htmlEscape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    this.downloadAnalyticsBlob(new Blob([table], { type: 'application/vnd.ms-excel' }), `${survey.title.replace(/\s+/g, '_')}_export.xls`);
  }

  printInlineAnalytics(): void {
    const survey = this.survey();
    if (!survey) return;
    this.openAnalyticsPdfReport(survey);
  }

  private openAnalyticsPdfReport(survey: Survey): void {
    const reportWindow = window.open('', '_blank', 'width=1100,height=800');
    const html = this.buildAnalyticsReportHtml(survey);

    if (!reportWindow) {
      this.downloadAnalyticsBlob(new Blob([html], { type: 'text/html' }), `${this.slugifyFileName(survey.title)}_informe.html`);
      this.showInfo('Se descargo el informe. Abre el archivo y guardalo como PDF.');
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
    reportWindow.focus();
    setTimeout(() => reportWindow.print(), 350);
  }

  private buildAnalyticsReportHtml(survey: Survey): string {
    const metrics = this.analyticsService.getMetrics(survey);
    const generatedAt = new Date().toLocaleString();
    const latestResponse = survey.responses
      .map((response) => response.completedAt)
      .sort()
      .at(-1);
    const latestLabel = latestResponse ? new Date(latestResponse).toLocaleString() : 'Sin respuestas';
    const trend = this.analyticsService.getResponseTrend(survey.responses, 14);
    const maxTrend = Math.max(...trend.data, 1);
    const requiredCount = survey.questions.filter((question) => question.required).length;
    const tableHeaders = ['#', 'Fecha', 'Duracion', 'Nombre', 'Email', ...survey.questions.map((question) => question.text || 'Pregunta')];

    const trendRows = trend.data.map((value, index) => `
      <tr>
        <td>${this.htmlEscape(trend.labels[index] ?? '')}</td>
        <td>${value}</td>
        <td>${value === 0 ? 'Sin actividad' : value === maxTrend ? 'Pico del periodo' : 'Actividad registrada'}</td>
      </tr>
    `).join('');

    const questionSections = survey.questions.map((question, index) => {
      const answered = survey.responses.filter((response) => response.answers.some((answer) => answer.questionId === question.id));
      const distribution = this.analyticsService.getQuestionDistribution(survey, question.id);
      const textResponses = this.analyticsService.getTextResponses(survey, question.id);
      const maxDistribution = Math.max(...distribution.map((item) => item.count), 1);
      const body = distribution.length > 0
        ? distribution.map((item) => `
            <div class="dist-row">
              <span>${this.htmlEscape(item.label)}</span>
              <div><i style="width:${Math.max((item.count / maxDistribution) * 100, item.count > 0 ? 4 : 0)}%"></i></div>
              <strong>${item.count}</strong>
              <em>${item.percentage}%</em>
            </div>
          `).join('')
        : textResponses.length > 0
          ? textResponses.slice(0, 12).map((text) => `<blockquote>${this.htmlEscape(text)}</blockquote>`).join('')
          : '<p class="muted">No hay respuestas registradas para esta pregunta.</p>';

      return `
        <section class="question-card">
          <div class="question-head">
            <span>Pregunta ${index + 1}</span>
            <strong>${answered.length} respuesta${answered.length === 1 ? '' : 's'}</strong>
          </div>
          <h3>${this.htmlEscape(question.text || 'Pregunta sin titulo')}</h3>
          ${question.description ? `<p class="muted">${this.htmlEscape(question.description)}</p>` : ''}
          ${body}
        </section>
      `;
    }).join('');

    const responseRows = survey.responses.map((response, index) => {
      const name = this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === '__participant_name')?.value ?? '');
      const email = this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === '__participant_email')?.value ?? '');
      const answers = survey.questions.map((question) => this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === question.id)?.value ?? 'Sin respuesta'));
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${this.htmlEscape(new Date(response.completedAt).toLocaleString())}</td>
          <td>${this.htmlEscape(this.formatDuration(response.duration))}</td>
          <td>${this.htmlEscape(name || '-')}</td>
          <td>${this.htmlEscape(email || '-')}</td>
          ${answers.map((answer) => `<td>${this.htmlEscape(answer)}</td>`).join('')}
        </tr>
      `;
    }).join('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Informe - ${this.htmlEscape(survey.title || 'Encuesta')}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; background: #f8fafc; font-family: Inter, Arial, sans-serif; line-height: 1.45; }
    .report { max-width: 1100px; margin: 0 auto; padding: 32px; background: #fff; }
    .hero { border: 1px solid #e5e7eb; border-radius: 18px; padding: 28px; background: linear-gradient(135deg, #ffffff, #f3f0ff); }
    .eyebrow { margin: 0 0 8px; color: #440789; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; color: #111827; font-size: 34px; line-height: 1.1; }
    h2 { margin: 32px 0 12px; font-size: 20px; }
    h3 { margin: 8px 0; font-size: 16px; }
    p { margin: 8px 0 0; }
    .muted { color: #64748b; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; color: #475569; font-size: 12px; }
    .meta span { border: 1px solid #e5e7eb; border-radius: 999px; padding: 6px 10px; background: #fff; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 18px; }
    .metric { border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px; background: #fff; }
    .metric small { display: block; color: #64748b; font-size: 11px; font-weight: 700; }
    .metric strong { display: block; margin-top: 6px; color: #440789; font-size: 24px; line-height: 1; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .panel, .question-card { break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; background: #fff; }
    .question-card { margin-bottom: 12px; }
    .question-head { display: flex; justify-content: space-between; gap: 12px; color: #64748b; font-size: 12px; font-weight: 700; }
    .report-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    .report-table th, .report-table td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    .report-table th { background: #f8fafc; color: #334155; font-weight: 800; }
    .dist-row { display: grid; grid-template-columns: minmax(150px, 1fr) 2fr 48px 48px; gap: 10px; align-items: center; margin-top: 9px; font-size: 12px; }
    .dist-row div { height: 8px; border-radius: 999px; background: #eef2ff; overflow: hidden; }
    .dist-row i { display: block; height: 100%; border-radius: inherit; background: #440789; }
    .dist-row strong, .dist-row em { text-align: right; font-style: normal; }
    blockquote { margin: 10px 0 0; border-left: 3px solid #c4b5fd; padding: 8px 10px; background: #f8fafc; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10px; }
    th, td { border: 1px solid #e5e7eb; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #334155; font-weight: 800; }
    td { color: #1f2937; }
    .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 11px; }
    @media print {
      body { background: #fff; }
      .report { padding: 0; max-width: none; }
      .hero, .panel, .question-card, .metric { box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="report">
    <section class="hero">
      <p class="eyebrow">Informe de resultados</p>
      <h1>${this.htmlEscape(survey.title || 'Encuesta sin titulo')}</h1>
      ${survey.description ? `<p class="muted">${this.htmlEscape(survey.description)}</p>` : ''}
      <div class="meta">
        <span>Generado: ${this.htmlEscape(generatedAt)}</span>
        <span>Ultima respuesta: ${this.htmlEscape(latestLabel)}</span>
        <span>Estado: ${this.htmlEscape(String(survey.status))}</span>
        <span>${survey.questions.length} pregunta${survey.questions.length === 1 ? '' : 's'} (${requiredCount} requerida${requiredCount === 1 ? '' : 's'})</span>
      </div>
      <div class="metrics">
        <article class="metric"><small>Total respuestas</small><strong>${metrics.totalResponses}</strong></article>
        <article class="metric"><small>Tasa de completado</small><strong>${metrics.completionRate}%</strong></article>
        <article class="metric"><small>Tiempo promedio</small><strong>${this.htmlEscape(metrics.avgDurationFormatted)}</strong></article>
        <article class="metric"><small>NPS</small><strong>${metrics.npsScore > 0 ? '+' : ''}${metrics.npsScore}</strong></article>
      </div>
    </section>

    <h2>Resumen ejecutivo</h2>
    <section class="summary-grid">
      <article class="panel">
        <h3>Lectura general</h3>
        <p class="muted">La encuesta registra ${metrics.totalResponses} respuesta${metrics.totalResponses === 1 ? '' : 's'}, con una tasa de completado de ${metrics.completionRate}% y un tiempo promedio de ${this.htmlEscape(metrics.avgDurationFormatted)}.</p>
      </article>
      <article class="panel">
        <h3>Movimiento de respuestas, ultimos 14 dias</h3>
        <table class="report-table">
          <thead>
            <tr>
              <th>Dia</th>
              <th>Respuestas</th>
              <th>Lectura</th>
            </tr>
          </thead>
          <tbody>${trendRows}</tbody>
        </table>
      </article>
    </section>

    <h2>Analisis por pregunta</h2>
    ${questionSections || '<p class="muted">No hay preguntas configuradas.</p>'}

    <h2>Base completa de respuestas</h2>
    <table>
      <thead><tr>${tableHeaders.map((header) => `<th>${this.htmlEscape(header)}</th>`).join('')}</tr></thead>
      <tbody>${responseRows || `<tr><td colspan="${tableHeaders.length}">Sin respuestas registradas.</td></tr>`}</tbody>
    </table>

    <p class="footer">Informe generado por DataEncuesta. Revise los datos personales antes de compartir este documento externamente.</p>
  </main>
</body>
</html>`;
  }

  latestResponseDate(): string {
    const latest = this.filteredAnalyticsResponses()
      .map((response) => response.completedAt)
      .sort()
      .at(-1);
    return latest ? new Date(latest).toLocaleString() : 'Sin respuestas';
  }

  analyticsRangeLabel(): string {
    switch (this.analyticsRange()) {
      case '7d': return '7 días';
      case '14d': return '14 días';
      case '30d': return '30 días';
      default: return 'Todo';
    }
  }

  analyticsInsights(): { icon: string; title: string; detail: string; tone: 'good' | 'warn' | 'info' }[] {
    const survey = this.filteredAnalyticsSurvey();
    const metrics = this.analyticsMetrics();
    if (!survey || !metrics || survey.responses.length === 0) {
      return [
        { icon: 'campaign', title: 'Aún no hay respuestas', detail: 'Comparte el enlace o QR para empezar a recolectar datos.', tone: 'info' }
      ];
    }

    const insights: { icon: string; title: string; detail: string; tone: 'good' | 'warn' | 'info' }[] = [];
    insights.push({
      icon: metrics.completionRate >= 70 ? 'task_alt' : 'warning',
      title: metrics.completionRate >= 70 ? 'Buen nivel de completado' : 'Revisa la fricción',
      detail: `La tasa de completado es ${metrics.completionRate}%.`,
      tone: metrics.completionRate >= 70 ? 'good' : 'warn'
    });
    insights.push({
      icon: 'timer',
      title: metrics.avgDuration > 180 ? 'Duración elevada' : 'Tiempo razonable',
      detail: `El promedio de respuesta es ${metrics.avgDurationFormatted}.`,
      tone: metrics.avgDuration > 180 ? 'warn' : 'good'
    });
    const mostAnswered = survey.questions
      .map((question) => ({
        question,
        count: survey.responses.filter((response) => response.answers.some((answer) => answer.questionId === question.id)).length
      }))
      .sort((a, b) => b.count - a.count)[0];
    if (mostAnswered) {
      insights.push({
        icon: 'leaderboard',
        title: 'Pregunta con más datos',
        detail: `${mostAnswered.question.text || 'Pregunta'} tiene ${mostAnswered.count} respuesta(s).`,
        tone: 'info'
      });
    }
    return insights.slice(0, 3);
  }

  recentAnalyticsResponses() {
    return [...this.filteredAnalyticsResponses()]
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
      .slice(0, 8);
  }

  analyticsResponsesList() {
    return [...this.filteredAnalyticsResponses()]
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  }

  selectedIndividualResponse(): Survey['responses'][number] | null {
    const responses = this.analyticsResponsesList();
    if (!responses.length) return null;
    const selected = this.selectedResponseId();
    return responses.find((response) => response.id === selected) ?? responses[0];
  }

  selectedIndividualResponseIndex(): number {
    const response = this.selectedIndividualResponse();
    if (!response) return 0;
    const index = this.analyticsResponsesList().findIndex((item) => item.id === response.id);
    return index >= 0 ? index + 1 : 1;
  }

  individualResponseAnswers(response: Survey['responses'][number] | null = this.selectedIndividualResponse()) {
    const survey = this.survey();
    if (!survey || !response) return [];
    return survey.questions.map((question, index) => {
      const answer = response.answers.find((item) => item.questionId === question.id);
      const value = this.formatAnalyticsCell(answer?.value ?? '');
      return {
        index: index + 1,
        question,
        value: value || 'Sin respuesta',
        answered: value.trim().length > 0
      };
    });
  }

  individualResponseAnsweredCount(response: Survey['responses'][number] | null = this.selectedIndividualResponse()): number {
    return this.individualResponseAnswers(response).filter((answer) => answer.answered).length;
  }

  responseParticipantValue(response: Survey['responses'][number], field: 'name' | 'email'): string {
    const id = field === 'name' ? '__participant_name' : '__participant_email';
    return this.formatAnalyticsCell(response.answers.find((answer) => answer.questionId === id)?.value ?? '');
  }

  responseCompletionLabel(response: Survey['responses'][number]): string {
    const required = this.survey()?.questions.filter((question) => question.required).map((question) => question.id) ?? [];
    if (!required.length) return 'Completa';
    const answered = response.answers.map((answer) => answer.questionId);
    return required.every((id) => answered.includes(id)) ? 'Completa' : 'Incompleta';
  }

  responseAnswerPreview(response: Survey['responses'][number]): string {
    const survey = this.survey();
    if (!survey) return '';
    const answer = response.answers.find((item) => survey.questions.some((question) => question.id === item.questionId));
    return this.formatAnalyticsCell(answer?.value ?? 'Sin respuesta');
  }

  goToShareFromResults(): void {
    this.currentTab.set('collect');
    this.activeShareSection.set('link');
  }

  getShareLink(): string {
    const survey = this.survey();
    return survey ? this.surveyService.getShareLink(survey.id) : '';
  }

  setActiveShareSection(section: ShareSection): void {
    this.activeShareSection.set(section);
    if (section === 'checklist') {
      const survey = this.survey();
      if (survey) {
        this.publishChecklist.set(this.getPublishChecklist(survey));
      }
    }
  }

  async downloadQrCode(): Promise<void> {
    const survey = this.survey();
    if (!survey || this.qrDownloading()) return;

    this.qrDownloading.set(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(this.getQrCodeUrl(), { signal: controller.signal });
      if (!response.ok) throw new Error(`QR request failed with status ${response.status}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const sanitizedTitle = (survey.title || 'encuesta').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.download = `qr-${sanitizedTitle}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      this.showInfo('Código QR descargado con éxito.');
    } catch (error) {
      console.error('Error al descargar el QR:', error);
      window.open(this.getQrCodeUrl(), '_blank');
      this.showInfo('Se abrió el QR en una nueva pestaña.');
    } finally {
      clearTimeout(timeoutId);
      this.qrDownloading.set(false);
    }
  }

  openSurveySettings(): void {
    const survey = this.survey();
    if (survey) {
      const metadata = (survey.metadata || {}) as any;

      this.surveyMaxResponses.set(metadata.maxResponses ?? null);
      this.surveyPreventDuplicates.set(metadata.responsePolicy === 'once-per-browser');
      this.surveySkipWelcome.set(metadata.skipWelcomePage ?? false);
      this.surveyCloseDate.set(metadata.closesAt ?? '');
    }
    this.setActiveShareSection('settings');
  }

  applySettingsToSurvey(): void {
    this.survey.update(survey => {
      if (!survey) return survey;
      const metadata = { ...survey.metadata } as any;
      metadata.maxResponses = this.surveyMaxResponses() || undefined;
      metadata.responsePolicy = this.surveyPreventDuplicates() ? 'once-per-browser' : 'multiple';
      metadata.skipWelcomePage = this.surveySkipWelcome();
      metadata.closesAt = this.surveyCloseDate() || undefined;
      return { ...survey, metadata };
    });
    if (this.surveyCloseDate()) {
      this.publicationDeadline.set(this.surveyCloseDate());
    }
    this.queueSave();
  }

  saveSurveySettings(): void {
    this.applySettingsToSurvey();
    this.setActiveShareSection('link');
  }

  onMaxResponsesInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.surveyMaxResponses.set(val ? Number(val) : null);
    this.applySettingsToSurvey();
  }

  onCloseDateInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.surveyCloseDate.set(val || '');
    this.applySettingsToSurvey();
  }

  updateQrSize(value: string | number): void {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      this.qrSize.set(Math.min(720, Math.max(180, Math.round(numeric))));
      this.selectedQrPreset.set(this.matchQrPreset(Math.min(720, Math.max(180, Math.round(numeric))), this.qrColor())?.id ?? this.selectedQrPreset());
    }
  }

  updateQrColor(value: string): void {
    this.qrColor.set(value || '#111827');
    this.selectedQrPreset.set(this.matchQrPreset(this.qrSize(), value || '#111827')?.id ?? this.selectedQrPreset());
  }

  applyQrPreset(presetId: QrPresetId): void {
    const preset = this.qrPresets.find((item) => item.id === presetId);
    if (!preset) return;
    this.selectedQrPreset.set(preset.id);
    this.qrSize.set(preset.size);
    this.qrColor.set(preset.color);
  }

  activeQrPreset(): QrPreset {
    return this.qrPresets.find((preset) => preset.id === this.selectedQrPreset()) ?? this.qrPresets[0];
  }

  updateQrCtaText(value: string): void {
    this.qrCtaText.set(value.trimStart() || 'Escanea para responder');
  }

  updatePublicationDeadline(value: string): void {
    this.publicationDeadline.set(value);
  }

  updatePublicationAccess(value: 'public' | 'private'): void {
    this.publicationAccess.set(value);
  }

  getEmbedCode(): string {
    const url = this.getShareLink();
    return `<iframe src="${url}" title="Encuesta DataEncuesta" style="width:100%;height:720px;border:0;border-radius:16px;" loading="lazy"></iframe>`;
  }

  getShareMessage(): string {
    const survey = this.survey();
    const title = survey?.title?.trim() || 'Encuesta DataEncuesta';
    return `Hola, te comparto esta encuesta: ${title}\n${this.getShareLink()}`;
  }

  getTrackedShareLink(presetId: QrPresetId = this.selectedQrPreset()): string {
    const link = this.getShareLink();
    const preset = this.qrPresets.find((item) => item.id === presetId) ?? this.activeQrPreset();
    if (!link) return '';
    try {
      const url = new URL(link);
      url.searchParams.set('utm_source', 'qr');
      url.searchParams.set('utm_medium', preset.trackingLabel);
      url.searchParams.set('utm_campaign', 'survey_distribution');
      return url.toString();
    } catch {
      const separator = link.includes('?') ? '&' : '?';
      return `${link}${separator}utm_source=qr&utm_medium=${encodeURIComponent(preset.trackingLabel)}&utm_campaign=survey_distribution`;
    }
  }

  getQrCodeUrl(): string {
    const link = this.getTrackedShareLink();
    const size = this.qrSize();
    const color = this.qrColor().replace('#', '') || '111827';
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&format=png&color=${color}&bgcolor=ffffff&data=${encodeURIComponent(link)}`;
  }

  copyQrVariantLink(presetId: QrPresetId): void {
    navigator.clipboard.writeText(this.getTrackedShareLink(presetId));
    const preset = this.qrPresets.find((item) => item.id === presetId);
    this.recordShareCopy(`Link ${preset?.name ?? 'QR'}`);
    this.showInfo('Link de ubicación copiado.');
  }

  copyQrCampaignKit(): void {
    const survey = this.survey();
    if (!survey) return;
    const lines = [
      survey.title || 'Encuesta DataEncuesta',
      this.qrCtaText(),
      `QR activo: ${this.activeQrPreset().name}`,
      `Link: ${this.getTrackedShareLink()}`,
      `QR PNG: ${this.getQrCodeUrl()}`
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    this.recordShareCopy('Kit QR');
    this.showInfo('Kit de QR copiado.');
  }

  exportQrCampaignKit(): void {
    const survey = this.survey();
    if (!survey) return;
    const title = this.htmlEscape(survey.title || 'Encuesta DataEncuesta');
    const cta = this.htmlEscape(this.qrCtaText());
    const qr = this.htmlEscape(this.getQrCodeUrl());
    const variants = this.qrPresets.map((preset) => `
      <article>
        <h2>${this.htmlEscape(preset.name)}</h2>
        <p>${this.htmlEscape(preset.useCase)}</p>
        <img src="${qr}" alt="QR ${this.htmlEscape(preset.name)}">
        <strong>${cta}</strong>
        <small>${this.htmlEscape(this.getTrackedShareLink(preset.id))}</small>
      </article>
    `).join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Kit QR - ${title}</title><style>
      body{margin:0;background:#f8fafc;color:#111827;font-family:Inter,Arial,sans-serif;padding:32px}
      header{max-width:1100px;margin:0 auto 24px}h1{margin:0 0 8px;font-size:34px}p{color:#64748b}
      main{max-width:1100px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
      article{background:white;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 16px 38px rgba(15,23,42,.08)}
      h2{margin:0 0 8px;font-size:20px}img{width:180px;height:180px;display:block;margin:18px auto;border:10px solid #f8fafc;border-radius:14px}
      strong,small{display:block}strong{text-align:center;font-size:18px}small{margin-top:12px;color:#64748b;word-break:break-all}
    </style></head><body><header><h1>${title}</h1><p>${cta}</p></header><main>${variants}</main></body></html>`;
    this.downloadAnalyticsBlob(new Blob([html], { type: 'text/html' }), `${(survey.title || 'encuesta').replace(/\s+/g, '_')}_kit_qr.html`);
  }

  private matchQrPreset(size: number, color: string): QrPreset | undefined {
    const normalized = color.toLowerCase();
    return this.qrPresets.find((preset) => preset.size === size && preset.color.toLowerCase() === normalized);
  }

  getChecklistCompletion(): number {
    const list = this.publishChecklist().length ? this.publishChecklist() : this.survey() ? this.getPublishChecklist(this.survey() as Survey) : [];
    if (!list.length) return 0;
    return Math.round((list.filter((item) => item.ok).length / list.length) * 100);
  }

  getChecklistItems(survey: Survey): PublishChecklistItem[] {
    return this.publishChecklist().length ? this.publishChecklist() : this.getPublishChecklist(survey);
  }

  getQuickConversionRate(): number {
    const responses = this.survey()?.responses.length || this.survey()?.responses_count || 0;
    const denominator = Math.max(1, responses + 8);
    return Math.round((responses / denominator) * 100);
  }

  private recordShareCopy(label: string): void {
    const stamp = new Date().toLocaleString();
    this.shareCopyHistory.update((history) => [`${label} · ${stamp}`, ...history].slice(0, 5));
  }

  private isTextAnalyticsQuestion(questionId: string): boolean {
    const type = this.survey()?.questions.find((question) => question.id === questionId)?.type;
    return ['text', 'long-text', 'email', 'phone', 'url', 'number', 'date', 'time'].includes(type ?? '');
  }

  filteredAnalyticsSurvey(): Survey | null {
    const survey = this.survey();
    return survey ? { ...survey, responses: this.filteredAnalyticsResponses() } : null;
  }

  filteredAnalyticsResponses(): Survey['responses'] {
    const survey = this.survey();
    if (!survey) return [];
    const range = this.analyticsRange();
    if (range === 'all') return survey.responses;
    const days = range === '7d' ? 7 : range === '14d' ? 14 : 30;
    const cutoff = Date.now() - days * 86400000;
    return survey.responses.filter((response) => new Date(response.completedAt).getTime() >= cutoff);
  }

  private downloadAnalyticsBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private formatAnalyticsCell(value: unknown): string {
    if (Array.isArray(value)) return value.join(' | ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  }

  private formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}m ${secs}s`;
  }

  private slugifyFileName(value: string): string {
    return (value || 'encuesta')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'encuesta';
  }

  private csvEscape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private htmlEscape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  getQuestionCountLabel(): string {
    const count = this.survey()?.questions.length ?? 0;
    return `${count} pregunta${count === 1 ? '' : 's'}`;
  }

  getSurveyPageCount = computed(() => {
    return this.questionPageSummaries().length + 2;
  });

  choiceOptionCount(question: Question): number {
    if (!this.isChoiceType(question.type)) return 0;
    return question.options.filter((option) => option.texto.trim().length > 0).length;
  }

  questionPageSummaries = computed(() => {
    const total = this.survey()?.questions.length ?? 0;
    const breaks = this.normalizePageBreaks(total, this.survey()?.metadata?.questionPageBreaks);
    return breaks.map((start, index) => {
      const end = breaks[index + 1] ?? total;
      return { index, start, end, count: Math.max(0, end - start) };
    });
  });

  // El lienzo visual (arrastrar/redimensionar) no es viable en pantallas táctiles
  // angostas; en su lugar, la pestaña "Crear" muestra esta lista simple de
  // preguntas de la página activa, reutilizando las mismas acciones del lienzo.
  currentPageQuestionsForMobile(): Question[] {
    const survey = this.survey();
    if (!survey) return [];
    const page = this.questionPageSummaries()[this.activeQuestionPageIndex()];
    if (!page) return [];
    return survey.questions.slice(page.start, page.end);
  }

  pageTitle(pageIndex: number): string {
    return this.survey()?.metadata?.questionPageTitles?.[pageIndex]?.trim() || `Página ${pageIndex + 1}`;
  }

  isPageMenuOpen(pageIndex: number): boolean {
    return this.openPageMenuIndex === pageIndex;
  }

  togglePageMenu(pageIndex: number, event: Event): void {
    event.stopPropagation();
    this.openPageMenuIndex = this.openPageMenuIndex === pageIndex ? null : pageIndex;
  }

  editQuestionPageName(pageIndex: number, event?: Event): void {
    event?.stopPropagation();
    this.openPageMenuIndex = null;
    const current = this.pageTitle(pageIndex);
    this.dialogInputValue = current;
    this.captureFocus();
    this.dialogModal.set({
      type: 'prompt',
      title: 'Editar nombre de página',
      placeholder: 'Nombre de la página',
      value: current,
      onConfirm: (value) => {
        if (value === null || value === undefined) return;
        const title = value.trim() || `Página ${pageIndex + 1}`;
        this.survey.update((survey) => {
          if (!survey) return survey;
          const metadata = this.ensureMetadata(survey.metadata);
          const titles = [...(metadata.questionPageTitles ?? [])];
          titles[pageIndex] = title;
          return {
            ...survey,
            metadata: {
              ...metadata,
              questionPageTitles: titles
            }
          };
        });
        this.queueSave();
      }
    });
  }

  selectQuestionPage(page: { index: number; start: number; count: number }): void {
    this.activeSection.set('questions');
    this.activeQuestionPageIndex.set(page.index);
    this.activeQuestionIndex.set(Math.max(0, Math.min(page.start, (this.survey()?.questions.length ?? 1) - 1)));
  }

  moveQuestionPage(pageIndex: number, direction: -1 | 1, event?: Event): void {
    event?.stopPropagation();
    this.openPageMenuIndex = null;
    const survey = this.survey();
    if (!survey) return;

    const pages = this.questionPageSummaries();
    const targetIndex = pageIndex + direction;
    if (targetIndex < 0 || targetIndex >= pages.length) return;
    if (pages[pageIndex].count === 0 || pages[targetIndex].count === 0) {
      this.showInfo('Agrega preguntas antes de moverla.');
      return;
    }

    const chunks = pages.map((page) => survey.questions.slice(page.start, page.end));
    const titles = [...(survey.metadata?.questionPageTitles ?? [])];
    [chunks[pageIndex], chunks[targetIndex]] = [chunks[targetIndex], chunks[pageIndex]];
    [titles[pageIndex], titles[targetIndex]] = [titles[targetIndex], titles[pageIndex]];
    const questions = chunks.flat();
    const breaks: number[] = [];
    let cursor = 0;
    for (const chunk of chunks) {
      breaks.push(cursor);
      cursor += chunk.length;
    }

    this.survey.set(this.normalizeSurvey({
      ...survey,
      questions,
      metadata: {
        ...this.ensureMetadata(survey.metadata),
        questionPageBreaks: breaks,
        questionPageTitles: titles,
        paginationMode: 'paged'
      }
    }));
    this.activeQuestionPageIndex.set(targetIndex);
    this.activeQuestionIndex.set(breaks[targetIndex] ?? 0);
    this.activeSection.set('questions');
    this.queueSave();
  }

  duplicateQuestionPage(pageIndex: number, event?: Event): void {
    event?.stopPropagation();
    this.openPageMenuIndex = null;
    const survey = this.survey();
    if (!survey) return;

    const pages = this.questionPageSummaries();
    const page = pages[pageIndex];
    if (!page) return;

    const cloned = survey.questions.slice(page.start, page.end).map((question) => ({
      ...question,
      id: this.createLocalId('question'),
      options: question.options.map((option) => ({
        ...option,
        id: this.createLocalId('option')
      })),
      logic: []
    }));

    const insertAt = page.end;
    const questions = [...survey.questions];
    questions.splice(insertAt, 0, ...cloned);

    const oldBreaks = this.normalizePageBreaks(survey.questions.length, survey.metadata?.questionPageBreaks);
    const insertedLength = cloned.length;
    const breaks = [
      ...oldBreaks.slice(0, pageIndex + 1),
      insertAt,
      ...oldBreaks.slice(pageIndex + 1).map((value) => value + insertedLength)
    ];
    const titles = [...(survey.metadata?.questionPageTitles ?? [])];
    titles.splice(pageIndex + 1, 0, `${this.pageTitle(pageIndex)} copia`);

    this.survey.set(this.normalizeSurvey({
      ...survey,
      questions,
      metadata: {
        ...this.ensureMetadata(survey.metadata),
        questionPageBreaks: breaks,
        questionPageTitles: titles,
        paginationMode: 'paged'
      }
    }));
    this.activeSection.set('questions');
    this.activeQuestionPageIndex.set(pageIndex + 1);
    this.activeQuestionIndex.set(insertAt);
    this.showInfo('Página duplicada.');
    this.queueSave();
  }

  removeQuestionPage(pageIndex: number, event?: Event): void {
    event?.stopPropagation();
    this.openPageMenuIndex = null;
    const survey = this.survey();
    if (!survey) return;

    const pages = this.questionPageSummaries();
    if (pages.length <= 1) {
      this.showInfo('Debe quedar al menos una página.');
      return;
    }

    const page = pages[pageIndex];
    if (!page) return;
    this.captureFocus();
    this.dialogModal.set({
      type: 'confirm',
      title: 'Eliminar página',
      message: `¿Estás seguro de que deseas eliminar "${this.pageTitle(pageIndex)}" y sus ${page.count} pregunta${page.count === 1 ? '' : 's'}?`,
      onConfirm: () => {
        const questions = survey.questions.filter((_, index) => index < page.start || index >= page.end);
        const chunks = pages
          .filter((_, index) => index !== pageIndex)
          .map((item) => survey.questions.slice(item.start, item.end));
        const breaks: number[] = [];
        let cursor = 0;
        for (const chunk of chunks) {
          breaks.push(cursor);
          cursor += chunk.length;
        }
        const titles = [...(survey.metadata?.questionPageTitles ?? [])];
        titles.splice(pageIndex, 1);

        const nextPageIndex = Math.max(0, Math.min(pageIndex, chunks.length - 1));
        this.survey.set(this.normalizeSurvey({
          ...survey,
          questions,
          metadata: {
            ...this.ensureMetadata(survey.metadata),
            questionPageBreaks: breaks.length ? breaks : [0],
            questionPageTitles: titles,
            paginationMode: breaks.length > 1 ? 'paged' : 'all-at-once'
          }
        }));
        this.activeSection.set('questions');
        this.activeQuestionPageIndex.set(nextPageIndex);
        this.activeQuestionIndex.set(breaks[nextPageIndex] ?? 0);
        this.showInfo(page.count > 0 ? 'Página eliminada.' : 'Página vacía eliminada.');
        this.queueSave();
      }
    });
  }

  currentQuestion = computed(() => {
    const survey = this.survey();
    const index = this.activeQuestionIndex();
    return survey?.questions[index] ?? null;
  });

  welcomeImages(): DecoratedImage[] {
    return this.survey()?.metadata?.welcomeImages ?? [];
  }

  endImages(): DecoratedImage[] {
    return this.survey()?.metadata?.endImages ?? [];
  }

  endTitle(): string {
    return this.survey()?.metadata?.endTitle || 'Gracias por participar';
  }

  endDescription(): string {
    return this.survey()?.metadata?.endDescription || 'Tu respuesta ha sido registrada exitosamente.';
  }

  brand(): SurveyBrand {
    return this.ensureBrand(this.survey()?.metadata?.brand);
  }

  brandLogoConfig(): { x: number; y: number; width: number; height: number } {
    return this.brand().logoConfig ?? this.defaultLogoConfig();
  }

  isPaletteActive(palette: PalettePreset): boolean {
    const brand = this.brand();
    return brand.primaryColor === palette.primaryColor
      && brand.secondaryColor === palette.secondaryColor
      && brand.backgroundColor === palette.backgroundColor
      && brand.surfaceColor === palette.surfaceColor
      && brand.textColor === palette.textColor;
  }

  buttonRadius(): number {
    return this.brand().buttonRadius ?? 18;
  }

  cardRadius(): number {
    return this.brand().cardRadius ?? 24;
  }

  private defaultFontSize(kind: AssetKind): number {
    if (kind === 'welcome-title') return 56;
    if (kind === 'welcome-desc') return 18;
    if (kind === 'welcome-cta') return 17;
    if (kind === 'welcome-kicker') return 12;
    if (kind === 'welcome-meta') return 13;
    if (kind === 'question-title') return 34;
    if (kind === 'question-help') return 15;
    if (kind === 'question-answer') return 18;
    if (kind === 'question-meta') return 12;
    if (kind === 'end-title') return 42;
    if (kind === 'end-desc') return 17;
    if (kind === 'end-summary') return 13;
    if (kind === 'end-brand') return 14;
    return 16;
  }

  welcomeCardStyle(): Record<string, string> {
    const brand = this.brand();
    return {
      '--survey-primary': brand.primaryColor ?? '#440789',
      '--survey-secondary': brand.secondaryColor ?? '#a78bfa',
      '--survey-bg': brand.backgroundColor ?? '#f0edf6',
      '--survey-surface': brand.surfaceColor ?? '#ffffff',
      '--survey-text': brand.textColor ?? '#1f2937',
      '--survey-button-radius': `${brand.buttonRadius ?? 18}px`,
      '--survey-card-radius': `${brand.cardRadius ?? 24}px`,
      '--survey-font-title': `'${brand.fontTitle || 'Inter'}', sans-serif`,
      '--survey-font-body': `'${brand.fontBody || 'Inter'}', sans-serif`,
      '--survey-font-button': `'${brand.fontButton || 'Inter'}', sans-serif`,
      '--survey-button-color': brand.buttonColor || brand.primaryColor || '#440789',
      '--survey-button-text': brand.buttonTextColor || '#ffffff'
    };
  }

  elementStyle(kind: AssetKind, index?: number): Record<string, string> {
    const survey = this.survey();
    if (!survey) return {};
    const metadata = this.ensureMetadata(survey.metadata);

    let config: { x: number; y: number; width?: number; height?: number } | undefined;

    switch (kind) {
      case 'logo': config = metadata.brand?.logoConfig; break;
      case 'welcome-image': config = metadata.welcomeImages?.[index ?? 0]?.config; break;
      case 'welcome-title': config = metadata.welcomeTitleConfig; break;
      case 'welcome-desc': config = metadata.welcomeDescConfig; break;
      case 'welcome-cta': config = metadata.welcomeCtaConfig; break;
      case 'welcome-kicker': config = metadata.welcomeKickerConfig; break;
      case 'welcome-meta': config = metadata.welcomeMetaConfig; break;
      case 'welcome-preview': config = metadata.welcomePreviewConfig; break;
      case 'end-rule': config = metadata.endRuleConfig; break;
      case 'end-icon': config = metadata.endIconConfig; break;
      case 'end-title': config = metadata.endTitleConfig; break;
      case 'end-desc': config = metadata.endDescConfig; break;
      case 'end-summary': config = metadata.endSummaryConfig; break;
      case 'end-brand': config = metadata.endBrandConfig; break;
      case 'question-meta': config = survey.questions[index ?? 0]?.metaConfig; break;
      case 'question-title': config = survey.questions[index ?? 0]?.titleConfig; break;
      case 'question-help': config = survey.questions[index ?? 0]?.helpConfig; break;
      case 'question-answer': config = survey.questions[index ?? 0]?.answerConfig; break;
      case 'question-image': config = survey.questions[index ?? 0]?.imageConfig; break;
    }

    if (!config) return {};

    return {
      'position': 'absolute',
      'left': `${config.x}px`,
      'top': `${config.y}px`,
      'width': config.width ? `${config.width}px` : 'auto',
      'height': config.height ? `${config.height}px` : 'auto',
      'z-index': kind.includes('image') ? '5' : '10'
    };
  }

  startTransform(event: MouseEvent, kind: AssetKind, mode: TransformMode, index?: number, frame?: SurveyElementConfig, frames?: LayoutFrameMap): void {
    event.preventDefault();
    event.stopPropagation();

    if (frames) {
      this.initializeMeasuredLayout(kind, frames, index);
    }

    const survey = this.survey();
    if (!survey) return;
    const metadata = this.ensureMetadata(survey.metadata);

    let config: SurveyElementConfig | undefined;

    switch (kind) {
      case 'logo': config = metadata.brand?.logoConfig ?? this.defaultLogoConfig(); break;
      case 'welcome-image': config = metadata.welcomeImages?.[index ?? 0]?.config; break;
      case 'welcome-title': config = metadata.welcomeTitleConfig ?? { x: 44, y: 180, width: 500, height: 100 }; break;
      case 'welcome-desc': config = metadata.welcomeDescConfig ?? { x: 44, y: 280, width: 450, height: 80 }; break;
      case 'welcome-cta': config = metadata.welcomeCtaConfig ?? { x: 44, y: 400, width: 220, height: 60 }; break;
      case 'welcome-kicker': config = metadata.welcomeKickerConfig ?? { x: 44, y: 140, width: 200, height: 30 }; break;
      case 'welcome-meta': config = metadata.welcomeMetaConfig ?? { x: 44, y: 480, width: 300, height: 40 }; break;
      case 'welcome-preview': config = metadata.welcomePreviewConfig ?? { x: 0, y: 0, width: 280, height: 360 }; break;
      case 'end-rule': config = metadata.endRuleConfig ?? { x: 64, y: 0, width: 420, height: 8 }; break;
      case 'end-icon': config = metadata.endIconConfig ?? { x: 233, y: 130, width: 82, height: 52 }; break;
      case 'end-title': config = metadata.endTitleConfig ?? { x: 34, y: 212, width: 480, height: 120 }; break;
      case 'end-desc': config = metadata.endDescConfig ?? { x: 54, y: 356, width: 440, height: 84 }; break;
      case 'end-summary': config = metadata.endSummaryConfig ?? { x: 94, y: 468, width: 360, height: 48 }; break;
      case 'end-brand': config = metadata.endBrandConfig ?? { x: 64, y: 548, width: 420, height: 54 }; break;
      case 'question-meta': config = survey.questions[index ?? 0]?.metaConfig ?? { x: 0, y: 0, width: 360, height: 42 }; break;
      case 'question-title': config = survey.questions[index ?? 0]?.titleConfig ?? { x: 0, y: 72, width: 708, height: 112 }; break;
      case 'question-help': config = survey.questions[index ?? 0]?.helpConfig ?? { x: 0, y: 202, width: 620, height: 54 }; break;
      case 'question-image': config = survey.questions[index ?? 0]?.imageConfig ?? { x: 0, y: 276, width: 260, height: 180 }; break;
      case 'question-answer': config = survey.questions[index ?? 0]?.answerConfig ?? { x: 0, y: 486, width: 708, height: 150 }; break;
      default:
        if (kind.startsWith('extra-text-')) {
          config = metadata.welcomeExtraTexts?.find(t => t.id === kind)?.config ?? { x: 50, y: 350, width: 300, height: 40 };
        }
        break;
    }

    if (frame) {
      config = {
        ...(config ?? frame),
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        originX: config?.originX ?? frame.x,
        originY: config?.originY ?? frame.y
      };
    }

    if (!config) return;

    this.activeTransform = this.createActiveTransform(kind, mode, event, config, index);
  }

  responseThemeStyle(): Record<string, string> {
    const brand = this.brand();
    const style: Record<string, string> = {
      '--response-primary': brand.primaryColor ?? '#440789',
      '--response-secondary': brand.secondaryColor ?? '#00c4cc',
      '--response-bg': brand.backgroundColor ?? '#16132b',
      '--response-surface': brand.surfaceColor ?? '#ffffff',
      '--response-text': brand.textColor ?? '#f8fafc',
      '--response-button-radius': `${brand.buttonRadius ?? 18}px`,
      '--response-card-radius': `${brand.cardRadius ?? 24}px`
    };
    if (brand.backgroundImageUrl) {
      style['background-image'] = `linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)), url("${brand.backgroundImageUrl}")`;
      style['background-size'] = 'cover';
      style['background-position'] = 'center';
    }
    return style;
  }

  private ensureAuthenticated(): boolean {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/']);
      return false;
    }

    return true;
  }

  private updateQuestion(index: number, patch: Partial<Question>): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      questions[index] = { ...questions[index], ...patch };
      return { ...survey, questions };
    });
    this.queueSave();
  }

  private createBlankQuestion(type: QuestionType): Question {
    return {
      id: this.createLocalId('question'),
      type,
      text: '',
      description: '',
      required: true,
      options: this.isChoiceType(type)
        ? [
            { id: this.createLocalId('option'), texto: 'Opción 1' },
            { id: this.createLocalId('option'), texto: 'Opción 2' }
          ]
        : [],
      min: this.isScaleType(type) ? (type === 'nps' ? 0 : 1) : undefined,
      max: this.isScaleType(type) ? (type === 'rating' ? 5 : 10) : undefined
    };
  }

  private applyDefaultDirectStyle(survey: Survey): Survey {
    const presentation = this.presentationPresets.find((item) => item.name === 'Directa') ?? this.presentationPresets[0];
    const visual = this.visualDesignPresets.find((item) => item.name === 'Minimal blanco') ?? this.visualDesignPresets[0];
    const completion = this.completionPresets.find((item) => item.name === 'Compacto elegante') ?? this.completionPresets[0];
    const metadata = this.ensureMetadata(survey.metadata);
    const brand = this.ensureBrand({
      ...metadata.brand,
      ...visual.brand,
      ...(presentation.brand ?? {}),
      ...(completion.brand ?? {}),
      questionStyle: 'minimal'
    });

    for (const font of [brand.fontTitle, brand.fontBody, brand.fontButton]) {
      if (font) this.loadGoogleFont(font);
    }

    return this.normalizeSurvey({
      ...survey,
      title: presentation.title,
      description: presentation.surveyDescription,
      metadata: {
        ...metadata,
        brand,
        welcomeLayout: presentation.layout,
        ctaText: presentation.ctaText,
        endLayout: completion.layout,
        endTitle: completion.title,
        endDescription: completion.endDescription,
        thankYouTitle: completion.title,
        thankYouDescription: completion.endDescription
      }
    });
  }

  private reconcileSavedIds(current: Survey, snapshot: Survey, saved: Survey): Survey {
    const questions = current.questions.map((question, index) => {
      const snapshotQuestion = snapshot.questions[index];
      const savedQuestion = saved.questions[index];
      const id = snapshotQuestion && savedQuestion && question.id === snapshotQuestion.id
        ? savedQuestion.id
        : question.id;

      const options = question.options.map((option, optionIndex) => {
        const snapshotOption = snapshotQuestion?.options[optionIndex];
        const savedOption = savedQuestion?.options[optionIndex];
        return snapshotOption && savedOption && option.id === snapshotOption.id
          ? { ...option, id: savedOption.id }
          : option;
      });

      return { ...question, id, options };
    });

    return {
      ...current,
      id: saved.id,
      userId: saved.userId,
      status: saved.status,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      responses_count: saved.responses_count,
      responses: saved.responses,
      questions
    };
  }

  private normalizePageBreaks(total: number, breaks?: number[]): number[] {
    const max = Math.max(0, total);
    const raw = breaks?.length ? [...breaks] : [0];
    if (raw[0] !== 0) raw.unshift(0);
    const normalized = raw
      .map((value) => Math.max(0, Math.min(max, Math.round(Number(value) || 0))))
      .sort((a, b) => a - b);
    return normalized.length ? normalized : [0];
  }

  private pageIndexForQuestion(questionIndex: number, breaks: number[]): number {
    let pageIndex = 0;
    for (let index = 0; index < breaks.length; index += 1) {
      if (questionIndex >= breaks[index]) pageIndex = index;
    }
    return pageIndex;
  }

  private pageBreaksAfterQuestionInsert(breaks: number[], insertIndex: number, targetPageIndex: number): number[] {
    return breaks.map((breakValue, breakIndex) => {
      if (breakIndex <= targetPageIndex) return breakValue;
      return breakValue >= insertIndex ? breakValue + 1 : breakValue;
    });
  }

  private normalizePageTitles(titles: string[] | undefined, pageCount: number): string[] {
    return Array.from({ length: pageCount }, (_, index) => {
      const title = titles?.[index]?.trim() ?? '';
      if (!title) return '';
      return /^p[áa]gina\s+\d+$/i.test(title) ? '' : title;
    });
  }

  private patchBrand(patch: Partial<SurveyBrand>): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      const brand = this.ensureBrand(metadata.brand);
      const updatedMetadata = {
        ...metadata,
        brand: { ...brand, ...patch }
      };

      // Recalculate canvas screens with new brand colors
      return this.normalizeSurvey({ ...survey, metadata: updatedMetadata });
    });
    this.queueSave();
  }

  updateCanvasElement(event: { id: string; changes: Partial<CanvasElement> }): void {
    this.survey.update((survey) => {
      if (!survey || !survey.metadata?.canvas) return survey;

      const canvas = { ...survey.metadata.canvas };
      const section = this.activeSection();
      const qIndex = this.activeQuestionIndex();
      const targetId = section === 'questions' ? `question-${qIndex}` : section;

      const screenIndex = canvas.screens.findIndex(s => s.id === targetId);
      if (screenIndex === -1) return survey;

      const screen = { ...canvas.screens[screenIndex] };
      const elements = [...screen.elements];
      const elIndex = elements.findIndex(e => e.id === event.id);

      if (elIndex === -1) return survey;

      const existing = elements[elIndex];
      elements[elIndex] = {
        ...existing,
        ...event.changes,
        styles: {
          ...existing.styles,
          ...(event.changes.styles ?? {}),
          __freeEdited: true
        }
      };
      screen.elements = elements;
      canvas.screens[screenIndex] = screen;

      return {
        ...survey,
        metadata: {
          ...survey.metadata,
          canvas
        }
      };
    });
    this.queueSave();
  }

  selectLayerElement(id: string): void {
    this.selectedElementIds.set([id]);
  }

  alignSelected(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
    const elements = this.selectedCanvasElements();
    if (elements.length === 0) return;

    const updates: Record<string, Partial<CanvasElement>> = {};
    for (const element of elements) {
      if (element.locked) continue;
      if (direction === 'left') updates[element.id] = { x: 40 };
      if (direction === 'center') updates[element.id] = { x: Math.round((1000 - element.width) / 2) };
      if (direction === 'right') updates[element.id] = { x: Math.round(1000 - element.width - 40) };
      if (direction === 'top') updates[element.id] = { y: 40 };
      if (direction === 'middle') updates[element.id] = { y: Math.round((600 - element.height) / 2) };
      if (direction === 'bottom') updates[element.id] = { y: Math.round(600 - element.height - 40) };
    }

    this.patchCurrentScreenElements(updates);
  }

  bringSelectedForward(): void {
    this.adjustSelectedZIndex(1);
  }

  sendSelectedBackward(): void {
    this.adjustSelectedZIndex(-1);
  }

  duplicateSelectedElements(): void {
    const selected = this.selectedCanvasElements();
    if (selected.length === 0) return;

    const clones = selected.map((element, index) => ({
      ...element,
      id: this.createLocalId(`${element.id}-copy`),
      x: element.x + 24 + index * 8,
      y: element.y + 24 + index * 8,
      locked: false,
      zIndex: element.zIndex + 10 + index
    }));

    this.survey.update((survey) => this.updateCurrentScreen(survey, (screen) => ({
      ...screen,
      elements: [...screen.elements, ...clones].sort((a, b) => a.zIndex - b.zIndex)
    })));
    this.selectedElementIds.set(clones.map((element) => element.id));
    this.queueSave();
  }

  toggleSelectedLock(): void {
    const selectedIds = this.selectedElementIds();
    if (selectedIds.length === 0) return;
    const selected = this.selectedCanvasElements();
    const shouldLock = selected.some((element) => !element.locked);
    this.patchCurrentScreenElements(Object.fromEntries(selectedIds.map((id) => [id, { locked: shouldLock }])));
  }

  deleteSelectedElements(): void {
    const selectedIds = new Set(this.selectedElementIds());
    if (selectedIds.size === 0) return;

    this.survey.update((survey) => this.updateCurrentScreen(survey, (screen) => ({
      ...screen,
      elements: screen.elements.filter((element) => element.locked || !selectedIds.has(element.id))
    })));
    this.selectedElementIds.set([]);
    this.queueSave();
  }

  copySelectedStyle(): void {
    const element = this.selectedCanvasElements()[0];
    if (!element) return;
    this.copiedElementStyles = { ...element.styles };
    this.showInfo('Estilo copiado.');
  }

  pasteSelectedStyle(): void {
    if (!this.copiedElementStyles) return;
    const updates = Object.fromEntries(
      this.selectedCanvasElements()
        .filter((element) => !element.locked)
        .map((element) => [element.id, { styles: { ...element.styles, ...this.copiedElementStyles } }])
    );
    this.patchCurrentScreenElements(updates);
  }

  private adjustSelectedZIndex(delta: number): void {
    const updates = Object.fromEntries(
      this.selectedCanvasElements()
        .filter((element) => !element.locked)
        .map((element) => [element.id, { zIndex: Math.max(0, element.zIndex + delta) }])
    );
    this.patchCurrentScreenElements(updates);
  }

  private patchCurrentScreenElements(updates: Record<string, Partial<CanvasElement>>): void {
    if (Object.keys(updates).length === 0) return;

    this.survey.update((survey) => this.updateCurrentScreen(survey, (screen) => ({
      ...screen,
      elements: screen.elements
        .map((element) => updates[element.id] ? { ...element, ...updates[element.id] } : element)
        .sort((a, b) => a.zIndex - b.zIndex)
    })));
    this.queueSave();
  }

  private updateCurrentScreen(survey: Survey | null, updater: (screen: CanvasScreen) => CanvasScreen): Survey | null {
    if (!survey || !survey.metadata?.canvas) return survey;

    const section = this.activeSection();
    const qIndex = this.activeQuestionIndex();
    const targetId = section === 'questions' ? `question-${qIndex}` : section;
    const canvas = { ...survey.metadata.canvas };
    const screenIndex = canvas.screens.findIndex((screen) => screen.id === targetId);
    if (screenIndex === -1) return survey;

    const screens = [...canvas.screens];
    screens[screenIndex] = updater({ ...screens[screenIndex], elements: [...screens[screenIndex].elements] });

    return {
      ...survey,
      metadata: {
        ...survey.metadata,
        canvas: {
          ...canvas,
          screens
        }
      }
    };
  }

  private addWelcomeImage(imageUrl: string, width: number, height: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      const welcomeImages = [...(metadata.welcomeImages ?? [])];
      welcomeImages.push({
        id: this.createLocalId('welcome-image'),
        imageUrl,
        config: {
          x: 40 + welcomeImages.length * 18,
          y: 40 + welcomeImages.length * 18,
          width: Math.min(Math.max(width, 80), 220),
          height: Math.min(Math.max(height, 80), 220),
          rotation: 0,
          zIndex: 5 + welcomeImages.length
        }
      });
      return { ...survey, metadata: { ...metadata, welcomeImages } };
    });
    this.queueSave();
  }

  private addEndImage(imageUrl: string, width: number, height: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const metadata = this.ensureMetadata(survey.metadata);
      const endImages = [...(metadata.endImages ?? [])];
      endImages.push({
        id: this.createLocalId('end-image'),
        imageUrl,
        config: {
          x: 40 + endImages.length * 18,
          y: 40 + endImages.length * 18,
          width: Math.min(Math.max(width, 80), 220),
          height: Math.min(Math.max(height, 80), 220),
          rotation: 0,
          zIndex: 5 + endImages.length
        }
      });
      return { ...survey, metadata: { ...metadata, endImages } };
    });
    this.queueSave();
  }

  private attachQuestionImage(index: number, imageUrl: string, width: number, height: number): void {
    this.survey.update((survey) => {
      if (!survey) {
        return survey;
      }

      const questions = [...survey.questions];
      const question = { ...questions[index] };
      question.imageUrl = imageUrl;
      question.imageConfig = {
        x: 30,
        y: 20,
        width: Math.min(Math.max(width, 70), 200),
        height: Math.min(Math.max(height, 70), 200),
        rotation: 0,
        zIndex: 9
      };
      questions[index] = question;
      return { ...survey, questions };
    });
    this.queueSave();
  }

  private readImageFile(file: File, onLoad: (imageUrl: string, width: number, height: number) => void): void {
    // If it's a GIF, we preserve it to keep the animation
    if (file.type === 'image/gif') {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => onLoad(reader.result as string, img.width, img.height);
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxWidth = 1200;
        const scale = image.width > maxWidth ? maxWidth / image.width : 1;
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, width, height);
        onLoad(canvas.toDataURL('image/webp', 0.88), Math.min(width, 220), Math.min(height, 220));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }


  private ensureMetadata(metadata?: SurveyMetadata): SurveyMetadata {
    return {
      ...(metadata || {}),
      canvas: metadata?.canvas,
      brand: this.ensureBrand(metadata?.brand),
      welcomeLayout: metadata?.welcomeLayout ?? 'split',
      welcomeImages: metadata?.welcomeImages ?? [],
      endTitle: metadata?.endTitle ?? 'Gracias por participar',
      endDescription: metadata?.endDescription ?? 'Tu respuesta ha sido registrada exitosamente.',
      endLayout: metadata?.endLayout ?? 'centered',
      endImages: metadata?.endImages ?? [],
      welcomeTitleConfig: metadata?.welcomeTitleConfig,
      welcomeDescConfig: metadata?.welcomeDescConfig,
      welcomeCtaConfig: metadata?.welcomeCtaConfig,
      welcomeKickerConfig: metadata?.welcomeKickerConfig,
      welcomeMetaConfig: metadata?.welcomeMetaConfig,
      welcomePreviewConfig: metadata?.welcomePreviewConfig,
      endRuleConfig: metadata?.endRuleConfig,
      endIconConfig: metadata?.endIconConfig,
      endTitleConfig: metadata?.endTitleConfig,
      endDescConfig: metadata?.endDescConfig,
      endSummaryConfig: metadata?.endSummaryConfig,
      endBrandConfig: metadata?.endBrandConfig,
      ctaText: metadata?.ctaText ?? 'Comenzar encuesta',
      questionPageBreaks: metadata?.questionPageBreaks ?? [0],
      questionPageTitles: metadata?.questionPageTitles ?? [],
      paginationMode: metadata?.questionPageBreaks && metadata.questionPageBreaks.length > 1 ? 'paged' : 'all-at-once',
      questionsPerPage: undefined,
      progressMode: metadata?.progressMode ?? 'percentage',
      theme: metadata?.theme,
      thankYouTitle: metadata?.thankYouTitle,
      thankYouDescription: metadata?.thankYouDescription
    };
  }

  private ensureBrand(brand?: SurveyBrand): SurveyBrand {
    const logoConfig = {
      ...this.defaultLogoConfig(),
      ...(brand?.logoConfig ?? {})
    };

    return {
      primaryColor: '#440789',
      secondaryColor: '#00c4cc',
      backgroundColor: '#f0edf6',
      surfaceColor: '#ffffff',
      textColor: '#1f2937',
      backgroundImageUrl: undefined,
      questionStyle: 'classic',
      buttonStyle: 'rounded',
      buttonRadius: 18,
      cardRadius: 24,
      fontTitle: 'Inter',
      fontBody: 'Inter',
      fontButton: 'Inter',
      glassEffect: false,
      shadowPreset: 'soft',
      borderGlow: false,
      entryAnimation: 'none',
      progressBar: { enabled: true, style: 'line' },
      ...brand,
      logoConfig
    };
  }

  private defaultLogoConfig(): SurveyElementConfig {
    return { x: 36, y: 24, width: 120, height: 56 };
  }

  private normalizeSurvey(survey: Survey): Survey {
    let normalized = {
      ...survey,
      title: survey.title.trim() || 'Nueva Encuesta',
      description: survey.description.trim(),
      questions: survey.questions.map((question, index) => ({
        ...question,
        id: question.id || this.createLocalId(`question-${index}`),
        text: question.text.trim(),
        description: question.description?.trim() || undefined,
        options: this.isChoiceType(question.type)
          ? question.options
            .map((option, optionIndex) => ({
              ...option,
              id: option.id || this.createLocalId(`option-${index}-${optionIndex}`),
              texto: option.texto
            }))
          : [],
        min: this.isScaleType(question.type) ? (question.type === 'nps' ? 0 : 1) : undefined,
        max: this.isScaleType(question.type) ? (question.type === 'rating' ? 5 : 10) : undefined,
        validation: this.cleanValidation(question.validation),
        logic: question.logic?.filter((rule) => rule.goTo) ?? [],
        randomizeOptions: this.isChoiceType(question.type) ? question.randomizeOptions ?? false : false
      }))
    };

    normalized.metadata = this.ensureCanvasScreens(this.ensureMetadata(normalized.metadata), normalized);
    normalized.metadata.questionPageBreaks = this.normalizePageBreaks(normalized.questions.length, normalized.metadata.questionPageBreaks);
    normalized.metadata.questionPageTitles = this.normalizePageTitles(normalized.metadata.questionPageTitles, normalized.metadata.questionPageBreaks.length);
    normalized.metadata.paginationMode = normalized.metadata.questionPageBreaks.length > 1 ? 'paged' : 'all-at-once';

    return normalized;
  }

  isChoiceType(type: QuestionType): boolean {
    return type === 'multiple-choice' || type === 'multi-select' || type === 'visual-choice';
  }

  private isScaleType(type: QuestionType): boolean {
    return type === 'rating' || type === 'scale' || type === 'nps';
  }

  private ensureCanvasScreens(metadata: SurveyMetadata, survey: Survey): SurveyMetadata {
    if (!metadata.canvas) {
      metadata.canvas = { screens: [] };
    }

    const canvas = metadata.canvas!;
    const freeLayoutVersion = 3;
    if (canvas.layoutVersion !== freeLayoutVersion) {
      canvas.screens = [];
      canvas.layoutVersion = freeLayoutVersion;
    }

    const brand = this.ensureBrand(metadata.brand);
    const primaryColor = brand.primaryColor || '#440789';
    const secondaryColor = brand.secondaryColor || '#06b6d4';
    const textColor = brand.textColor || '#111827';
    const bg = brand.backgroundColor || '#f4f0ff';
    const surfaceColor = brand.surfaceColor || '#ffffff';
    const cardRadius = `${brand.cardRadius ?? 24}px`;
    const shadow = this.canvasShadow(brand.shadowPreset);
    const validQuestionScreenIds = new Set(survey.questions.map((_, index) => `question-${index}`));
    canvas.screens = canvas.screens.filter((screen) => screen.type !== 'question' || validQuestionScreenIds.has(screen.id));

    // Welcome Screen - Sync with brand
    let welcomeScreen = canvas.screens.find(s => s.id === 'welcome');
    if (!welcomeScreen) {
      welcomeScreen = {
        id: 'welcome',
        type: 'welcome',
        background: { type: 'gradient', value: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` },
        elements: []
      };
      canvas.screens.push(welcomeScreen);
    } else {
      // Force sync background with brand for consistency
      welcomeScreen.background = { type: 'gradient', value: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` };
    }

    welcomeScreen.elements = this.mergeCanvasElements(
      welcomeScreen.elements,
      this.createWelcomeCanvasElements(
        survey,
        metadata,
        { primaryColor, secondaryColor, textColor, surfaceColor, cardRadius, shadow }
      )
    );

    if (welcomeScreen.elements.length === 0) {
      welcomeScreen.elements = [
        {
          id: 'welcome-kicker',
          type: 'text',
          content: 'VISTA PREVIA PÚBLICA',
          x: 60, y: 80, width: 300, height: 30,
          rotation: 0, zIndex: 10, locked: false, hidden: false,
          styles: { fontSize: '12px', fontWeight: '800', color: '#ffffff', letterSpacing: '0.1em', opacity: '0.8' }
        },
        {
          id: 'welcome-title',
          type: 'text',
          content: survey.title || 'Nueva Encuesta',
          x: 60, y: 120, width: 880, height: 100,
          rotation: 0, zIndex: 10, locked: false, hidden: false,
          styles: { fontSize: '56px', fontWeight: '850', color: '#ffffff', lineHeight: '1.1' }
        },
        {
          id: 'welcome-desc',
          type: 'text',
          content: survey.description || 'Descripción de tu encuesta',
          x: 60, y: 240, width: 700, height: 60,
          rotation: 0, zIndex: 10, locked: false, hidden: false,
          styles: { fontSize: '20px', fontWeight: '400', color: '#ffffff', opacity: '0.9' }
        },
        {
          id: 'welcome-cta',
          type: 'button',
          content: 'Comenzar encuesta',
          x: 60, y: 340, width: 220, height: 56,
          rotation: 0, zIndex: 10, locked: false, hidden: false,
          styles: { backgroundColor: '#ffffff', color: primaryColor, borderRadius: '18px', fontWeight: '800' }
        }
      ];
    }

    // Question Screens - Sync with brand
    survey.questions.forEach((q, i) => {
      const screenId = `question-${i}`;
      let qScreen = canvas.screens.find(s => s.id === screenId);
      if (!qScreen) {
        qScreen = {
          id: screenId,
          type: 'question',
          background: { type: 'solid', value: bg },
          elements: []
        };
        canvas.screens.push(qScreen);
      } else {
        qScreen.background = { type: 'solid', value: bg };
      }

      qScreen.elements = this.mergeCanvasElements(
        qScreen.elements,
        this.createQuestionCanvasElements(q, i, { primaryColor, secondaryColor, textColor, surfaceColor, bg, cardRadius, shadow })
      );

      // Question Card/Background
      if (!qScreen.elements.find(e => e.id === `q-${i}-card`)) {
        qScreen.elements.unshift({
          id: `q-${i}-card`,
          type: 'shape',
          content: '',
          x: 30, y: 40, width: 940, height: 520,
          rotation: 0, zIndex: 1, locked: true, hidden: false,
          styles: { backgroundColor: surfaceColor, borderRadius: '24px', boxShadow: '0 10px 40px rgba(0,0,0,0.05)' }
        });
      }

      if (qScreen.elements.length <= 1) { // Only card exists
        qScreen.elements.push(
          {
            id: `q-${i}-kicker`,
            type: 'text',
            content: `PREGUNTA ${i + 1}`,
            x: 70, y: 80, width: 200, height: 30,
            rotation: 0, zIndex: 10, locked: false, hidden: false,
            styles: { fontSize: '11px', fontWeight: '800', color: primaryColor, letterSpacing: '0.14em' }
          },
          {
            id: `q-${i}-title`,
            type: 'text',
            content: q.text || 'Pregunta sin título',
            x: 70, y: 110, width: 800, height: 80,
            rotation: 0, zIndex: 10, locked: false, hidden: false,
            styles: { fontSize: '32px', fontWeight: '800', color: textColor, lineHeight: '1.2' }
          },
          {
            id: `q-${i}-options`,
            type: 'text', // Using text for options representation for now
            content: this.getOptionsPlaceholder(q),
            x: 70, y: 220, width: 860, height: 280,
            rotation: 0, zIndex: 10, locked: true, hidden: false,
            styles: { fontSize: '16px', color: textColor, opacity: '0.6' }
          }
        );
      }
    });

    let endScreen = canvas.screens.find(s => s.id === 'end');
    if (!endScreen) {
      endScreen = {
        id: 'end',
        type: 'end',
        background: { type: 'gradient', value: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` },
        elements: []
      };
      canvas.screens.push(endScreen);
    } else {
      endScreen.background = { type: 'gradient', value: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` };
    }

    endScreen.elements = this.mergeCanvasElements(
      endScreen.elements,
      this.createEndCanvasElements(metadata, { primaryColor, secondaryColor, textColor, surfaceColor, cardRadius, shadow })
    );

    return metadata;
  }

  private getOptionsPlaceholder(q: Question): string {
    if (q.type === 'multiple-choice') {
      return q.options.map(o => `○ ${o.texto}`).join('\n\n');
    }
    if (q.type === 'rating' || q.type === 'scale') {
      return Array.from({ length: q.max || 5 }, (_, i) => `[ ${i + 1} ]`).join('  ');
    }
    if (q.type === 'text') {
      return 'Escribe tu respuesta aquí...';
    }
    return 'Opciones de respuesta';
  }

  private mergeCanvasElements(existing: CanvasElement[], defaults: CanvasElement[]): CanvasElement[] {
    const defaultsById = new Map(defaults.map((element) => [element.id, element]));
    const merged = existing
      .filter((element) => !defaultsById.has(element.id) || defaultsById.get(element.id)?.type === element.type)
      .map((element) => {
        const next = defaultsById.get(element.id);
        if (!next) {
          return element;
        }

        const generatedLayout = next.locked
          ? {
            x: next.x,
            y: next.y,
            width: next.width,
            height: next.height,
            rotation: next.rotation,
            zIndex: next.zIndex
          }
          : {};

        const keepFreeStyle = element.styles?.['__freeEdited'] === true;
        return {
          ...element,
          ...generatedLayout,
          content: next.content,
          questionId: next.questionId,
          locked: next.locked,
          hidden: next.hidden,
          styles: keepFreeStyle ? element.styles : next.styles
        };
      });

    for (const element of defaults) {
      if (!merged.some((item) => item.id === element.id)) {
        merged.push(element);
      }
    }

    return merged.sort((a, b) => a.zIndex - b.zIndex);
  }

  private createWelcomeCanvasElements(
    survey: Survey,
    metadata: SurveyMetadata,
    theme: {
      primaryColor: string;
      secondaryColor: string;
      textColor: string;
      surfaceColor: string;
      cardRadius: string;
      shadow: string;
    }
  ): CanvasElement[] {
    const questionCount = survey.questions.length || 1;

    return [
      {
        id: 'welcome-bg-panel',
        type: 'shape',
        content: '',
        x: 0, y: 0, width: 1000, height: 600,
        rotation: 0, zIndex: 0, locked: true, hidden: false,
        styles: {
          background: `radial-gradient(circle at 12% 14%, ${theme.secondaryColor}26 0%, transparent 32%), radial-gradient(circle at 88% 12%, ${theme.primaryColor}26 0%, transparent 30%), linear-gradient(135deg, ${metadata.brand?.backgroundColor || '#f5f3ff'}, #ffffff)`
        }
      },
      {
        id: 'welcome-card',
        type: 'shape',
        content: '',
        x: 70, y: 64, width: 860, height: 472,
        rotation: 0, zIndex: 2, locked: true, hidden: false,
        styles: {
          backgroundColor: '#ffffff',
          borderRadius: theme.cardRadius,
          boxShadow: '0 28px 90px rgba(15,23,42,0.16)',
          border: '1px solid rgba(15,23,42,0.08)'
        }
      },
      {
        id: 'welcome-kicker',
        type: 'text',
        content: 'ENCUESTA PUBLICA',
        x: 128, y: 124, width: 220, height: 30,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: { fontSize: '12px', fontWeight: '850', color: theme.primaryColor, letterSpacing: '0.12em', textTransform: 'uppercase' }
      },
      {
        id: 'welcome-title',
        type: 'text',
        content: survey.title || 'Bienvenido a nuestra Encuesta',
        x: 128, y: 160, width: 510, height: 112,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: {
          fontSize: '52px',
          fontWeight: '900',
          color: theme.textColor,
          textAlign: 'left',
          lineHeight: '1.04'
        }
      },
      {
        id: 'welcome-desc',
        type: 'text',
        content: survey.description || 'Tu opinión es muy valiosa para nosotros. Solo te tomará un minuto.',
        x: 128, y: 292, width: 510, height: 86,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: {
          fontSize: '18px',
          fontWeight: '400',
          lineHeight: '1.55',
          color: theme.textColor,
          textAlign: 'left',
          opacity: '0.7'
        }
      },
      {
        id: 'welcome-cta',
        type: 'button',
        content: metadata.ctaText || 'Comenzar encuesta',
        x: 128, y: 414, width: 248, height: 58,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: {
          backgroundColor: theme.primaryColor,
          color: '#ffffff',
          borderRadius: '16px',
          fontWeight: '800',
          fontSize: '16px',
          boxShadow: `0 12px 24px ${theme.primaryColor}33`
        }
      },
      {
        id: 'welcome-preview-panel',
        type: 'shape',
        content: '',
        x: 680, y: 138, width: 190, height: 324,
        rotation: 0, zIndex: 6, locked: false, hidden: false,
        styles: { background: `${theme.primaryColor}1f`, border: '1px solid rgba(255,255,255,0.38)', borderRadius: '28px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), 0 24px 60px rgba(15,23,42,0.12)' }
      },
      {
        id: 'welcome-meta',
        type: 'text',
        content: `${questionCount} pregunta${questionCount === 1 ? '' : 's'}  |  1 min`,
        x: 398, y: 432, width: 260, height: 22,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: { fontSize: '13px', fontWeight: '700', color: theme.textColor, textAlign: 'left', opacity: '0.5' }
      }
    ];
  }

  private createQuestionCanvasElements(
    question: Question,
    index: number,
    theme: {
      primaryColor: string;
      secondaryColor: string;
      textColor: string;
      surfaceColor: string;
      bg: string;
      cardRadius: string;
      shadow: string;
    }
  ): CanvasElement[] {
    const optionHeight = question.type === 'text' ? 150 : question.type === 'scale' ? 96 : 210;
    const optionY = question.type === 'text' ? 300 : 285;

    const baseElements: CanvasElement[] = [
      {
        id: `q-${index}-accent`,
        type: 'shape',
        content: '',
        x: 0, y: 0, width: 1000, height: 600,
        rotation: 0, zIndex: 0, locked: true, hidden: false,
        styles: {
          background: `radial-gradient(circle at 86% 12%, ${theme.secondaryColor}33 0%, transparent 30%), radial-gradient(circle at 8% 90%, ${theme.primaryColor}26 0%, transparent 28%)`
        }
      },
      {
        id: `q-${index}-card`,
        type: 'shape',
        content: '',
        x: 40, y: 44, width: 920, height: 512,
        rotation: 0, zIndex: 1, locked: true, hidden: false,
        styles: {
          backgroundColor: theme.surfaceColor,
          borderRadius: theme.cardRadius,
          boxShadow: theme.shadow,
          border: `1px solid ${theme.primaryColor}1f`
        }
      },
      {
        id: `q-${index}-pill`,
        type: 'shape',
        content: '',
        x: 76, y: 78, width: 148, height: 32,
        rotation: 0, zIndex: 2, locked: true, hidden: false,
        styles: { backgroundColor: `${theme.primaryColor}18`, borderRadius: '999px' }
      },
      {
        id: `q-${index}-kicker`,
        type: 'text',
        content: `PREGUNTA ${index + 1}`,
        x: 96, y: 85, width: 180, height: 22,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: { fontSize: '11px', fontWeight: '800', color: theme.primaryColor, letterSpacing: '0.12em' }
      },
      {
        id: `q-${index}-title`,
        type: 'text',
        content: question.text || this.defaultQuestionTitle(question.type),
        x: 76, y: 132, width: 760, height: 92,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: { fontSize: '34px', fontWeight: '850', color: theme.textColor, lineHeight: '1.18' }
      },
      {
        id: `q-${index}-helper`,
        type: 'text',
        content: this.getQuestionHelper(question.type),
        x: 76, y: 230, width: 660, height: 32,
        rotation: 0, zIndex: 10, locked: true, hidden: false,
        styles: { fontSize: '15px', fontWeight: '600', color: theme.textColor, opacity: '0.54' }
      },
      {
        id: `q-${index}-options-bg`,
        type: 'shape',
        content: '',
        x: 76, y: optionY, width: 820, height: optionHeight,
        rotation: 0, zIndex: 2, locked: true, hidden: false,
        styles: {
          backgroundColor: question.type === 'text' ? `${theme.bg}cc` : `${theme.primaryColor}0d`,
          border: question.type === 'text' ? `2px dashed ${theme.primaryColor}55` : `1px solid ${theme.primaryColor}1f`,
          borderRadius: question.type === 'text' ? '22px' : '18px'
        }
      },
      {
        id: `q-${index}-options`,
        type: 'text',
        content: this.getPrettyOptionsPlaceholder(question),
        x: 104, y: optionY + 26, width: 760, height: optionHeight - 44,
        rotation: 0, zIndex: 10, locked: true, hidden: false,
        styles: this.questionOptionsStyle(question, theme)
      }
    ];

    if (question.type === 'rating' || question.type === 'scale') {
      return [
        ...baseElements.map((element) => element.id === `q-${index}-options`
          ? { ...element, hidden: true, content: '' }
          : element),
        ...this.createScaleCanvasButtons(question, index, theme, optionY)
      ];
    }

    return baseElements;
  }

  private createScaleCanvasButtons(
    question: Question,
    index: number,
    theme: { primaryColor: string; secondaryColor: string; textColor: string },
    y: number
  ): CanvasElement[] {
    const min = question.min ?? 1;
    const max = question.max ?? 10;
    const values = Array.from({ length: Math.max(0, max - min + 1) }, (_, valueIndex) => min + valueIndex);
    const isTenPoint = values.length > 5;
    const buttonWidth = isTenPoint ? 68 : 88;
    const gap = isTenPoint ? 10 : 16;
    const startX = isTenPoint ? 104 : 126;
    const top = y + 28;

    return values.map((value, valueIndex) => ({
      id: `q-${index}-scale-btn-${value}`,
      type: 'button',
      content: String(value),
      x: startX + valueIndex * (buttonWidth + gap),
      y: top,
      width: buttonWidth,
      height: 58,
      rotation: 0,
      zIndex: 12,
      locked: true,
      hidden: false,
      styles: {
        background: '#ffffff',
        color: theme.primaryColor,
        border: `2px solid ${theme.primaryColor}33`,
        borderRadius: '16px',
        fontSize: '20px',
        fontWeight: '850',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
      }
    }));
  }

  private createEndCanvasElements(
    metadata: SurveyMetadata,
    theme: {
      primaryColor: string;
      secondaryColor: string;
      textColor: string;
      surfaceColor: string;
      cardRadius: string;
      shadow: string;
    }
  ): CanvasElement[] {
    return [
      {
        id: 'end-bg-panel',
        type: 'shape',
        content: '',
        x: 0, y: 0, width: 1000, height: 600,
        rotation: 0, zIndex: 0, locked: true, hidden: false,
        styles: {
          background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})`
        }
      },
      {
        id: 'end-card',
        type: 'shape',
        content: '',
        x: 200, y: 100, width: 600, height: 400,
        rotation: 0, zIndex: 2, locked: true, hidden: false,
        styles: {
          backgroundColor: '#ffffff',
          borderRadius: theme.cardRadius,
          boxShadow: '0 40px 100px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.2)'
        }
      },
      {
        id: 'end-icon-circle',
        type: 'shape',
        content: '',
        x: 460, y: 140, width: 80, height: 80,
        rotation: 0, zIndex: 10, locked: true, hidden: false,
        styles: {
          backgroundColor: `${theme.primaryColor}15`,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }
      },
      {
        id: 'end-icon-check',
        type: 'text',
        content: '✓',
        x: 460, y: 140, width: 80, height: 80,
        rotation: 0, zIndex: 11, locked: true, hidden: false,
        styles: {
          fontSize: '40px',
          color: theme.primaryColor,
          textAlign: 'center',
          lineHeight: '80px',
          fontWeight: '900'
        }
      },
      {
        id: 'end-title',
        type: 'text',
        content: metadata.thankYouTitle || '¡Muchas gracias!',
        x: 250, y: 240, width: 500, height: 60,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: {
          fontSize: '36px',
          fontWeight: '900',
          color: theme.textColor,
          textAlign: 'center'
        }
      },
      {
        id: 'end-desc',
        type: 'text',
        content: metadata.thankYouDescription || 'Tus respuestas han sido enviadas con éxito. Apreciamos mucho tu tiempo.',
        x: 250, y: 310, width: 500, height: 60,
        rotation: 0, zIndex: 10, locked: false, hidden: false,
        styles: {
          fontSize: '18px',
          fontWeight: '400',
          color: theme.textColor,
          textAlign: 'center',
          opacity: '0.6'
        }
      }
    ];
  }

  private getPrettyOptionsPlaceholder(question: Question): string {
    if (question.type === 'multiple-choice' || question.type === 'visual-choice') {
      const options = question.options.length
        ? question.options
        : [
          { id: 'default-option-1', texto: 'Opción 1' },
          { id: 'default-option-2', texto: 'Opción 2' }
        ];
      return options.map((option) => `( )  ${option.texto}`).join('\n');
    }

    if (question.type === 'rating') {
      return Array.from({ length: question.max || 10 }, (_, index) => `${index + 1}`).join('   ');
    }

    if (question.type === 'scale') {
      return Array.from({ length: question.max || 5 }, (_, index) => `${index + 1}`).join('        ');
    }

    return 'Escribe tu respuesta aqui...';
  }

  private questionOptionsStyle(
    question: Question,
    theme: { primaryColor: string; secondaryColor: string; textColor: string }
  ): Record<string, string> {
    if (question.type === 'rating' || question.type === 'scale') {
      return {
        fontSize: question.type === 'rating' ? '22px' : '28px',
        fontWeight: '850',
        color: theme.primaryColor,
        lineHeight: '1.9',
        textAlign: 'center',
        letterSpacing: '0'
      };
    }

    if (question.type === 'text') {
      return {
        fontSize: '18px',
        color: theme.textColor,
        opacity: '0.5',
        lineHeight: '1.6'
      };
    }

    return {
      fontSize: '18px',
      fontWeight: '700',
      color: theme.textColor,
      lineHeight: '2.35'
    };
  }

  private defaultQuestionTitle(type: QuestionType): string {
    if (type === 'multiple-choice' || type === 'visual-choice') return 'Elige una opción';
    if (type === 'rating') return '¿Cómo calificarías tu experiencia?';
    if (type === 'scale') return 'Selecciona el nivel que mejor te represente';
    return 'Cuéntanos tu respuesta';
  }

  private getQuestionHelper(type: QuestionType): string {
    if (type === 'multiple-choice' || type === 'visual-choice') return 'Selecciona una de las opciones disponibles.';
    if (type === 'rating') return 'Usa una puntuación del 1 al 10.';
    if (type === 'scale') return 'Marca un valor de 1 a 10.';
    return 'Respuesta abierta para capturar más contexto.';
  }

  private canvasShadow(preset?: SurveyBrand['shadowPreset']): string {
    if (preset === 'none') return 'none';
    if (preset === 'medium') return '0 18px 55px rgba(15, 23, 42, 0.12)';
    if (preset === 'strong') return '0 26px 80px rgba(15, 23, 42, 0.18)';
    if (preset === 'float') return '0 34px 90px rgba(15, 23, 42, 0.16)';
    return '0 14px 44px rgba(15, 23, 42, 0.09)';
  }

  private getPublishChecklist(survey: Survey): PublishChecklistItem[] {
    const hasTitle = survey.title.trim().length > 0;
    const hasQuestions = survey.questions.length > 0;
    const completeQuestions = survey.questions.every((question) => question.text.trim().length > 0);
    const completeOptions = survey.questions.every((question) => {
      if (!this.isChoiceType(question.type)) return true;
      return question.options.filter((option) => option.texto.trim().length > 0).length >= 2;
    });
    const emptyPages = this.questionPageSummaries().filter((page) => page.count === 0).length;
    const validLogic = survey.questions.every((question) => (question.logic ?? []).every((rule) => {
      const target = rule.goTo;
      if (!target || target === 'end') return true;
      if (target === question.id) return false; // salta a sí misma: bucle infinito para quien responde
      return survey.questions.some((item) => item.id === target);
    }));
    const duplicateOptions = survey.questions.some((question) => {
      if (!this.isChoiceType(question.type)) return false;
      const labels = question.options
        .map((option) => option.texto.trim().toLowerCase())
        .filter((label) => label.length > 0);
      return new Set(labels).size !== labels.length;
    });
    // Las imágenes se suben como data URI (base64); una referencia "rota" real
    // es una cadena no vacía que ya no es ni un data URI válido ni una URL http(s)
    // (por ejemplo, truncada al guardarse por un límite de tamaño del backend).
    const isValidImageRef = (value?: string): boolean =>
      !value || /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\/\S+$/i.test(value);
    const hasBrokenImages = !isValidImageRef(survey.metadata?.brand?.logoUrl)
      || survey.questions.some((question) => !isValidImageRef(question.imageUrl));

    return [
      { label: 'Título', ok: hasTitle, detail: hasTitle ? 'Listo.' : 'Agrega un título antes de publicar.' },
      { label: 'Preguntas', ok: hasQuestions, detail: hasQuestions ? `${survey.questions.length} pregunta(s).` : 'Agrega al menos una pregunta antes de publicar.' },
      { label: 'Páginas', ok: emptyPages === 0, detail: emptyPages === 0 ? 'Todas las páginas tienen contenido.' : `Hay ${emptyPages} página(s) sin preguntas.` },
      { label: 'Enunciados', ok: completeQuestions, detail: completeQuestions ? 'Todas las preguntas tienen texto.' : 'Hay preguntas sin enunciado.' },
      { label: 'Opciones', ok: completeOptions, detail: completeOptions ? 'Las preguntas de selección tienen opciones válidas.' : 'Cada pregunta de selección necesita al menos dos opciones válidas.' },
      { label: 'Opciones duplicadas', ok: !duplicateOptions, detail: !duplicateOptions ? 'No hay opciones repetidas.' : 'Hay una pregunta con opciones de respuesta repetidas.' },
      { label: 'Lógica condicional', ok: validLogic, detail: validLogic ? 'Los saltos apuntan a pantallas válidas.' : 'Hay una regla condicional con destino inválido o que se repite a sí misma.' },
      { label: 'Recursos visuales', ok: !hasBrokenImages, detail: hasBrokenImages ? 'Revisa imágenes o logos faltantes.' : 'Sin recursos rotos detectados.' }
    ];
  }

  private cleanValidation(validation?: QuestionValidation): QuestionValidation | undefined {
    if (!validation) return undefined;
    const next: QuestionValidation = {};
    for (const [key, value] of Object.entries(validation) as Array<[keyof QuestionValidation, any]>) {
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'number' && Number.isNaN(value)) continue;
      next[key] = value as never;
    }
    return Object.keys(next).length ? next : undefined;
  }

  private pulseSavedState(): void {
    this.hasUnsavedChanges.set(false);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private createActiveTransform(
    kind: AssetKind | string,
    mode: TransformMode,
    event: MouseEvent,
    config: SurveyElementConfig,
    index?: number
  ): ActiveTransform {
    return {
      kind,
      index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initialX: config.x,
      initialY: config.y,
      initialWidth: config.width,
      initialHeight: config.height,
      originX: config.originX ?? config.x,
      originY: config.originY ?? config.y,
      initialFontSize: config.fontSize ?? this.elementFontSize(kind, index)
    };
  }

  private initializeMeasuredLayout(kind: AssetKind, frames: LayoutFrameMap, index?: number): void {
    if (!Object.keys(frames).length) return;

    this.survey.update((survey) => {
      if (!survey) return survey;

      if (kind.startsWith('welcome-') || !!frames['welcome-title'] || !!frames['welcome-kicker'] || !!frames['welcome-preview']) {
        const metadata = this.ensureMetadata(survey.metadata);
        const brand = this.ensureBrand(metadata.brand);
        this.applyMeasuredFrameToBrandLogo(brand, frames['logo']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomeKickerConfig', frames['welcome-kicker']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomeTitleConfig', frames['welcome-title']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomeDescConfig', frames['welcome-desc']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomeMetaConfig', frames['welcome-meta']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomeCtaConfig', frames['welcome-cta']);
        this.applyMeasuredFrameToMetadata(metadata, 'welcomePreviewConfig', frames['welcome-preview']);
        metadata.brand = brand;
        return { ...survey, metadata };
      }

      if (kind.startsWith('question-') && index !== undefined) {
        const questions = [...survey.questions];
        const question = { ...questions[index] };
        if (!question) return survey;
        this.applyMeasuredFrameToQuestion(question, 'metaConfig', frames['question-meta']);
        this.applyMeasuredFrameToQuestion(question, 'titleConfig', frames['question-title']);
        this.applyMeasuredFrameToQuestion(question, 'helpConfig', frames['question-help']);
        this.applyMeasuredFrameToQuestion(question, 'imageConfig', frames['question-image']);
        this.applyMeasuredFrameToQuestion(question, 'answerConfig', frames['question-answer']);
        questions[index] = question;
        return { ...survey, questions };
      }

      if (kind.startsWith('end-') || !!frames['end-title'] || !!frames['end-rule']) {
        const metadata = this.ensureMetadata(survey.metadata);
        const brand = this.ensureBrand(metadata.brand);
        this.applyMeasuredFrameToBrandLogo(brand, frames['logo']);
        this.applyMeasuredFrameToMetadata(metadata, 'endRuleConfig', frames['end-rule']);
        this.applyMeasuredFrameToMetadata(metadata, 'endIconConfig', frames['end-icon']);
        this.applyMeasuredFrameToMetadata(metadata, 'endTitleConfig', frames['end-title']);
        this.applyMeasuredFrameToMetadata(metadata, 'endDescConfig', frames['end-desc']);
        this.applyMeasuredFrameToMetadata(metadata, 'endSummaryConfig', frames['end-summary']);
        this.applyMeasuredFrameToMetadata(metadata, 'endBrandConfig', frames['end-brand']);
        metadata.brand = brand;
        return { ...survey, metadata };
      }

      return survey;
    });
  }

  private applyMeasuredFrameToMetadata(
    metadata: SurveyMetadata,
    key: keyof Pick<SurveyMetadata,
      'welcomeKickerConfig' | 'welcomeTitleConfig' | 'welcomeDescConfig' | 'welcomeMetaConfig' | 'welcomeCtaConfig' | 'welcomePreviewConfig'
      | 'endRuleConfig' | 'endIconConfig' | 'endTitleConfig' | 'endDescConfig' | 'endSummaryConfig' | 'endBrandConfig'>,
    frame: SurveyElementConfig | undefined
  ): void {
    if (!frame || metadata[key]?.positioned) return;
    metadata[key] = this.frameToPositionedConfig(frame);
  }

  private applyMeasuredFrameToQuestion(
    question: Question,
    key: keyof Pick<Question, 'metaConfig' | 'titleConfig' | 'helpConfig' | 'imageConfig' | 'answerConfig'>,
    frame: SurveyElementConfig | undefined
  ): void {
    const existing = question[key] as SurveyElementConfig | undefined;
    if (!frame || existing?.positioned) return;
    question[key] = this.frameToPositionedConfig(frame) as never;
  }

  private applyMeasuredFrameToBrandLogo(brand: SurveyBrand, frame: SurveyElementConfig | undefined): void {
    if (!frame || brand.logoConfig?.positioned) return;
    brand.logoConfig = this.frameToPositionedConfig(frame);
  }

  private frameToPositionedConfig(frame: SurveyElementConfig): SurveyElementConfig {
    return {
      ...frame,
      originX: frame.x,
      originY: frame.y,
      positioned: true
    };
  }

  private resizeWithAspectRatio(
    transform: ActiveTransform,
    dx: number,
    dy: number,
    minWidth: number,
    maxWidth: number,
    minHeight: number,
    maxHeight: number
  ): { width: number; height: number } {
    const ratio = transform.initialWidth / Math.max(1, transform.initialHeight);
    const widthFromDrag = transform.initialWidth + dx;
    const heightFromDrag = transform.initialHeight + dy;
    const widthFromHeight = heightFromDrag * ratio;
    const targetWidth = Math.abs(dy) > Math.abs(dx) ? widthFromHeight : widthFromDrag;
    let width = this.clamp(targetWidth, minWidth, maxWidth);
    let height = this.clamp(width / ratio, minHeight, maxHeight);
    width = this.clamp(height * ratio, minWidth, maxWidth);
    height = this.clamp(width / ratio, minHeight, maxHeight);
    return { width: Math.round(width), height: Math.round(height) };
  }

  private createLocalId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }
}

