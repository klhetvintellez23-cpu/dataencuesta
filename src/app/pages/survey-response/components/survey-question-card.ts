import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnswerValue, Question, SurveyElementConfig } from '../../../services/survey.service';
import { SurveyOptionInputComponent } from './survey-option-input';
import { SurveyScaleInputComponent } from './survey-scale-input';

type PublicQuestionType =
  | 'text'
  | 'long-text'
  | 'multiple-choice'
  | 'multi-select'
  | 'visual-choice'
  | 'scale'
  | 'rating'
  | 'nps'
  | 'date'
  | 'time'
  | 'email'
  | 'phone';
type QuestionDesignKind = 'question-meta' | 'question-title' | 'question-help' | 'question-image' | 'question-answer';
type TransformMode = 'move' | 'resize' | 'stretch';

@Component({
  selector: 'app-survey-question-card',
  standalone: true,
  imports: [CommonModule, FormsModule, SurveyScaleInputComponent, SurveyOptionInputComponent],
  template: `
    <section class="question-shell">
      <article class="question-card positioning-root" [class.positioned-layout]="usesPositionedLayout()" [style.min-height.px]="positionedHeight()">
        <div class="design-box" data-design-kind="question-meta" [class.design-active]="designMode" [class.design-selected]="isSelected('question-meta')" [ngStyle]="boxStyle('question-meta')" (mousedown)="selectBox($event, 'question-meta')">
          <button class="move-handle" type="button" aria-label="Mover datos de pregunta" (mousedown)="beginTransform($event, 'question-meta', 'move')"></button>
          <div class="question-meta">
            <span class="question-pill">Pregunta {{ index + 1 }} de {{ total }}</span>
            @if (question.required) {
              <span class="required-pill">Requerida</span>
            }
          </div>
          <button class="resize-handle" type="button" aria-label="Redimensionar datos de pregunta" (mousedown)="beginTransform($event, 'question-meta', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar datos de pregunta" (mousedown)="beginTransform($event, 'question-meta', 'stretch')"></button>
        </div>

        <div class="design-box" data-design-kind="question-title" [class.design-active]="designMode" [class.design-selected]="isSelected('question-title')" [ngStyle]="boxStyle('question-title')" (mousedown)="selectBox($event, 'question-title')">
          <button class="move-handle" type="button" aria-label="Mover titulo de pregunta" (mousedown)="beginTransform($event, 'question-title', 'move')"></button>
          <h2
            [style.font-size]="dynamicFontSize('question-title', 24, 6)"
            [attr.contenteditable]="designMode ? 'true' : null"
            [class.design-editable]="designMode"
            (keydown)="designMode && preventEditableEnter($event)"
            (blur)="designMode && emitQuestionText($event)">
            {{ question.text || 'Pregunta sin titulo' }}
          </h2>
          <button class="resize-handle" type="button" aria-label="Redimensionar titulo de pregunta" (mousedown)="beginTransform($event, 'question-title', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar titulo de pregunta" (mousedown)="beginTransform($event, 'question-title', 'stretch')"></button>
        </div>

        <div class="design-box" data-design-kind="question-help" [class.design-active]="designMode" [class.design-selected]="isSelected('question-help')" [ngStyle]="boxStyle('question-help')" (mousedown)="selectBox($event, 'question-help')">
          <button class="move-handle" type="button" aria-label="Mover ayuda de pregunta" (mousedown)="beginTransform($event, 'question-help', 'move')"></button>
          <p class="question-help" [style.font-size]="dynamicFontSize('question-help', 14, 3)">{{ helperText }}</p>
          <button class="resize-handle" type="button" aria-label="Redimensionar ayuda de pregunta" (mousedown)="beginTransform($event, 'question-help', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar ayuda de pregunta" (mousedown)="beginTransform($event, 'question-help', 'stretch')"></button>
        </div>

        @if (question.imageUrl) {
          <div class="design-box" data-design-kind="question-image" [class.design-active]="designMode" [class.design-selected]="isSelected('question-image')" [ngStyle]="boxStyle('question-image')" (mousedown)="selectBox($event, 'question-image')">
            <button class="move-handle" type="button" aria-label="Mover imagen de pregunta" (mousedown)="beginTransform($event, 'question-image', 'move')"></button>
            <img class="question-image" [src]="question.imageUrl" alt="Imagen de la pregunta" />
            <button class="resize-handle" type="button" aria-label="Redimensionar imagen de pregunta" (mousedown)="beginTransform($event, 'question-image', 'resize')"></button>
          </div>
        }

        <div class="design-box" data-design-kind="question-answer" [class.design-active]="designMode" [class.design-selected]="isSelected('question-answer')" [ngStyle]="boxStyle('question-answer')" (mousedown)="selectBox($event, 'question-answer')">
          <button class="move-handle" type="button" aria-label="Mover respuestas" (mousedown)="beginTransform($event, 'question-answer', 'move')"></button>
          <div class="answer-area" [style.font-size]="dynamicFontSize('question-answer', 16, 4)">
            @switch (questionType) {
              @case ('multiple-choice') {
                <app-survey-option-input
                  [options]="safeOptions"
                  [selected]="stringAnswer"
                  (valueChange)="answerChange.emit($event)">
                </app-survey-option-input>
              }
              @case ('visual-choice') {
                <div class="visual-choice-grid">
                  @for (option of safeOptions; track option.id) {
                    <button
                      type="button"
                      class="visual-card"
                      [class.selected]="stringAnswer === option.texto"
                      [disabled]="designMode"
                      (click)="answerChange.emit(option.texto)">
                      <span class="visual-card-text">{{ option.texto }}</span>
                    </button>
                  }
                </div>
              }
              @case ('multi-select') {
                <app-survey-option-input
                  [options]="safeOptions"
                  [selected]="arrayAnswer"
                  [multiple]="true"
                  (valueChange)="answerChange.emit($event)">
                </app-survey-option-input>
              }
              @case ('rating') {
                <app-survey-scale-input
                  [values]="range(1, 5)"
                  [selected]="numberAnswer"
                  variant="stars"
                  minLabel="Baja"
                  maxLabel="Excelente"
                  (valueChange)="answerChange.emit($event)">
                </app-survey-scale-input>
              }
              @case ('scale') {
                <app-survey-scale-input
                  [values]="range(question.min || 1, question.max || 10)"
                  [selected]="numberAnswer"
                  minLabel="Nada probable"
                  maxLabel="Muy probable"
                  (valueChange)="answerChange.emit($event)">
                </app-survey-scale-input>
              }
              @case ('nps') {
                <app-survey-scale-input
                  [values]="range(0, 10)"
                  [selected]="numberAnswer"
                  minLabel="No recomendaria"
                  maxLabel="Lo recomendaria"
                  (valueChange)="answerChange.emit($event)">
                </app-survey-scale-input>
              }
              @case ('long-text') {
                <textarea
                  class="survey-field textarea"
                  [disabled]="designMode"
                  rows="6"
                  [attr.minlength]="question.validation?.minLength || null"
                  [attr.maxlength]="question.validation?.maxLength || null"
                  [attr.aria-invalid]="error ? 'true' : 'false'"
                  [ngModel]="stringAnswer"
                  (ngModelChange)="answerChange.emit($event)"
                  placeholder="Escribe tu respuesta con detalle...">
                </textarea>
              }
              @case ('date') {
                <input class="survey-field" type="date" [disabled]="designMode" [ngModel]="stringAnswer" (ngModelChange)="answerChange.emit($event)" />
              }
              @case ('time') {
                <input class="survey-field" type="time" [disabled]="designMode" [ngModel]="stringAnswer" (ngModelChange)="answerChange.emit($event)" />
              }
              @case ('email') {
                <input class="survey-field" type="email" [disabled]="designMode" [ngModel]="stringAnswer" (ngModelChange)="answerChange.emit($event)" placeholder="nombre@empresa.com" />
              }
              @case ('phone') {
                <input class="survey-field" type="tel" [disabled]="designMode" [ngModel]="stringAnswer" (ngModelChange)="answerChange.emit($event)" placeholder="+1 000 000 0000" />
              }
              @default {
                <input
                  class="survey-field"
                  type="text"
                  [disabled]="designMode"
                  [attr.minlength]="question.validation?.minLength || null"
                  [attr.maxlength]="question.validation?.maxLength || null"
                  [attr.aria-invalid]="error ? 'true' : 'false'"
                  [ngModel]="stringAnswer"
                  (ngModelChange)="answerChange.emit($event)"
                  placeholder="Escribe tu respuesta..." />
              }
            }
          </div>
          <button class="resize-handle" type="button" aria-label="Redimensionar respuestas" (mousedown)="beginTransform($event, 'question-answer', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar respuestas" (mousedown)="beginTransform($event, 'question-answer', 'stretch')"></button>
        </div>

        @if (error) {
          <div class="question-error" role="alert">{{ error }}</div>
        }
      </article>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      container-type: inline-size;
    }

    .question-shell {
      width: 100%;
      min-height: calc(100svh - 112px);
      display: grid;
      place-items: center;
      padding: clamp(22px, 5vw, 56px) clamp(18px, 4vw, 32px) 24px;
      position: relative;
      z-index: 1;
    }

    .question-card {
      position: relative;
      width: min(820px, 100%);
      padding: clamp(28px, 5vw, 56px);
      border-radius: var(--response-card-radius, 28px);
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 28px 90px rgba(15, 23, 42, 0.14);
      color: var(--response-heading, #111827);
      backdrop-filter: blur(18px);
      animation: card-in 260ms ease both;
    }

    .design-box {
      position: relative;
      box-sizing: border-box;
    }

    .positioned-layout > .design-box {
      position: absolute;
      min-width: 44px;
      min-height: 28px;
    }

    .design-active {
      border: 1px solid transparent;
      border-radius: 12px;
      cursor: move;
    }

    .design-active:hover,
    .design-selected {
      border-color: color-mix(in srgb, var(--response-primary, #440789) 62%, white);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--response-primary, #440789) 12%, transparent);
    }

    .move-handle,
    .resize-handle,
    .stretch-handle {
      display: none;
      position: absolute;
      z-index: 20;
      border: 0;
      background: var(--response-primary, #440789);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
    }

    .design-selected .move-handle,
    .design-selected .resize-handle,
    .design-selected .stretch-handle {
      display: block;
    }

    .move-handle {
      left: 50%;
      top: -13px;
      width: 28px;
      height: 18px;
      border-radius: 999px;
      transform: translateX(-50%);
      cursor: move;
    }

    .move-handle::before {
      content: "";
      width: 12px;
      height: 2px;
      border-radius: 999px;
      background: #ffffff;
      display: block;
      margin: 8px auto 0;
    }

    .resize-handle {
      right: -7px;
      bottom: -7px;
      width: 14px;
      height: 14px;
      border-radius: 5px;
      cursor: nwse-resize;
    }

    .stretch-handle {
      right: -5px;
      top: 50%;
      width: 8px;
      height: 24px;
      border-radius: 999px;
      transform: translateY(-50%);
      cursor: ew-resize;
    }

    .question-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 24px;
    }

    .question-pill,
    .required-pill {
      width: fit-content;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .question-pill {
      color: var(--response-primary, #440789);
      background: color-mix(in srgb, var(--response-primary, #440789) 12%, white);
    }

    .required-pill {
      color: #be123c;
      background: #fff1f2;
    }

    h2 {
      margin: 14px 0 0;
      font-family: var(--response-title-font, Inter, sans-serif);
      font-size: clamp(28px, 4.5vw, 46px);
      line-height: 1.14;
      letter-spacing: 0;
      color: var(--response-heading, #111827);
      overflow-wrap: anywhere;
    }

    .question-help {
      margin: 24px 0 0;
      color: var(--response-muted, #64748b);
      font-size: 16px;
      line-height: 1.6;
    }

    .question-image {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      margin: 0;
      border-radius: 18px;
    }

    .answer-area {
      margin-top: 30px;
    }

    .survey-field {
      width: 100%;
      border: 1px solid var(--response-border, #e2e8f0);
      border-radius: var(--response-button-radius, 16px);
      padding: 18px 20px;
      background: var(--response-answer-bg, #ffffff);
      color: var(--response-heading, #111827);
      font: inherit;
      font-size: 17px;
      outline: none;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .survey-field:focus {
      border-color: var(--response-primary, #440789);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--response-primary, #440789) 14%, transparent);
    }

    .positioned-layout .question-meta,
    .positioned-layout .question-help,
    .positioned-layout .question-image,
    .positioned-layout .answer-area {
      margin: 0;
    }

    .survey-field:disabled {
      opacity: 0.72;
      cursor: default;
    }

    .design-editable {
      outline: none;
      border-radius: 10px;
      cursor: text;
      transition: background 160ms ease;
    }

    .design-editable:hover,
    .design-editable:focus {
      background: color-mix(in srgb, var(--response-primary, #440789) 7%, transparent);
    }

    .textarea {
      resize: vertical;
      min-height: 160px;
      line-height: 1.55;
    }

    .question-error {
      margin-top: 18px;
      padding: 12px 14px;
      border-radius: 14px;
      color: #991b1b;
      background: #fef2f2;
      border: 1px solid #fecaca;
      font-size: 14px;
      font-weight: 750;
    }

    .visual-choice-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .visual-card {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
      padding: 24px;
      border: 2px solid var(--response-border, #e2e8f0);
      border-radius: var(--response-button-radius, 16px);
      background: var(--response-answer-bg, #ffffff);
      color: var(--response-heading, #111827);
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    }
    .visual-card:hover:not(:disabled) {
      transform: translateY(-4px);
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
      border-color: color-mix(in srgb, var(--response-primary, #440789) 40%, #e2e8f0);
    }
    .visual-card.selected {
      border-color: var(--response-primary, #440789);
      background: color-mix(in srgb, var(--response-primary, #440789) 8%, #ffffff);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--response-primary, #440789) 15%, transparent);
    }
    .visual-card:disabled {
      cursor: default;
      opacity: 0.7;
    }

    @keyframes card-in {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @container (max-width: 640px) {
      .question-shell {
        min-height: auto;
        padding-top: 18px;
      }

      .question-card {
        padding: 24px;
      }

      .question-card.positioned-layout {
        min-height: auto !important;
        display: flex;
        flex-direction: column;
      }

      .positioned-layout > .design-box {
        position: relative !important;
        left: auto !important;
        top: auto !important;
        width: 100% !important;
        height: auto !important;
        margin: 0 0 16px !important;
        transform: none !important;
      }
    }

    :host-context(.multi-question-page) .question-shell {
      min-height: auto;
      padding: 0;
      display: block;
    }

    :host-context(.multi-question-page) .question-card {
      width: 100%;
      padding: clamp(22px, 4vw, 34px);
    }

    :host-context(.multi-question-page) h2 {
      font-size: clamp(24px, 3.5vw, 34px);
    }

    :host-context(.simulator-question-page) .question-shell,
    :host-context(.response-question-page) .question-shell {
      min-height: auto;
      padding: 0;
      display: block;
    }

    :host-context(.simulator-question-page) .question-card,
    :host-context(.response-question-page) .question-card {
      width: 100%;
    }
  `]
})
export class SurveyQuestionCardComponent {
  @Input({ required: true }) question!: Question;
  @Input() index = 0;
  @Input() total = 0;
  @Input() answer: AnswerValue | string[] | undefined;
  @Input() error = '';
  @Input() designMode = false;
  @Input() staticLayout = false;
  @Output() answerChange = new EventEmitter<AnswerValue | string[]>();
  @Output() questionTextChange = new EventEmitter<string>();
  @Output() transformStart = new EventEmitter<{ event: MouseEvent; kind: QuestionDesignKind; mode: TransformMode; index: number; frame?: SurveyElementConfig; frames?: Record<string, SurveyElementConfig> }>();
  selectedKind: QuestionDesignKind | null = null;

