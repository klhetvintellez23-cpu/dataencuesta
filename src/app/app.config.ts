import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withPreloading, withViewTransitions } from '@angular/router';

import { routes } from './app.routes';
import { SelectivePreloadStrategy } from './router-preload.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideRouter(routes, withViewTransitions(), withPreloading(SelectivePreloadStrategy))
  ],
};
