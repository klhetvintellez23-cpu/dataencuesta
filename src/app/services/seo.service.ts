import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface SeoRouteData {
  title?: string;
  description?: string;
  noindex?: boolean;
}

const DOMAIN = 'https://www.dataencuesta.com';
const DEFAULT_TITLE = 'DataEncuesta - Tu plataforma de encuestas y analíticas';
const DEFAULT_DESCRIPTION = 'DataEncuesta: Plataforma de encuestas B2B rápida y práctica. Crea, comparte y analiza resultados con máxima conversión y estilo premium.';

/**
 * Esta app es un SPA sin SSR: todas las rutas comparten el mismo index.html,
 * que traía un <link rel="canonical"> fijo a la home. Eso le decía a Google
 * que cada página era un duplicado de la home ("Página alternativa con
 * etiqueta canónica adecuada" en Search Console), así que dejaba de
 * indexarlas. Este servicio actualiza título, descripción, canonical y
 * robots en cada navegación para que cada ruta declare su propia URL.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly router = inject(Router);

  init(): void {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.apply());

    this.apply();
  }

  private apply(): void {
    const data = this.collectRouteData();
    const title = data.title ? `${data.title} | DataEncuesta` : DEFAULT_TITLE;
    const description = data.description || DEFAULT_DESCRIPTION;
    const url = `${DOMAIN}${this.router.url.split('?')[0].split('#')[0]}`;

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ name: 'robots', content: data.noindex ? 'noindex, nofollow' : 'index, follow' });
    this.setCanonical(url);
  }

  private collectRouteData(): SeoRouteData {
    let snapshot: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    const merged: SeoRouteData = {};
    while (snapshot) {
      const data = snapshot.data as SeoRouteData;
      if (data.title) merged.title = data.title;
      if (data.description) merged.description = data.description;
      if (data.noindex) merged.noindex = true;
      snapshot = snapshot.firstChild;
    }
    return merged;
  }

  private setCanonical(url: string): void {
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}
