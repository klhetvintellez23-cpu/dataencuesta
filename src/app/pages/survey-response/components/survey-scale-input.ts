import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-survey-scale-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="scale-wrap" [class.is-stars]="variant === 'stars'">
      <div class="scale-grid" [class.ten-grid]="values.length > 5">
        @for (value of values; track value) {
          <button
            type="button"
            class="scale-button"
            [class.selected]="value === selected"
            (click)="valueChange.emit(value)"
            [attr.aria-pressed]="value === selected">
            @if (variant === 'stars') {
              <span class="star">★</span>
            } @else {
              {{ value }}
            }
          </button>
        }
      </div>

      @if (showLabels) {
        <div class="scale-labels">
          <span>{{ minLabel }}</span>
          <span>{{ maxLabel }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .scale-wrap {
      display: grid;
      gap: 12px;
    }

    .scale-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(56px, 1fr));
      gap: 12px;
    }

    .scale-grid.ten-grid {
      grid-template-columns: repeat(auto-fit, minmax(50px, 1fr));
    }

    .scale-button {
      min-height: 58px;
      border: 1px solid var(--response-border, #e2e8f0);
      border-radius: var(--response-button-radius, 16px);
      background: var(--response-answer-bg, #ffffff);
      color: var(--response-heading, #111827);
      font: inherit;
      font-size: 18px;
      font-weight: 850;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
    }

    .scale-button:hover {
      transform: translateY(-2px);
      border-color: color-mix(in srgb, var(--response-primary, #440789) 55%, white);
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.1);
    }

    .scale-button.selected {
      background: linear-gradient(135deg, var(--response-primary, #440789), var(--response-secondary, #06b6d4));
      color: #ffffff;
      border-color: transparent;
      box-shadow: 0 16px 34px color-mix(in srgb, var(--response-primary, #440789) 28%, transparent);
    }

    .is-stars .scale-grid {
      grid-template-columns: repeat(5, minmax(48px, 1fr));
      max-width: 440px;
    }

    .star {
      font-size: 25px;
      line-height: 1;
    }

    .scale-labels {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      color: var(--response-muted, #64748b);
      font-size: 13px;
      font-weight: 700;
    }

    @container (max-width: 520px) {
      .scale-grid,
      .scale-grid.ten-grid,
      .is-stars .scale-grid {
        grid-template-columns: repeat(auto-fit, minmax(42px, 1fr));
        gap: 8px;
        max-width: 100%;
      }

      .scale-button {
        min-height: 48px;
        font-size: 16px;
      }
    }
  `]
})
export class SurveyScaleInputComponent {
  @Input() values: number[] = [];
  @Input() selected?: number;
  @Input() variant: 'number' | 'stars' = 'number';
  @Input() showLabels = true;
  @Input() minLabel = 'Bajo';
  @Input() maxLabel = 'Alto';
  @Output() valueChange = new EventEmitter<number>();
}
