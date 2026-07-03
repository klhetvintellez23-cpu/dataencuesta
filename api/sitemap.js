module.exports = async function handler(req, res) {
  // 1. Configuración de cabeceras para servir XML
  res.setHeader('Content-Type', 'text/xml');

  // 2. Caché HTTP Edge: Fundamental para SEO y rendimiento en Vercel.
  // Cachea el sitemap por 1 hora (s-maxage) y sirve contenido 'stale' mientras revalida de fondo.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  // TODO: Cambia esto por tu dominio real gestionado en Cloudflare
  const DOMAIN = 'https://www.dataencuesta.com';

  // 3. Rutas Estáticas
  // NOTA: /dashboard y /editor/* requieren sesión (no tienen contenido
  // público indexable) y no deben estar en el sitemap.
  const staticRoutes = [
    '',              // Home
    '/tour',
    '/showcase',
    '/api-docs',
    '/templates',
    '/nosotros',
    '/novedades',
    '/terminos',
    '/privacidad'
  ];

  // 4. (Futuro) Rutas Dinámicas desde Base de Datos (ej. Supabase)
  /*
  // Ejemplo de cómo inyectarías rutas dinámicas:
  const dbData = await fetch('https://api.tudominio.com/items').then(r => r.json());
  const dynamicRoutes = dbData.map(item => `/item/${item.slug}`);
  */
  const dynamicRoutes = []; // Array vacío por ahora

  // Combina ambas rutas
  const allRoutes = [...staticRoutes, ...dynamicRoutes];

  // 5. Generación del XML del Sitemap
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${allRoutes
      .map((route) => {
        // Damos mayor prioridad a la home
        const priority = route === '' ? '1.0' : '0.8';
        return `
  <url>
    <loc>${DOMAIN}${route}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${priority}</priority>
  </url>`;
      })
      .join('')}
</urlset>`;

  // Enviar respuesta
  res.status(200).send(sitemap);
};
