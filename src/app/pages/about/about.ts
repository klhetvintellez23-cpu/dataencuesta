import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavbarComponent } from '../../components/navbar/navbar';
import { FooterComponent } from '../../components/footer/footer';

@Component({
  selector: 'app-about',
  imports: [NavbarComponent, FooterComponent],
  templateUrl: './about.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .blog-container {
      max-width: 768px;
      margin: 0 auto;
      padding: 6rem 2rem;
      font-family: 'Epilogue', sans-serif;
      color: #1d1b20;
    }
    .blog-tag {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: #f1edf7;
      color: #440789;
      border-radius: 999px;
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
    }
    .blog-title {
      font-size: clamp(2rem, 8vw, 3rem);
      line-height: 1.1;
      font-weight: 800;
      margin-bottom: 1.5rem;
      letter-spacing: -0.02em;
      overflow-wrap: break-word;
    }
    .blog-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
      color: #625b71;
      font-size: 0.95rem;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #f0f0f0;
    }
    .blog-content h2 {
      font-size: 2rem;
      font-weight: 700;
      margin-top: 3.5rem;
      margin-bottom: 1.5rem;
      color: #1d1b20;
    }
    .blog-content p {
      font-size: 1.25rem;
      line-height: 1.8;
      color: #49454e;
      margin-bottom: 2rem;
    }
    .blog-content strong {
      color: #1d1b20;
      font-weight: 700;
    }
    .blog-card {
      background: #f8f6fb;
      border-radius: 1.5rem;
      padding: 2rem;
      margin: 2.5rem 0;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .blog-card-icon {
      color: #440789;
      font-size: 2rem;
    }
    .blog-card h3 {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0;
    }
    .blog-card p {
      font-size: 1.15rem;
      margin: 0;
    }
  `]
})
export class AboutPage {
}
