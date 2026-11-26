// The 3D scene when the browser has WebGL (or if it fails to start), and the flat 2D view otherwise. Add ?flat to the address to see the 2D view.
// This is a file of its own, not an inline script, so the page's Content-Security-Policy needs no allowance for inline code.
const canvas = document.createElement('canvas');
const webgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')) && !new URLSearchParams(location.search).has('flat');
(webgl ? import('./scene/main.js').catch((e) => { console.error(e); return import('./page/flat.js'); }) : import('./page/flat.js'));

// Vercel Web Analytics (page views) and Speed Insights (how fast the page loads for real visitors). Both are scripts served by Vercel from this site's own address, so the page's
// Content-Security-Policy needs no new host, and they set no cookie. They exist only on the hosted site, so they are not asked for on localhost, where the address would not be found.
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (!local) for (const path of ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js']) {
  const script = document.createElement('script'); script.defer = true; script.src = path; document.head.append(script);
}
