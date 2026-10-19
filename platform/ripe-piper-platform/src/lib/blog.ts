import { Marked } from "marked";

/** Server-rendered blog pages (SEO-friendly) built from CMS posts and the site's shared page shell. */

const md = new Marked({ gfm: true, breaks: false });
// Raw HTML in posts is shown as text, so a post can never inject scripts into the page.
md.use({ renderer: { html: (token: any) => escapeHtml(typeof token === "string" ? token : token.text ?? "") } });

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMarkdown(src: string): string {
  // Headings get ids so a table of contents can link to them.
  const html = md.parse(src, { async: false }) as string;
  return html.replace(/<h2>(.*?)<\/h2>/g, (_m, t) => `<h2 id="${slug(t)}">${t}</h2>`);
}

export function slug(s: string): string {
  return s.replace(/<[^>]+>/g, "").toLowerCase().replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function readingMinutes(src: string): number {
  return Math.max(1, Math.round(src.split(/\s+/).filter(Boolean).length / 220));
}

export interface Post { slug: string; title: string; description: string; body_md: string; cover_path: string | null; cover_alt: string | null; author_name: string; published_at: string; updated_at: string }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });

/** Fill the shell exported by the website build (blog-shell.html) with page-specific content. */
export function fillShell(shell: string, p: { title: string; description: string; canonical: string; body: string; jsonld: object[] }): string {
  return shell
    .replace(/\{\{TITLE\}\}/g, escapeHtml(p.title))
    .replace(/\{\{DESC\}\}/g, escapeHtml(p.description))
    .replace(/\{\{CANONICAL\}\}/g, p.canonical)
    .replace("{{JSONLD}}", p.jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join(""))
    .replace("{{BODY}}", p.body);
}

export function postPage(site: string, post: Post): { title: string; description: string; canonical: string; body: string; jsonld: object[] } {
  const canonical = `${site}/blog/${post.slug}`;
  const html = renderMarkdown(post.body_md);
  const toc = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)].map(m => `<a href="#${m[1]}">${m[2]}</a>`).join("");
  const cover = post.cover_path ? `<figure class="photo wide plain"><img src="${escapeHtml(post.cover_path)}" alt="${escapeHtml(post.cover_alt ?? "")}" width="960" height="540"></figure>` : "";
  const body = `
<section class="page-hero"><div class="wrap"><div class="copy narrow">
  <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="/">Home</a></li><li><a href="/blog/">Blog</a></li><li aria-current="page">${escapeHtml(post.title)}</li></ol></nav>
  <h1>${escapeHtml(post.title)}</h1>
  <p class="meta"><span>By ${escapeHtml(post.author_name)}</span><span>Published ${fmtDate(post.published_at)}</span><span>Updated ${fmtDate(post.updated_at)}</span><span>${readingMinutes(post.body_md)} min read</span></p>
</div></div></section>
<section><div class="wrap prose-wrap">
  <article class="prose">${cover}${html}</article>
  <aside class="aside">
    <nav class="toc" aria-label="On this page"><span class="kicker">On this page</span>${toc}</nav>
    <div class="formbox"><h3>Want us to do this for you?</h3><p class="muted">We run this process for B2B companies in the UAE and India.</p>
      <a class="btn btn-dark" href="/book">Book a 15-minute call<span class="ms" aria-hidden="true">arrow_forward</span></a></div>
  </aside>
</div></section>`;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Article", headline: post.title, description: post.description, datePublished: post.published_at, dateModified: post.updated_at,
      author: { "@type": "Person", name: post.author_name }, publisher: { "@type": "Organization", name: "Ripe Piper" }, mainEntityOfPage: canonical,
      ...(post.cover_path ? { image: post.cover_path } : {}) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: site + "/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: site + "/blog/" },
      { "@type": "ListItem", position: 3, name: post.title, item: canonical }] },
  ];
  return { title: `${post.title} | Ripe Piper`, description: post.description, canonical, body, jsonld };
}

export function indexPage(site: string, posts: Post[]): { title: string; description: string; canonical: string; body: string; jsonld: object[] } {
  const cards = posts.map(p => `<a class="card-link" href="/blog/${p.slug}">${p.cover_path ? `<figure class="photo"><img src="${escapeHtml(p.cover_path)}" alt="${escapeHtml(p.cover_alt ?? "")}" loading="lazy" width="960" height="540"></figure>` : ""}
  <span class="meta"><span>Article</span><span>${readingMinutes(p.body_md)} min read</span><span>${fmtDate(p.published_at)}</span></span><h3>${escapeHtml(p.title)}</h3><p class="muted">${escapeHtml(p.description)}</p></a>`).join("");
  const body = `
<section class="page-hero"><div class="wrap"><div class="copy narrow">
  <nav aria-label="Breadcrumb"><ol class="crumbs"><li><a href="/">Home</a></li><li aria-current="page">Blog</li></ol></nav>
  <h1>The Ripe Piper blog</h1>
  <p class="lede">Practical articles on B2B lead generation in the UAE and India, based on the work we do every day. Each article lists its sources so you can check the facts.</p>
</div></div></section>
<section><div class="wrap"><div class="cards">${cards || '<p class="muted">New articles are on their way.</p>'}</div></div></section>`;
  return {
    title: "Blog | B2B Lead Generation in the UAE and India | Ripe Piper",
    description: "Practical articles on B2B lead generation in the UAE and India: reactivating old leads, cold email rules, sending limits and data protection.",
    canonical: `${site}/blog/`, body,
    jsonld: [{ "@context": "https://schema.org", "@type": "Blog", name: "Ripe Piper blog", url: `${site}/blog/` }],
  };
}
