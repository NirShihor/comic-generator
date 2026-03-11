import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import ComicList from './pages/ComicList';
import ComicEditor from './pages/ComicEditor';
import ComicSettings from './pages/ComicSettings';
import PageEditor from './pages/PageEditor';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="navbar">
          <Link to="/" className="nav-brand">Comic Generator</Link>
        </nav>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<ComicList />} />
            <Route path="/comic/:id" element={<ComicEditor />} />
            <Route path="/comic/:id/settings" element={<ComicSettings />} />
            <Route path="/comic/:id/page/:pageId" element={<PageEditor />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
