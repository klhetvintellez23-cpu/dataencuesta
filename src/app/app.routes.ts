import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing').then(m => m.LandingPage)
  },
  {
    path: 'tour',
    loadComponent: () => import('./pages/tour/tour').then(m => m.TourPage)
  },
  {
    path: 'showcase',
    loadComponent: () => import('./pages/showcase/showcase').then(m => m.ShowcasePage)
  },
  {
    path: 'api-docs',
    loadComponent: () => import('./pages/api-docs/api-docs').then(m => m.ApiDocsPage)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardPage)
  },
  {
    path: 'editor/new',
    loadComponent: () => import('./pages/editor/editor').then(m => m.EditorPage),
    data: { preload: true }
  },
  {
    path: 'editor/:id',
    loadComponent: () => import('./pages/editor/editor').then(m => m.EditorPage),
    data: { preload: true }
  },
  {
    path: 'analytics/:id',
    redirectTo: 'editor/:id'
  },
  {
    path: 'survey/:id',
    loadComponent: () => import('./pages/survey-response/survey-response').then(m => m.SurveyResponsePage)
  },
  {
    path: 'templates',
    loadComponent: () => import('./pages/templates/templates').then(m => m.TemplatesPage)
  },
  {
    path: 'nosotros',
    loadComponent: () => import('./pages/about/about').then(m => m.AboutPage)
  },
  {
    path: 'novedades',
    loadComponent: () => import('./pages/updates/updates').then(m => m.UpdatesPage)
  },
  {
    path: 'terminos',
    loadComponent: () => import('./pages/terms/terms').then(m => m.TermsPage)
  },
  {
    path: 'privacidad',
    loadComponent: () => import('./pages/privacy/privacy').then(m => m.PrivacyPage)
  },
  {
    path: 'templates/:id',
    loadComponent: () => import('./pages/template-details/template-details').then(m => m.TemplateDetailsPage)
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadChildren: () => import('./pages/admin/admin.routes').then(m => m.adminRoutes)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
