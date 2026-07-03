import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing').then(m => m.LandingPage),
    data: {
      description: 'DataEncuesta: Plataforma de encuestas B2B rápida y práctica. Crea, comparte y analiza resultados con máxima conversión y estilo premium.'
    }
  },
  {
    path: 'tour',
    loadComponent: () => import('./pages/tour/tour').then(m => m.TourPage),
    data: {
      title: 'Tour del producto',
      description: 'Recorré las funciones de DataEncuesta: creación de encuestas, distribución y analíticas en un solo lugar.'
    }
  },
  {
    path: 'showcase',
    loadComponent: () => import('./pages/showcase/showcase').then(m => m.ShowcasePage),
    data: {
      title: 'Casos de uso',
      description: 'Ejemplos y casos de uso reales de encuestas creadas con DataEncuesta.'
    }
  },
  {
    path: 'api-docs',
    loadComponent: () => import('./pages/api-docs/api-docs').then(m => m.ApiDocsPage),
    data: {
      title: 'Documentación de la API',
      description: 'Integra DataEncuesta en tus aplicaciones con nuestra API REST.'
    }
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardPage),
    data: { noindex: true }
  },
  {
    path: 'editor/new',
    loadComponent: () => import('./pages/editor/editor').then(m => m.EditorPage),
    data: { preload: true, noindex: true }
  },
  {
    path: 'editor/:id',
    loadComponent: () => import('./pages/editor/editor').then(m => m.EditorPage),
    data: { preload: true, noindex: true }
  },
  {
    path: 'analytics/:id',
    redirectTo: 'editor/:id'
  },
  {
    path: 'survey/:id',
    loadComponent: () => import('./pages/survey-response/survey-response').then(m => m.SurveyResponsePage),
    data: { noindex: true }
  },
  {
    path: 'templates',
    loadComponent: () => import('./pages/templates/templates').then(m => m.TemplatesPage),
    data: {
      title: 'Plantillas de encuestas',
      description: 'Plantillas de encuestas listas para usar: satisfacción, clima laboral, eventos y más.'
    }
  },
  {
    path: 'nosotros',
    loadComponent: () => import('./pages/about/about').then(m => m.AboutPage),
    data: {
      title: 'Acerca de DataEncuesta',
      description: 'Conocé la misión y el equipo detrás de DataEncuesta.'
    }
  },
  {
    path: 'novedades',
    loadComponent: () => import('./pages/updates/updates').then(m => m.UpdatesPage),
    data: {
      title: 'Novedades',
      description: 'Últimas novedades y actualizaciones de DataEncuesta.'
    }
  },
  {
    path: 'terminos',
    loadComponent: () => import('./pages/terms/terms').then(m => m.TermsPage),
    data: {
      title: 'Términos y condiciones',
      description: 'Términos y condiciones de uso de DataEncuesta.'
    }
  },
  {
    path: 'privacidad',
    loadComponent: () => import('./pages/privacy/privacy').then(m => m.PrivacyPage),
    data: {
      title: 'Política de privacidad',
      description: 'Política de privacidad de DataEncuesta.'
    }
  },
  {
    path: 'templates/:id',
    loadComponent: () => import('./pages/template-details/template-details').then(m => m.TemplateDetailsPage),
    data: { title: 'Plantilla de encuesta' }
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadChildren: () => import('./pages/admin/admin.routes').then(m => m.adminRoutes),
    data: { noindex: true }
  },
  {
    path: '**',
    redirectTo: ''
  }
];