  private readonly defaults: Record<QuestionDesignKind, SurveyElementConfig> = {
    'question-meta': { x: 0, y: 0, width: 360, height: 42 },
    'question-title': { x: 0, y: 72, width: 708, height: 112 },
    'question-help': { x: 0, y: 202, width: 620, height: 54 },
    'question-image': { x: 0, y: 276, width: 260, height: 180, zIndex: 9 },
    'question-answer': { x: 0, y: 486, width: 708, height: 150 }
  };

  emitQuestionText(event: Event): void {
    this.questionTextChange.emit((event.target as HTMLElement).innerText.trim());
  }

  preventEditableEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    (event.target as HTMLElement).blur();
  }

  beginTransform(event: MouseEvent, kind: QuestionDesignKind, mode: TransformMode): void {
    if (!this.designMode) return;
    this.selectedKind = kind;
    this.transformStart.emit({ event, kind, mode, index: this.index, frame: this.measureFrame(event), frames: this.measureSiblingFrames(event) });
  }

  selectBox(event: MouseEvent, kind: QuestionDesignKind): void {
    if (!this.designMode) return;
    event.stopPropagation();
    this.selectedKind = kind;
  }

  isSelected(kind: QuestionDesignKind): boolean {
    return this.designMode && this.selectedKind === kind;
  }

  fontSize(kind: QuestionDesignKind): number | null {
    return this.configFor(kind).fontSize ?? null;
  }

  dynamicFontSize(kind: QuestionDesignKind, minPx: number, cqi: number): string | null {
    const size = this.fontSize(kind);
    if (!size) return null;
    return `clamp(${minPx}px, ${cqi}cqi, ${size}px)`;
  }

  boxStyle(kind: QuestionDesignKind): Record<string, string> {
    const config = this.configFor(kind);
    if (!this.usesPositionedLayout()) return {};
    return {
      position: 'absolute',
      left: `${config.x}px`,
      top: `${config.y}px`,
      width: `${config.width}px`,
      height: `${config.height}px`,
      zIndex: `${config.zIndex ?? 10}`
    };
  }

  usesPositionedLayout(): boolean {
    if (this.staticLayout) return false;
    return this.hasStoredConfig('question-meta')
      || this.hasStoredConfig('question-title')
      || this.hasStoredConfig('question-help')
      || this.hasStoredConfig('question-image')
      || this.hasStoredConfig('question-answer');
  }

  positionedHeight(): number | null {
    if (!this.usesPositionedLayout()) return null;
    return this.maxElementBottom([
      this.configFor('question-meta'),
      this.configFor('question-title'),
      this.configFor('question-help'),
      this.question.imageUrl ? this.configFor('question-image') : undefined,
      this.configFor('question-answer')
    ], 28);
  }

  private configFor(kind: QuestionDesignKind): SurveyElementConfig {
    const stored = kind === 'question-meta' ? this.question.metaConfig
      : kind === 'question-title' ? this.question.titleConfig
      : kind === 'question-help' ? this.question.helpConfig
      : kind === 'question-image' ? this.question.imageConfig
      : this.question.answerConfig;
    return { ...this.defaults[kind], ...(stored ?? {}) };
  }

  private hasStoredConfig(kind: QuestionDesignKind): boolean {
    return kind === 'question-meta' ? this.question.metaConfig?.positioned === true
      : kind === 'question-title' ? this.question.titleConfig?.positioned === true
      : kind === 'question-help' ? this.question.helpConfig?.positioned === true
      : kind === 'question-image' ? this.question.imageConfig?.positioned === true
      : this.question.answerConfig?.positioned === true;
  }

  private maxElementBottom(configs: Array<SurveyElementConfig | undefined>, padding: number): number {
    const bottom = configs.reduce((max, config) => {
      if (!config) return max;
      return Math.max(max, config.y + config.height);
    }, 0);
    return Math.ceil(bottom + padding);
  }

  private measureFrame(event: MouseEvent): SurveyElementConfig | undefined {
    const box = (event.currentTarget as HTMLElement).closest('.design-box') as HTMLElement | null;
    const root = box?.parentElement as HTMLElement | null;
    if (!box || !root) return undefined;
    const boxRect = box.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      x: Math.round(boxRect.left - rootRect.left),
      y: Math.round(boxRect.top - rootRect.top),
      width: Math.round(boxRect.width),
      height: Math.round(boxRect.height)
    };
  }

  private measureSiblingFrames(event: MouseEvent): Record<string, SurveyElementConfig> {
    const box = (event.currentTarget as HTMLElement).closest('.design-box') as HTMLElement | null;
    const root = box?.parentElement as HTMLElement | null;
    if (!root) return {};

    const rootRect = root.getBoundingClientRect();
    const frames: Record<string, SurveyElementConfig> = {};
    root.querySelectorAll<HTMLElement>(':scope > .design-box').forEach((item) => {
      const kind = item.dataset['designKind'];
      if (!kind) return;
      const rect = item.getBoundingClientRect();
      frames[kind] = {
        x: Math.round(rect.left - rootRect.left),
        y: Math.round(rect.top - rootRect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });
    return frames;
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return !!element?.closest('[contenteditable="true"], input, textarea, select, button, .move-handle, .resize-handle, .stretch-handle');
  }

  get questionType(): PublicQuestionType {
    const raw = String(this.question?.type || 'text');
    if (raw === 'telefono') return 'phone';
    if (raw === 'seleccion-multiple') return 'multi-select';
    return raw as PublicQuestionType;
  }

  get safeOptions() {
    return this.question.options?.length
      ? this.question.options
      : [
        { id: 'option-1', texto: 'Opcion 1' },
        { id: 'option-2', texto: 'Opcion 2' }
      ];
  }

  get stringAnswer(): string {
    return typeof this.answer === 'string' || typeof this.answer === 'number' ? String(this.answer) : '';
  }

  get numberAnswer(): number | undefined {
    return typeof this.answer === 'number' ? this.answer : undefined;
  }

  get arrayAnswer(): string[] {
    return Array.isArray(this.answer) ? this.answer : [];
  }

  get helperText(): string {
    if (this.question.description?.trim()) return this.question.description.trim();
    if (this.questionType === 'multiple-choice') return 'Selecciona una opcion para continuar.';
    if (this.questionType === 'visual-choice') return 'Toca o haz clic en una de las tarjetas para seleccionar.';
    if (this.questionType === 'multi-select') return 'Puedes seleccionar una o varias opciones.';
    if (this.questionType === 'rating') return 'Elige una calificacion de 1 a 5 estrellas.';
    if (this.questionType === 'scale') return 'Selecciona el numero que mejor represente tu respuesta.';
    if (this.questionType === 'nps') return 'Responde de 0 a 10 segun tu probabilidad de recomendar.';
    if (this.questionType === 'email') return 'Ingresa un correo valido.';
    if (this.questionType === 'phone') return 'Ingresa un numero de contacto.';
    if (this.questionType === 'date') return 'Selecciona una fecha.';
    if (this.questionType === 'time') return 'Selecciona una hora.';
    if (this.questionType === 'long-text') return 'Escribe una respuesta detallada.';
    return 'Escribe tu respuesta.';
  }

  range(min: number, max: number): number[] {
    const start = Number.isFinite(min) ? min : 1;
    const end = Number.isFinite(max) ? max : 10;
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  }
}
