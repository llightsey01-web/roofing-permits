export default function DartiqLegalLayout({ title, children }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .dartiq-legal-page {
          min-height: 100vh;
          background: #0f172a;
          color: #ffffff;
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          line-height: 1.7;
          overflow-x: hidden;
        }
        .dartiq-legal-header {
          border-bottom: 1px solid #334155;
          padding: 20px 24px;
        }
        .dartiq-legal-header a {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          color: #ffffff;
        }
        .dartiq-legal-logo {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 15px;
          color: #fff;
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.35);
        }
        .dartiq-legal-brand {
          font-size: 18px;
          font-weight: 700;
        }
        .dartiq-legal-main {
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 24px 56px;
          box-sizing: border-box;
        }
        .dartiq-legal-main > h1 {
          font-size: 2rem;
          font-weight: 700;
          margin: 0 0 8px;
          color: #ffffff;
        }
        .dartiq-legal-content {
          word-wrap: break-word;
          overflow-wrap: anywhere;
        }
        .dartiq-legal-content h1,
        .dartiq-legal-content h2,
        .dartiq-legal-content h3 {
          color: #ffffff;
          font-family: inherit;
        }
        .dartiq-legal-content h1 {
          font-size: 2rem;
          font-weight: 700;
          margin: 0 0 12px;
        }
        .dartiq-legal-content h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 32px 0 12px;
        }
        .dartiq-legal-content h3 {
          font-size: 1.05rem;
          font-weight: 600;
          margin: 24px 0 8px;
          color: #e2e8f0;
        }
        .dartiq-legal-content p,
        .dartiq-legal-content li,
        .dartiq-legal-content span,
        .dartiq-legal-content td,
        .dartiq-legal-content th {
          color: #e2e8f0;
          font-size: 15px;
          font-family: inherit;
        }
        .dartiq-legal-content ul,
        .dartiq-legal-content ol {
          padding-left: 1.5rem;
          margin: 12px 0;
        }
        .dartiq-legal-content li {
          margin-bottom: 8px;
        }
        .dartiq-legal-content a {
          color: #3b82f6 !important;
          text-decoration: underline;
        }
        .dartiq-legal-content a:hover {
          color: #60a5fa !important;
        }
        .dartiq-legal-content strong {
          color: #ffffff;
        }
        .dartiq-legal-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          display: block;
          overflow-x: auto;
        }
        .dartiq-legal-content th,
        .dartiq-legal-content td {
          border: 1px solid #334155 !important;
          padding: 10px;
          vertical-align: top;
          background: transparent !important;
        }
        .dartiq-legal-content [data-custom-class='body'],
        .dartiq-legal-content [data-custom-class='body'] *,
        .dartiq-legal-content [data-custom-class='body_text'],
        .dartiq-legal-content [data-custom-class='body_text'] *,
        .dartiq-legal-content [data-custom-class='subtitle'],
        .dartiq-legal-content [data-custom-class='subtitle'] * {
          background: transparent !important;
          color: #e2e8f0 !important;
          font-family: inherit !important;
          font-size: 15px !important;
        }
        .dartiq-legal-content [data-custom-class='title'],
        .dartiq-legal-content [data-custom-class='title'] *,
        .dartiq-legal-content [data-custom-class='heading_1'],
        .dartiq-legal-content [data-custom-class='heading_1'] * {
          background: transparent !important;
          color: #ffffff !important;
          font-family: inherit !important;
        }
        .dartiq-legal-content [data-custom-class='heading_2'],
        .dartiq-legal-content [data-custom-class='heading_2'] * {
          background: transparent !important;
          color: #e2e8f0 !important;
          font-family: inherit !important;
        }
        .dartiq-legal-content [data-custom-class='link'],
        .dartiq-legal-content [data-custom-class='link'] * {
          color: #3b82f6 !important;
          font-family: inherit !important;
          word-break: break-word !important;
        }
        .dartiq-legal-footer {
          border-top: 1px solid #334155;
          padding: 24px;
          text-align: center;
          color: #94a3b8;
          font-size: 13px;
        }
        .dartiq-legal-placeholder {
          color: #e2e8f0;
          font-size: 16px;
        }
        .dartiq-legal-placeholder a {
          color: #3b82f6;
        }
        @media (max-width: 768px) {
          .dartiq-legal-header {
            padding: 14px 16px;
          }
          .dartiq-legal-main {
            padding: 28px 16px 40px;
          }
          .dartiq-legal-main > h1,
          .dartiq-legal-content h1 {
            font-size: 1.5rem;
          }
          .dartiq-legal-content h2 {
            font-size: 1.1rem;
          }
          .dartiq-legal-content p,
          .dartiq-legal-content li,
          .dartiq-legal-content span,
          .dartiq-legal-content td,
          .dartiq-legal-content th {
            font-size: 14px;
          }
          .dartiq-legal-footer {
            padding: 20px 16px;
          }
        }
      `}</style>
      <div className="dartiq-legal-page">
        <header className="dartiq-legal-header">
          <a href="/">
            <span className="dartiq-legal-logo">D</span>
            <span className="dartiq-legal-brand">DART iQ</span>
          </a>
        </header>
        <main className="dartiq-legal-main">
          {title ? <h1>{title}</h1> : null}
          {children}
        </main>
        <footer className="dartiq-legal-footer">
          © 2026 Zigamus Technologies, LLC
        </footer>
      </div>
    </>
  )
}
