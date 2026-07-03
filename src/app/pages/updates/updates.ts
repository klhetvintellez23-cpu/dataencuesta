import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavbarComponent } from '../../components/navbar/navbar';
import { FooterComponent } from '../../components/footer/footer';

@Component({
  selector: 'app-updates',
  imports: [NavbarComponent, FooterComponent],
  templateUrl: './updates.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .magazine-layout {
      font-family: 'Epilogue', sans-serif;
      background-color: #fdfcff;
      color: #1d1b20;
    }
    .magazine-header {
      padding: 8rem 2rem 4rem;
      text-align: center;
      border-bottom: 2px solid #1d1b20;
      max-width: 1200px;
      margin: 0 auto;
    }
    .magazine-title {
      font-size: clamp(2.4rem, 11vw, 5rem);
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: -0.04em;
      line-height: 0.9;
      margin-bottom: 1rem;
      overflow-wrap: break-word;
    }
    .magazine-subtitle {
      font-size: 1.5rem;
      font-weight: 300;
      color: #49454e;
      text-transform: uppercase;
      letter-spacing: 0.2em;
    }
    .magazine-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 2rem;
      max-width: 1200px;
      margin: 4rem auto;
      padding: 0 2rem;
    }
    .magazine-article {
      border-top: 4px solid #440789;
      padding-top: 1.5rem;
    }
    .magazine-article.featured {
      grid-column: span 12;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
    }
    @media (max-width: 768px) {
      .magazine-article.featured {
        grid-template-columns: 1fr;
        gap: 2rem;
      }
    }
    .magazine-article.secondary {
      grid-column: span 6;
    }
    @media (max-width: 768px) {
      .magazine-article.secondary {
        grid-column: span 12;
      }
    }
    .magazine-article.tertiary {
      grid-column: span 4;
      border-top: 1px solid #d1c8de;
    }
    @media (max-width: 1024px) {
      .magazine-article.tertiary {
        grid-column: span 6;
      }
    }
    @media (max-width: 768px) {
      .magazine-article.tertiary {
        grid-column: span 12;
      }
    }
    .article-tag {
      font-size: 0.85rem;
      font-weight: 800;
      text-transform: uppercase;
      color: #440789;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
      display: inline-block;
    }
    .article-title {
      font-size: 3rem;
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 1rem;
      letter-spacing: -0.02em;
    }
    .secondary .article-title {
      font-size: 2.2rem;
    }
    .tertiary .article-title {
      font-size: 1.5rem;
    }
    .article-excerpt {
      font-size: 1.15rem;
      line-height: 1.6;
      color: #49454e;
      margin-bottom: 1.5rem;
    }
    .article-date {
      font-size: 0.9rem;
      font-weight: 600;
      color: #625b71;
      border-top: 1px solid #eee;
      padding-top: 1rem;
      margin-top: 1rem;
    }
    .drop-cap:first-letter {
      float: left;
      font-size: 4.5rem;
      line-height: 0.8;
      font-weight: 900;
      padding-top: 0.5rem;
      padding-right: 0.5rem;
      color: #440789;
    }
  `]
})
export class UpdatesPage {
  readonly updatesList = [
    {
      type: 'new',
      tag: 'NUEVA FUNCIÓN',
      title: 'Nuevo editor de encuestas v2',
      description: 'Hemos rediseñado por completo el editor de encuestas. Ahora incluye una barra lateral premium inspirada en herramientas modernas de diseño, soporte para personalización avanzada de temas y vistas en tiempo real con micro-animaciones.',
      date: '30 de Mayo, 2026'
    },
    {
      type: 'improvement',
      tag: 'MEJORA',
      title: 'Optimización de rendimiento y velocidad',
      description: 'Redujimos el tamaño de los recursos CSS principales del editor, logrando cargar y compilar estilos de manera instantánea por debajo de los límites presupuestarios establecidos.',
      date: '24 de Mayo, 2026'
    },
    {
      type: 'new',
      tag: 'NUEVA FUNCIÓN',
      title: 'Nuevas opciones de exportación',
      description: 'Exporta las respuestas recopiladas en formatos adicionales como PDF optimizado para reportes ejecutivos, Excel con tipado automático y JSON estructurado para integración.',
      date: '18 de Mayo, 2026'
    },
    {
      type: 'fix',
      tag: 'CORRECCIÓN',
      title: 'Corrección de errores reportados',
      description: 'Corregimos la visualización de imágenes decorativas en ciertos navegadores móviles e implementamos mejoras de estabilidad y persistencia local en el almacenamiento.',
      date: '10 de Mayo, 2026'
    }
  ];
}
