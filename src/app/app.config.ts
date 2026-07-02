import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withPreloading, withViewTransitions } from '@angular/router';

import { routes } from './app.routes';
import { SelectivePreloadStrategy } from './router-preload.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    provideRouter(
      routes,
      withViewTransitions({
        onViewTransitionCreated: ({ transition, to }) => {
          // Skip the animated transition when landing on the editor: it's a very
          // large route and the transition was leaving it unresponsive right after
          // navigating in (e.g. right after creating a survey).
          if (to.routeConfig?.path?.startsWith('editor')) {
            transition.skipTransition();
          }
        }
      }),
      withPreloading(SelectivePreloadStrategy)
    )
  ],
};
