/**
 * App.jsx — minimal client-side routing.
 *
 * Routes:
 *   /              → UploadForm
 *   /files/:id     → DownloadPage
 *
 * No react-router dependency — a simple path check is sufficient
 * for two routes. Add react-router when the app grows.
 */

import UploadForm from './components/UploadForm';
import DownloadPage from './components/DownloadPage';

function getFileId() {
  const match = window.location.pathname.match(/^\/files\/([a-f0-9]{24})$/);
  return match ? match[1] : null;
}

export default function App() {
  const fileId = getFileId();

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f9fafb; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <header style={{
        padding: '16px 24px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontSize: 20 }}>🔒</span>
        <span style={{
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 18,
          color: '#111',
        }}>
          VaultShare
        </span>
        {fileId && (
          <a
            href="/"
            style={{
              marginLeft: 'auto',
              fontSize: 13,
              color: '#6366f1',
              textDecoration: 'none',
            }}
          >
            Upload a file
          </a>
        )}
      </header>

      <main style={{ padding: '20px 16px' }}>
        {fileId
          ? <DownloadPage fileId={fileId} />
          : <UploadForm />
        }
      </main>
    </>
  );
}