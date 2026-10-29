import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import ComicList from './pages/ComicList';
import ComicEditor from './pages/ComicEditor';
import ComicSettings from './pages/ComicSettings';
import PageEditor from './pages/PageEditor';
import ReorderComics from './pages/ReorderComics';
import NotebookAdmin from './pages/NotebookAdmin';
import Backgrounds from './pages/Backgrounds';
import Marketing from './pages/Marketing';
import StoryList from './pages/StoryList';
import StoryWorkshop from './pages/StoryWorkshop';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="navbar">
          <Link to="/" className="nav-brand">Comic Generator</Link>
          <Link to="/backgrounds" style={{ color: '#007bff', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 600 }}>Backgrounds</Link>
          <Link to="/stories" style={{ color: '#007bff', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 600, marginLeft: '1rem' }}>Stories</Link>
        </nav>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<ComicList />} />
            <Route path="/order" element={<ReorderComics />} />
            <Route path="/notebook" element={<NotebookAdmin />} />
            <Route path="/backgrounds" element={<Backgrounds />} />
            <Route path="/marketing" element={<Marketing />} />
            <Route path="/stories" element={<StoryList />} />
            <Route path="/story/:id" element={<StoryWorkshop />} />
            <Route path="/comic/:id" element={<ComicEditor />} />
            <Route path="/comic/:id/settings" element={<ComicSettings />} />
            <Route path="/comic/:id/page/:pageId" element={<PageEditor />} />
            <Route path="/comic/:id/cover" element={<PageEditor isCover />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
