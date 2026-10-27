import { useEffect, useRef } from 'react'
import { enhanceArticle } from '../services/articleEnhancer'
import type { PublicPage } from '../services/publicSpaceClient'

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

interface PageArticleProps {
  page: PublicPage
  dark: boolean
  onNavigate: (url: string) => void
}

function Arrow({ back }: { back?: boolean }) {
  return (
    <svg className="ps-pager-arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d={back ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} />
    </svg>
  )
}

/** A page of the space: breadcrumb, title, the body the server wrote and
 * the previous and next pages. */
export function PageArticle({ page, dark, onNavigate }: PageArticleProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (body) void enhanceArticle(body, dark)
  }, [page, dark])

  const link = (url: string) => (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    onNavigate(url)
  }

  return (
    <article className="ps-article">
      <header className="ps-article-head">
        {page.trail.length > 0 ? <p className="ps-breadcrumb">{page.trail.join(' / ')}</p> : null}
        <h1 className="ps-article-title">{page.title}</h1>
        {page.description ? <p className="ps-article-description">{page.description}</p> : null}
      </header>
      {/* The server writes this HTML and filters what a note may contain. */}
      <div ref={bodyRef} className="ps-article-body" dangerouslySetInnerHTML={{ __html: page.html }} />
      {page.previous || page.next ? (
        <nav className="ps-pager" aria-label="Páginas vecinas">
          {page.previous ? (
            <a className="ps-pager-card" data-direction="previous" href={page.previous.url} onClick={link(page.previous.url)}>
              <Arrow back />
              <span className="ps-pager-text">
                <span className="ps-pager-label">Anterior</span>
                <span className="ps-pager-title">{page.previous.title}</span>
              </span>
            </a>
          ) : <span />}
          {page.next ? (
            <a className="ps-pager-card" data-direction="next" href={page.next.url} onClick={link(page.next.url)}>
              <span className="ps-pager-text">
                <span className="ps-pager-label">Siguiente</span>
                <span className="ps-pager-title">{page.next.title}</span>
              </span>
              <Arrow />
            </a>
          ) : null}
        </nav>
      ) : null}
      {page.modifiedAt ? <p className="ps-updated">Última actualización: {DATE_FORMAT.format(new Date(page.modifiedAt))}</p> : null}
    </article>
  )
}
