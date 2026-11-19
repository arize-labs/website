## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

The site is served under a base path (`/website` on GitHub Pages; dev runs at
`localhost:4321/website/`). Wrap internal root-relative links in `withBase`
from `src/lib/url.ts`; never hard-code `href="/..."` in components.

## Design

Follow [`DESIGN.md`](./DESIGN.md) when adding or changing pages: pick the
page type (index or reading), use `PageLayout`/`PostLayout` for the title
block, and use tokens from `src/styles/tokens.css` only.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
