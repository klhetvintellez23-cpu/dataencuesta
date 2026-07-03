import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Survey, SurveyBrand, SurveyElementConfig } from '../../../services/survey.service';

type EndDesignKind = 'end-rule' | 'logo' | 'end-icon' | 'end-title' | 'end-desc' | 'end-summary' | 'end-brand';
type TransformMode = 'move' | 'resize' | 'stretch';

@Component({
  selector: 'app-survey-thank-you-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      class="thanks-shell"
      [class.layout-centered]="endLayout() === 'centered'"
      [class.layout-receipt]="endLayout() === 'receipt'"
      [class.layout-split]="endLayout() === 'split'"
      [class.layout-celebration]="endLayout() === 'celebration'"
      [class.layout-spotlight]="endLayout() === 'spotlight'"
      [class.layout-certificate]="endLayout() === 'certificate'"
      [class.layout-timeline]="endLayout() === 'timeline'"
      [class.layout-compact]="endLayout() === 'compact'">
      <div class="thanks-card positioning-root" [class.positioned-layout]="usesPositionedLayout()" [style.min-height.px]="positionedHeight()">
        <div class="design-box" data-design-kind="end-rule" [class.design-active]="designMode" [class.design-selected]="isSelected('end-rule')" [ngStyle]="boxStyle('end-rule')" (mousedown)="selectBox($event, 'end-rule')">
          <button class="move-handle" type="button" aria-label="Mover linea" (mousedown)="beginTransform($event, 'end-rule', 'move')"></button>
          <div class="thanks-rule"></div>
          <button class="resize-handle" type="button" aria-label="Redimensionar linea" (mousedown)="beginTransform($event, 'end-rule', 'resize')"></button>
        </div>

        @if (brand.logoUrl) {
          <div class="design-box" data-design-kind="logo" [class.design-active]="designMode" [class.design-selected]="isSelected('logo')" [ngStyle]="boxStyle('logo')" (mousedown)="selectBox($event, 'logo')">
            <button class="move-handle" type="button" aria-label="Mover logo" (mousedown)="beginTransform($event, 'logo', 'move')"></button>
            <img class="thanks-logo" [src]="brand.logoUrl" alt="Logo de la encuesta" />
            <button class="resize-handle" type="button" aria-label="Redimensionar logo" (mousedown)="beginTransform($event, 'logo', 'resize')"></button>
          </div>
        }

        <div class="design-box" data-design-kind="end-icon" [class.design-active]="designMode" [class.design-selected]="isSelected('end-icon')" [ngStyle]="boxStyle('end-icon')" (mousedown)="selectBox($event, 'end-icon')">
          <button class="move-handle" type="button" aria-label="Mover icono" (mousedown)="beginTransform($event, 'end-icon', 'move')"></button>
          <div class="thanks-icon">✓</div>
          <button class="resize-handle" type="button" aria-label="Redimensionar icono" (mousedown)="beginTransform($event, 'end-icon', 'resize')"></button>
        </div>

        <div class="design-box" data-design-kind="end-title" [class.design-active]="designMode" [class.design-selected]="isSelected('end-title')" [ngStyle]="boxStyle('end-title')" (mousedown)="selectBox($event, 'end-title')">
          <button class="move-handle" type="button" aria-label="Mover titulo final" (mousedown)="beginTransform($event, 'end-title', 'move')"></button>
          <h1
            [style.font-size]="dynamicFontSize('end-title', 32, 8)"
            [attr.contenteditable]="designMode ? 'true' : null"
            [class.design-editable]="designMode"
            (keydown)="designMode && preventEditableEnter($event)"
            (blur)="designMode && emitEditable($event, titleChange)">
            {{ survey.metadata?.endTitle || survey.metadata?.thankYouTitle || 'Gracias por participar' }}
          </h1>
          <button class="resize-handle" type="button" aria-label="Redimensionar titulo final" (mousedown)="beginTransform($event, 'end-title', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar titulo final" (mousedown)="beginTransform($event, 'end-title', 'stretch')"></button>
        </div>

        <div class="design-box" data-design-kind="end-desc" [class.design-active]="designMode" [class.design-selected]="isSelected('end-desc')" [ngStyle]="boxStyle('end-desc')" (mousedown)="selectBox($event, 'end-desc')">
          <button class="move-handle" type="button" aria-label="Mover descripcion final" (mousedown)="beginTransform($event, 'end-desc', 'move')"></button>
          <p
            [style.font-size]="dynamicFontSize('end-desc', 16, 4)"
            [attr.contenteditable]="designMode ? 'true' : null"
            [class.design-editable]="designMode"
            (blur)="designMode && emitEditable($event, descriptionChange)">
            {{ survey.metadata?.endDescription || survey.metadata?.thankYouDescription || 'Tu respuesta ha sido registrada exitosamente.' }}
          </p>
          <button class="resize-handle" type="button" aria-label="Redimensionar descripcion final" (mousedown)="beginTransform($event, 'end-desc', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar descripcion final" (mousedown)="beginTransform($event, 'end-desc', 'stretch')"></button>
        </div>

        <div class="design-box" data-design-kind="end-summary" [class.design-active]="designMode" [class.design-selected]="isSelected('end-summary')" [ngStyle]="boxStyle('end-summary')" (mousedown)="selectBox($event, 'end-summary')">
          <button class="move-handle" type="button" aria-label="Mover resumen" (mousedown)="beginTransform($event, 'end-summary', 'move')"></button>
          <div class="thanks-summary" [style.font-size]="dynamicFontSize('end-summary', 14, 3)">
            <span>Respuesta recibida</span>
            <span>Envio seguro</span>
          </div>
          <button class="resize-handle" type="button" aria-label="Redimensionar resumen" (mousedown)="beginTransform($event, 'end-summary', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar resumen" (mousedown)="beginTransform($event, 'end-summary', 'stretch')"></button>
        </div>

        <div class="design-box" data-design-kind="end-brand" [class.design-active]="designMode" [class.design-selected]="isSelected('end-brand')" [ngStyle]="boxStyle('end-brand')" (mousedown)="selectBox($event, 'end-brand')">
          <button class="move-handle" type="button" aria-label="Mover marca" (mousedown)="beginTransform($event, 'end-brand', 'move')"></button>
          <div class="thanks-brand" [style.font-size]="dynamicFontSize('end-brand', 12, 2)">Powered by DataEncuesta</div>
          <button class="resize-handle" type="button" aria-label="Redimensionar marca" (mousedown)="beginTransform($event, 'end-brand', 'resize')"></button>
          <button class="stretch-handle" type="button" aria-label="Estirar marca" (mousedown)="beginTransform($event, 'end-brand', 'stretch')"></button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      container-type: inline-size;
    }

    .thanks-shell {
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: clamp(24px, 5vw, 72px);
      position: relative;
      z-index: 1;
    }

    .thanks-card {
      position: relative;
      width: min(680px, 100%);
      padding: clamp(32px, 6vw, 64px);
      border-radius: var(--response-card-radius, 28px);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.88)),
        var(--response-surface, #ffffff);
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 28px 90px rgba(15, 23, 42, 0.16);
      text-align: center;
      color: var(--response-heading, #111827);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .thanks-card.positioned-layout {
      position: relative;
    }

    .design-box {
      position: relative;
      box-sizing: border-box;
    }

    .positioned-layout > .design-box {
      position: absolute;
      min-width: 44px;
      min-height: 24px;
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

    .thanks-rule {
      width: 100%;
      height: 100%;
      margin: 0 auto 34px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--response-primary, #440789), var(--response-secondary, #06b6d4));
    }

    .thanks-logo {
      width: 100%;
      height: 100%;
      object-fit: contain;
      margin: 0 auto 26px;
      display: block;
    }

    .thanks-icon {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      margin: 0 auto 24px;
      border-radius: 999px;
      color: var(--response-primary, #440789);
      background: color-mix(in srgb, var(--response-primary, #440789) 12%, white);
      font-weight: 950;
      font-size: 28px;
    }

    h1 {
      margin: 0;
      font-family: var(--response-title-font, Inter, sans-serif);
      font-size: clamp(32px, 5vw, 52px);
      line-height: 1.08;
    }

    p {
      margin: 18px auto 0;
      max-width: 440px;
      color: var(--response-muted, #64748b);
      line-height: 1.65;
      font-size: 17px;
    }

    .thanks-summary {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 28px;
    }

    .thanks-summary span {
      padding: 9px 13px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.05);
      color: var(--response-muted, #64748b);
      font-size: 13px;
      font-weight: 800;
    }

    .thanks-brand {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid var(--response-border, #e2e8f0);
      color: var(--response-primary, #440789);
      font-size: 14px;
      font-weight: 850;
    }

    .positioned-layout .thanks-rule,
    .positioned-layout .thanks-logo,
    .positioned-layout .thanks-icon,
    .positioned-layout p,
    .positioned-layout .thanks-summary,
    .positioned-layout .thanks-brand {
      margin: 0 auto;
    }

    .layout-receipt .thanks-card {
      width: min(560px, 100%);
      padding: clamp(30px, 5vw, 54px);
      border-radius: 12px;
      background:
        linear-gradient(90deg, transparent 0 10px, rgba(15,23,42,0.05) 10px 12px, transparent 12px) top left / 22px 1px repeat-x,
        linear-gradient(180deg, #ffffff, color-mix(in srgb, var(--response-bg, #f5f3ff) 24%, #ffffff));
      box-shadow: 0 20px 58px rgba(15, 23, 42, 0.12);
      text-align: left;
    }

    .layout-receipt .thanks-rule {
      height: 1px;
      margin-bottom: 28px;
      background: repeating-linear-gradient(90deg, var(--response-primary, #440789) 0 10px, transparent 10px 18px);
    }

    .layout-receipt .thanks-icon {
      margin-left: 0;
      width: 58px;
      height: 58px;
      border-radius: 14px;
    }

    .layout-receipt p {
      margin-left: 0;
    }

    .layout-receipt .thanks-summary {
      justify-content: flex-start;
      border-top: 1px dashed var(--response-border, #e2e8f0);
      padding-top: 20px;
    }

    .layout-split .thanks-card {
      width: min(920px, 100%);
      display: grid;
      grid-template-columns: 190px minmax(0, 1fr);
      column-gap: clamp(26px, 5vw, 54px);
      align-items: center;
      text-align: left;
    }

    .layout-split .thanks-rule,
    .layout-split [data-design-kind="logo"],
    .layout-split [data-design-kind="end-icon"] {
      grid-column: 1;
    }

    .layout-split [data-design-kind="end-title"],
    .layout-split [data-design-kind="end-desc"],
    .layout-split [data-design-kind="end-summary"],
    .layout-split [data-design-kind="end-brand"] {
      grid-column: 2;
    }

    .layout-split .thanks-icon {
      width: 136px;
      height: 136px;
      font-size: 48px;
      margin: 0;
    }

    .layout-split p {
      margin-left: 0;
    }

    .layout-split .thanks-summary {
      justify-content: flex-start;
    }

    .layout-celebration .thanks-card {
      width: min(760px, 100%);
      padding-top: clamp(48px, 8vw, 88px);
      background:
        radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--response-secondary, #06b6d4) 22%, transparent), transparent 30%),
        radial-gradient(circle at 84% 6%, color-mix(in srgb, var(--response-primary, #440789) 24%, transparent), transparent 28%),
        linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.88)),
        var(--response-surface, #ffffff);
    }

    .layout-celebration .thanks-rule {
      width: 96px;
      height: 96px;
      margin-bottom: -72px;
      border-radius: 50%;
      opacity: 0.12;
    }

    .layout-celebration .thanks-icon {
      width: 104px;
      height: 104px;
      font-size: 42px;
      box-shadow: 0 20px 56px color-mix(in srgb, var(--response-primary, #440789) 22%, transparent);
    }

    .layout-celebration h1 {
      font-size: clamp(38px, 6vw, 68px);
    }

    .layout-spotlight .thanks-card {
      width: min(760px, 100%);
      padding-top: clamp(54px, 8vw, 92px);
      background:
        radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--response-primary, #440789) 24%, transparent), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.86)),
        var(--response-surface, #ffffff);
    }

    .layout-spotlight .thanks-card::before {
      content: "";
      position: absolute;
      left: 50%;
      top: -120px;
      width: 360px;
      height: 360px;
      transform: translateX(-50%);
      border-radius: 50%;
      background: radial-gradient(circle, color-mix(in srgb, var(--response-secondary, #06b6d4) 26%, transparent), transparent 62%);
      pointer-events: none;
    }

    .layout-spotlight .thanks-icon {
      width: 112px;
      height: 112px;
      font-size: 44px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--response-primary, #440789), var(--response-secondary, #06b6d4));
      box-shadow: 0 26px 70px color-mix(in srgb, var(--response-primary, #440789) 32%, transparent);
    }

    .layout-certificate .thanks-card {
      width: min(820px, 100%);
      padding: clamp(40px, 6vw, 78px);
      border-radius: 8px;
      background:
        linear-gradient(#ffffff, #ffffff) padding-box,
        linear-gradient(135deg, var(--response-primary, #440789), var(--response-secondary, #06b6d4)) border-box;
      border: 8px solid transparent;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
    }

    .layout-certificate .thanks-rule {
      width: 180px;
      height: 2px;
      margin-bottom: 34px;
    }

    .layout-certificate .thanks-icon {
      width: 78px;
      height: 78px;
      border-radius: 16px;
      transform: rotate(45deg);
    }

    .layout-certificate .thanks-icon::first-letter {
      display: inline-block;
      transform: rotate(-45deg);
    }

    .layout-certificate h1 {
      font-family: var(--response-title-font, Georgia, serif);
      font-size: clamp(36px, 6vw, 64px);
    }

    .layout-timeline .thanks-card {
      width: min(860px, 100%);
      display: grid;
      grid-template-columns: 74px minmax(0, 1fr);
      column-gap: 28px;
      text-align: left;
    }

    .layout-timeline .thanks-rule {
      grid-row: 1 / span 5;
      width: 4px;
      height: 100%;
      margin: 0 auto;
      background: linear-gradient(180deg, var(--response-primary, #440789), var(--response-secondary, #06b6d4));
    }

    .layout-timeline [data-design-kind="end-icon"] {
      grid-column: 1;
      grid-row: 1;
      align-self: start;
    }

    .layout-timeline [data-design-kind="end-title"],
    .layout-timeline [data-design-kind="end-desc"],
    .layout-timeline [data-design-kind="end-summary"],
    .layout-timeline [data-design-kind="end-brand"] {
      grid-column: 2;
    }

    .layout-timeline .thanks-icon {
      width: 58px;
      height: 58px;
      margin: 0;
      border-radius: 18px;
    }

    .layout-timeline p {
      margin-left: 0;
    }

    .layout-timeline .thanks-summary {
      justify-content: flex-start;
    }

    .layout-compact .thanks-card {
      width: min(520px, 100%);
      padding: 28px;
      border-radius: 16px;
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr);
      gap: 16px;
      text-align: left;
      box-shadow: 0 16px 42px rgba(15, 23, 42, 0.1);
    }

    .layout-compact .thanks-rule,
    .layout-compact [data-design-kind="logo"],
    .layout-compact [data-design-kind="end-summary"],
    .layout-compact [data-design-kind="end-brand"] {
      display: none;
    }

    .layout-compact [data-design-kind="end-icon"] {
      grid-column: 1;
      grid-row: 1 / span 2;
    }

    .layout-compact [data-design-kind="end-title"],
    .layout-compact [data-design-kind="end-desc"] {
      grid-column: 2;
    }

    .layout-compact .thanks-icon {
      width: 54px;
      height: 54px;
      margin: 0;
      border-radius: 14px;
      font-size: 24px;
    }

    .layout-compact h1 {
      font-size: 28px;
    }

    .layout-compact p {
      margin: 6px 0 0;
      font-size: 15px;
    }

    @container (max-width: 640px) {
      .layout-split .thanks-card,
      .layout-timeline .thanks-card,
      .layout-compact .thanks-card {
        grid-template-columns: 1fr;
        text-align: center;
      }

      .layout-split [data-design-kind],
      .layout-timeline [data-design-kind],
      .layout-compact [data-design-kind] {
        grid-column: 1;
        grid-row: auto;
      }

      .layout-split .thanks-icon,
      .layout-timeline .thanks-icon,
      .layout-compact .thanks-icon {
        margin: 0 auto 16px;
      }

      .layout-timeline .thanks-rule {
        display: none;
      }

      .thanks-card.positioned-layout {
        min-height: auto !important;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .positioned-layout > .design-box {
        position: relative !important;
        left: auto !important;
        top: auto !important;
        width: 100% !important;
        height: auto !important;
        margin: 0 auto 16px !important;
        transform: none !important;
      }
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
  `]
})
export class SurveyThankYouScreenComponent {
  @Input({ required: true }) survey!: Survey;
  @Input({ required: true }) brand!: SurveyBrand;
  @Input() designMode = false;
  @Output() titleChange = new EventEmitter<string>();
  @Output() descriptionChange = new EventEmitter<string>();
  @Output() transformStart = new EventEmitter<{ event: MouseEvent; kind: EndDesignKind; mode: TransformMode; frame?: SurveyElementConfig; frames?: Record<string, SurveyElementConfig> }>();
  selectedKind: EndDesignKind | null = null;

  endLayout(): NonNullable<Survey['metadata']>['endLayout'] {
    return this.survey.metadata?.endLayout ?? 'centered';
  }

  private readonly defaults: Record<EndDesignKind, SurveyElementConfig> = {
    'end-rule': { x: 64, y: 0, width: 420, height: 8 },
    logo: { x: 199, y: 42, width: 150, height: 64 },
    'end-icon': { x: 233, y: 130, width: 82, height: 52 },
    'end-title': { x: 34, y: 212, width: 480, height: 120 },
    'end-desc': { x: 54, y: 356, width: 440, height: 84 },
    'end-summary': { x: 94, y: 468, width: 360, height: 48 },
    'end-brand': { x: 64, y: 548, width: 420, height: 54 }
  };

  emitEditable(event: Event, output: EventEmitter<string>): void {
    output.emit((event.target as HTMLElement).innerText.trim());
  }

  preventEditableEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    (event.target as HTMLElement).blur();
  }

  beginTransform(event: MouseEvent, kind: EndDesignKind, mode: TransformMode): void {
    if (!this.designMode) return;
    this.selectedKind = kind;
    this.transformStart.emit({ event, kind, mode, frame: this.measureFrame(event), frames: this.measureSiblingFrames(event) });
  }

  selectBox(event: MouseEvent, kind: EndDesignKind): void {
    if (!this.designMode) return;
    event.stopPropagation();
    this.selectedKind = kind;
  }

  isSelected(kind: EndDesignKind): boolean {
    return this.designMode && this.selectedKind === kind;
  }

  fontSize(kind: EndDesignKind): number | null {
    return this.configFor(kind).fontSize ?? null;
  }

  dynamicFontSize(kind: EndDesignKind, minPx: number, cqi: number): string | null {
    const size = this.fontSize(kind);
    if (!size) return null;
    return `clamp(${minPx}px, ${cqi}cqi, ${size}px)`;
  }

  boxStyle(kind: EndDesignKind): Record<string, string> {
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
    return this.hasStoredConfig('logo')
      || this.hasStoredConfig('end-rule')
      || this.hasStoredConfig('end-icon')
      || this.hasStoredConfig('end-title')
      || this.hasStoredConfig('end-desc')
      || this.hasStoredConfig('end-summary')
      || this.hasStoredConfig('end-brand');
  }

  positionedHeight(): number | null {
    if (!this.usesPositionedLayout()) return null;
    return this.maxElementBottom([
      this.configFor('end-rule'),
      this.brand.logoUrl ? this.configFor('logo') : undefined,
      this.configFor('end-icon'),
      this.configFor('end-title'),
      this.configFor('end-desc'),
      this.configFor('end-summary'),
      this.configFor('end-brand')
    ], 28);
  }

  private configFor(kind: EndDesignKind): SurveyElementConfig {
    const metadata = this.survey.metadata;
    const stored = kind === 'logo' ? this.brand.logoConfig
      : kind === 'end-rule' ? metadata?.endRuleConfig
      : kind === 'end-icon' ? metadata?.endIconConfig
      : kind === 'end-title' ? metadata?.endTitleConfig
      : kind === 'end-desc' ? metadata?.endDescConfig
      : kind === 'end-summary' ? metadata?.endSummaryConfig
      : metadata?.endBrandConfig;
    return { ...this.defaults[kind], ...(stored ?? {}) };
  }

  private hasStoredConfig(kind: EndDesignKind): boolean {
    const metadata = this.survey.metadata;
    return kind === 'logo' ? this.brand.logoConfig?.positioned === true
      : kind === 'end-rule' ? metadata?.endRuleConfig?.positioned === true
      : kind === 'end-icon' ? metadata?.endIconConfig?.positioned === true
      : kind === 'end-title' ? metadata?.endTitleConfig?.positioned === true
      : kind === 'end-desc' ? metadata?.endDescConfig?.positioned === true
      : kind === 'end-summary' ? metadata?.endSummaryConfig?.positioned === true
      : metadata?.endBrandConfig?.positioned === true;
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
    return !!element?.closest('[contenteditable="true"], input, textarea, select, .move-handle, .resize-handle, .stretch-handle');
  }
}
