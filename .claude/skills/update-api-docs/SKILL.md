---
name: update-api-docs
description: >
  Updates the Forgebound frontend API documentation (public/index.html) when new
  endpoints are added or existing ones change. Use this skill whenever new controllers,
  endpoints, or route changes are made to the NestJS backend. Also use it if the user
  mentions updating docs, the landing page, or the API reference. Trigger proactively
  after implementing any new feature that adds or modifies API endpoints.
---

# Update API Docs

When new API endpoints are added to the Forgebound NestJS backend, the static landing
page at `public/index.html` must be updated to document them. This skill handles that.

## What to update

There are two areas in `public/index.html` that need updating:

### 1. Sidebar navigation

The sidebar (`<aside class="sidebar">`) contains grouped sections with links to each
endpoint. Each section looks like:

```html
<div class="sidebar-section">
  <div class="sidebar-heading">Section Name</div>
  <a href="#ep-id"><span class="method-sm post">POST</span> Label</a>
  <a href="#ep-id"><span class="method-sm get">GET</span> Label</a>
</div>
```

- Use class `method-sm get` for GET, `method-sm post` for POST
- The `href` should match the `id` on the endpoint block in main content
- Place new sections in logical order (after Travel: Inventory, Spells, Rest)

### 2. Main content endpoint blocks

Each API section in `<main class="docs-main">` uses this structure:

```html
<div class="endpoint-section" id="section-id">
  <div class="section-label">Section Name</div>
  <div class="section-title">Display Title</div>
  <div class="section-desc">Brief description of this group of endpoints.</div>

  <div class="endpoint-block" id="ep-endpoint-id">
    <div class="endpoint-header">
      <span class="method-badge get">GET</span>
      <code>/api/path</code>
    </div>
    <div class="endpoint-desc">
      What this endpoint does.
    </div>
    <div class="endpoint-meta">
      <span class="meta-tag">Auth: Required</span>
    </div>
    <div class="code-pair">
      <div class="code-block">
        <div class="code-label">Request</div>
        <pre>{ "key": "value" }</pre>
      </div>
      <div class="code-block">
        <div class="code-label">Response</div>
        <pre>{ "result": "data" }</pre>
      </div>
    </div>
  </div>
</div>
```

## Key CSS classes

- `.method-badge get` / `.method-badge post` — colored method label in main content
- `.method-sm get` / `.method-sm post` — small method label in sidebar
- `.endpoint-section` — wraps a group of related endpoints
- `.endpoint-block` — individual endpoint documentation
- `.endpoint-header` — method badge + path
- `.endpoint-desc` — description paragraph
- `.endpoint-meta` — auth requirement tag
- `.code-pair` — container for request/response code blocks
- `.code-block` + `.code-label` + `<pre>` — code sample
- `.meta-tag` — small tag for auth info
- `.auth-chip` — alternative auth indicator

## Auth indicators

- `Auth: Required` — needs Bearer token (most gameplay endpoints)
- `Auth: Optional` — works without token but returns more data with one (map)
- `Auth: None (Public)` — no token needed (game data endpoints)

## Process

1. Read the relevant controller file(s) to see what endpoints exist
2. Read the service file(s) to understand request/response shapes
3. Read the current `public/index.html` to see what's already documented
4. Add missing endpoints following the patterns above
5. Insert new sections before the `<!-- REFERENCE -->` comment
6. Keep the existing endpoint sections in order: Auth > Game Data > Characters > Map > Travel > Inventory > Spells > Rest > Reference

## Tips

- JSON in `<pre>` tags should be nicely formatted with 2-space indentation
- Show realistic example data, not lorem ipsum
- For endpoints with notable constraints, add a muted description below the code:
  ```html
  <div class="endpoint-desc" style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted);">
    Valid values: <code>north</code>, <code>south</code>, ...
  </div>
  ```
- Don't use `<span class="key">` syntax highlighting in the new blocks — the newer
  endpoint sections use plain JSON text in `<pre>` tags
